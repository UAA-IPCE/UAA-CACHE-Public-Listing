#!/usr/bin/env node

// Export a detailed JSON file containing enriched data for every event.
// Outputs `src/data/events.full.json` and copies a build-ready version to `v101/events.full.json`.

import fs from "fs";
import path from "path";
// This script expects to be run with runtime hooks to allow importing TS and
// resolving path aliases, for example:
//   node -r ts-node/register -r tsconfig-paths/register scripts/exportEventDetails.js

async function main() {
    const eventsModule = await import(path.resolve("src/data/events.ts"));
    const orgs = JSON.parse(fs.readFileSync(path.resolve("src/data/organizations.json"), "utf-8"));

    const events = eventsModule.events;
    const getEventSlug = eventsModule.getEventSlug || ((e) => `${e.id}`);

    function findOrganization(name) {
        if (!name) return null;
        const lc = name.toLowerCase();
        return orgs.find((o) => (o.name && o.name.toLowerCase() === lc) || (o.short_name && o.short_name.toLowerCase() === lc)) || null;
    }

    function normalizeRegistrationUrl(raw) {
        if (!raw) return null;
        try {
            const parsed = new URL(raw);
            const host = parsed.hostname.toLowerCase();
            if (host === "continuingstudies.alaska.edu") {
                const section = parsed.searchParams.get("SectionIndex") || parsed.searchParams.get("id") || parsed.searchParams.get("FilterSectionIndex");
                if (section) return `https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3&FilterSectionIndex=${section}`;
                // ensure AffiliateID present on registration links
                if (parsed.pathname.toLowerCase().includes("/registration.aspx")) {
                    if (!parsed.searchParams.get("AffiliateID")) parsed.searchParams.set("AffiliateID", "6Q68Q3");
                    return parsed.toString();
                }
            }
        } catch (e) {
            // not a valid URL — return raw
        }
        return raw;
    }

    const detailed = events.map((e) => {
        const slug = getEventSlug(e);
        const org = findOrganization(e.organization);
        return {
            id: e.id,
            slug,
            url: `/events/${slug}`,
            title: e.title,
            organization: e.organization,
            organization_details: org,
            location: e.location,
            region: e.region,
            format: e.format,
            event_type: e.event_type ?? (e.start_date && e.start_date <= "2099-12-31" ? "live" : "on-demand"),
            start_date: e.start_date || null,
            end_date: e.end_date || null,
            duration_hours: e.duration_hours ?? null,
            latitude: e.latitude ?? null,
            longitude: e.longitude ?? null,
            credits: e.credits ?? [],
            profession: e.profession ?? [],
            profession_credits: e.profession_credits ?? {},
            seats_total: e.seats_total ?? null,
            seats_remaining: e.seats_remaining ?? null,
            price_usd: e.price_usd ?? null,
            registration_url: e.registration_url || null,
            registration_direct: normalizeRegistrationUrl(e.registration_url || ""),
            description: e.description || null,
            learning_objectives: e.learning_objectives ?? [],
            tags: e.tags ?? [],
            topics: e.topics ?? [],
            training_tags: e.training_tags ?? [],
            image: e.image ?? null,
            instructor_name: e.instructor_name ?? null,
            is_student_friendly: e.is_student_friendly ?? false,
            raw: e,
        };
    });

    const dest = path.resolve("src/data/events.full.json");
    fs.writeFileSync(dest, JSON.stringify(detailed, null, 2));
    console.log(`Wrote detailed events to ${dest}`);

    // also copy into v101 if exists (build folder)
    try {
        const vDestDir = path.resolve("v101");
        if (fs.existsSync(vDestDir)) {
            const vDest = path.join(vDestDir, "events.full.json");
            fs.writeFileSync(vDest, JSON.stringify(detailed, null, 2));
            console.log(`Also wrote v101 copy to ${vDest}`);
        }
    } catch (err) {
        // ignore
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
