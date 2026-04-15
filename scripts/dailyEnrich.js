#!/usr/bin/env node

/**
 * dailyEnrich.js — CACHE Daily Course Enrichment Pipeline
 * ────────────────────────────────────────────────────────
 * Source:  https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3
 *
 * Reads the freshly scraped ahecCourses.json (produced by scrapeContinuingStudies.js),
 * compares against the current course-catalog index, then:
 *
 *   1. Detects NEW courses not yet in the catalog.
 *   2. Enriches each new course with CACHE taxonomy, voice, and data points.
 *   3. Updates seat‐availability snapshots for ALL existing courses.
 *   4. Writes new course-catalog JSON files.
 *   5. Updates the catalog index.json.
 *   6. Appends new titles to cacheMasterList.ts.
 *   7. Logs a human-readable summary.
 *
 * CACHE Voice & Tone Rules (applied to all generated descriptions):
 *   • Professional but accessible — serve both clinicians and rural learners.
 *   • Action-oriented — lead with what the learner will gain.
 *   • Alaska-specific — mention Alaska context when relevant.
 *   • Equity-centered — highlight cultural responsiveness, rural reach.
 *   • Concise — one clear paragraph; no marketing fluff.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const today = new Date().toISOString().split("T")[0];

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

function normalizeTitle(t) {
  return t
    .trim()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // smart single quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')    // smart double quotes → "
    .replace(/['']/g, "'")                           // fallback curly apos
    .replace(/[""]/g, '"')                           // fallback curly dbl
    .replace(/\s+/g, " ");
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(p|div|b|i|a|span|li|ul|ol|h\d)[^>]*>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Delivery / Format Inference ────────────────────────────

function inferDeliveryMethod(scraped) {
  const d = (scraped.Delivery || "").toLowerCase();
  if (d.includes("on-demand")) return "on-demand";
  if (d.includes("live")) return "live";
  return "on-demand";
}

function inferFormat(scraped) {
  const d = (scraped.Delivery || "").toLowerCase();
  const loc = (scraped.Location || "").toLowerCase();
  if (d.includes("on-demand") || loc.includes("online")) return "Virtual";
  if (d.includes("live") && loc.includes("online")) return "Virtual";
  if (d.includes("live") && !loc.includes("online")) return "In-Person";
  return "Virtual";
}

function inferLocation(scraped) {
  const loc = scraped.Location || "";
  if (loc.startsWith("*")) return loc.slice(1).trim() || "Online";
  return loc || "Online";
}

// ─── Date Parsing ───────────────────────────────────────────

function parseDateField(raw) {
  if (!raw || raw.toLowerCase() === "ongoing") return "";
  // Try MM/DD/YYYY or YYYY-MM-DD
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
}

function isOngoing(scraped) {
  const s = (scraped.FormatedStartDate || "").toLowerCase();
  return s === "ongoing" || s === "";
}

// ─── Region Inference ───────────────────────────────────────

const REGION_KEYWORDS = {
  Southcentral: ["anchorage", "wasilla", "palmer", "kenai", "soldotna", "homer", "seward", "valdez", "rasmuson"],
  Interior: ["fairbanks", "north pole", "delta junction", "tok"],
  Southeast: ["juneau", "ketchikan", "sitka", "skagway", "haines", "petersburg"],
  Northwest: ["nome", "kotzebue", "barrow", "utqiagvik"],
  "Yukon-Kuskokwim": ["bethel", "dillingham"],
};

function inferRegion(scraped) {
  const haystack = `${scraped.CourseName} ${scraped.Location} ${scraped.Description}`.toLowerCase();
  if (haystack.includes("online") || haystack.includes("virtual") || haystack.includes("zoom")) return "Virtual";
  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (keywords.some((k) => haystack.includes(k))) return region;
  }
  return "Virtual";
}

// ─── Profession Inference ───────────────────────────────────
// Rules based on title/description keyword matching — same logic as events.ts

function inferProfessions(title, desc) {
  const h = `${title} ${desc}`.toLowerCase();
  const profs = [];

  if (/(physician|md |do |pa |np |medical|moud|cals|opioid|mat guide|asam)/.test(h)) profs.push("physician");
  if (/(nurs|rn |cne|gero.?nurse|ob care|ed nurse)/.test(h)) profs.push("nurse");
  if (/(behavioral|mental health|counsel|peer|mhfa|dsm|sud |substance|addiction|recovery|ethics.*peer)/.test(h)) profs.push("behavioral-health");
  if (/(pharmac|rx |prescription|medication)/.test(h)) profs.push("pharmacy");
  if (/(public health|epidemiol|program evaluation|health equity)/.test(h)) profs.push("public-health");
  if (/(community health|cha |chw|village|tribal health)/.test(h)) profs.push("community-health-aide");
  if (/(social work|lcsw|aswb|nasw|school social)/.test(h)) profs.push("social-work");
  if (/(dental|dds|coronal polishing|oral health)/.test(h)) profs.push("dental");
  if (/(law enforce|police|officer|corrections)/.test(h)) profs.push("law-enforcement");
  if (/(ems|paramedi|first respond|crisis respond|first aid|cals.*rn)/.test(h)) profs.push("first-responder");
  if (/(dieteti|nutrition|rdns)/.test(h)) profs.push("dietetics");
  if (/(peer support|peer specialist)/.test(h)) profs.push("peer-support");

  return [...new Set(profs)];
}

// ─── Topic Inference ────────────────────────────────────────

function inferTopics(title, desc) {
  const h = `${title} ${desc}`.toLowerCase();
  const topics = [];

  if (/(substance|sud|opioid|moud|mat|addiction|harm reduction)/.test(h)) topics.push("substance-use-disorders");
  if (/(trauma|forensic|compassion fatigue|violence|de-escalation)/.test(h)) topics.push("trauma-informed-care");
  if (/(equity|inclusive|disparit|underserved|rural|indigenous|cultural humility|culturally)/.test(h)) topics.push("health-equity");
  if (/(chronic|diabetes|hypertension|arthritis|pain)/.test(h)) topics.push("chronic-disease");
  if (/(gero|geront|older adult|senior|elder)/.test(h)) topics.push("elder-care-senior-services");
  if (/autism/.test(h)) topics.push("autism-spectrum-disorders");
  if (/fasd|fetal alcohol|prenatal alcohol/.test(h)) topics.push("fasd");

  return topics;
}

// ─── Training Tags Inference ────────────────────────────────

function inferTrainingTags(title, desc, professions) {
  const h = `${title} ${desc}`.toLowerCase();
  const tags = ["Professional Development and Training", "Continuing Education"];

  if (professions.includes("nurse")) tags.push("Nursing");
  if (professions.includes("physician")) tags.push("Physicians");
  if (professions.includes("pharmacy")) tags.push("Pharmacy");
  if (professions.includes("social-work")) tags.push("Social Work");
  if (professions.includes("behavioral-health")) tags.push("Behavioral Health");
  if (professions.includes("community-health-aide")) tags.push("Allied Health");
  if (professions.includes("dental")) tags.push("Dental");
  if (professions.includes("law-enforcement")) tags.push("Law Enforcement");
  if (professions.includes("first-responder")) tags.push("First Responders");

  if (/(substance|sud|opioid|moud|mat|addiction|qap)/.test(h)) tags.push("Substance Use Disorders");
  if (/(trauma|forensic|compassion fatigue|violence|de-escalation)/.test(h)) tags.push("Trauma Informed Care");
  if (/(equity|inclusive|disparit|underserved|indigenous|cultural humility|culturally)/.test(h)) tags.push("Health Equity");
  if (/(elder|older adult|senior|gero|alzheimer|dementia)/.test(h)) tags.push("Aging/Senior Services");
  if (/fasd|fetal alcohol/.test(h)) tags.push("FASD - Fetal Alcohol Syndrome");
  if (/autism/.test(h)) tags.push("Autism Spectrum Disorders");
  if (/(mental health|behavioral health|counsel|mhfa|peer)/.test(h)) tags.push("Behavioral and Mental Health");
  if (/resilien|burnout|wellness/.test(h)) tags.push("Resilience");
  if (/emergency|cals|first aid|critical|trauma update/.test(h)) tags.push("Emergency and Medical");
  if (/student|practicum|academy|onboarding/.test(h)) tags.push("Students");

  return [...new Set(tags)];
}

// ─── Credit Type Inference ──────────────────────────────────

function inferCredits(title, desc) {
  const h = `${title} ${desc}`.toLowerCase();
  const credits = [];

  if (/cme|ama pra/.test(h)) credits.push("CME");
  if (/cne|ancc/.test(h)) credits.push("CNE");
  if (/pharmacy ce|acpe/.test(h)) credits.push("Pharmacy CE");
  if (/social work ce|aswb|nasw/.test(h)) credits.push("Social Work CE");

  // Default to CEU if nothing specific detected
  if (credits.length === 0) credits.push("CEU");

  return credits;
}

// ─── CACHE Voice Description Generator ──────────────────────
// Writes a clean, human-readable description in CACHE tone from
// the raw scraped HTML. Professional, Alaska-focused, action-oriented.

function generateDescription(scraped) {
  const rawDesc = scraped.Description || "";
  const rawLong = scraped.LongDescription || "";
  const plainLong = stripHtml(rawLong);

  // If the long description is rich, extract the first meaningful paragraph
  if (plainLong.length > 80) {
    // Remove boilerplate "When: On-Demand Where: Online..." preamble
    const cleaned = plainLong
      .replace(/^when:\s*\S+\s*where:\s*\S+\s*(continuing education:\s*\S+)?/i, "")
      .trim();

    // Take first ~500 characters at a sentence boundary
    const cutoff = cleaned.slice(0, 600);
    const lastPeriod = cutoff.lastIndexOf(".");
    if (lastPeriod > 80) return cutoff.slice(0, lastPeriod + 1).trim();
    if (cutoff.length > 100) return cutoff.trim();
  }

  // Fall back to the short description
  if (rawDesc.length > 10) return rawDesc.trim();

  return "Continuing education opportunity available through the CACHE catalog. Visit the registration page for full details.";
}

// ─── Price Extraction ───────────────────────────────────────

function extractPrice(scraped) {
  const raw = scraped._raw || {};
  if (raw.Cost !== null && raw.Cost !== undefined) return parseFloat(raw.Cost) || null;
  if (raw.Price !== null && raw.Price !== undefined) return parseFloat(raw.Price) || null;
  const costStr = raw.FormatedCost || "";
  const m = costStr.match(/\$?([\d,.]+)/);
  return m ? parseFloat(m[1].replace(",", "")) : null;
}

// Fuzzy key for title comparison — strips all quotes/apostrophes so minor
// punctuation differences between scrape runs don't create duplicates.
function titleKey(t) {
  return normalizeTitle(t).toLowerCase().replace(/['"''""]/g, "").replace(/\s+/g, " ");
}

// ─── Main Pipeline ──────────────────────────────────────────

const scraped = readJson("src/data/ahecCourses.json");
const index = readJson("src/data/course-catalog/index.json");

// Build lookup of existing titles (normalized)
const existingTitles = new Set(
  index.courses.map((c) => titleKey(c.title))
);

let nextId = Math.max(...index.courses.map((c) => c.id)) + 1;
const newCourses = [];
const seatUpdates = [];

console.log(`📥 Scraped ${scraped.length} courses from UAA Continuing Studies.`);
console.log(`📂 Existing catalog has ${index.courses.length} courses.\n`);

for (const s of scraped) {
  const title = normalizeTitle(s.CourseName);
  const raw = s._raw || {};

  // ── Update seat snapshots for existing courses ──
  const catalogEntry = index.courses.find(
    (c) => titleKey(c.title) === titleKey(title)
  );

  if (catalogEntry) {
    // Update the individual course JSON with fresh seat data
    const coursePath = catalogEntry.file;
    if (existsSync(resolve(ROOT, coursePath))) {
      try {
        const courseJson = readJson(coursePath);
        const newSeats = raw.CapAvailable ?? null;
        const oldSeats = courseJson.seats_available_snapshot;

        if (newSeats !== null && newSeats !== oldSeats) {
          courseJson.seats_available_snapshot = newSeats;
          courseJson.seats_snapshot_date = today;
          courseJson.last_verified_at = today;

          // Also update price if we got one
          const price = extractPrice(s);
          if (price !== null) courseJson.price_usd = price;

          writeJson(coursePath, courseJson);
          seatUpdates.push({ title, seats: newSeats });
        }
      } catch {
        // file might be malformed — skip
      }
    }
    continue; // not new
  }

  // ── This is a NEW course ──
  const desc = generateDescription(s);
  const professions = inferProfessions(title, desc);
  const topicTags = inferTopics(title, desc);
  const trainingTags = inferTrainingTags(title, desc, professions);
  const credits = inferCredits(title, desc);
  const deliveryMethod = inferDeliveryMethod(s);
  const format = inferFormat(s);
  const location = inferLocation(s);
  const region = inferRegion(s);
  const ongoing = isOngoing(s);
  const startDate = parseDateField(s.FormatedStartDate);
  const endDate = parseDateField(s.FormatedEndDate);
  const price = extractPrice(s);
  const seats = raw.CapAvailable ?? null;

  const courseSlug = slug(title);
  const paddedId = String(nextId).padStart(3, "0");
  const fileName = `course-${paddedId}-${courseSlug}.json`;
  const filePath = `src/data/course-catalog/courses/${fileName}`;

  const courseRecord = {
    id: nextId,
    title,
    slug: courseSlug,
    status: "auto-enriched",
    source_catalog: "UAA CACHE",
    source_affiliate_id: "6Q68Q3",
    source_section_index: s.SectionIndex || null,
    summary: s.Description || "",
    description: desc,
    delivery_method: deliveryMethod,
    format,
    location,
    region,
    start_date: startDate,
    end_date: endDate,
    ongoing,
    price_usd: price,
    seats_available_snapshot: seats,
    seats_snapshot_date: seats !== null ? today : "",
    registration_url: s.Url || `https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3`,
    organization: "UAA Continuing Studies",
    instructor: s.Teachers || "",
    image: s.CourseImage || "",
    professions,
    topic_tags: topicTags,
    training_tags: trainingTags,
    credits,
    notes: `Auto-discovered on ${today} by daily scrape pipeline.`,
    last_verified_at: today,
  };

  // Write individual course JSON
  writeJson(filePath, courseRecord);

  // Add to index
  index.courses.push({
    id: nextId,
    title,
    slug: courseSlug,
    file: filePath,
  });

  newCourses.push({ id: nextId, title, filePath });
  nextId++;
}

// ─── Update the course-catalog index ────────────────────────

index.total_courses = index.courses.length;
index.generated_at = new Date().toISOString();
writeJson("src/data/course-catalog/index.json", index);

// ─── Append new titles to cacheMasterList.ts ────────────────

if (newCourses.length > 0) {
  const masterPath = resolve(ROOT, "src/data/cacheMasterList.ts");
  let masterContent = readFileSync(masterPath, "utf-8");

  for (const nc of newCourses) {
    const escaped = nc.title.replace(/"/g, '\\"');
    // Insert before the closing ];
    masterContent = masterContent.replace(
      /\n\];/,
      `\n  "${escaped}",\n];`
    );
  }

  writeFileSync(masterPath, masterContent, "utf-8");
}

// ─── Summary ────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════");
console.log("  CACHE Daily Enrichment Summary");
console.log("═══════════════════════════════════════════════════");
console.log(`  Source:       https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3`);
console.log(`  Date:         ${today}`);
console.log(`  Scraped:      ${scraped.length} courses`);
console.log(`  New courses:  ${newCourses.length}`);
console.log(`  Seat updates: ${seatUpdates.length}`);
console.log(`  Total catalog:${index.total_courses}`);
console.log("───────────────────────────────────────────────────");

if (newCourses.length > 0) {
  console.log("\n🆕 New courses added:");
  for (const nc of newCourses) {
    console.log(`  [${nc.id}] ${nc.title}`);
    console.log(`       → ${nc.filePath}`);
  }
}

if (seatUpdates.length > 0) {
  console.log(`\n🪑 Seat snapshots updated for ${seatUpdates.length} course(s).`);
}

if (newCourses.length === 0 && seatUpdates.length === 0) {
  console.log("\n✅ No changes detected — catalog is up to date.");
}

console.log("");
