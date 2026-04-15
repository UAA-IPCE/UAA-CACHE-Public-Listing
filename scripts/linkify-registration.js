import fs from 'fs/promises';
import path from 'path';

function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function extractEventsFromTs(filePath) {
    const txt = await fs.readFile(filePath, 'utf8');
    const lines = txt.split(/\r?\n/);
    const results = [];
    for (let i = 0; i < lines.length; i++) {
        const idM = lines[i].match(/id:\s*"([^"]+)"/);
        if (idM) {
            const id = idM[1];
            const title = (function () {
                for (let j = i; j < i + 12 && j < lines.length; j++) { const m = lines[j].match(/title:\s*"([^"]+)"/); if (m) return m[1]; } return '';
            })();
            const reg = (function () { for (let j = i; j < i + 20 && j < lines.length; j++) { const m = lines[j].match(/registration_url:\s*"([^"]+)"/); if (m) return m[1]; } return null; })();
            results.push({ id, title, registration_url: reg, file: path.basename(filePath), index: i });
        }
    }
    return results;
}

async function main() {
    const root = process.cwd();
    const ahecPath = path.join(root, 'src', 'data', 'ahecCourses.json');
    const eventsTs = path.join(root, 'src', 'data', 'events.ts');
    const uaaTs = path.join(root, 'src', 'data', 'uaaPortalEvents.ts');
    const ahec = JSON.parse(await fs.readFile(ahecPath, 'utf8'));
    const ev1 = await extractEventsFromTs(eventsTs);
    const ev2 = await extractEventsFromTs(uaaTs);
    const all = [...ev1, ...ev2];

    const genericBase = 'https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3';

    const candidates = all.filter(e => !e.registration_url || e.registration_url.trim() === genericBase || e.registration_url.trim() === genericBase + '"');
    console.log(`Found ${candidates.length} events using generic registration or missing link`);

    const mappings = [];
    for (const c of candidates) {
        const norm = normalize(c.title);
        let best = null;
        for (const a of ahec) {
            const an = normalize(a.CourseName || a.CourseName || a.CourseName);
            if (!an) continue;
            if (an === norm || an.includes(norm) || norm.includes(an)) { best = a; break; }
        }
        if (!best) {
            for (const a of ahec) { const an = normalize(a.CourseName || a.CourseName); if (!an) continue; if (an.split(' ').some(w => norm.includes(w) && w.length > 4)) { best = a; break; } }
        }
        mappings.push({ id: c.id, title: c.title, file: c.file, found: !!best, direct: best ? (best.DirectUrl || best.RegistrationUrl || '') : '', sourceCourseName: best ? best.CourseName : '' });
    }

    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'registration-fixes.json'), JSON.stringify(mappings, null, 2));
    const csv = ['id,title,file,found,direct,sourceCourseName'].concat(mappings.map(m => `"${m.id.replace(/"/g, '""')}","${(m.title || '').replace(/"/g, '""')}","${m.file}",${m.found},"${(m.direct || '').replace(/"/g, '""')}","${(m.sourceCourseName || '').replace(/"/g, '""')}"`)).join('\n');
    await fs.writeFile(path.join(root, 'data', 'registration-fixes.csv'), csv);
    console.log('Wrote data/registration-fixes.json and .csv');
    const foundCount = mappings.filter(m => m.found && m.direct).length;
    console.log(`Matches with direct url: ${foundCount} / ${mappings.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
