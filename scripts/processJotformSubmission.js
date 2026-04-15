#!/usr/bin/env node

/**
 * processJotformSubmission.js — CACHE Jotform → Course Catalog Pipeline
 * ──────────────────────────────────────────────────────────────────────
 * Receives a Jotform submission payload (via SUBMISSION_PAYLOAD env var),
 * maps it to the CACHE course-catalog JSON schema, writes the course file,
 * and updates the catalog index.
 *
 * Outputs (via GitHub Actions):
 *   course_file, course_title, course_location, course_provider,
 *   course_dates, submission_id
 */

import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const today = new Date().toISOString().split("T")[0];

// ─── Paths ──────────────────────────────────────────────────
const INDEX_PATH = "src/data/course-catalog/index.json";
const COURSES_DIR = "src/data/course-catalog/courses";

// ─── Jotform Field Mapping ──────────────────────────────────
// Maps Jotform field names/keys to internal schema fields.
// Jotform question names vary by form — update these mappings
// to match YOUR form's field names (case-insensitive match).
const FIELD_MAP = {
  // Required fields
  title:            ["trainingTitle", "training_title", "title", "courseName", "course_name"],
  organization:     ["provider", "organization", "org", "providerName", "provider_name"],
  description:      ["description", "courseDescription", "course_description", "summary"],
  location:         ["location", "city", "venue", "trainingLocation"],
  delivery_method:  ["format", "delivery_method", "deliveryMethod", "modality"],
  registration_url: ["website", "registration_url", "registrationUrl", "url", "link"],
  contact_email:    ["contact", "contactEmail", "contact_email", "email"],

  // Date fields
  start_date:       ["startDate", "start_date", "dateStart", "date_start", "fromDate"],
  end_date:         ["endDate", "end_date", "dateEnd", "date_end", "toDate"],

  // Optional enrichment
  category:         ["category", "trainingCategory", "training_category", "type"],
  professions:      ["professions", "targetAudience", "target_audience", "audience"],
  credits:          ["credits", "ceCredits", "ce_credits", "creditTypes"],
  price:            ["price", "cost", "fee", "price_usd", "priceUsd"],
  notes:            ["notes", "additionalInfo", "additional_info", "comments"],
};

// ─── Helpers ────────────────────────────────────────────────

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf-8"));
}

