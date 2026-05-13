#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

const brandingDir = path.resolve(process.cwd(), 'partner-logo-branding');
const outBase = path.resolve(process.cwd(), 'public', 'logo');

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function renderPngFromSvg(svgContent, outPath) {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 64, height: 64 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{width:64px;height:64px}</style></head><body>${svgContent}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const body = await page.$('body');
    await body.screenshot({ path: outPath, omitBackground: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const files = await fs.readdir(brandingDir);
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.svg')) continue;
      const name = path.parse(f).name;
      const slug = slugify(name);
      const srcPath = path.join(brandingDir, f);
      const svgContent = await fs.readFile(srcPath, 'utf8');
      for (const type of ['partners', 'organizations']) {
        const destDir = path.join(outBase, type, slug);
        await ensureDir(destDir);
        const destSvg = path.join(destDir, 'favicon.svg');
        const destPng = path.join(destDir, 'favicon.png');
        await fs.writeFile(destSvg, svgContent, 'utf8');
        try {
          await renderPngFromSvg(svgContent, destPng);
          console.log(`Wrote ${destPng}`);
        } catch (err) {
          console.error(`Failed to render PNG for ${f} -> ${destPng}:`, err.message || err);
        }
      }
    }
    console.log('Done.');
  } catch (err) {
    console.error('Error generating branding favicons:', err);
    process.exit(1);
  }
}

main();
