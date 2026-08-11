import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.URL || 'http://localhost:4321/youtube-audio/';
const OUT = process.env.OUT || '.factory-preview';
const TAG = process.env.TAG || 'detail';
const PATH = process.env.PATH_ || '/';
const COLOR_SCHEME = process.env.COLOR_SCHEME || 'light';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);
const OFFSETS = (process.env.OFFSETS || '0,900,1800').split(',').map(Number);

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

for (const [index, offset] of OFFSETS.entries()) {
  await page.evaluate((top) => window.scrollTo(0, top), offset);
  await page.waitForTimeout(50);
  const output = `${OUT}/${TAG}-${WIDTH}-${COLOR_SCHEME}-${String(index).padStart(2, '0')}-y${offset}.png`;
  await page.screenshot({ path: output });
  console.log('shot', output);
}

await browser.close();
console.log('done');
