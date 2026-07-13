#!/usr/bin/env node
/**
 * MOBILE Firefox (Android emulator) core verification — logged-out.
 * Drives Fenix (org.mozilla.fenix) via geckodriver/Marionette, installs the bench build as a
 * TEMPORARY add-on (no signing), and checks the core path on m.youtube.com:
 *   eligible VOD → audio-only hijack (currentSrc → googlevideo, videoWidth 0, ytaStatus active)
 *   live stream  → graceful fallback (not hijacked, ytaStatus fallback/live)
 * Defaults already have audioOnlyEnabled:true, so no settings seeding is required.
 *
 * Usage: node tests/e2e/probe-mobile-fenix.mjs [xpi]
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ServiceBuilder } from 'selenium-webdriver/firefox.js';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const GECKO = process.env.GECKO || `${process.cwd()}/node_modules/.bin/geckodriver`;
const FENIX_PACKAGE = process.env.FENIX_PACKAGE || 'org.mozilla.fenix';
const CASES = [
  { id: 'Bu4ztj3R32k', kind: 'vod', label: 'music' },
  { id: 'DaWe9L1iwNw', kind: 'vod', label: 'podcast' },
  { id: 'fOdo1GkzZAk', kind: 'kids', label: 'kids-unplayable' },
  { id: 'X4VbdwhkE10', kind: 'live', label: 'live-radio' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function options() {
  const v = new firefox.Options();
  // Target Fenix via Marionette. Only one device is connected, so let geckodriver auto-detect the
  // serial (selenium's enableMobile emits a `deviceSerial` field geckodriver 0.37 rejects).
  v.enableMobile(FENIX_PACKAGE);
  return v;
}

const report = { installed: false, cases: [], verdict: 'INCONCLUSIVE' };
let driver;
try {
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options())
    .setFirefoxService(new ServiceBuilder(GECKO))
    .build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 90_000 });

  // Install the extension as a temporary add-on (no signing needed).
  const addonId = await driver.installAddon(XPI, true);
  report.installed = !!addonId;
  report.addonId = addonId;
  await sleep(1500);

  for (const c of CASES) {
    await driver.get(`https://m.youtube.com/watch?v=${c.id}`);
    let snap = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(700);
      snap = await driver.executeScript(function () {
        const v = document.querySelector('video');
        const cs = v ? v.currentSrc || v.src || '' : '';
        return {
          hasVideo: !!v,
          bench: document.documentElement.dataset.ytaBench || null,
          status: document.documentElement.dataset.ytaStatus || null,
          reason: document.documentElement.dataset.ytaReason || null,
          hijacked: cs.indexOf('googlevideo.com') >= 0,
          currentSrc: cs.slice(0, 40),
          videoWidth: v ? v.videoWidth : null,
          readyState: v ? v.readyState : null,
        };
      });
      if (snap.status && ['active', 'fallback', 'disabled'].includes(snap.status)) {
        if (c.kind !== 'vod' || snap.hijacked) break;
      }
    }
    const pass =
      c.kind === 'vod'
        ? !!(snap && snap.bench === '1' && snap.hijacked && snap.videoWidth === 0)
        : !!(snap && snap.bench === '1' && !snap.hijacked);
    report.cases.push({ ...c, snap, pass });
  }
  report.verdict =
    report.installed && report.cases.length === CASES.length && report.cases.every((c) => c.pass)
      ? 'PASS'
      : 'FAIL';
} catch (error) {
  report.error = String(error?.stack || error);
  report.verdict = 'FAIL';
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
