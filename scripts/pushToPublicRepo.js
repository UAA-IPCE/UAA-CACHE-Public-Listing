#!/usr/bin/env node
/**
 * pushToPublicRepo.js
 *
 * Clones UAA-IPCE/UAA-CACHE-Public-Listing, copies files from /tmp/public-listing/,
 * and pushes a single commit if anything changed.
 *
 * Uses git over HTTPS (execFileSync) rather than the GitHub REST API so the
 * operation works with any PAT that has Contents write access on the target repo.
 *
 * Requires env: PUBLIC_REPO_TOKEN (a PAT with Contents read/write on the target repo)
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const REPO     = "UAA-IPCE/UAA-CACHE-Public-Listing";
const BRANCH   = "main";
const SRC_DIR  = "/tmp/public-listing";
const DEST_DIR = "/tmp/public-listing-repo";
const FILES    = [
  "README.md", 
  "active.json", 
  "past.json",
  ".github/workflows/daily-scrape.yml",
  "scripts/pushToPublicRepo.js",
  "scripts/publishPublicListing.js"
];
const TOKEN    = (process.env.PUBLIC_REPO_TOKEN ?? "").trim();

if (!TOKEN) {
  console.log("No PUBLIC_REPO_TOKEN found; falling back to local git credentials.");
}

/**
 * Run a git command, inheriting stdio so progress is visible in Actions logs.
 * Wraps errors with the command name for easier debugging while masking the token.
 */
function git(args, opts = {}) {
  try {
    execFileSync("git", args, { stdio: "inherit", ...opts });
  } catch (err) {
    const safe = args.map(a => (TOKEN && a.includes(TOKEN)) ? a.replace(TOKEN, "***") : a);
    throw new Error(`git ${safe.join(" ")} failed: ${err.message}`);
  }
}

/** Run a git command and return its trimmed stdout. */
function gitOut(args, opts = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", ...opts }).trim();
  } catch (err) {
    const safe = args.map(a => (TOKEN && a.includes(TOKEN)) ? a.replace(TOKEN, "***") : a);
    throw new Error(`git ${safe.join(" ")} failed: ${err.message}`);
  }
}

function readMetaCount(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))?._meta?.count ?? null;
  } catch {
    return null;
  }
}

function buildCommitMessage(today, counts) {
  return counts.active !== null && counts.past !== null
    ? `data: ${counts.active} active + ${counts.past} past events (${today})`
    : `data: refresh public listing (${today})`;
}

async function main() {
  const today  = new Date().toISOString().slice(0, 10);
  const counts = {
    active: readMetaCount(path.join(SRC_DIR, "active.json")),
    past:   readMetaCount(path.join(SRC_DIR, "past.json")),
  };

  // ── 1. Initialize fresh local repo (Security Squashing) ───────────────────
  // We use a clean-slate fresh init + force-push strategy to ensure that the
  // public repository history NEVER contains more than exactly one commit.
  // This prevents any accidental leakage of historical data, logs, or rules
  // that may have been present in previous versions of the data feeds.
  if (fs.existsSync(DEST_DIR)) {
    fs.rmSync(DEST_DIR, { recursive: true });
  }
  fs.mkdirSync(DEST_DIR, { recursive: true });

  console.log(`Initializing fresh repository for ${REPO}…`);
  git(["init"], { cwd: DEST_DIR });
  git(["checkout", "-b", BRANCH], { cwd: DEST_DIR });

  const authUrl = TOKEN 
    ? `https://x-access-token:${TOKEN}@github.com/${REPO}.git` 
    : `https://github.com/${REPO}.git`;
    
  git(["remote", "add", "origin", authUrl], { cwd: DEST_DIR });

  // ── 2. Clean dest dir and copy source files ──────────────────────────────────
  const destEntries = fs.readdirSync(DEST_DIR);
  for (const entry of destEntries) {
    if (entry !== ".git") {
      fs.rmSync(path.join(DEST_DIR, entry), { recursive: true, force: true });
    }
  }

  for (const file of FILES) {
    const src  = path.join(SRC_DIR, file);
    const dest = path.join(DEST_DIR, file);
    if (!fs.existsSync(src)) {
      console.log(`  skip  ${file} (not found in source)`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  wrote ${file}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  }

  // ── 3. Stage and check for changes ─────────────────────────────────────────
  git(["add", "-A"], { cwd: DEST_DIR });
  const statusOutput = gitOut(["status", "--porcelain"], { cwd: DEST_DIR });
  if (!statusOutput) {
    console.log("\nPublic listing unchanged — skipping commit.");
    return;
  }

  // ── 4. Commit & push ────────────────────────────────────────────────────────
  git(["config", "user.name",  "cache-bot[bot]"],                           { cwd: DEST_DIR });
  git(["config", "user.email", "cache-bot[bot]@users.noreply.github.com"],  { cwd: DEST_DIR });
  git(["commit", "-m", buildCommitMessage(today, counts)],                  { cwd: DEST_DIR });
  git(["push", "-f", "origin", BRANCH],                                     { cwd: DEST_DIR });

  console.log(`\nPushed to https://github.com/${REPO}`);
}

main().catch(err => {
  console.error("Push failed:", err.message);
  process.exit(1);
});
