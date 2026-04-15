#!/usr/bin/env node

/**
 * fetchGeniusFeed.js — Pull CACHE courses from the Genius SIS public JSON feed
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The UAA Continuing Studies registration page embeds the full course catalog
 * as a JavaScript variable (`coursesJson`).  This script fetches that page,
 * extracts the JSON array, normalises each record into our canonical schema,
 * and writes two outputs:
 *
 *   1. COURSE-CONVERT/UAA-CACHE-STATICINFO-V101/events.all.json  (full archive)
 *   2. src/data/pastEvents.json   (past-only subset for the site)
 *
 * Additionally, ahecCourses.json (the active scraped snapshot) is updated so
 * the daily enrichment pipeline sees fresh data.
 *
 * Schedule:  Designed to run 4× daily via GitHub Actions.
 *
 * Usage:
 *   node scripts/fetchGeniusFeed.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Config ──────────────────────────────────────────────────
const AFFILIATE_ID = "6Q68Q3";
const CATALOG_URL = `https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=${AFFILIATE_ID}`;
const EVENTS_ALL_PATH = path.resolve(ROOT, "COURSE-CONVERT/UAA-CACHE-STATICINFO-V101/events.all.json");
const PAST_EVENTS_PATH = path.resolve(ROOT, "src/data/pastEvents.json");
const AHECOURSES_PATH = path.resolve(ROOT, "src/data/ahecCourses.json");

// ── Extract the embedded coursesJson array from the page HTML ──
function extractCoursesJson(html) {
  const marker = "var coursesJson =";
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const arrayStart = html.indexOf("[", start);
  if (arrayStart === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = arrayStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[") depth++;
    if (ch === "]") { depth--; if (depth === 0) return html.slice(arrayStart, i + 1); }
  }
  return null;
}

function parseJson(text) {
  // Try JS eval first (handles embedded HTML in strings)
  try { return Function('"use strict"; return (' + text + ")")(); } catch { /* fall through */ }
  // Fallback: strip trailing commas and parse as JSON
  try {
    const cleaned = text.replace(/,\s*(?=[}\]])/g, "");
    return JSON.parse(cleaned);
  } catch { /* fall through */ }
  return null;
}

// ── URL helpers ─────────────────────────────────────────────
const BASE = "https://continuingstudies.alaska.edu";
function abs(url) {
  if (!url) return "";
  try { return new URL(url, BASE).toString(); } catch { return url; }
}

// ── Normalise a raw Genius course object into our canonical schema ──
function normaliseCourse(c) {
  const sectionIndex = Number(c.SectionIndex) || 0;
  const courseIndex = Number(c.CourseIndex) || 0;

  const startRaw = c.FormatedStartDate || c.StartDate || "";
  const endRaw = c.FormatedEndDate || c.EndDate || "";
  const startDate = toIso(startRaw);
  const endDate = toIso(endRaw) || startDate;
  const isOngoing = !startDate || /ongoing/i.test(startRaw);
  const isOnDemand = /on.?demand/i.test(c.Delivery || "");
  const term = isOnDemand ? "On-Demand" : guessYear(startDate);

  return {
    section_index: sectionIndex,
    section_name: (c.CourseName || "").trim(),
    section_status: c.AvailableForRegistration === "True" || c.AvailableForRegistration === true ? "ACTIVE" : "ARCHIVED",
    instructors: [c.Teachers, c.Teachers2].filter(Boolean).join(", ").trim() || "",
    start_date: isOngoing ? null : startDate,
    end_date: isOngoing ? null : endDate,
    enrollments: Number(c.Enrolled) || 0,
    cap: Number(c.Cap) || 0,
    credits: Number(c.Credits) || 0,
    contact_hours: null,
    term,
    semester: isOngoing ? "Ongoing" : term,
    price: c.Cost != null && c.Cost !== "" ? Number(c.Cost) : null,
    location: (c.Location || "Online").replace(/^\*/, "").trim(),
    available_for_registration: c.AvailableForRegistration === "True" || c.AvailableForRegistration === true,
    registration_url: `${BASE}/Registration.aspx?AffiliateID=${AFFILIATE_ID}&FilterSectionIndex=${sectionIndex}`,
    ceu_provider: "",
    ceu_certificate_number: "",
    public_notes: c.PublicNotes || "",
    meeting_time_display: c.MeetingTimeDisplay || "",
    enroll_by_date: null,
    delivery_method_index: null,
    days: dateDiffDays(startDate, endDate),
    course_index: courseIndex,
    course_name: (c.CourseName || "").trim(),
    course_display_name: (c.CourseName || "").trim(),
    course_status: c.AvailableForRegistration === "True" || c.AvailableForRegistration === true ? "ACTIVE" : "ARCHIVED",
    category: (c.Category || "").trim(),
    affiliation: "CACHE",
    type: isOnDemand ? "ECOURSE" : "ECOURSE",
    description: c.Description || c.LongDescription || "",
    course_image: abs(c.CourseImage) || "",
    keyword: c.Keyword || "",
    course_code: c.CourseCode || "",
    catalog: "",
    department: "",
    self_registration: true,
    sections_count: 1,
  };
}

