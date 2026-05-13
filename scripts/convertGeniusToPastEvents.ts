#!/usr/bin/env npx tsx
/**
 * convertGeniusToPastEvents.ts
 *
 * Reads the Genius SIS full export (events.all.json) and produces:
 *   src/data/pastEvents.json   — past live events (end_date < today)
 *
 * Run:  npx tsx scripts/convertGeniusToPastEvents.ts
 *
 * The generated JSON is imported by src/data/pastEvents.ts and merged
 * into the main events array.  Re-run this script any time you get a
 * fresh Genius export.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const INPUT = resolve(ROOT, "COURSE-CONVERT/UAA-CACHE-STATICINFO-V101/events.all.json");
const OUTPUT = resolve(ROOT, "src/data/pastEvents.json");

interface GeniusRecord {
  section_index: number;
  section_name: string;
  section_status: string;
  instructors: string;
  start_date: string | null;
  end_date: string | null;
  enrollments: number;
  cap: number;
  credits: number;
  contact_hours: number | null;
  term: string;
  semester: string;
  price: number | null;
  location: string;
  available_for_registration: boolean;
  registration_url: string;
  ceu_provider: string;
  course_index: number;
  course_name: string;
  course_display_name: string;
  course_status: string;
  category: string;
  affiliation: string;
  type: string;
  description: string;
  course_image: string;
  meeting_time_display: string;
  days: number;
}

interface PastEvent {
  id: string;
  title: string;
  organization: string;
  location: string;
  format: "In-Person" | "Virtual" | "Hybrid";
  start_date: string;
  end_date: string;
  credits: string[];
  description: string;
  registration_url: string;
  region?: string;
  image?: string;
  event_type: "live" | "on-demand" | "enduring";
  instructor_name?: string;
  seats_total?: number;
  enrollments?: number;
  genius_section_index: number;
  genius_course_index: number;
  category?: string;
  ceu_provider?: string;
  price_usd?: number;
  contact_hours?: number;
}

const today = new Date().toISOString().slice(0, 10);

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function inferFormat(r: GeniusRecord): "Virtual" | "In-Person" | "Hybrid" {
  const loc = (r.location || "").toLowerCase();
  if (loc.includes("online") || loc.includes("zoom") || loc.includes("virtual")) return "Virtual";
  if (loc.includes("hybrid")) return "Hybrid";
  return "In-Person";
}

function inferRegion(loc: string): string | undefined {
  const l = loc.toLowerCase();
  if (l.includes("online") || l.includes("zoom") || l.includes("virtual")) return "Virtual";
  if (l.includes("anchorage")) return "Southcentral";
  if (l.includes("fairbanks")) return "Interior";
  if (l.includes("juneau") || l.includes("sitka") || l.includes("ketchikan")) return "Southeast";
  if (l.includes("bethel") || l.includes("kuskokwim")) return "Yukon-Kuskokwim";
  if (l.includes("nome") || l.includes("kotzebue") || l.includes("barrow") || l.includes("utqiagvik")) return "Northern";
  if (l.includes("kodiak")) return "Kodiak";
  if (l.includes("kenai") || l.includes("homer") || l.includes("soldotna") || l.includes("palmer") || l.includes("wasilla") || l.includes("mat-su")) return "Southcentral";
  return undefined;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferEventType(r: GeniusRecord): "live" | "on-demand" | "enduring" {
  if (r.term === "On-Demand") {
    // On-demand with no meaningful end date → enduring
    if (!r.end_date || r.end_date === "2099-12-31") return "enduring";
    return "on-demand";
  }
  return "live";
}

function convertRecord(r: GeniusRecord): PastEvent {
  const cleanDesc = stripHtml(r.description || "");
  const credits: string[] = [];
  if (r.credits > 0) credits.push("CEU");
  if (r.ceu_provider) {
    // Try to infer credit type from provider name
    const prov = r.ceu_provider.toLowerCase();
    if (prov.includes("nursing") || prov.includes("cne")) credits.push("CNE");
    if (prov.includes("medical") || prov.includes("cme")) credits.push("CME");
    if (prov.includes("social work")) credits.push("Social Work CE");
    if (prov.includes("pharmacy")) credits.push("Pharmacy CE");
  }
  if (credits.length === 0 && (r.contact_hours ?? 0) > 0) {
    credits.push("Contact Hours");
  }

  return {
    id: `genius-${r.section_index}`,
    title: (r.course_display_name || r.course_name || r.section_name).trim(),
    organization: r.ceu_provider || "UAA Continuing Studies",
    location: r.location || "Online",
    format: inferFormat(r),
    start_date: r.start_date || "",
    end_date: r.end_date || "",
    credits,
    description: cleanDesc.slice(0, 800),
    registration_url: r.registration_url || "",
    region: inferRegion(r.location || ""),
    image: r.course_image || undefined,
    event_type: inferEventType(r),
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

// ── Main ──────────────────────────────────────────────────────────────
const raw: GeniusRecord[] = JSON.parse(readFileSync(INPUT, "utf-8"));

// Past = live events whose end_date is before today
const pastLive = raw.filter(r => {
  const end = r.end_date || "";
  return end !== "" && end < today && r.term !== "On-Demand";
});

// De-duplicate by section_index
const seen = new Set<number>();
const deduped = pastLive.filter(r => {
  if (seen.has(r.section_index)) return false;
  seen.add(r.section_index);
  return true;
});

const converted = deduped
  .map(convertRecord)
  .sort((a, b) => b.start_date.localeCompare(a.start_date)); // newest first

writeFileSync(OUTPUT, JSON.stringify(converted, null, 2), "utf-8");

console.log(`✅ Wrote ${converted.length} past events to ${OUTPUT}`);
console.log(`   Date range: ${converted.at(-1)?.start_date} → ${converted[0]?.start_date}`);
console.log(`   Skipped ${pastLive.length - deduped.length} duplicates`);
