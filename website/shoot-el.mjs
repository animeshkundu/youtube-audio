import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4321/youtube-audio/';
const OUT = process.env.OUT || '.factory-preview';
const TAG = process.env.TAG || 'element';
const PATH = process.env.PATH_ || '/';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);
const NAME = process.env.VP || 'desktop';
const COLOR_SCHEME = process.env.COLOR_SCHEME || 'light';
const selectors = (process.env.SELS || '').split('||').filter(Boolean);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  colorScheme: COLOR_SCHEME,
  javaScriptEnabled: process.env.NOJS !== '1',
  ...(process.env.UA ? { userAgent: process.env.UA } : {}),
});
const page = await context.newPage();
await page.goto(BASE.replace(/\/$/, '') + (PATH === '/' ? '/' : PATH), { waitUntil: 'load' });
await page.evaluate(async () => {
  const step = Math.round(window.innerHeight * 0.8);
  for (let y = 0; y <= document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  window.scrollTo(0, 0);
});
await page.evaluate(() =>
  Promise.all(
    Array.from(document.images)
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise((resolve) => {
            image.onload = image.onerror = resolve;
          }),
      ),
  ),
);

let index = 0;
for (const selector of selectors) {
  const element = page.locator(selector).first();
  try {
    await element.scrollIntoViewIfNeeded();
    const safe = selector.replace(/[^a-z0-9]+/gi, '-').slice(0, 24);
    const output = `${OUT}/${TAG}-${NAME}-${COLOR_SCHEME}-${String(index).padStart(2, '0')}-${safe}.png`;
    await element.screenshot({ path: output });
    console.log('shot', output);
  } catch (error) {
    console.error('miss', selector, error.message);
    process.exitCode = 1;
  }
  index += 1;
}

await browser.close();
console.log('done');
