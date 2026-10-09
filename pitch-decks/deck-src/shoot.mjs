// Render each slide HTML to a 2x PNG using system Chrome via Playwright.
// Usage: node shoot.mjs [slidesDir] [outDir] [width] [height] [scale]
// Defaults render ./slides -> ./assets at 1280x720 @2x (true 16:9, 2560x1440).
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
const inArg = process.argv[2] || resolve(HERE, 'slides');
const outDir = process.argv[3] || resolve(HERE, 'assets');
const width = Number(process.argv[4] || 1280);
const height = Number(process.argv[5] || 720);
const scale = Number(process.argv[6] || 2);

const toUrl = (p) => 'file:///' + resolve(p).replace(/\\/g, '/');

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
const page = await ctx.newPage();

const files = inArg.endsWith('.html')
  ? [inArg]
  : readdirSync(inArg)
      .filter((f) => f.endsWith('.html'))
      .sort()
      .map((f) => resolve(inArg, f));

for (const f of files) {
  await page.goto(toUrl(f), { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const base = f
    .split(/[\\/]/)
    .pop()
    .replace(/\.html$/, '');
  const out = resolve(outDir, base + '.png');
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  console.log('shot', out);
}

await browser.close();
