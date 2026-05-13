#!/usr/bin/env node

/**
 * geniusConvert.js
 *
 * Reads Genius SIS XLSX exports (courses + MAP report) and produces:
 *   - COURSE-CONVERT/UAA-CACHE-STATICINFO-V101/events.all.json
 *   - COURSE-CONVERT/UAA-CACHE-STATICINFO-V101/genius-filter.csv
 *
 * Usage:
 *   node scripts/geniusConvert.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Dynamic import for xlsx (CommonJS package)
const XLSXmod = await import("xlsx");
const XLSX = XLSXmod.default ?? XLSXmod;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Excel serial date to ISO string. Returns null for blanks. */
function excelDateToISO(serial) {
    if (!serial || typeof serial !== "number") return null;
    // Excel epoch is 1900-01-01 but has a leap-year bug (+1 day offset)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + serial * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
}

/** Trim and normalize whitespace. */
function clean(val) {
    if (val == null) return "";
    return String(val).trim().replace(/\s+/g, " ");
}

/** Build a registration URL from a SectionIndex. */
function registrationUrl(sectionIndex) {
    if (!sectionIndex) return null;
    return `https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3&FilterSectionIndex=${sectionIndex}`;
}

// ── Locate input files ──────────────────────────────────────────────────────

const inputDir = path.join(ROOT, "COURSE-CONVERT", "_INPUT", "GENIUS-INPUT");
const reportDir = path.join(ROOT, "COURSE-CONVERT", "_REPORTS");
const outputDir = path.join(ROOT, "COURSE-CONVERT", "UAA-CACHE-STATICINFO-V101");

// Find the latest date-stamped folder in _INPUT/GENIUS-INPUT
const dateFolders = fs
    .readdirSync(inputDir)
    .filter((d) => fs.statSync(path.join(inputDir, d)).isDirectory())
    .sort()
    .reverse();
if (dateFolders.length === 0) {
    console.error("No date-stamped input folders found in", inputDir);
    process.exit(1);
}
const latestFolder = path.join(inputDir, dateFolders[0]);
console.log("Using input folder:", latestFolder);

// Find XLSX files by name pattern
function findFile(dir, pattern) {
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().includes(pattern) && f.endsWith(".xlsx"));
    return files.length > 0 ? path.join(dir, files[0]) : null;
}

const coursesFile = findFile(latestFolder, "all-courses");
const sectionsFile = findFile(latestFolder, "all-course-sections");
const mapFile = findFile(reportDir, "map-course-and-section");

if (!coursesFile) {
    console.error("Could not find courses XLSX in", latestFolder);
    process.exit(1);
}
console.log("Courses file:", path.basename(coursesFile));
console.log("Sections file:", sectionsFile ? path.basename(sectionsFile) : "(not found — will use MAP report)");
console.log("MAP report:", mapFile ? path.basename(mapFile) : "(not found — will build from courses+sections only)");

// ── Read & parse ────────────────────────────────────────────────────────────

function readSheet(filePath, sheetName) {
    const wb = XLSX.readFile(filePath);
    const name = sheetName || wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[name]);
}

const courses = readSheet(coursesFile);
console.log(`Loaded ${courses.length} courses`);

// Build a course lookup by CourseIndex (= ID)
const courseMap = new Map();
for (const c of courses) {
    courseMap.set(String(c.CourseIndex ?? c.ID), c);
}

// ── Build sections lookup for enrichment (instructors, enrollments) ──────────

const sectionMap = new Map();
if (sectionsFile) {
    const sections = readSheet(sectionsFile);
    console.log(`Loaded ${sections.length} sections for enrichment`);
    for (const s of sections) {
        const idx = String(s.SectionIndex ?? "");
        if (idx) sectionMap.set(idx, s);
    }
}

// ── Strategy: prefer MAP report (has full join), fall back to sections-only ─

let output = [];

