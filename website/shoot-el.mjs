import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4321/youtube-audio/';
const OUT = process.env.OUT || '/tmp/redesign-v3';
const TAG = process.env.TAG || 'el';
const PATH = process.env.PATH_ || '/';
const WIDTH = Number(process.env.WIDTH || 1440);
const NAME = process.env.VP || 'desk';
const sels = (process.env.SELS || '').split('||').filter(Boolean);
mkdirSync(OUT, { recursive: true });
const target = BASE.replace(/\/$/, '') + (PATH === '/' ? '/' : PATH);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(target, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const step = Math.round(window.innerHeight * 0.8);
  for (let y = 0; y <= document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
  window.scrollTo(0, 0);
});
await page.evaluate(() => Promise.all(Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((res) => { i.onload = i.onerror = res; }))));
await page.waitForTimeout(250);

let i = 0;
for (const sel of sels) {
  const el = page.locator(sel).first();
  try {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const safe = sel.replace(/[^a-z0-9]+/gi, '-').slice(0, 24);
    await el.screenshot({ path: `${OUT}/${TAG}-${NAME}-${String(i).padStart(2,'0')}-${safe}.png` });
    console.log('shot', sel);
  } catch (e) { console.log('MISS', sel, e.message); }
  i++;
}
await browser.close();
console.log('done');
