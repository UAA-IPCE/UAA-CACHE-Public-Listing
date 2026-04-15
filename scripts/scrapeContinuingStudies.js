#!/usr/bin/env node

/*
 * Simple scraper for the UAA Continuing Studies affiliate page (AffiliateID=6Q68Q3).
 * It fetches the HTML, extracts the `coursesJson` JavaScript variable, and emits
 * an array of course objects with full image URLs and a registration link.  The
 * resulting JSON can be consumed by our data pipeline or merged into `events.ts`.
 *
 * Usage:
 *   node scripts/scrapeContinuingStudies.js
 *   npm run scrape:continuing
 */

import fs from "fs";
import path from "path";

// node 18+ has fetch globally; if not you can install node-fetch
// import fetch from "node-fetch"; // uncomment when using older node

const CACHE_AFFILIATE_ID = "6Q68Q3";
const BASE_URL = "https://continuingstudies.alaska.edu";
const ALL_MODE = process.argv.includes("--all");
const SOURCE_URL = ALL_MODE
  ? `${BASE_URL}/Registration.aspx`
  : `${BASE_URL}/Registration.aspx?AffiliateID=${CACHE_AFFILIATE_ID}`;

function extractCoursesJson(text) {
  const marker = "var coursesJson =";
  const start = text.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const arrayStart = text.indexOf("[", start);
  if (arrayStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = arrayStart; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(arrayStart, index + 1);
      }
    }
  }

  return null;
}

