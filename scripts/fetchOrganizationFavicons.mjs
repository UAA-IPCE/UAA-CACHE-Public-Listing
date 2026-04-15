#!/usr/bin/env node
import fs from 'fs';
import https from 'https';

function download(url, dest, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (redirectCount > 5) return reject(new Error('Too many redirects'));
                const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
                return resolve(download(loc, dest, redirectCount + 1));
            }
            if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', reject);
        }).on('error', reject);
    });
}

function writePlaceholderSvg(dest, label) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="8" fill="#0f6b4a" />\n  <text x="50%" y="54%" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#fff" font-weight="700" text-anchor="middle">${label}</text>\n</svg>\n`;
    fs.writeFileSync(dest, svg, 'utf8');
}

async function main() {
    const orgsPath = new URL('../src/data/organizations.json', import.meta.url);
    const orgs = JSON.parse(fs.readFileSync(orgsPath, 'utf8'));

    for (const o of orgs) {
        const dir = `public/logo/organizations/${o.id}`;
        fs.mkdirSync(dir, { recursive: true });
        const pngPath = `${dir}/favicon.png`;
        const svgPath = `${dir}/favicon.svg`;

        if (o.website) {
            try {
                const hostname = new URL(o.website).hostname;
                const favUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
                console.log(`Downloading ${favUrl} -> ${pngPath}`);
                await download(favUrl, pngPath);
                const label = (o.short_name || o.name || o.id).slice(0, 3).toUpperCase();
                writePlaceholderSvg(svgPath, label);
            } catch (err) {
                console.error(`Failed to download for ${o.id}: ${err}`);
                const label = (o.short_name || o.name || o.id).slice(0, 3).toUpperCase();
                writePlaceholderSvg(svgPath, label);
            }
        } else {
            const label = (o.short_name || o.name || o.id).slice(0, 3).toUpperCase();
            writePlaceholderSvg(svgPath, label);
            console.log(`Wrote placeholder ${svgPath}`);
        }
    }
    console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
