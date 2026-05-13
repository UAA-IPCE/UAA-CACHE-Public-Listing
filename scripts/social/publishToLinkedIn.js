#!/usr/bin/env node
/**
 * publishToLinkedIn.js — CACHE → LinkedIn Auto-Publisher
 * ──────────────────────────────────────────────────────
 * Posts new CACHE CE events to a LinkedIn Organization Page
 * using the LinkedIn Marketing API (v2).
 *
 * Required environment variables:
 *   LINKEDIN_ACCESS_TOKEN   — OAuth 2.0 access token with w_organization_social scope
 *   LINKEDIN_ORG_ID         — LinkedIn Organization (Company) URN ID (numeric)
 *
 * Usage:
 *   node scripts/social/publishToLinkedIn.js
 *   node scripts/social/publishToLinkedIn.js --dry-run
 *   node scripts/social/publishToLinkedIn.js --event-id uaa-cache-4277
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatLinkedInPost } from "./formatSocialPost.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LEDGER_PATH = path.resolve(ROOT, "data/social_publish_ledger.json");
const ACTIVE_PATH = path.resolve(ROOT, "data/events_active.json");

// ── Configuration ───────────────────────────────────────────
const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";
const MAX_POSTS_PER_RUN = 5; // Rate-limit: max posts in one execution

// ── CLI flags ───────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
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
 * Post to LinkedIn Organization page via the UGC Post API.
 * Uses the v2/ugcPosts endpoint for organization shares.
 *
 * @param {string} text      — Post body text
 * @param {string} linkUrl   — URL to attach as an article share
 * @param {string} orgId     — LinkedIn Organization URN ID
 * @param {string} token     — OAuth access token
 * @returns {Promise<object>} — API response
 */
async function postToLinkedIn(text, linkUrl, orgId, token) {
  const authorUrn = `urn:li:organization:${orgId}`;

  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: linkUrl ? "ARTICLE" : "NONE",
        ...(linkUrl && {
          media: [
            {
              status: "READY",
              originalUrl: linkUrl,
              title: { text: "Register for this training" },
              description: { text: "Alaska CACHE — Continuing Health Education" },
            },
          ],
        }),
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${errText}`);
  }

  return res.json();
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  if (!DRY_RUN && (!token || !orgId)) {
    console.error("ERROR: Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_ORG_ID environment variables.");
    console.error("Set them in GitHub Actions secrets or your local .env file.");
    process.exit(1);
  }

  const events = readJson(ACTIVE_PATH);
  const ledger = loadLedger();
  if (!ledger.linkedin) ledger.linkedin = {};

  // Filter to events not yet posted
  let candidates = events.filter((e) => {
    if (!e.event_id) return false;
    if (ledger.linkedin[e.event_id]) return false;
    if (!e.available_for_registration) return false;
    return true;
  });

  // If a specific event was requested, filter to just that one
  if (SINGLE_EVENT_ID) {
    candidates = candidates.filter((e) => e.event_id === SINGLE_EVENT_ID);
    if (candidates.length === 0) {
      const alreadyPosted = ledger.linkedin[SINGLE_EVENT_ID];
      if (alreadyPosted) {
        console.log(`Event ${SINGLE_EVENT_ID} was already posted to LinkedIn on ${alreadyPosted.posted_at}`);
      } else {
        console.log(`Event ${SINGLE_EVENT_ID} not found in active events or not available for registration.`);
      }
      return;
    }
  }

  // Limit per run
  const batch = candidates.slice(0, MAX_POSTS_PER_RUN);

  if (batch.length === 0) {
    console.log("LinkedIn: No new events to publish.");
    return;
  }

  console.log(`LinkedIn: Publishing ${batch.length} event(s)${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

  let successCount = 0;
  let failCount = 0;

  for (const event of batch) {
    const { text, linkUrl } = formatLinkedInPost(event);

    console.log(`─── ${event.event_id}: ${event.title} ───`);

    if (DRY_RUN) {
      console.log("[DRY RUN] Would post:\n");
      console.log(text);
      console.log("\n---\n");
      ledger.linkedin[event.event_id] = {
        posted_at: new Date().toISOString(),
        dry_run: true,
      };
      successCount++;
      continue;
    }

    try {
      const result = await postToLinkedIn(text, linkUrl, orgId, token);
      console.log(`✓ Posted successfully. ID: ${result.id || "ok"}`);
      ledger.linkedin[event.event_id] = {
        posted_at: new Date().toISOString(),
        post_id: result.id || null,
        dry_run: false,
      };
      successCount++;

      // Rate-limit: wait 2 seconds between posts
      if (batch.indexOf(event) < batch.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error(`✗ Failed: ${err.message}`);
      failCount++;
    }
  }

  saveLedger(ledger);

  console.log(`\nLinkedIn summary: ${successCount} posted, ${failCount} failed, ${candidates.length - batch.length} remaining.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