function toAbsoluteUrl(url) {
  if (!url) return null;
  try {
    return new URL(url, BASE_URL).toString();
  } catch {
    return url;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function mapCourse(course, affiliateId) {
  const affiliateParam = affiliateId ? `AffiliateID=${affiliateId}&` : "";
  const directUrl = `${BASE_URL}/Registration.aspx?${affiliateParam}FilterSectionIndex=${course.SectionIndex}`;
  const registrationPageUrl = affiliateId
    ? `${BASE_URL}/Registration.aspx?AffiliateID=${affiliateId}`
    : `${BASE_URL}/Registration.aspx`;

  return {
    event_id: `uaa-cache-${course.SectionIndex}`,
    SectionIndex: course.SectionIndex,
    CourseIndex: course.CourseIndex,
    CourseName: normalizeText(course.CourseName),
    CourseImage: toAbsoluteUrl(course.CourseImage),
    Description: normalizeText(course.Description),
    LongDescription: course.LongDescription ?? "",
    PublicNotes: course.PublicNotes ?? "",
    Delivery: normalizeText(course.Delivery),
    Location: normalizeText(course.Location),
    Category: normalizeText(course.Category),
    Keyword: normalizeText(course.Keyword),
    CourseCode: normalizeText(course.CourseCode),
    Teachers: normalizeText(course.Teachers),
    Teachers2: normalizeText(course.Teachers2),
    Credits: course.Credits,
    Cost: course.Cost,
    Price: course.Price,
    FormatedCost: normalizeText(course.FormatedCost),
    FormatedStartDate: normalizeText(course.FormatedStartDate),
    FormatedEndDate: normalizeText(course.FormatedEndDate),
    StartDate: course.StartDate,
    EndDate: course.EndDate,
    MeetingTimeDisplay: course.MeetingTimeDisplay ?? "",
    DisplayText: course.DisplayText,
    Cap: course.Cap,
    QtdSecEnrolled: course.QtdSecEnrolled,
    CapAvailable: course.CapAvailable,
    Enrolled: course.Enrolled,
    UpaySiteID: course.UpaySiteID,
    UpaySiteIDStatus: course.UpaySiteIDStatus,
    AvailableForRegistration: course.AvailableForRegistration === "True",
    HasPreRequisites: course.HasPreRequisites === "1",
    PreRequisitesCompleted: course.PreRequisitesCompleted === "1",
    PreRequisites: course.PreRequisites,
    HasRecommendedCourses: course.HasRecommendedCourses === "1",
    RecommendedCourses: course.RecommendedCourses,
    HasRequiredDocuments: course.HasRequiredDocuments === "1",
    RequiredDocuments: course.RequiredDocuments,
    HasCompetencies: course.HasCompetencies === "1",
    Competencies: course.Competencies,
    HasLearningPath: course.HasLearningPath === "1",
    LearningPath: course.LearningPath,
    Highlighted: course.Highlighted === "1",
    LastCompletionDate: course.LastCompletionDate,
    DirectUrl: directUrl,
    RegistrationPageUrl: registrationPageUrl,
    RegistrationUrl: directUrl,
    SourceUrl: SOURCE_URL,
    scraped_at: new Date().toISOString(),
    _raw: course,
  };
}

async function main() {
  console.log(`fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    console.error(`failed to fetch source page: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const text = await res.text();
  const jsonText = extractCoursesJson(text);
  if (!jsonText) {
    console.error("unable to locate coursesJson variable in page");
    process.exit(1);
  }

  let courses;
  try {
    courses = JSON.parse(jsonText);
  } catch (err) {
    console.error("failed to parse JSON from coursesJson:", err);
    process.exit(1);
  }

  const affiliateId = ALL_MODE ? null : CACHE_AFFILIATE_ID;
  const output = courses.map((c) => mapCourse(c, affiliateId));

  const suffix = ALL_MODE ? ".all" : "";
  const dest = path.resolve(`src/data/ahecCourses${suffix}.json`);
  fs.writeFileSync(dest, JSON.stringify(output, null, 2));
  console.log(`wrote ${output.length} courses to ${dest}`);

  // ── Also produce COURSE-CONVERT comprehensive output ──
  if (!ALL_MODE) {
    writeCourseConvertOutputs(output);
  }
}

/**
 * Write comprehensive courses.json + courses.csv to COURSE-CONVERT/
 * for the daily pipeline and external consumers.
 */
function stripHtmlBasic(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(p|div|b|i|a|span|li|ul|ol|em|strong|h\d)[^>]*>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function writeCourseConvertOutputs(records) {
  const outDir = path.resolve("COURSE-CONVERT/UAA-CACHE-STATICINFO-V101");
  fs.mkdirSync(outDir, { recursive: true });

  // Build comprehensive format matching the user-requested schema
  const comprehensive = records.map((r) => ({
    // Identifiers
    section_index: Number(r.SectionIndex) || r.SectionIndex,
    course_index: r.CourseIndex,
    event_id: r.event_id,
    course_code: r.CourseCode || "",

    // Core info
    title: r.CourseName,
    short_description: r.Description,
    full_description: stripHtmlBasic(r.LongDescription),
    public_notes: r.PublicNotes,

    // Schedule
    start_date: r.FormatedStartDate,
    end_date: r.FormatedEndDate,
    raw_start_date: r.StartDate,
    raw_end_date: r.EndDate,
    time: r.MeetingTimeDisplay,

    // Classification
    category: r.Category,
    keywords: r.Keyword ? r.Keyword.split(/[,;]/).map((k) => k.trim()).filter(Boolean) : [],
    delivery_type: r.Delivery,
    location: r.Location,

    // People
    instructors: r.Teachers
      ? r.Teachers.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
      : [],

    // Enrollment & capacity
    status: r.AvailableForRegistration ? "Open" : "Closed",
    seats_available: r.CapAvailable,
    seats_total: r.Cap,
    enrolled: r.QtdSecEnrolled,
    available_for_registration: r.AvailableForRegistration,

    // Cost
    cost: r.Cost ?? r.Price ?? null,
    formatted_cost: r.FormatedCost || "Free",

    // Continuing education
    credits: r.Credits,
    continuing_education: extractCEFromDescription(r.LongDescription),

    // Related content
    recommendations: r.HasRecommendedCourses ? stripHtmlBasic(r.RecommendedCourses) : null,
    prerequisites: r.HasPreRequisites ? r.PreRequisites : null,
    competencies: r.HasCompetencies ? stripHtmlBasic(r.Competencies) : null,
    learning_path: r.HasLearningPath ? r.LearningPath : null,

    // Media
    image_url: r.CourseImage,

    // URLs
    direct_url: r.DirectUrl,
    registration_url: r.RegistrationUrl,
    catalog_url: r.RegistrationPageUrl,

    // Metadata
    affiliate_id: CACHE_AFFILIATE_ID,
    highlighted: r.Highlighted,
    scraped_at: r.scraped_at,
  }));

  // Write JSON
  const jsonDest = path.join(outDir, "courses.json");
  fs.writeFileSync(jsonDest, JSON.stringify(comprehensive, null, 2));
  console.log(`wrote ${comprehensive.length} courses to ${jsonDest}`);

  // Write CSV
  const csvCols = [
    "section_index", "course_index", "title", "short_description",
    "start_date", "end_date", "time", "category", "delivery_type",
    "location", "status", "seats_available", "seats_total",
    "enrolled", "cost", "formatted_cost", "credits",
    "continuing_education", "direct_url", "image_url", "scraped_at",
  ];
  const csvEscape = (val) => {
    if (val == null) return "";
    const s = Array.isArray(val) ? val.join("; ") : String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const csvLines = [csvCols.join(",")];
  for (const row of comprehensive) {
    csvLines.push(csvCols.map((c) => csvEscape(row[c])).join(","));
  }
  const csvDest = path.join(outDir, "courses.csv");
  fs.writeFileSync(csvDest, csvLines.join("\n"));
  console.log(`wrote ${comprehensive.length} rows to ${csvDest}`);
}

/**
 * Extract continuing education info from the LongDescription HTML.
 * Genius embeds CE details as "Continuing Education: ..." in the HTML body.
 */
function extractCEFromDescription(html) {
  if (!html) return null;
  const match = html.match(/Continuing\s+Education[:\s]*<\/b>\s*([^<]+)/i)
    || html.match(/Continuing\s+Education[:\s]+([^<\n]+)/i);
  return match ? match[1].trim() : null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
