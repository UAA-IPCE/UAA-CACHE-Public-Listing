/**
 * Build-time sitemap.xml generator.
 * Run after `vite build` or as part of the build pipeline:
 *   node scripts/generateSitemap.js
 *
 * Outputs public/sitemap.xml with all static + dynamic routes.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITE_URL = "https://cache.alaska.edu";

// Static routes
const staticRoutes = [
  "/",
  "/events",
  "/find-training",
  "/calendar",
  "/submit-training",
  "/register-account",
  "/cache-101",
  "/refund-policy",
  "/about",
  "/resources",
  "/instructors",
  "/organizations",
  "/professions",
  "/credits",
  "/regions",
  "/pathways",
  "/faq",
  "/testimonials",
  "/news",
  "/saved",
  "/partners",
];

function readJson(relPath) {
  const fullPath = resolve(__dirname, "..", relPath);
  try {
    return JSON.parse(readFileSync(fullPath, "utf-8"));
  } catch {
    return [];
  }
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Load JSON data for dynamic routes
const instructors = readJson("src/data/instructors.json");
const organizations = readJson("src/data/organizations.json");
const regions = readJson("src/data/regions.json");
const credits = readJson("src/data/credits.json");
const pathways = readJson("src/data/pathways.json");
const partners = readJson("src/data/partners.json");
const announcements = readJson("src/data/announcements.json");
const ahecCourses = readJson("src/data/ahecCourses.json");

// Profession values
const professions = [
  "physician", "nurse", "behavioral-health", "pharmacy", "public-health",
  "community-health-aide", "dental", "dietetics", "ems", "social-work",
  "first-responder", "law-enforcement", "peer-support", "other",
];

const dynamicRoutes = [];

for (const event of ahecCourses) {
  if (event.id) {
    dynamicRoutes.push(`/events/${slug(event.title || "")}--${event.id}`);
  }
}

for (const item of instructors) {
  if (item.id) dynamicRoutes.push(`/instructors/${item.id}`);
}

for (const item of organizations) {
  if (item.id) dynamicRoutes.push(`/organizations/${item.id}`);
}

for (const p of professions) {
  dynamicRoutes.push(`/professions/${p}`);
}

for (const item of credits) {
  if (item.id) dynamicRoutes.push(`/credits/${item.id}`);
}

for (const item of regions) {
  if (item.id) dynamicRoutes.push(`/regions/${item.id}`);
}

for (const item of pathways) {
  if (item.id) dynamicRoutes.push(`/pathways/${item.id}`);
}

for (const item of partners) {
  if (item.id) dynamicRoutes.push(`/partners/${item.id}`);
}

for (const item of announcements) {
  if (item.id) dynamicRoutes.push(`/news/${item.id}`);
}

const allRoutes = [...staticRoutes, ...dynamicRoutes];
const today = new Date().toISOString().split("T")[0];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes
  .map(
    (route) => `  <url>
    <loc>${SITE_URL}${route}</loc>
    <lastmod>${today}</lastmod>
  </url>`
  )
  .join("\n")}
</urlset>`;

const outPath = resolve(__dirname, "..", "public", "sitemap.xml");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, xml, "utf-8");
console.log(`✅ sitemap.xml generated with ${allRoutes.length} URLs → ${outPath}`);
