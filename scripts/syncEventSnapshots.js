#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const SCRAPED_DATA_PATH = path.resolve(ROOT, "src/data/ahecCourses.json");
const OUTPUT_DIR = path.resolve(ROOT, "data");
const ACTIVE_EVENTS_PATH = path.resolve(OUTPUT_DIR, "events_active.json");
const ARCHIVED_EVENTS_PATH = path.resolve(OUTPUT_DIR, "events_archived.json");
const AFFILIATE_ID = "6Q68Q3";
const HOST_ORGANIZATION = "University of Alaska Anchorage Continuing Studies";

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function stripHtml(value) {
  if (!value) return "";

  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocation(location) {
  if (!location) {
    return { location: "Online", city: null, state: null };
  }

  const cleaned = location.replace(/^\*/, "").trim();
  if (!cleaned) {
    return { location: "Online", city: null, state: null };
  }

  if (/online/i.test(cleaned)) {
    return { location: cleaned, city: null, state: null };
  }

  return {
    location: cleaned,
    city: cleaned,
    state: "AK",
  };
}

function toIsoDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function extractTimes(meetingTimeDisplay) {
  if (!meetingTimeDisplay) {
    return { start_time: null, end_time: null };
  }

  const cleaned = stripHtml(meetingTimeDisplay);
  const match = cleaned.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!match) {
    return { start_time: null, end_time: null };
  }

  return {
    start_time: match[1].toUpperCase(),
    end_time: match[2].toUpperCase(),
  };
}

function buildTags(course) {
  const tags = new Set();

  for (const source of [course.Category, course.Keyword]) {
    if (!source) continue;
    for (const part of String(source).split(/[,;|]/)) {
      const value = part.trim();
      if (value) tags.add(value);
    }
  }

  return [...tags];
}

function buildSnapshotRecord(course, today) {
  const location = normalizeLocation(course.Location);
  const times = extractTimes(course.MeetingTimeDisplay);
  const description = stripHtml(course.LongDescription || course.PublicNotes || course.Description);
  const startDate = toIsoDate(course.StartDate);
  const endDate = toIsoDate(course.EndDate) ?? startDate;

  return {
    event_id: course.event_id || `uaa-cache-${course.SectionIndex}`,
    title: course.CourseName,
    description,
    location: location.location,
    city: location.city,
    state: location.state,
    latitude: null,
    longitude: null,
    start_date: startDate,
    end_date: endDate,
    start_time: times.start_time,
    end_time: times.end_time,
    registration_url: course.RegistrationUrl || course.DirectUrl || course.SourceUrl,
    affiliate_id: AFFILIATE_ID,
    host_organization: HOST_ORGANIZATION,
    credits: course.Credits,
    category: course.Category,
    tags: buildTags(course),
    cost: typeof course.Cost === "number" ? course.Cost : typeof course.Price === "number" ? course.Price : null,
    last_updated: today,
    source_url: course.DirectUrl || course.SourceUrl,
    available_for_registration: Boolean(course.AvailableForRegistration),
    seats_available: typeof course.CapAvailable === "number" ? course.CapAvailable : null,
    delivery: course.Delivery || null,
    meeting_time_display: course.MeetingTimeDisplay || null,
    public_notes: course.PublicNotes || null,
    section_index: course.SectionIndex,
  };
}

/**
 * Enduring check: a record with no end_date (or "Ongoing") never expires.
 * It stays active indefinitely and is flagged as enduring.
 */
function isEnduring(record) {
  if (!record.end_date) return true;
  const d = String(record.end_date).toLowerCase();
  return d === "ongoing" || d === "" || d === "2099-12-31";
}

export function splitActiveAndArchived(records, existingActive, existingArchived, today) {
  const archivedById = new Map(existingArchived.map((record) => [record.event_id, record]));
  const currentById = new Map(records.map((record) => [record.event_id, record]));
  const active = [];

  for (const record of records) {
    // Enduring events (no end date / Ongoing) never get archived
    if (isEnduring(record)) {
      active.push({ ...record, is_enduring: true });
      continue;
    }

    if (record.end_date && record.end_date < today) {
      const previous = archivedById.get(record.event_id) || {};
      archivedById.set(record.event_id, {
        ...previous,
        ...record,
        archived_date: previous.archived_date || today,
      });
      continue;
    }

    active.push(record);
  }

  for (const record of existingActive) {
    if (currentById.has(record.event_id)) {
      continue;
    }

    // Enduring events from existing active stay active
    if (isEnduring(record)) {
      active.push({ ...record, is_enduring: true });
      continue;
    }

    if (record.end_date && record.end_date < today) {
      const previous = archivedById.get(record.event_id) || {};
      archivedById.set(record.event_id, {
        ...previous,
        ...record,
        archived_date: previous.archived_date || today,
      });
      continue;
    }

    active.push(record);
  }

  return {
    active: active.sort((left, right) => left.title.localeCompare(right.title)),
    archived: [...archivedById.values()].sort((left, right) => left.title.localeCompare(right.title)),
  };
}

async function main() {
  if (!fs.existsSync(SCRAPED_DATA_PATH)) {
    console.error(`missing scraped data at ${SCRAPED_DATA_PATH}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const scrapedCourses = readJson(SCRAPED_DATA_PATH, []);
  const existingActive = readJson(ACTIVE_EVENTS_PATH, []);
  const existingArchived = readJson(ARCHIVED_EVENTS_PATH, []);

  const records = scrapedCourses.map((course) => buildSnapshotRecord(course, today));
  const { active, archived } = splitActiveAndArchived(records, existingActive, existingArchived, today);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson(ACTIVE_EVENTS_PATH, active);
  writeJson(ARCHIVED_EVENTS_PATH, archived);

  console.log(`wrote ${active.length} active events to ${ACTIVE_EVENTS_PATH}`);
  console.log(`wrote ${archived.length} archived events to ${ARCHIVED_EVENTS_PATH}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}