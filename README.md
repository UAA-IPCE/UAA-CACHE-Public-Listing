# UAA CACHE Public Listing

**Public JSON feeds for the University of Alaska Anchorage CACHE continuing education catalog.**

This repository is a public-facing data mirror for CACHE course and event listings. It is auto-generated from the private [UAA-CACHE-StaticSite-v101](https://github.com/UAA-IPCE/UAA-CACHE-StaticSite-v101) pipeline and is intended to be easy to browse, easy to download, and safe to reference from public websites, dashboards, search tools, and SEO workflows.

The public repo contains only clean output files for public consumption:

- `README.md` for human-readable documentation
- `active.json` for current and upcoming listings
- `past.json` for historical and archived listings

---

## Files

| File | Description | Records |
|------|-------------|---------|
| [`active.json`](active.json) | Current, upcoming, open-registration, online, in-person, and hybrid CACHE listings | Refreshed by the automation pipeline |
| [`past.json`](past.json) | Archived, completed, and historical CACHE listings | Growing archive of older offerings |

---

## What The JSON Includes

The feeds are designed to represent the kinds of listings people expect to find on the public CACHE catalog, including:

- live upcoming trainings with active registration
- scheduled online events
- scheduled in-person events
- hybrid offerings
- historical past events for archive and analysis use cases
- standardized event metadata that can be reused across sites and systems

Depending on the source record, an event may include information such as title, date, delivery format, location, credits, host organization, registration URL, seat availability, tags, and cost.

This makes the repo useful for:

- public website integrations
- open data and reporting workflows
- partner institution embeds
- analytics and dashboards
- search indexing and discovery pages

---

## Schema

Both files share the same top-level structure:

```json
{
  "_meta": {
    "generated": "2026-03-12T20:00:00.000Z",
    "description": "Active and upcoming CACHE continuing education listings",
    "count": 96,
    "source": "UAA-IPCE/UAA-CACHE-StaticSite-v101"
  },
  "events": [ ... ]
}
```

### Event Record Fields

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | string | Unique identifier (e.g. `uaa-cache-1234`) |
| `title` | string | Course / event title |
| `description` | string | Plain-text description (HTML stripped) |
| `location` | string | Venue or "Online" |
| `city` | string \| null | City name if in-person |
| `state` | string \| null | State code (typically "AK") |
| `start_date` | string | ISO date `YYYY-MM-DD` |
| `end_date` | string | ISO date `YYYY-MM-DD` |
| `start_time` | string \| null | e.g. "9:00 AM" |
| `end_time` | string \| null | e.g. "5:00 PM" |
| `registration_url` | string \| null | Direct registration link |
| `affiliate_id` | string | Genius SIS affiliate ID |
| `host_organization` | string | Hosting organization name |
| `credits` | string \| null | CE credit types offered |
| `category` | string \| null | Course category |
| `tags` | string[] | Keywords / tags |
| `cost` | number \| null | Price in USD |
| `delivery` | string \| null | Delivery format (Online, In-Person, Hybrid) |
| `source_url` | string \| null | Original listing URL |
| `seats_available` | number \| null | Remaining seats (active only) |
| `last_updated` | string | ISO date of last data sync |
| `section_index` | number \| null | Genius SIS section index |

### Notes On Field Behavior

- `active.json` may include operational fields such as `seats_available` when that information exists in the source system.
- `past.json` uses the same general schema so downstream consumers can reuse a single parser.
- Some values may be `null` when the upstream source does not provide that detail.
- `description` is flattened to plain text for easier API consumption and public reuse.
- `delivery`, `credits`, and `category` reflect normalized catalog data where available.

---

## Data Source

Data is sourced from the **Genius SIS** (Student Information System) public registration page for [UAA Continuing Studies](https://continuingstudies.alaska.edu). The pipeline:

1. Fetches the live Genius JSON feed
2. Merges with historical archive
3. Splits into active vs. past based on end dates
4. Writes clean public JSON artifacts
5. Publishes those artifacts to this repo

The public repo is intentionally kept separate from the private site/application repository so consumers only see public-facing data products rather than internal scripts, workflows, and implementation details.

---

## Usage

Fetch the raw JSON directly:

```
https://raw.githubusercontent.com/UAA-IPCE/UAA-CACHE-Public-Listing/main/active.json
https://raw.githubusercontent.com/UAA-IPCE/UAA-CACHE-Public-Listing/main/past.json
```

Or use the GitHub API:

```bash
curl -s https://api.github.com/repos/UAA-IPCE/UAA-CACHE-Public-Listing/contents/active.json \
  -H "Accept: application/vnd.github.raw" | jq '.events | length'
```

You can also treat this repository as a lightweight public dataset endpoint for static sites, ETL jobs, reporting notebooks, or search indexing pipelines.

---

## Public / SEO Notes

This repository exists partly to support public discoverability.

- the files are publicly accessible without authentication
- the repository can be crawled, linked, and referenced from documentation or partner sites
- raw JSON URLs can be used by external systems that build landing pages, search experiences, or directory views
- the dataset structure is intentionally simple so it can support search ingestion and public content reuse

For Google and other search engines, this repo helps by providing:

- stable public URLs for machine-readable event data
- transparent documentation about what the dataset contains
- a clear separation between public content and private implementation code
- a clean repository structure with minimal noise for public visitors

### Structured Data (JSON-LD)

To help search engines understand this repository as a dataset of continuing education listings, we include the following Schema.org markup:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Dataset",
  "name": "UAA CACHE Continuing Education Listings",
  "description": "Public JSON feed of active and past healthcare continuing education trainings from the University of Alaska Anchorage CACHE portal.",
  "url": "https://github.com/UAA-IPCE/UAA-CACHE-Public-Listing",
  "creator": {
    "@type": "Organization",
    "name": "UAA IPCE"
  },
  "distribution": [
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://raw.githubusercontent.com/UAA-IPCE/UAA-CACHE-Public-Listing/main/active.json"
    }
  ]
}
</script>
```

---

## Public Repo Design Principles

This repository is kept intentionally minimal:

- no internal automation scripts
- no private workflow files
- no development-only artifacts
- no app source code
- only clean public documentation and public JSON outputs

That keeps the repo understandable for external users and keeps commit history focused on data refreshes rather than implementation churn.

---

## License

This data is provided for informational and educational purposes. See the [UAA CACHE website](http://cache.uaa.alaska.edu/) for official course information and registration.

---

*Maintained by [UAA IPCE](https://github.com/UAA-IPCE) · Auto-updated by [cache-bot](https://github.com/UAA-IPCE/UAA-CACHE-StaticSite-v101)*
