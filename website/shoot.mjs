import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4321/youtube-audio/';
const OUT = process.env.OUT || '/tmp/redesign-v3';
const TAG = process.env.TAG || 'v1';
mkdirSync(OUT, { recursive: true });

// pages: [slug, filenameLabel]
const pages = (process.env.PAGES || '/:home').split(',').map((p) => {
  const [path, label] = p.split(':');
  return { path, label };
});

const viewports = [
  { name: 'desktop', width: 1440, height: 900, dsf: 2 },
  { name: 'mobile', width: 390, height: 844, dsf: 3 },
];

async function autoScroll(page) {
  // Scroll through in steps to trigger lazy images, then back to top.
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.85);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
  // Wait for all images to be complete.
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images)
        .filter((i) => !i.complete)
        .map((i) => new Promise((res) => { i.onload = i.onerror = res; }))
    )
  );
  await page.waitForTimeout(200);
}

const browser = await chromium.launch();
for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  for (const { path, label } of pages) {
    const target = BASE.replace(/\/$/, '') + (path === '/' ? '/' : path);
    await page.goto(target, { waitUntil: 'networkidle' });
    await autoScroll(page);
    const file = `${OUT}/${TAG}-${label}-${vp.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log('shot', file);
  }
  await ctx.close();
}
await browser.close();
console.log('done');