function writeJson(relPath, data) {
  writeFileSync(resolve(ROOT, relPath), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

/**
 * Resolve a value from the Jotform payload using the field mapping.
 * Jotform payloads can nest values under numbered keys (q3_title, q5_email)
 * or use prettified names. We try all mapped aliases.
 */
function resolveField(payload, fieldName) {
  const aliases = FIELD_MAP[fieldName] || [fieldName];

  // 1. Direct key match (case-insensitive)
  const payloadKeys = Object.keys(payload);
  for (const alias of aliases) {
    const match = payloadKeys.find(
      (k) => k.toLowerCase() === alias.toLowerCase()
    );
    if (match && payload[match] != null && payload[match] !== "") {
      return String(payload[match]).trim();
    }
  }

  // 2. Jotform "pretty" format — nested under rawRequest or formData
  const nested = payload.rawRequest || payload.formData || payload;
  if (nested !== payload) {
    const nestedKeys = Object.keys(nested);
    for (const alias of aliases) {
      const match = nestedKeys.find(
        (k) => k.toLowerCase() === alias.toLowerCase()
      );
      if (match && nested[match] != null && nested[match] !== "") {
        return String(nested[match]).trim();
      }
    }
  }

  return "";
}

/**
 * Map a category string to CACHE training_tags.
 */
function inferTrainingTags(category) {
  const CATEGORY_TAG_MAP = {
    "trades":               ["Job Training", "Professional Development and Training"],
    "healthcare":           ["Continuing Education", "Allied Health"],
    "behavioral-health":    ["Behavioral Health", "Behavioral and Mental Health"],
    "nursing":              ["Nursing", "Continuing Education"],
    "dental":               ["Dental", "Continuing Education"],
    "pharmacy":             ["Pharmacy", "Continuing Education"],
    "social-work":          ["Social Work", "Continuing Education"],
    "public-health":        ["Public Health", "Continuing Education"],
    "first-responder":      ["First Responders", "Emergency and Medical"],
    "law-enforcement":      ["Law Enforcement", "Professional Development and Training"],
    "substance-use":        ["Substance Use Disorders", "Behavioral Health"],
    "mental-health":        ["Behavioral and Mental Health", "Counseling"],
    "youth-services":       ["Children, Youth, and Families"],
    "elder-care":           ["Aging/Senior Services"],
    "peer-support":         ["Peer Support Specialist"],
    "cultural":             ["Health Equity", "Community Members"],
    "personal-enrichment":  ["Personal Enrichment"],
    "professional-dev":     ["Professional Development and Training"],
    "fasd":                 ["FASD - Fetal Alcohol Syndrome"],
    "trauma":               ["Trauma Informed Care", "Resilience"],
  };

  if (!category) return [];
  const key = category.toLowerCase().replace(/\s+/g, "-");
  return CATEGORY_TAG_MAP[key] || ["Professional Development and Training"];
}

/**
 * Map a category to CACHE professions array.
 */
function inferProfessions(category, professionField) {
  if (professionField) {
    // Could be comma-separated or JSON array
    try {
      const parsed = JSON.parse(professionField);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return professionField.split(",").map((p) => p.trim().toLowerCase().replace(/\s+/g, "-"));
    }
  }

  const CATEGORY_PROFESSION_MAP = {
    "healthcare":        ["physician", "nurse", "allied-health"],
    "behavioral-health": ["behavioral-health", "social-work"],
    "nursing":           ["nurse"],
    "dental":            ["dental"],
    "pharmacy":          ["pharmacy"],
    "social-work":       ["social-work"],
    "public-health":     ["public-health"],
    "first-responder":   ["first-responder"],
    "law-enforcement":   ["law-enforcement"],
    "peer-support":      ["behavioral-health", "social-work"],
  };

  if (!category) return [];
  const key = category.toLowerCase().replace(/\s+/g, "-");
  return CATEGORY_PROFESSION_MAP[key] || [];
}

/**
 * Map delivery_method from form free-text to normalized value.
 */
function normalizeDeliveryMethod(raw) {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("online") || lower.includes("virtual") || lower.includes("remote") || lower.includes("zoom")) {
    return "Virtual";
  }
  if (lower.includes("hybrid") || lower.includes("blended")) {
    return "Hybrid";
  }
  if (lower.includes("person") || lower.includes("onsite") || lower.includes("on-site") || lower.includes("classroom")) {
    return "In-Person";
  }
  return raw;
}

/**
 * Parse price from various formats: "$50", "50.00", "free", etc.
 */
function parsePrice(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === "free" || lower === "0" || lower === "$0") return 0;
  const num = parseFloat(lower.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? null : num;
}

/**
 * Parse credits from form input.
 * Accepts: "CME, CNE", "CME", ["CME","CNE"], JSON array
 */
function parseCredits(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return raw.split(",").map((c) => c.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Format dates for display: "May 10, 2026 – May 12, 2026"
 */
function formatDateRange(start, end) {
  const opts = { month: "long", day: "numeric", year: "numeric" };
  const parts = [];
  if (start) {
    try { parts.push(new Date(start).toLocaleDateString("en-US", opts)); } catch { parts.push(start); }
  }
  if (end && end !== start) {
    try { parts.push(new Date(end).toLocaleDateString("en-US", opts)); } catch { parts.push(end); }
  }
  return parts.join(" – ") || "TBD";
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  // 1. Parse submission payload
  const rawPayload = process.env.SUBMISSION_PAYLOAD;
  if (!rawPayload) {
    console.error("❌ No SUBMISSION_PAYLOAD environment variable found.");
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch (err) {
    console.error("❌ Failed to parse SUBMISSION_PAYLOAD as JSON:", err.message);
    process.exit(1);
  }

  console.log("📥 Processing Jotform submission...");

  // 2. Extract fields
  const title           = resolveField(payload, "title");
  const organization    = resolveField(payload, "organization");
  const description     = resolveField(payload, "description");
  const location        = resolveField(payload, "location");
  const deliveryMethod  = resolveField(payload, "delivery_method");
  const registrationUrl = resolveField(payload, "registration_url");
  const contactEmail    = resolveField(payload, "contact_email");
  const startDate       = resolveField(payload, "start_date");
  const endDate         = resolveField(payload, "end_date");
  const category        = resolveField(payload, "category");
  const professionField = resolveField(payload, "professions");
  const creditsField    = resolveField(payload, "credits");
  const priceField      = resolveField(payload, "price");
  const notes           = resolveField(payload, "notes");
  const submissionId    = payload.submissionID || payload.submission_id || payload.id || `jf-${Date.now()}`;

  // 3. Validate required fields
  const missing = [];
  if (!title)           missing.push("title");
  if (!organization)    missing.push("organization/provider");
  if (!registrationUrl) missing.push("registration_url/website");

  if (missing.length > 0) {
    console.error(`❌ Missing required fields: ${missing.join(", ")}`);
    console.error("Payload keys:", Object.keys(payload).join(", "));
    process.exit(1);
  }

  // 4. Read current catalog index to get next ID
  const index = readJson(INDEX_PATH);
  const nextId = index.total_courses + 1;
  const courseSlug = slug(title);
  const paddedId = String(nextId).padStart(3, "0");
  const fileName = `course-${paddedId}-${courseSlug}.json`;
  const filePath = `${COURSES_DIR}/${fileName}`;

  // 5. Build course JSON (matches CACHE course-catalog schema exactly)
  const course = {
    id:                       nextId,
    title:                    title,
    slug:                     courseSlug,
    status:                   "pending-review",
    source_catalog:           "Jotform Submission",
    source_affiliate_id:      null,
    summary:                  description.slice(0, 200),
    description:              description,
    delivery_method:          normalizeDeliveryMethod(deliveryMethod),
    location:                 location,
    start_date:               startDate,
    end_date:                 endDate || startDate,
    ongoing:                  !startDate,
    price_usd:                parsePrice(priceField),
    seats_available_snapshot: null,
    seats_snapshot_date:      null,
    registration_url:         registrationUrl,
    organization:             organization,
    professions:              inferProfessions(category, professionField),
    topic_tags:               [],
    training_tags:            inferTrainingTags(category),
    credits:                  parseCredits(creditsField),
    notes:                    notes || `Submitted via Jotform. Contact: ${contactEmail || "N/A"}`,
    last_verified_at:         today,
    // Jotform metadata (extra fields for tracking)
    _submission: {
      source:        "jotform",
      submission_id: submissionId,
      contact_email: contactEmail,
      submitted_at:  new Date().toISOString(),
    },
  };

  // 6. Write course JSON file
  writeJson(filePath, course);
  console.log(`✅ Created course file: ${filePath}`);

  // 7. Update catalog index
  index.total_courses = nextId;
  index.generated_at = new Date().toISOString();
  index.courses.push({
    id:    nextId,
    title: title,
    slug:  courseSlug,
    file:  filePath,
  });
  writeJson(INDEX_PATH, index);
  console.log(`✅ Updated catalog index: ${nextId} total courses`);

  // 8. Set GitHub Actions outputs
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const outputs = [
      `course_file=${filePath}`,
      `course_title=${title}`,
      `course_location=${location || "TBD"}`,
      `course_provider=${organization}`,
      `course_dates=${formatDateRange(startDate, endDate)}`,
      `submission_id=${submissionId}`,
    ];
    appendFileSync(outputFile, outputs.join("\n") + "\n");
    console.log("✅ Set GitHub Actions outputs");
  }

  console.log(`\n🎉 Submission processed successfully!`);
  console.log(`   Title:    ${title}`);
  console.log(`   Provider: ${organization}`);
  console.log(`   File:     ${filePath}`);
  console.log(`   ID:       ${nextId}`);
}

main();
