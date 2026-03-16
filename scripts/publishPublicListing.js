'use strict';

/**
 * publishPublicListing.js
 *
 * Generates SEO-enhanced public output files from active.json and past.json:
 *   - README.md  (enriched with active courses table, JSON-LD, and last-updated timestamp)
 *   - training-sitemap.xml  (XML sitemap for course registration URLs)
 *
 * Usage (run from repo root):
 *   node scripts/publishPublicListing.js
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse a JSON file relative to the repo root. */
function readJson(relPath) {
  const abs = path.resolve(__dirname, '..', relPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

/** Escape characters that are reserved in XML. */
function escapeXml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

/**
 * Normalise a past-record so it always carries the same fields as an
 * active-record.  Missing fields are set to null rather than being absent.
 */
function normalizePastRecord(record) {
  const DEFAULTS = {
    event_id:                 null,
    title:                    null,
    description:              null,
    location:                 null,
    city:                     null,
    state:                    null,
    latitude:                 null,
    longitude:                null,
    start_date:               null,
    end_date:                 null,
    start_time:               null,
    end_time:                 null,
    registration_url:         null,
    affiliate_id:             null,
    host_organization:        null,
    credits:                  null,
    category:                 null,
    tags:                     [],
    cost:                     null,
    last_updated:             null,
    source_url:               null,
    available_for_registration: false,
    seats_available:          null,
    delivery:                 null,
    meeting_time_display:     null,
    public_notes:             null,
    section_index:            null,
    is_enduring:              false,
  };
  return Object.assign({}, DEFAULTS, record);
}

// ---------------------------------------------------------------------------
// SEO generators
// ---------------------------------------------------------------------------

/**
 * Build a Markdown table of active courses.
 *
 * Columns: Course Title | Category | Delivery | Dates | Registration
 */
function generateActiveCoursesTable(activeCourses) {
  const header = [
    '| Course Title | Category | Delivery | Dates | Registration |',
    '|---|---|---|---|---|',
  ];

  const rows = activeCourses.map((course) => {
    const title    = (course.title    || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    const category = (course.category || '—').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    const delivery = (course.delivery || 'On-Demand').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

    let dates = 'Ongoing';
    if (course.start_date) {
      dates = course.start_date;
      if (course.end_date && course.end_date !== course.start_date) {
        dates += ` – ${course.end_date}`;
      }
    }

    const registration = course.registration_url
      ? `[Register](${course.registration_url})`
      : '—';

    return `| ${title} | ${category} | ${delivery} | ${dates} | ${registration} |`;
  });

  return [...header, ...rows].join('\n');
}

/**
 * Build a training sitemap XML document from all course registration URLs.
 *
 * Active courses get priority 0.8; on-demand / archived get 0.5.
 */
function generateSitemapXML(activeCourses, pastCourses) {
  const repoBase    = 'https://raw.githubusercontent.com/UAA-IPCE/UAA-CACHE-Public-Listing/main';
  const currentDate = new Date().toISOString().split('T')[0];

  const repoUrls = [
    { loc: `${repoBase}/active.json`, lastmod: currentDate, changefreq: 'daily',  priority: '1.0' },
    { loc: `${repoBase}/past.json`,   lastmod: currentDate, changefreq: 'weekly', priority: '0.7' },
  ];

  const courseUrls = [...activeCourses, ...pastCourses]
    .filter((c) => c.registration_url)
    .map((course) => ({
      loc:        course.registration_url,
      lastmod:    course.last_updated || currentDate,
      changefreq: 'weekly',
      priority:   course.available_for_registration ? '0.8' : '0.5',
    }));

  const allUrls = [...repoUrls, ...courseUrls];

  const urlEntries = allUrls
    .map(({ loc, lastmod, changefreq, priority }) =>
      [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
      ].join('\n')
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntries,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Build a JSON-LD ItemList schema for all provided courses.
 *
 * Returns a formatted JSON string ready to embed in a <script> tag or a
 * Markdown code block.
 */
function generateJSONLD(courses) {
  const items = courses
    .filter((c) => c.title && c.registration_url)
    .map((course, i) => {
      const courseNode = {
        '@type':       'Course',
        name:          course.title,
        url:           course.registration_url,
        provider: {
          '@type': 'Organization',
          name:    course.host_organization || 'University of Alaska Anchorage Continuing Studies',
          url:     'https://continuingstudies.alaska.edu',
        },
      };

      if (course.description) {
        courseNode.description = course.description.slice(0, 500);
      }
      if (course.category) {
        courseNode.educationalCredentialAwarded = course.category;
      }
      if (course.start_date) {
        courseNode.hasCourseInstance = {
          '@type':    'CourseInstance',
          startDate:  course.start_date,
          endDate:    course.end_date || course.start_date,
          courseMode: course.delivery || 'Online',
        };
      }
      if (course.cost !== null && course.cost !== undefined) {
        courseNode.offers = {
          '@type':         'Offer',
          price:           course.cost,
          priceCurrency:   'USD',
        };
      }

      return {
        '@type':    'ListItem',
        position:   i + 1,
        item:       courseNode,
      };
    });

  const schema = {
    '@context':      'https://schema.org',
    '@type':         'ItemList',
    name:            'UAA CACHE Continuing Education Courses',
    description:     'Active and archived continuing education courses from University of Alaska Anchorage CACHE',
    url:             'https://github.com/UAA-IPCE/UAA-CACHE-Public-Listing',
    numberOfItems:   items.length,
    itemListElement: items,
  };

  return JSON.stringify(schema, null, 2);
}

/**
 * Return a copy of readmeContent with the <!-- LAST_UPDATED --> section
 * replaced (or appended if not present) with the supplied timestamp line.
 */
function embedLastUpdatedTimestamp(readmeContent, generatedISO) {
  const date = generatedISO.split('T')[0];
  const time = generatedISO.split('T')[1].slice(0, 5);
  const line = `> 🕐 **Last synced:** ${date} at ${time} UTC`;

  const OPEN_TAG  = '<!-- LAST_UPDATED -->';
  const CLOSE_TAG = '<!-- /LAST_UPDATED -->';

  const replacement = `${OPEN_TAG}\n${line}\n${CLOSE_TAG}`;

  if (readmeContent.includes(OPEN_TAG)) {
    // Replace existing block (greedy between open/close tags)
    return readmeContent.replace(
      new RegExp(`${OPEN_TAG}[\\s\\S]*?${CLOSE_TAG}`),
      replacement
    );
  }

  // Insert just after the first top-level heading + intro paragraph
  const insertAfterPattern = /^(\s*#[^\n]+\n[\s\S]*?\n---\n)/m;
  if (insertAfterPattern.test(readmeContent)) {
    return readmeContent.replace(
      insertAfterPattern,
      `$1\n${replacement}\n\n`
    );
  }

  // Fallback: prepend below the H1
  return readmeContent.replace(
    /^(# [^\n]+\n)/,
    `$1\n${replacement}\n\n`
  );
}

/**
 * Return a copy of readmeContent updated with:
 *   - last-updated timestamp block
 *   - active courses Markdown table
 *   - JSON-LD structured data block
 */
function updateREADMEWithSEO(readmeContent, activeCoursesTable, jsonLD, generatedISO, activeMeta) {
  let updated = readmeContent;

  // 1. Timestamp
  updated = embedLastUpdatedTimestamp(updated, generatedISO);

  // 2. Active-courses table section
  const TABLE_OPEN  = '<!-- ACTIVE_COURSES_TABLE -->';
  const TABLE_CLOSE = '<!-- /ACTIVE_COURSES_TABLE -->';
  const tableSection = [
    TABLE_OPEN,
    '',
    `## Active Courses (${activeMeta.count})`,
    '',
    '_Refreshed automatically by the cache-bot pipeline. Click a registration link to enroll._',
    '',
    activeCoursesTable,
    '',
    TABLE_CLOSE,
  ].join('\n');

  if (updated.includes(TABLE_OPEN)) {
    updated = updated.replace(
      new RegExp(`${TABLE_OPEN}[\\s\\S]*?${TABLE_CLOSE}`),
      tableSection
    );
  } else {
    // Insert before the Schema section
    updated = updated.replace(
      /(\n## Schema\n)/,
      `\n${tableSection}\n\n---\n$1`
    );
  }

  // 3. JSON-LD block
  const JSONLD_OPEN  = '<!-- JSONLD -->';
  const JSONLD_CLOSE = '<!-- /JSONLD -->';
  const jsonLDSection = [
    JSONLD_OPEN,
    '',
    '## Structured Data (JSON-LD)',
    '',
    'The following [schema.org](https://schema.org) ItemList describes the active course catalog',
    'and is intended for consumption by search engines and structured-data tools.',
    '',
    '<details>',
    '<summary>View JSON-LD schema</summary>',
    '',
    '```json',
    jsonLD,
    '```',
    '',
    '</details>',
    '',
    JSONLD_CLOSE,
  ].join('\n');

  if (updated.includes(JSONLD_OPEN)) {
    updated = updated.replace(
      new RegExp(`${JSONLD_OPEN}[\\s\\S]*?${JSONLD_CLOSE}`),
      jsonLDSection
    );
  } else {
    // Insert before the Public / SEO Notes section (or at end)
    const seoPatt = /(\n## Public \/ SEO Notes\n)/;
    if (seoPatt.test(updated)) {
      updated = updated.replace(seoPatt, `\n${jsonLDSection}\n\n---\n$1`);
    } else {
      updated = updated.trimEnd() + '\n\n---\n\n' + jsonLDSection + '\n';
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const repoRoot = path.resolve(__dirname, '..');

  console.log('📖  Reading data files…');
  const activeData = readJson('active.json');
  const pastData   = readJson('past.json');

  const activeCourses = activeData.events;
  const pastCourses   = pastData.events.map(normalizePastRecord);

  const generatedISO  = activeData._meta.generated;

  console.log(`   Active: ${activeCourses.length} courses`);
  console.log(`   Past:   ${pastCourses.length} courses`);

  // Generate sitemap
  console.log('🗺️   Generating training-sitemap.xml…');
  const sitemapXml = generateSitemapXML(activeCourses, pastCourses);
  fs.writeFileSync(path.join(repoRoot, 'training-sitemap.xml'), sitemapXml, 'utf8');
  console.log('   ✅  training-sitemap.xml written');

  // Generate active-courses table
  console.log('📋  Generating active courses table…');
  const activeCoursesTable = generateActiveCoursesTable(activeCourses);

  // Generate JSON-LD (active courses only for the README block)
  console.log('🔍  Generating JSON-LD schema…');
  const jsonLD = generateJSONLD(activeCourses);

  // Update README
  console.log('📝  Updating README.md with SEO content…');
  const readmePath    = path.join(repoRoot, 'README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  const updatedReadme = updateREADMEWithSEO(
    readmeContent,
    activeCoursesTable,
    jsonLD,
    generatedISO,
    activeData._meta
  );
  fs.writeFileSync(readmePath, updatedReadme, 'utf8');
  console.log('   ✅  README.md updated');

  console.log('\n✨  SEO enhancement complete.');
}

main();
