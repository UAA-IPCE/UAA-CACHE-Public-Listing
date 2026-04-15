#!/usr/bin/env node
/**
 * publishSocial.js — CACHE Social Media Orchestrator
 * ───────────────────────────────────────────────────
 * Single entry-point that runs both LinkedIn and Facebook publishers.
 * Designed to be called from the daily pipeline or GitHub Actions.
 *
 * Detects NEW events by comparing events_active.json against the
 * social_publish_ledger.json, then delegates to each platform publisher.
 *
 * Usage:
 *   node scripts/social/publishSocial.js                  # publish to all platforms
 *   node scripts/social/publishSocial.js --dry-run         # preview without posting
 *   node scripts/social/publishSocial.js --linkedin-only   # LinkedIn only
 *   node scripts/social/publishSocial.js --facebook-only   # Facebook only
 *   node scripts/social/publishSocial.js --event-id uaa-cache-4277  # single event
 *   node scripts/social/publishSocial.js --summary         # just show what would be posted
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LEDGER_PATH = path.resolve(ROOT, "data/social_publish_ledger.json");
const ACTIVE_PATH = path.resolve(ROOT, "data/events_active.json");

// ── CLI flags ───────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LINKEDIN_ONLY = args.includes("--linkedin-only");
const FACEBOOK_ONLY = args.includes("--facebook-only");
const SUMMARY = args.includes("--summary");
const EVENT_ID_IDX = args.indexOf("--event-id");
const EVENT_ID = EVENT_ID_IDX !== -1 ? args[EVENT_ID_IDX + 1] : null;

// ── Helpers ─────────────────────────────────────────────────

function readJson(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { linkedin: {}, facebook: {} };
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
}

// ── Summary Mode ────────────────────────────────────────────

function showSummary() {
  const events = readJson(ACTIVE_PATH);
  const ledger = loadLedger();

  const unpublished = {
    linkedin: events.filter(
      (e) => e.event_id && e.available_for_registration && !ledger.linkedin?.[e.event_id]
    ),
    facebook: events.filter(
      (e) => e.event_id && e.available_for_registration && !ledger.facebook?.[e.event_id]
    ),
  };

  console.log("══════════════════════════════════════════════════════");
  console.log("  CACHE Social Media Publishing Summary");
  console.log("══════════════════════════════════════════════════════\n");
  console.log(`Total active events:     ${events.length}`);
  console.log(`Available for reg:       ${events.filter((e) => e.available_for_registration).length}`);
  console.log(`Unpublished (LinkedIn):  ${unpublished.linkedin.length}`);
  console.log(`Unpublished (Facebook):  ${unpublished.facebook.length}`);
  console.log(`Already posted (LI):     ${Object.keys(ledger.linkedin || {}).length}`);
  console.log(`Already posted (FB):     ${Object.keys(ledger.facebook || {}).length}`);
  console.log();

  if (unpublished.linkedin.length > 0) {
    console.log("── Next LinkedIn posts ──");
    unpublished.linkedin.slice(0, 5).forEach((e) => {
      const date = e.start_date || "On-Demand";
      console.log(`  • [${e.event_id}] ${e.title}  (${date})`);
    });
    if (unpublished.linkedin.length > 5) {
      console.log(`  … and ${unpublished.linkedin.length - 5} more`);
    }
    console.log();
  }

  if (unpublished.facebook.length > 0) {
    console.log("── Next Facebook posts ──");
    unpublished.facebook.slice(0, 5).forEach((e) => {
      const date = e.start_date || "On-Demand";
      console.log(`  • [${e.event_id}] ${e.title}  (${date})`);
    });
    if (unpublished.facebook.length > 5) {
      console.log(`  … and ${unpublished.facebook.length - 5} more`);
    }
    console.log();
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  if (SUMMARY) {
    showSummary();
    return;
  }

  console.log("══════════════════════════════════════════════════════");
  console.log("  CACHE Social Media Auto-Publisher");
  console.log(`  ${new Date().toISOString()}`);
  console.log("══════════════════════════════════════════════════════\n");

  // Build child arguments
  const childArgs = [];
  if (DRY_RUN) childArgs.push("--dry-run");
  if (EVENT_ID) childArgs.push("--event-id", EVENT_ID);

  // ── LinkedIn ──
  if (!FACEBOOK_ONLY) {
    console.log("── LinkedIn ──────────────────────────────────────\n");
    try {
      execFileSync("node", [path.resolve(__dirname, "publishToLinkedIn.js"), ...childArgs], {
        stdio: "inherit",
        env: process.env,
      });
    } catch (err) {
      console.error("LinkedIn publisher exited with error.\n");
    }
  }

  // ── Facebook ──
  if (!LINKEDIN_ONLY) {
    console.log("\n── Facebook ──────────────────────────────────────\n");
    try {
      execFileSync("node", [path.resolve(__dirname, "publishToFacebook.js"), ...childArgs], {
        stdio: "inherit",
        env: process.env,
      });
    } catch (err) {
      console.error("Facebook publisher exited with error.\n");
    }
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Publishing complete.");
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
