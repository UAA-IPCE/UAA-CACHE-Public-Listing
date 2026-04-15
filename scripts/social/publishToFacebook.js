#!/usr/bin/env node
/**
 * publishToFacebook.js — CACHE → Facebook Auto-Publisher
 * ──────────────────────────────────────────────────────
 * Posts new CACHE CE events to a Facebook Page as both
 * feed posts and (optionally) Facebook Events via Graph API.
 *
 * Required environment variables:
 *   FACEBOOK_PAGE_ACCESS_TOKEN — Page Access Token with pages_manage_posts,
 *                                 pages_read_engagement, pages_manage_events
 *   FACEBOOK_PAGE_ID           — Numeric Facebook Page ID
 *
 * Usage:
 *   node scripts/social/publishToFacebook.js
 *   node scripts/social/publishToFacebook.js --dry-run
 *   node scripts/social/publishToFacebook.js --event-id uaa-cache-4277
 *   node scripts/social/publishToFacebook.js --events-only     (create FB Events, skip feed posts)
 *   node scripts/social/publishToFacebook.js --posts-only      (create feed posts, skip FB Events)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatFacebookPost, formatFacebookEvent } from "./formatSocialPost.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LEDGER_PATH = path.resolve(ROOT, "data/social_publish_ledger.json");
const ACTIVE_PATH = path.resolve(ROOT, "data/events_active.json");

// ── Configuration ───────────────────────────────────────────
const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
const MAX_POSTS_PER_RUN = 5;

// ── CLI flags ───────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const EVENTS_ONLY = process.argv.includes("--events-only");
const POSTS_ONLY = process.argv.includes("--posts-only");
const SINGLE_EVENT_IDX = process.argv.indexOf("--event-id");
const SINGLE_EVENT_ID = SINGLE_EVENT_IDX !== -1 ? process.argv[SINGLE_EVENT_IDX + 1] : null;

// ── Helpers ─────────────────────────────────────────────────

function readJson(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function writeJson(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { linkedin: {}, facebook: {} };
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
}

function saveLedger(ledger) {
  writeJson(LEDGER_PATH, ledger);
}

/**
 * Post to a Facebook Page feed via Graph API.
 *
 * @param {string} message  — Post text
 * @param {string} linkUrl  — URL to attach
 * @param {string} pageId   — Facebook Page ID
 * @param {string} token    — Page Access Token
 * @returns {Promise<object>}
 */
async function postToPageFeed(message, linkUrl, pageId, token) {
  const params = new URLSearchParams();
  params.set("message", message);
  if (linkUrl) params.set("link", linkUrl);
  params.set("access_token", token);

  const res = await fetch(`${GRAPH_API_BASE}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Facebook Feed API ${res.status}: ${errBody}`);
  }

  return res.json();
}

/**
 * Create a Facebook Event on the Page via Graph API.
 *
 * @param {object} eventData — Facebook Event fields (name, description, start_time, etc.)
 * @param {string} pageId    — Facebook Page ID
 * @param {string} token     — Page Access Token
 * @returns {Promise<object>}
 */
async function createPageEvent(eventData, pageId, token) {
  const params = new URLSearchParams();
  params.set("name", eventData.name);
  params.set("description", eventData.description);
  params.set("start_time", eventData.start_time);
  if (eventData.end_time) params.set("end_time", eventData.end_time);
  if (eventData.place?.name) params.set("location", eventData.place.name);
  if (eventData.ticket_uri) params.set("ticket_uri", eventData.ticket_uri);
  params.set("access_token", token);

  const res = await fetch(`${GRAPH_API_BASE}/${pageId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Facebook Events API ${res.status}: ${errBody}`);
  }

  return res.json();
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;

  if (!DRY_RUN && (!token || !pageId)) {
    console.error("ERROR: Missing FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_PAGE_ID environment variables.");
    console.error("Set them in GitHub Actions secrets or your local .env file.");
    process.exit(1);
  }

  const events = readJson(ACTIVE_PATH);
  const ledger = loadLedger();
  if (!ledger.facebook) ledger.facebook = {};

  // Filter to events not yet posted
  let candidates = events.filter((e) => {
    if (!e.event_id) return false;
    if (ledger.facebook[e.event_id]) return false;
    if (!e.available_for_registration) return false;
    return true;
  });

  // Single-event mode
  if (SINGLE_EVENT_ID) {
    candidates = candidates.filter((e) => e.event_id === SINGLE_EVENT_ID);
    if (candidates.length === 0) {
      const already = ledger.facebook[SINGLE_EVENT_ID];
      if (already) {
        console.log(`Event ${SINGLE_EVENT_ID} was already posted to Facebook on ${already.posted_at}`);
      } else {
        console.log(`Event ${SINGLE_EVENT_ID} not found in active events or not available for registration.`);
      }
      return;
    }
  }

  const batch = candidates.slice(0, MAX_POSTS_PER_RUN);

  if (batch.length === 0) {
    console.log("Facebook: No new events to publish.");
    return;
  }

  console.log(`Facebook: Publishing ${batch.length} event(s)${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

  let successCount = 0;
  let failCount = 0;

  for (const event of batch) {
    const { message, linkUrl } = formatFacebookPost(event);
    const fbEvent = formatFacebookEvent(event);

    console.log(`─── ${event.event_id}: ${event.title} ───`);

    if (DRY_RUN) {
      if (!EVENTS_ONLY) {
        console.log("[DRY RUN] Would post to feed:\n");
        console.log(message);
        console.log();
      }
      if (!POSTS_ONLY && fbEvent) {
        console.log("[DRY RUN] Would create Facebook Event:");
        console.log(`  Name: ${fbEvent.name}`);
        console.log(`  Start: ${fbEvent.start_time}`);
        console.log(`  End: ${fbEvent.end_time}`);
        console.log(`  Location: ${fbEvent.place.name}`);
        console.log();
      }
      console.log("---\n");
      ledger.facebook[event.event_id] = {
        posted_at: new Date().toISOString(),
        dry_run: true,
      };
      successCount++;
      continue;
    }

    try {
      const result = {};

      // Post to feed
      if (!EVENTS_ONLY) {
        const feedResult = await postToPageFeed(message, linkUrl, pageId, token);
        result.feed_post_id = feedResult.id || null;
        console.log(`✓ Feed post created. ID: ${feedResult.id || "ok"}`);
      }

      // Create Facebook Event (only if event has a date)
      if (!POSTS_ONLY && fbEvent) {
        try {
          const eventResult = await createPageEvent(fbEvent, pageId, token);
          result.fb_event_id = eventResult.id || null;
          console.log(`✓ Facebook Event created. ID: ${eventResult.id || "ok"}`);
        } catch (evErr) {
          console.warn(`⚠ Facebook Event creation failed (feed post succeeded): ${evErr.message}`);
          result.fb_event_error = evErr.message;
        }
      }

      ledger.facebook[event.event_id] = {
        posted_at: new Date().toISOString(),
        ...result,
        dry_run: false,
      };
      successCount++;

      // Rate-limit: wait 3 seconds between posts (Facebook is stricter)
      if (batch.indexOf(event) < batch.length - 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`✗ Failed: ${err.message}`);
      failCount++;
    }
  }

  saveLedger(ledger);

  console.log(`\nFacebook summary: ${successCount} posted, ${failCount} failed, ${candidates.length - batch.length} remaining.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
