#!/usr/bin/env node
/**
 * Closes the two gaps the breadth matrix left open:
 *   1. Does audio-only actually PLAY (currentTime advances), not just load?
 *   2. Does a LIVE stream fall back to normal playback without breaking?
 * IDs are ones the matrix just validated (VOD eligible + one live).
 *
 * Usage: node tests/e2e/probe-audio-playback.mjs [xpi]
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADDON_ID = 'youtube-audio@animesh.kundus.in';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const SETTINGS = {
  enabled: true, audioOnlyEnabled: true, backgroundPlayEnabled: false, ghostEnabled: false,
  aggressiveTelemetry: false, adBlockEnabled: true, segmentSkipEnabled: false, segmentSkipCategories: [],
  forceQualityMax: 'off', disableAutoplayNext: false, hideShorts: false, hideRecommendations: false,
  hideComments: false, loudnessNormalization: false, equalizerEnabled: false,
  equalizerBands: [0, 0, 0, 0, 0], lyricsEnabled: false, downloadEnabled: false,
};
// VOD eligible (expect audio-only + advance) and live (expect graceful fallback, not stalled).
const CASES = [
  { id: 'Bu4ztj3R32k', kind: 'vod', label: 'music' },
  { id: 'kSZddHca0ME', kind: 'vod', label: 'long-10h' },
  { id: 'DaWe9L1iwNw', kind: 'vod', label: 'podcast' },
  { id: 'X4VbdwhkE10', kind: 'live', label: 'live-radio' },
  { id: '7NOSDKb0HlU', kind: 'live', label: 'live-radio-2' },
  { id: 'FWjZ0x2M8og', kind: 'live', label: 'live-radio-3' },
  { id: 'ssf1J2tD-Ak', kind: 'live', label: 'live-news' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function options() {
  const v = new firefox.Options();
  if (process.env.HEADLESS !== '0') v.addArguments('-headless');
  v.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  v.setPreference('media.autoplay.default', 0); // allow autoplay so we can measure advance
  v.setPreference('media.autoplay.blocking_policy', 0);
  return v;
}

const results = [];
let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  await driver.installAddon(XPI, true);
  await driver.get(OPTIONS_URL);
  await driver.executeAsyncScript(function (s) {
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ settings: s }).then(() => done(true), (e) => done(String(e)));
  }, SETTINGS);

  for (const c of CASES) {
    await driver.get(`https://www.youtube.com/watch?v=${c.id}&hl=en&gl=US`);
    // Wait for hijack (VOD) or a settled video.
    let snap = null;
    for (let i = 0; i < 24; i += 1) {
      await sleep(500);
      snap = await driver.executeScript(function () {
        const v = document.querySelector('video');
        if (!v) return { hasVideo: false };
        const cs = v.currentSrc || v.src || '';
        return { hasVideo: true, hijacked: cs.indexOf('googlevideo.com') >= 0,
          blob: cs.indexOf('blob:') === 0, videoWidth: v.videoWidth, readyState: v.readyState };
      });
      if (snap.hasVideo && (snap.hijacked || (snap.blob && snap.readyState > 0))) break;
    }
    // Force play and measure currentTime advance over ~3.5s.
    const advance = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      const v = document.querySelector('video');
      if (!v) return done({ t0: null, t1: null, played: false });
      const t0 = v.currentTime;
      const p = v.play();
      if (p && p.catch) p.catch(function () {});
      setTimeout(function () { done({ t0: t0, t1: v.currentTime, paused: v.paused }); }, 3500);
    });
    const advanced = advance.t1 != null && advance.t0 != null && advance.t1 - advance.t0 > 0.3;
    const pass =
      c.kind === 'vod'
        ? !!(snap && snap.hijacked && snap.videoWidth === 0 && advanced)
        : !!(snap && snap.hasVideo && !snap.hijacked); // live → fell back, not broken
    results.push({ ...c, snap, advance, advanced, pass });
  }
} catch (error) {
  results.push({ error: String(error?.stack || error) });
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

const allPass = results.length === CASES.length && results.every((r) => r.pass);
for (const r of results) {
  console.log(
    `[${r.pass ? 'PASS' : 'FAIL'}] ${r.id} (${r.label}/${r.kind}) hijacked=${r.snap?.hijacked} ` +
      `vw=${r.snap?.videoWidth} advance=${r.advance?.t0?.toFixed?.(1)}→${r.advance?.t1?.toFixed?.(1)} advanced=${r.advanced}`
  );
}
console.log(`\nVERDICT: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
