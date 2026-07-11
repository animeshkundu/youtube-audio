#!/usr/bin/env node
/**
 * Focused LIVE ad-block verification (logged-out, real Firefox). The general live matrix
 * couldn't observe pruning because the test videos returned no ad fields. This does an A/B:
 * for each candidate video, fetch the WEB /youtubei/v1/player from the page (the same request
 * the extension's filterResponseData intercepts) with ad-block ON vs OFF and compare whether
 * adPlacements / playerAds / adSlots survive.
 *
 * Usage: node tests/e2e/probe-adblock-live.mjs [path-to-bench-xpi]
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADDON_ID = 'youtube-audio@local';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const BASE = {
  enabled: true,
  audioOnlyEnabled: false,
  backgroundPlayEnabled: false,
  ghostEnabled: false,
  aggressiveTelemetry: false,
  adBlockEnabled: true,
  segmentSkipEnabled: false,
  segmentSkipCategories: [],
  forceQualityMax: 'off',
  disableAutoplayNext: false,
  hideShorts: false,
  hideRecommendations: false,
  hideComments: false,
  loudnessNormalization: false,
  equalizerEnabled: false,
  equalizerBands: [0, 0, 0, 0, 0],
  lyricsEnabled: false,
  downloadEnabled: false,
};
// Popular monetized videos more likely to carry ad fields for a logged-out WEB client.
const candidates = ['9bZkp7q19f0', 'kJQP7kiw5Fk', 'JGwWNGJdvx8', 'OPf0YbXqDm0', 'dQw4w9WgXcQ'];

function options() {
  const v = new firefox.Options();
  if (process.env.HEADLESS !== '0') v.addArguments('-headless');
  v.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  return v;
}

async function session(adBlockEnabled) {
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  await driver.installAddon(XPI, true);
  await driver.get(OPTIONS_URL);
  await driver.executeAsyncScript(function (settings) {
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ settings }).then(() => done(true), (e) => done(String(e)));
  }, { ...BASE, adBlockEnabled });
  return driver;
}

async function adFieldsFor(driver, videoId) {
  await driver.get(`https://www.youtube.com/watch?v=${videoId}`);
  await driver.sleep(3500);
  return driver.executeAsyncScript(function (id) {
    const done = arguments[arguments.length - 1];
    try {
      const key = window.ytcfg.get('INNERTUBE_API_KEY');
      const ctx = window.ytcfg.get('INNERTUBE_CONTEXT');
      fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: ctx, videoId: id }),
      })
        .then((r) => r.json())
        .then((j) =>
          done({
            ok: true,
            adPlacements: Array.isArray(j.adPlacements) ? j.adPlacements.length : 0,
            playerAds: Array.isArray(j.playerAds) ? j.playerAds.length : 0,
            adSlots: Array.isArray(j.adSlots) ? j.adSlots.length : 0,
            status: j.playabilityStatus && j.playabilityStatus.status,
          })
        )
        .catch((e) => done({ ok: false, error: String(e) }));
    } catch (e) {
      done({ ok: false, error: String(e) });
    }
  }, videoId);
}

const report = { rows: [], verdict: 'INCONCLUSIVE' };
let off, on;
try {
  off = await session(false);
  on = await session(true);
  for (const id of candidates) {
    const withoutAb = await adFieldsFor(off, id);
    const withAb = await adFieldsFor(on, id);
    const hadAds = withoutAb.ok && (withoutAb.adPlacements + withoutAb.playerAds + withoutAb.adSlots) > 0;
    const pruned = withAb.ok && withAb.adPlacements === 0 && withAb.playerAds === 0 && withAb.adSlots === 0;
    const row = { id, withoutAb, withAb, hadAds, prunedWhenOn: pruned };
    report.rows.push(row);
    if (hadAds && pruned) {
      report.verdict = 'PASS';
      break;
    }
  }
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  if (off) await off.quit().catch(() => undefined);
  if (on) await on.quit().catch(() => undefined);
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
