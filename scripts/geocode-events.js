import fs from "fs/promises";
import path from "path";

const repoRoot = path.resolve(new URL(import.meta.url).pathname, "../..");
const dataDir = path.join(process.cwd(), "src", "data");

function lineMatch(lines, startIdx, re) {
    for (let i = startIdx; i < Math.min(lines.length, startIdx + 80); i++) {
        const m = lines[i].match(re);
        if (m) return m[1];
    }
    return null;
}

async function extractFromTs(filePath) {
    const txt = await fs.readFile(filePath, "utf8");
    const lines = txt.split(/\r?\n/);
    const results = [];
    for (let i = 0; i < lines.length; i++) {
        const idMatch = lines[i].match(/id:\s*"([^"]+)"/);
        if (idMatch) {
            const id = idMatch[1];
            const title = lineMatch(lines, i, /title:\s*"([^"]+)"/) || "";
            const location = lineMatch(lines, i, /location:\s*"([^"]+)"/) || "";
            const lat = lineMatch(lines, i, /latitude:\s*([\-0-9.]+)/);
            const lng = lineMatch(lines, i, /longitude:\s*([\-0-9.]+)/);
            results.push({ id, title, location, latitude: lat ? Number(lat) : undefined, longitude: lng ? Number(lng) : undefined, source: path.basename(filePath) });
        }
    }
    return results;
}

async function extractFromAhecJson(filePath) {
    const txt = await fs.readFile(filePath, "utf8");
    const arr = JSON.parse(txt);
    return arr.map(a => ({ id: a.event_id || a.SectionIndex || a.CourseIndex || a.CourseName, title: a.CourseName || a.CourseName, location: a.Location || a.Location || "", latitude: undefined, longitude: undefined, source: path.basename(filePath) }));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocode(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UAA-CACHE-geocoder/1.0 (+https://cache.alaska.edu)' } });
    if (!res.ok) return null;
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return null;
    const first = js[0];
    return { lat: Number(first.lat), lon: Number(first.lon), display_name: first.display_name };
}

function findRegionFallback(location, regions) {
    if (!location) return null;
    const city = location.split(",")[0].trim().toLowerCase();
    for (const r of regions) {
        for (const c of r.major_cities || []) {
            if (c.toLowerCase() === city) return { lat: r.latitude, lon: r.longitude, region: r.id };
        }
    }
    return null;
}

async function main() {
    const eventsTs = path.join(process.cwd(), "src", "data", "events.ts");
    const uaaTs = path.join(process.cwd(), "src", "data", "uaaPortalEvents.ts");
    const ahecJson = path.join(process.cwd(), "src", "data", "ahecCourses.json");
    const regionsFile = path.join(process.cwd(), "src", "data", "regions.json");

    const fromEvents = await extractFromTs(eventsTs);
    const fromUaa = await extractFromTs(uaaTs);
    const fromAhec = await extractFromAhecJson(ahecJson);
    const regions = JSON.parse(await fs.readFile(regionsFile, "utf8"));

    const combined = [...fromEvents, ...fromUaa, ...fromAhec];
    // dedupe by id (keep first)
    const seen = new Map();
    for (const e of combined) {
        if (!seen.has(e.id)) seen.set(e.id, e);
    }
    const all = Array.from(seen.values());

    const missing = all.filter(e => e.latitude === undefined || e.longitude === undefined);
    console.log(`Found ${all.length} events; ${missing.length} missing coordinates`);

    const out = [];
    for (let i = 0; i < missing.length; i++) {
        const ev = missing[i];
        const query = ev.location ? `${ev.location}, Alaska` : ev.title;
        let result = null;
        if (query) {
            try {
                // Nominatim rate limit: be polite, 1 request/sec
                result = await geocode(query);
            } catch (err) {
                console.error('geocode error', err);
            }
            await sleep(1100);
        }
        let method = null;
        if (result) {
            method = 'nominatim';
            out.push({ id: ev.id, title: ev.title, location: ev.location, lat: result.lat, lon: result.lon, display_name: result.display_name, method });
            console.log(`Geocoded ${ev.id} -> ${result.lat},${result.lon}`);
            continue;
        }
        // fallback to region centroid by matching city
        const fallback = findRegionFallback(ev.location, regions);
        if (fallback) {
            method = 'region-centroid';
            out.push({ id: ev.id, title: ev.title, location: ev.location, lat: fallback.lat, lon: fallback.lon, display_name: `region:${fallback.region}`, method });
            console.log(`Fallback ${ev.id} -> region ${fallback.region}`);
            continue;
        }
        out.push({ id: ev.id, title: ev.title, location: ev.location, lat: '', lon: '', display_name: '', method: 'none' });
        console.log(`No coords for ${ev.id}`);
    }

    const csvLines = ['id,title,location,lat,lon,display_name,method'];
    for (const r of out) {
        const safe = v => `"${String(v || '').replace(/"/g, '""')}"`;
        csvLines.push([safe(r.id), safe(r.title), safe(r.location), r.lat, r.lon, safe(r.display_name), r.method].join(','));
    }
    await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), 'data', 'events-geocode-report.csv'), csvLines.join('\n'));
    await fs.writeFile(path.join(process.cwd(), 'data', 'events-geocode.json'), JSON.stringify(out, null, 2));
    console.log('Wrote data/events-geocode-report.csv and data/events-geocode.json');
}

main().catch(e => { console.error(e); process.exit(1); });
