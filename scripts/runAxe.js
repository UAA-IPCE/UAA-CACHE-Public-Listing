const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const pages = [
  '/',
  '/events',
  '/find-training',
  '/map',
  '/about',
  '/faq',
  '/news',
  '/instructors',
  '/organizations',
  '/pathways',
];

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (e) {}
}

function slugFor(p) {
  if (p === '/') return 'home';
  return p.replace(/\//g, '').replace(/[^a-z0-9_-]/gi, '_') || 'page';
}

(async () => {
  await ensureDir(path.join(__dirname, '..', 'test-results', 'axe'));

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const p of pages) {
      const page = await browser.newPage();
      const url = `${BASE.replace(/\/$/, '')}${p}`;
      console.log('Testing', url);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (err) {
        console.error('Failed to load', url, err.message);
      }

      // Inject axe
      const axePath = require.resolve('axe-core/axe.min.js');
      const axeSource = await fs.promises.readFile(axePath, 'utf8');
      await page.evaluate(axeSource + '\nwindow.axe = axe;');

      // Run axe with WCAG2A/AA rules
      const result = await page.evaluate(async () => {
        return await axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa']
          }
        });
      });

      const slug = slugFor(p);
      const outJson = path.join(__dirname, '..', 'test-results', 'axe', `${slug}.json`);
      await fs.promises.writeFile(outJson, JSON.stringify(result, null, 2));
      console.log('Saved', outJson, 'violations:', result.violations.length);

      // Minimal HTML report
      const outHtml = path.join(__dirname, '..', 'test-results', 'axe', `${slug}.html`);
      const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>AXE Report - ${url}</title></head>
<body>
<h1>AXE Report - ${url}</h1>
<p>Violations: ${result.violations.length}</p>
<pre>${JSON.stringify(result.violations, null, 2)}</pre>
</body>
</html>`;
      await fs.promises.writeFile(outHtml, html);

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('All done. Reports in test-results/axe/');
})();
