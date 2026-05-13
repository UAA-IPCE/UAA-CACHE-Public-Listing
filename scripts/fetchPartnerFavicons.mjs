#!/usr/bin/env node
import fs from 'fs';
import https from 'https';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pipe = promisify(pipeline);

const partnersPath = new URL('../src/data/partners.json', import.meta.url);
const partners = JSON.parse(fs.readFileSync(partnersPath, 'utf8'));

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
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="8" fill=\"#0f6b4a\" />\n  <text x=\"50%\" y=\"54%\" font-family=\"Helvetica, Arial, sans-serif\" font-size=\"28\" fill=\"#fff\" font-weight=\"700\" text-anchor=\"middle\">${label}</text>\n</svg>\n`;
  fs.writeFileSync(dest, svg, 'utf8');
}

async function main() {
  for (const p of partners) {
    const dir = `public/logo/partners/${p.id}`;
    fs.mkdirSync(dir, { recursive: true });
    const pngPath = `${dir}/favicon.png`;
    const svgPath = `${dir}/favicon.svg`;

    if (p.website) {
      try {
        const hostname = new URL(p.website).hostname;
        const favUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
        console.log(`Downloading ${favUrl} -> ${pngPath}`);
        await download(favUrl, pngPath);
        // also create a simple SVG fallback using short_name or initials
        const label = (p.short_name || p.name || p.id).slice(0, 3).toUpperCase();
        writePlaceholderSvg(svgPath, label);
      } catch (err) {
        console.error(`Failed to download for ${p.id}: ${err}`);
        const label = (p.short_name || p.name || p.id).slice(0, 3).toUpperCase();
        writePlaceholderSvg(svgPath, label);
      }
    } else {
      const label = (p.short_name || p.name || p.id).slice(0, 3).toUpperCase();
      writePlaceholderSvg(svgPath, label);
      console.log(`Wrote placeholder ${svgPath}`);
    }
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