if (mapFile) {
    // Use the MAP report Table1 for the curated active join
    const mapRows = readSheet(mapFile, "Table1");
    console.log(`Loaded ${mapRows.length} rows from MAP report (Table1)`);

    for (const r of mapRows) {
        const courseIdx = String(r.CourseIndex ?? "");
        const course = courseMap.get(courseIdx) || {};
        const sec = sectionMap.get(String(r.SectionIndex ?? "")) || {};

        output.push({
            // Section-level
            section_index: r.SectionIndex ?? null,
            section_name: clean(r.Name),
            section_status: clean(r.Status),
            instructors: clean(sec.Instructors) || null,
            start_date: excelDateToISO(r.StartDate),
            end_date: excelDateToISO(r.EndDate),
            enrollments: sec["#Enrollments"] ?? null,
            cap: r.Cap ?? null,
            credits: r.Credits ?? 0,
            contact_hours: r.ContactHours != null ? Number(r.ContactHours) || 0 : null,
            term: clean(r.Term),
            semester: clean(r.Semester),
            price: r.Price != null && r.Price !== "" ? Number(r.Price) : null,
            location: clean(r.Location),
            available_for_registration: r.AvailableForRegistration === true || r.AvailableForRegistration === "true",
            registration_url: registrationUrl(r.SectionIndex),
            ceu_provider: clean(r.CEUProvider),
            ceu_certificate_number: clean(r.CEUCertificateNumber),
            public_notes: clean(r.PublicNotes),
            meeting_time_display: clean(r.MeetingTimeDisplay),
            enroll_by_date: excelDateToISO(r.EnrollByDate),
            delivery_method_index: r.DeliveryMethodListIndex ?? null,
            days: r.Days ?? null,

            // Course-level (from MAP fields suffixed with 1, or from courses lookup)
            course_index: r.CourseIndex ?? null,
            course_name: clean(r.Name1 || r.DisplayName || course.CourseName || course.Course),
            course_display_name: clean(r.DisplayName),
            course_status: clean(r.Status1),
            category: clean(course.Category || ""),
            affiliation: clean(r.Affiliation || course.Affiliation),
            type: clean(r.Type),
            description: clean(r.Description),
            course_image: clean(r.CourseImage),
            keyword: clean(r.Keyword),
            course_code: clean(r.CourseCode),
            catalog: clean(r.Catalog),
            department: clean(r.Department),
            self_registration: r.SelfRegistration != null ? Boolean(Number(r.SelfRegistration)) : null,
            sections_count: course["#Sections"] ?? null,
        });
    }
} else if (sectionsFile) {
    // Fallback: sections-only (no course join possible without MAP)
    const sections = readSheet(sectionsFile);
    console.log(`Loaded ${sections.length} sections (no MAP report — limited join)`);

    for (const s of sections) {
        output.push({
            section_index: s.SectionIndex ?? null,
            section_name: clean(s.Section || s.SectionName),
            section_status: clean(s.Status),
            instructors: clean(s.Instructors),
            start_date: excelDateToISO(s.StartDate),
            end_date: excelDateToISO(s.EndDate),
            enrollments: s["#Enrollments"] ?? null,
            cap: s.Cap ?? null,
            credits: s.Credits ?? 0,
            contact_hours: null,
            term: clean(s.Term),
            semester: null,
            price: null,
            location: null,
            available_for_registration: null,
            registration_url: registrationUrl(s.SectionIndex),
            ceu_provider: null,
            ceu_certificate_number: null,
            public_notes: null,
            meeting_time_display: null,
            enroll_by_date: null,
            delivery_method_index: null,
            days: null,

            course_index: null,
            course_name: null,
            course_display_name: null,
            course_status: null,
            category: null,
            affiliation: clean(s.Affiliation),
            type: null,
            description: null,
            course_image: null,
            keyword: null,
            course_code: null,
            catalog: null,
            department: null,
            self_registration: null,
            sections_count: null,
        });
    }
} else {
    console.error("Need either a MAP report or a sections export to continue.");
    process.exit(1);
}

// ── Write JSON output ────────────────────────────────────────────────────────

const jsonDest = path.join(outputDir, "events.all.json");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonDest, JSON.stringify(output, null, 2));
console.log(`\nWrote ${output.length} records to ${jsonDest}`);

// ── Write CSV output (genius-filter.csv) ────────────────────────────────────

const csvCols = [
    "section_index",
    "section_name",
    "section_status",
    "course_index",
    "course_name",
    "category",
    "start_date",
    "end_date",
    "term",
    "location",
    "cap",
    "price",
    "credits",
    "contact_hours",
    "available_for_registration",
    "registration_url",
    "ceu_provider",
    "affiliation",
];

function csvEscape(val) {
    if (val == null) return "";
    const s = String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const csvLines = [csvCols.join(",")];
for (const row of output) {
    csvLines.push(csvCols.map((c) => csvEscape(row[c])).join(","));
}
const csvDest = path.join(outputDir, "genius-filter.csv");
fs.writeFileSync(csvDest, csvLines.join("\n"));
console.log(`Wrote ${output.length} rows to ${csvDest}`);

// ── Summary stats ────────────────────────────────────────────────────────────

const activeCount = output.filter((r) => r.section_status === "ACTIVE").length;
const archivedCount = output.filter((r) => r.section_status === "ARCHIVED").length;
const uniqueCourses = new Set(output.map((r) => r.course_index).filter(Boolean)).size;
console.log(`\nSummary: ${output.length} total (${activeCount} active, ${archivedCount} archived) across ${uniqueCourses} unique courses`);