function toIso(val) {
  if (!val) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  if (/ongoing/i.test(val)) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function guessYear(iso) {
  if (!iso) return "On-Demand";
  return iso.slice(0, 4);
}

function dateDiffDays(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}

// ── Build the scraped-format record for ahecCourses.json ──
function toScrapedFormat(c) {
  return {
    event_id: `uaa-cache-${c.SectionIndex}`,
    SectionIndex: Number(c.SectionIndex) || 0,
    CourseIndex: Number(c.CourseIndex) || 0,
    CourseName: (c.CourseName || "").trim(),
    CourseImage: abs(c.CourseImage),
    Description: c.Description || "",
    LongDescription: c.LongDescription || "",
    PublicNotes: c.PublicNotes || "",
    Delivery: c.Delivery || "",
    Location: (c.Location || "").replace(/^\*/, "").trim(),
    Category: (c.Category || "").trim(),
    Keyword: c.Keyword || "",
    CourseCode: c.CourseCode || "",
    Teachers: c.Teachers || "",
    Teachers2: c.Teachers2 || "",
    Credits: Number(c.Credits) || 0,
    Cost: c.Cost != null && c.Cost !== "" ? Number(c.Cost) : null,
    Price: c.Price != null && c.Price !== "" ? Number(c.Price) : null,
    FormatedCost: c.FormatedCost || "",
    FormatedStartDate: c.FormatedStartDate || "",
    FormatedEndDate: c.FormatedEndDate || "",
    StartDate: c.StartDate || "",
    EndDate: c.EndDate || "",
    MeetingTimeDisplay: c.MeetingTimeDisplay || "",
    DisplayText: c.DisplayText || "",
    Cap: Number(c.Cap) || 0,
    QtdSecEnrolled: Number(c.QtdSecEnrolled) || 0,
    CapAvailable: Number(c.CapAvailable) || 0,
    Enrolled: Number(c.Enrolled) || 0,
    AvailableForRegistration: c.AvailableForRegistration === "True" || c.AvailableForRegistration === true,
    DirectUrl: `${BASE}/Registration.aspx?AffiliateID=${AFFILIATE_ID}&FilterSectionIndex=${c.SectionIndex}`,
    RegistrationPageUrl: `${BASE}/Registration.aspx?AffiliateID=${AFFILIATE_ID}`,
    RegistrationUrl: `${BASE}/Registration.aspx?AffiliateID=${AFFILIATE_ID}&FilterSectionIndex=${c.SectionIndex}`,
    SourceUrl: CATALOG_URL,
    scraped_at: new Date().toISOString(),
  };
}

// ── Build the past-event record for pastEvents.json ──
function toPastEvent(r) {
  const loc = (r.location || "").toLowerCase();
  let format = "In-Person";
  if (loc.includes("online") || loc.includes("zoom") || loc.includes("virtual")) format = "Virtual";
  if (loc.includes("hybrid")) format = "Hybrid";

  let region;
  if (/online|zoom|virtual/i.test(r.location || "")) region = "Virtual";
  else if (/anchorage/i.test(r.location || "")) region = "Southcentral";
  else if (/fairbanks/i.test(r.location || "")) region = "Interior";
  else if (/juneau|sitka|ketchikan/i.test(r.location || "")) region = "Southeast";
  else if (/bethel|kuskokwim/i.test(r.location || "")) region = "Yukon-Kuskokwim";
  else if (/nome|kotzebue|barrow|utqiagvik/i.test(r.location || "")) region = "Northern";
  else if (/kodiak/i.test(r.location || "")) region = "Kodiak";
  else if (/kenai|homer|soldotna|palmer|wasilla|mat.su/i.test(r.location || "")) region = "Southcentral";

  const desc = (r.description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);

  return {
    id: `genius-${r.section_index}`,
    title: r.course_display_name || r.course_name || r.section_name,
    organization: r.ceu_provider || "UAA Continuing Studies",
    location: r.location || "Online",
    format,
    start_date: r.start_date || "",
    end_date: r.end_date || "",
    credits: r.credits > 0 ? ["CEU"] : [],
    description: desc,
    registration_url: r.registration_url || "",
    region,
    image: r.course_image || undefined,
    event_type: r.term === "On-Demand" ? "on-demand" : "live",
    instructor_name: r.instructors && r.instructors !== "TBD TBD" ? r.instructors : undefined,
    seats_total: r.cap > 0 ? r.cap : undefined,
    enrollments: r.enrollments > 0 ? r.enrollments : undefined,
    genius_section_index: r.section_index,
    genius_course_index: r.course_index,
    category: r.category || undefined,
    ceu_provider: r.ceu_provider || undefined,
    price_usd: r.price ?? undefined,
    contact_hours: r.contact_hours ?? undefined,
  };
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] Fetching Genius feed from ${CATALOG_URL}`);
  const res = await fetch(CATALOG_URL, {
    headers: { "User-Agent": "CACHE-StaticSite-Bot/1.0 (UAA AHEC)" },
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  const jsonText = extractCoursesJson(html);
  if (!jsonText) {
    console.error("Could not find coursesJson in page HTML");
    process.exit(1);
  }

  const raw = parseJson(jsonText);
  if (!raw || !Array.isArray(raw)) {
    console.error("Failed to parse coursesJson");
    process.exit(1);
  }

  console.log(`  Parsed ${raw.length} course sections from Genius feed`);

  // ── 1. Write events.all.json (canonical archive) ──
  const allNormalised = raw.map(normaliseCourse);

  // Merge with existing events.all.json to preserve historical records
  let existing = [];
  if (fs.existsSync(EVENTS_ALL_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(EVENTS_ALL_PATH, "utf-8")); } catch { existing = []; }
  }
  const existingBySectionIndex = new Map(existing.map(r => [r.section_index, r]));
  for (const r of allNormalised) {
    existingBySectionIndex.set(r.section_index, r);
  }
  const merged = [...existingBySectionIndex.values()].sort((a, b) =>
    (a.start_date || "").localeCompare(b.start_date || "")
  );

  fs.mkdirSync(path.dirname(EVENTS_ALL_PATH), { recursive: true });
  fs.writeFileSync(EVENTS_ALL_PATH, JSON.stringify(merged, null, 2));
  console.log(`  Wrote ${merged.length} total records to events.all.json (${allNormalised.length} fresh + ${existing.length - allNormalised.length > 0 ? existing.length - allNormalised.length : 0} historical)`);

  // ── 2. Write pastEvents.json ──
  const pastRecords = merged.filter(r => {
    const end = r.end_date || "";
    return end !== "" && end < today && r.term !== "On-Demand";
  });

  const seen = new Set();
  const dedupedPast = pastRecords.filter(r => {
    if (seen.has(r.section_index)) return false;
    seen.add(r.section_index);
    return true;
  });

  const pastJson = dedupedPast
    .map(toPastEvent)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  fs.writeFileSync(PAST_EVENTS_PATH, JSON.stringify(pastJson, null, 2));
  console.log(`  Wrote ${pastJson.length} past events to pastEvents.json`);

  // ── 3. Write ahecCourses.json (active scraped snapshot) ──
  const scraped = raw.map(toScrapedFormat);
  fs.writeFileSync(AHECOURSES_PATH, JSON.stringify(scraped, null, 2));
  console.log(`  Wrote ${scraped.length} active courses to ahecCourses.json`);

  // Summary
  const activeCount = allNormalised.filter(r => {
    const end = r.end_date || today;
    return end >= today || r.term === "On-Demand";
  }).length;
  console.log(`\n  Summary: ${activeCount} active/upcoming, ${pastJson.length} past, ${merged.length} total`);
  console.log(`  Feed timestamp: ${timestamp}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
