#!/usr/bin/env node
/**
 * Validate course-catalog JSON files for data completeness.
 *
 * Usage:  node scripts/validateCourses.js
 * Exit 0 = all OK, Exit 1 = issues found (suitable for CI).
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const COURSES_DIR = join(
  import.meta.dirname ?? ".",
  "../src/data/course-catalog/courses"
);

const REQUIRED_STRINGS = ["title", "slug", "status", "registration_url"];
const REQUIRED_ARRAYS = ["professions", "topic_tags", "training_tags", "credits"];

let issues = 0;

const files = readdirSync(COURSES_DIR).filter((f) => f.endsWith(".json"));

for (const file of files) {
  const raw = readFileSync(join(COURSES_DIR, file), "utf-8");
  let course;
  try {
    course = JSON.parse(raw);
  } catch {
    console.error(`  PARSE ERROR  ${file}`);
    issues++;
    continue;
  }

  for (const key of REQUIRED_STRINGS) {
    if (!course[key] || typeof course[key] !== "string" || !course[key].trim()) {
      console.warn(`  EMPTY  ${file}  →  ${key}`);
      issues++;
    }
  }

  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(course[key]) || course[key].length === 0) {
      console.warn(`  EMPTY  ${file}  →  ${key}[]`);
      issues++;
    }
  }
}

console.log(
  `\nScanned ${files.length} courses — ${issues === 0 ? "✅ all OK" : `⚠️  ${issues} issue(s) found`}`
);

process.exit(issues > 0 ? 1 : 0);
