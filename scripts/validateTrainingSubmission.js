#!/usr/bin/env node

/**
 * validateTrainingSubmission.js — CACHE Training Submission Validator
 * ──────────────────────────────────────────────────────────────────
 * Validates a generated course-catalog JSON file before it becomes a PR.
 *
 * Checks:
 *   1. Valid JSON structure
 *   2. Required fields present and non-empty
 *   3. Unique ID (not already in index)
 *   4. Slug is URL-safe
 *   5. Registration URL format is valid
 *   6. Dates are valid ISO format (if provided)
 *   7. No duplicate title in existing catalog
 *   8. Professions and tags use valid CACHE taxonomy values
 *
 * Usage:
 *   node scripts/validateTrainingSubmission.js <path-to-course-json>
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Valid taxonomy values (must match src/types/event.ts) ──

const VALID_PROFESSIONS = [
  "physician", "nurse", "behavioral-health", "pharmacy",
  "public-health", "community-health-aide", "social-work",
  "dental", "law-enforcement", "first-responder", "allied-health",
];

const VALID_CREDIT_TYPES = [
  "CME", "CNE", "CEU", "Pharmacy CE", "Social Work CE", "ASWB",
];

const VALID_TRAINING_TAGS = [
  "Personal Enrichment", "Professional Development and Training",
  "Abuse Prevention", "Aging/Senior Services", "Allied Health",
  "Alzheimer's Disease and Dementia", "Autism Spectrum Disorders",
  "Behavioral and Mental Health", "Behavioral Health",
  "Children, Youth, and Families", "Community Members",
  "Continuing Education", "Counseling", "Dental",
  "Direct Support Professional", "Emergency and Medical",
  "FASD - Fetal Alcohol Syndrome", "First Responders",
  "Health Administration", "Health Equity", "Health Responders",
  "Infant and Early Childhood Mental Health",
  "Intellectual and Developmental Disabilities", "Job Training",
  "Law Enforcement", "Nursing", "Occupational Health and Safety",
  "Onboarding", "Optometry", "Orthopedics", "Peer Support Specialist",
  "Pharmacy", "Physical & Occupational Therapy", "Physician Assistants",
  "Physicians", "Public Health",
  "Qualified Addictions Professional (QAP)", "Resilience",
  "Social Work", "Students", "Substance Use Disorders",
  "Trauma Informed Care", "Traumatic Brain Injury",
];

// ─── Helpers ────────────────────────────────────────────────

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf-8"));
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidIsoDate(str) {
  if (!str) return true; // empty is ok (optional)
  return /^\d{4}-\d{2}-\d{2}/.test(str) && !isNaN(Date.parse(str));
}

function isValidSlug(str) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str);
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node validateTrainingSubmission.js <course-json-path>");
    process.exit(1);
  }

  const errors = [];
  const warnings = [];

  // 1. Parse JSON
  let course;
  try {
    course = readJson(filePath);
  } catch (err) {
    console.error(`❌ FATAL: Cannot parse ${filePath} as JSON: ${err.message}`);
    process.exit(1);
  }

  // 2. Required fields
  const required = ["id", "title", "slug", "registration_url", "organization"];
  for (const field of required) {
    if (course[field] == null || course[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // 3. Type checks
  if (typeof course.id !== "number" || course.id < 1) {
    errors.push(`Invalid id: must be a positive integer, got ${course.id}`);
  }

  if (course.title && course.title.length < 3) {
    errors.push("Title is too short (min 3 characters)");
  }

  if (course.title && course.title.length > 300) {
    errors.push("Title is too long (max 300 characters)");
  }

  // 4. Slug validation
  if (course.slug && !isValidSlug(course.slug)) {
    errors.push(`Invalid slug: "${course.slug}" (must be lowercase alphanumeric with hyphens)`);
  }

  // 5. URL validation
  if (course.registration_url && !isValidUrl(course.registration_url)) {
    errors.push(`Invalid registration_url: "${course.registration_url}" (must be http/https)`);
  }

  // 6. Date validation
  if (course.start_date && !isValidIsoDate(course.start_date)) {
    errors.push(`Invalid start_date: "${course.start_date}" (must be ISO format YYYY-MM-DD)`);
  }
  if (course.end_date && !isValidIsoDate(course.end_date)) {
    errors.push(`Invalid end_date: "${course.end_date}" (must be ISO format YYYY-MM-DD)`);
  }
  if (course.start_date && course.end_date && course.start_date > course.end_date) {
    errors.push("end_date is before start_date");
  }

  // 7. Price validation
  if (course.price_usd != null && typeof course.price_usd !== "number") {
    errors.push(`Invalid price_usd: must be a number, got ${typeof course.price_usd}`);
  }
  if (course.price_usd != null && course.price_usd < 0) {
    errors.push("price_usd cannot be negative");
  }

  // 8. Taxonomy validation
  if (Array.isArray(course.professions)) {
    for (const p of course.professions) {
      if (!VALID_PROFESSIONS.includes(p)) {
        warnings.push(`Unknown profession: "${p}" (not in CACHE taxonomy)`);
      }
    }
  }

  if (Array.isArray(course.credits)) {
    for (const c of course.credits) {
      if (!VALID_CREDIT_TYPES.includes(c)) {
        warnings.push(`Unknown credit type: "${c}" (not in CACHE taxonomy)`);
      }
    }
  }

  if (Array.isArray(course.training_tags)) {
    for (const t of course.training_tags) {
      if (!VALID_TRAINING_TAGS.includes(t)) {
        warnings.push(`Unknown training tag: "${t}" (not in CACHE taxonomy)`);
      }
    }
  }

  // 9. Check for duplicate ID and title in existing index
  try {
    const index = readJson("src/data/course-catalog/index.json");
    const existingIds = new Set(index.courses.map((c) => c.id));
    // Exclude the new course's own entry (it was already added to the index)
    // Check if another course with the same ID exists
    const idCount = index.courses.filter((c) => c.id === course.id).length;
    if (idCount > 1) {
      errors.push(`Duplicate id: ${course.id} already exists in catalog index`);
    }

    // Check for duplicate titles (fuzzy)
    const existingTitles = index.courses
      .filter((c) => c.id !== course.id)
      .map((c) => c.title.toLowerCase().trim());
    if (existingTitles.includes(course.title.toLowerCase().trim())) {
      warnings.push(`Possible duplicate: a course with title "${course.title}" already exists`);
    }
  } catch {
    warnings.push("Could not read catalog index for duplicate checking");
  }

  // ─── Report ───────────────────────────────────────────────
  if (warnings.length > 0) {
    console.log("\n⚠️  Warnings:");
    for (const w of warnings) console.log(`   • ${w}`);
  }

  if (errors.length > 0) {
    console.error("\n❌ Validation FAILED:");
    for (const e of errors) console.error(`   • ${e}`);
    process.exit(1);
  }

  console.log(`\n✅ Validation passed for: ${course.title} (ID: ${course.id})`);
  if (warnings.length > 0) {
    console.log(`   (${warnings.length} warning(s) — review recommended)`);
  }
}

main();
