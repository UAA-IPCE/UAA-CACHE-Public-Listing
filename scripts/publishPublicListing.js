#!/usr/bin/env node
/**
 * publishPublicListing.js
 *
 * Generates two JSON files for the UAA-CACHE-Public-Listing repo:
 *   active.json  — current / upcoming CACHE CE listings
 *   past.json    — archived / historical CACHE CE listings
 *
 * Both files share the same record schema so consumers need only one parser.
 *
 * Usage:
 *   node scripts/publishPublicListing.js [--out-dir /path/to/repo]
 *
 * Default --out-dir is ../UAA-CACHE-Public-Listing (sibling folder).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── CLI --out-dir flag ──────────────────────────────────────────────────────
const outDirIdx = process.argv.indexOf("--out-dir");
const OUT_DIR = outDirIdx !== -1 && process.argv[outDirIdx + 1]
  ? path.resolve(process.argv[outDirIdx + 1])
  : path.resolve(ROOT, "..", "UAA-CACHE-Public-Listing");

// ── Source files ────────────────────────────────────────────────────────────
const ACTIVE_PATH   = path.resolve(ROOT, "data/events_active.json");
const ARCHIVED_PATH = path.resolve(ROOT, "data/events_archived.json");
const PAST_PATH     = path.resolve(ROOT, "src/data/pastEvents.json");

function readJson(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

/** Normalize a pastEvents.json record to the public listing schema */
function normalizePastRecord(r) {
  return {
    event_id:        r.id || null,
    title:           r.title || "",
    description:     r.description || "",
    location:        r.location || "Online",
    city:            null,
    state:           r.location && !/online/i.test(r.location) ? "AK" : null,
    start_date:      r.start_date || null,
    end_date:        r.end_date || r.start_date || null,
    start_time:      null,
    end_time:        null,
    registration_url: r.registration_url || null,
    affiliate_id:    "6Q68Q3",
    host_organization: r.organization || "UAA Continuing Studies",
    credits:         Array.isArray(r.credits) ? r.credits.join(", ") : (r.credits || null),
    category:        r.category || null,
    tags:            [],
    cost:            null,
    source_url:      r.registration_url || null,
    delivery:        r.format || null,
    section_index:   r.genius_section_index ? Number(r.genius_section_index) : null,
    seats_total:     r.seats_total ?? null,
    enrollments:     r.enrollments ?? null,
    last_updated:    new Date().toISOString().slice(0, 10),
  };
}

function main() {
  const active   = readJson(ACTIVE_PATH);
  const archived = readJson(ARCHIVED_PATH);
  const pastRaw  = readJson(PAST_PATH);

  // Normalize past records to the same schema as active
  const pastNormalized = pastRaw.map(normalizePastRecord);

  // Merge archived + past, deduplicate by event_id (archived takes priority)
  const seenIds = new Set(archived.map(r => r.event_id));
  const mergedPast = [...archived];
  for (const r of pastNormalized) {
    if (r.event_id && seenIds.has(r.event_id)) continue;
    seenIds.add(r.event_id);
    mergedPast.push(r);
  }

  // Sort: active by start_date asc, past by start_date desc (newest first)
  active.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  mergedPast.sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));

  // Build metadata wrapper
  const now = new Date().toISOString();
  const activeOutput = {
    _meta: {
      generated: now,
      description: "Active and upcoming CACHE continuing education listings",
      count: active.length,
      source: "UAA CACHE Data Pipeline",
    },
    events: active,
  };

  const pastOutput = {
    _meta: {
      generated: now,
      description: "Past / archived CACHE continuing education listings",
      count: mergedPast.length,
      source: "UAA CACHE Data Pipeline",
    },
    events: mergedPast,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const activeDest = path.join(OUT_DIR, "active.json");
  const pastDest   = path.join(OUT_DIR, "past.json");

  fs.writeFileSync(activeDest, JSON.stringify(activeOutput, null, 2) + "\n", "utf-8");
  fs.writeFileSync(pastDest,   JSON.stringify(pastOutput,   null, 2) + "\n", "utf-8");

  // Copy README if it exists in the repo root for Public-Listing, or generate one
  const readmeSrc = path.resolve(ROOT, "scripts", "public-listing-README.md");
  const readmeDest = path.join(OUT_DIR, "README.md");
  if (fs.existsSync(readmeSrc)) {
    let readmeText = fs.readFileSync(readmeSrc, "utf-8");
    
    // Inject Last Updated at the top under the H1
    const timestampStr = new Date().toLocaleString("en-US", { 
      timeZone: "America/Anchorage",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    });
    
    const updateHeader = `\n> **Last Updated:** ${timestampStr} (Hourly Sync)\n`;
    
    // Find the end of the first line (# UAA CACHE Public Listing)
    const lines = readmeText.split("\n");
    if (lines[0].startsWith("#")) {
      lines.splice(1, 0, updateHeader);
      readmeText = lines.join("\n");
    } else {
      readmeText = updateHeader + "\n" + readmeText;
    }

    fs.writeFileSync(readmeDest, readmeText, "utf-8");
    console.log(`readme       → ${readmeDest} (Injected Timestamp)`);
  }

  // Copy workflow to public mirror for transparency (stripped of triggers)
  const workflowSrc = path.resolve(ROOT, ".github", "workflows", "daily-scrape.yml");
  const workflowDestDir = path.join(OUT_DIR, ".github", "workflows");
  const workflowDestFile = path.join(workflowDestDir, "daily-scrape.yml");
  if (fs.existsSync(workflowSrc)) {
    let workflowYaml = fs.readFileSync(workflowSrc, "utf8");
    
    // Safety: Strip the triggers so the public mirror doesn't try to run it and fail
    // We replace the 'on:' block with a comment
    workflowYaml = workflowYaml.replace(/on:[\s\S]*?permissions:/, 
      "# Triggers disabled for public mirror transparency\non: [workflow_dispatch]\n\npermissions:");
    
    fs.mkdirSync(workflowDestDir, { recursive: true });
    fs.writeFileSync(workflowDestFile, workflowYaml, "utf8");
    console.log(`workflow     → ${workflowDestFile} (Triggers Stripped)`);
  }

  // Copy scripts to public mirror for transparency
  const scriptsToMirror = ["pushToPublicRepo.js", "publishPublicListing.js"];
  const scriptsDestDir = path.join(OUT_DIR, "scripts");
  fs.mkdirSync(scriptsDestDir, { recursive: true });
  for (const scriptFile of scriptsToMirror) {
    const scriptSrc = path.resolve(ROOT, "scripts", scriptFile);
    const scriptDest = path.join(scriptsDestDir, scriptFile);
    if (fs.existsSync(scriptSrc)) {
      fs.copyFileSync(scriptSrc, scriptDest);
      console.log(`script       → ${scriptDest}`);
    }
  }

  console.log(`active.json  → ${activeDest}  (${active.length} events)`);
  console.log(`past.json    → ${pastDest}  (${mergedPast.length} events)`);
  console.log(`Generated at ${now}`);
}

main();
