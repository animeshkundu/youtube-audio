import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4321/youtube-audio/';
const OUT = process.env.OUT || '/tmp/redesign-v3';
const TAG = process.env.TAG || 'd1';
const PATH = process.env.PATH_ || '/';
mkdirSync(OUT, { recursive: true });

const target = BASE.replace(/\/$/, '') + (PATH === '/' ? '/' : PATH);

async function prep(page) {
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((res) => { i.onload = i.onerror = res; }))
    )
  );
  await page.waitForTimeout(250);
}

const browser = await chromium.launch();

// desktop viewport shots at offsets (fraction of full height)
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const dp = await dctx.newPage();
await prep(dp);
const dh = await dp.evaluate(() => document.body.scrollHeight);
const doffsets = (process.env.DOFF || '0,900,1800,2700,3600,4500,5400,6300').split(',').map(Number);
let i = 0;
for (const y of doffsets) {
  await dp.evaluate((yy) => window.scrollTo(0, yy), y);
  await dp.waitForTimeout(200);
  await dp.screenshot({ path: `${OUT}/${TAG}-desk-${String(i).padStart(2,'0')}-y${y}.png` });
  i++;
}
console.log('desktop height', dh);
await dctx.close();

// mobile viewport shots
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });
const mp = await mctx.newPage();
await prep(mp);
const mh = await mp.evaluate(() => document.body.scrollHeight);
const moffsets = (process.env.MOFF || '0,760,1520,2280,3040').split(',').map(Number);
i = 0;
for (const y of moffsets) {
  await mp.evaluate((yy) => window.scrollTo(0, yy), y);
  await mp.waitForTimeout(200);
  await mp.screenshot({ path: `${OUT}/${TAG}-mob-${String(i).padStart(2,'0')}-y${y}.png` });
  i++;
}
console.log('mobile height', mh);
await mctx.close();
await browser.close();
console.log('done');
