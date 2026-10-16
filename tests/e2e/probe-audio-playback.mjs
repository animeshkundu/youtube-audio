#!/usr/bin/env node
/**
 * Live-YouTube playback canary (non-gating, but honest).
 *
 * Questions it answers:
 *   1. Does audio-only actually PLAY for a sustained window (not just advance 3 s)?
 *   2. Does the buffered range stay ahead of the playhead, and does a seek to 80 % resume?
 *   3. Does a LIVE stream fall back to normal playback without breaking?
 *
 * Env knobs:
 *   PROBE_SUSTAIN_MS  sustained-playback window per VOD case (default 45000; a release run uses
 *                     90000). Clamped to 5000..120000.
 *   PROBE_CASES       optional comma-separated video ids to run instead of the full set.
 *   HEADLESS=0        run headful.
 *
 * Verdict semantics: a case that could not load media because YouTube served this network
 * position its "Sign in to confirm you're not a bot" wall, or because the publisher-side video is
 * unavailable, is environment-blocked rather than a regression. If every case is blocked the
 * verdict is INCONCLUSIVE (exit 0 plus a GitHub warning annotation); if some cases were measurable
 * and passed, PASS (partial); FAIL only when a case that did reach YouTube media misbehaved.
 *
 * Usage: node tests/e2e/probe-audio-playback.mjs [xpi]
 */
import { Builder } from 'selenium-webdriver';
import firefox, { ServiceBuilder } from 'selenium-webdriver/firefox.js';

import { seedDataConsent } from './consent-helper.mjs';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADDON_ID = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const SETTINGS = {
  enabled: true, audioOnlyEnabled: true, backgroundPlayEnabled: false, ghostEnabled: false,
  aggressiveTelemetry: false, adBlockEnabled: true, segmentSkipEnabled: false, segmentSkipCategories: [],
  forceQualityMax: 'off', disableAutoplayNext: false, hideShorts: false, hideRecommendations: false,
  hideComments: false, loudnessNormalization: false, equalizerEnabled: false,
  equalizerBands: [0, 0, 0, 0, 0], downloadEnabled: false,
};
const claimedSustainMs = Number(process.env.PROBE_SUSTAIN_MS);
const SUSTAIN_MS = Number.isFinite(claimedSustainMs)
  ? Math.min(Math.max(claimedSustainMs, 5_000), 120_000)
  : 45_000;
const SEEK_MS = 8_000;
const FILTER = (process.env.PROBE_CASES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// VOD eligible (expect audio-only + sustained advance + seek) and live (expect graceful fallback).
// Live fixture ids rotate: a stream can end and turn into "Video unavailable", which the probe now
// reports as UNAVAILABLE rather than a regression. Replace an id when that shows up (verified via
// the public watch page's isLiveNow on 2026-10-15: 4xDzrJKXOOY, 7NOSDKb0HlU, FWjZ0x2M8og and
// 36YnV9STBqc are live; X4VbdwhkE10 and ssf1J2tD-Ak are dead).
const ALL_CASES = [
  { id: 'Bu4ztj3R32k', kind: 'vod', label: 'music' },
  { id: 'kSZddHca0ME', kind: 'vod', label: 'long-10h' },
  { id: 'DaWe9L1iwNw', kind: 'vod', label: 'podcast' },
  { id: '4xDzrJKXOOY', kind: 'live', label: 'live-radio' },
  { id: '7NOSDKb0HlU', kind: 'live', label: 'live-radio-2' },
  { id: 'FWjZ0x2M8og', kind: 'live', label: 'live-radio-3' },
  { id: '36YnV9STBqc', kind: 'live', label: 'live-radio-4' },
];
const CASES = FILTER.length ? ALL_CASES.filter((c) => FILTER.includes(c.id)) : ALL_CASES;
// A filter that matches nothing (typo, renamed id) must fail loudly instead of reporting an empty
// ALL-CLEAR: zero cases would otherwise satisfy `results.length === CASES.length` and exit 0.
if (FILTER.length) {
  const unknown = FILTER.filter((id) => !ALL_CASES.some((c) => c.id === id));
  if (unknown.length || CASES.length === 0) {
    console.error(
      `PROBE_CASES matched ${CASES.length} case(s); unknown ids: ${unknown.join(', ') || '(none)'}`
    );
    process.exit(1);
  }
}

/**
 * Classifies a failing case as environment-blocked rather than a regression. GitHub-hosted runners
 * are datacenter IPs and YouTube frequently serves them the "Sign in to confirm you're not a bot"
 * interstitial: the watch page renders with the real title, but no media ever loads (the first
 * canary run that reached YouTube at all, 2026-10-16, hit it on 6 of 7 cases). A publisher-side
 * "Video unavailable" is likewise not a playback verdict. Both are reported and excluded from the
 * verdict rather than being counted as either a pass or a failure.
 */
function classifyCase(pass, diagnose) {
  if (pass) return 'pass';
  const text = typeof diagnose?.textSample === 'string' ? diagnose.textSample : '';
  if (/not a bot|unusual traffic|not a robot/i.test(text)) return 'bot-wall';
  if (/video unavailable|live stream recording is not available/i.test(text)) return 'unavailable';
  return 'measured-fail';
}
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
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options())
    // Required to navigate to the privileged moz-extension options page: without it geckodriver
    // refuses the navigation ("not allowed in this context") and the probe dies in setup.
    .setFirefoxService(new ServiceBuilder().addArguments('--allow-system-access'))
    .build();
  // The sustained sampler runs inside one async script; the script timeout must outlive it.
  await driver
    .manage()
    .setTimeouts({ script: SUSTAIN_MS + SEEK_MS + 30_000, pageLoad: 60_000 });
  await driver.installAddon(XPI, true);
  await seedDataConsent(driver, OPTIONS_URL);
  await driver.get(OPTIONS_URL);
  await driver.executeAsyncScript(function (s) {
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ settings: s }).then(() => done(true), (e) => done(String(e)));
  }, SETTINGS);

  for (const c of CASES) {
    await driver.get(`https://www.youtube.com/watch?v=${c.id}&hl=en&gl=US`);
    // Wait for hijack (VOD) or a settled video (live fallback).
    let snap = null;
    for (let i = 0; i < 40; i += 1) {
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

    // Bounded page-state diagnosis: on a failure it separates "this network position got a
    // bot/consent wall" from "the extension or YouTube broke". Prints no signed URLs (scheme only).
    const diagnose = await driver.executeScript(function () {
      const v = document.querySelector('video');
      const text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim();
      let sourceScheme = '';
      try {
        const cs = v && (v.currentSrc || v.src);
        if (cs) sourceScheme = new URL(cs, location.href).protocol;
      } catch (e) {
        sourceScheme = 'unparseable';
      }
      return {
        title: document.title.slice(0, 70),
        path: location.pathname.slice(0, 40),
        hasVideo: Boolean(v),
        readyState: v ? v.readyState : null,
        mediaError: v && v.error ? v.error.code : 0,
        sourceScheme: sourceScheme,
        consentForm: Boolean(
          document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox')
        ),
        textSample: text.slice(0, 140),
      };
    });

    // Quick 3.5 s advance check first: fast diagnosis when playback never starts at all.
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

    let sustained = null;
    let seek = null;
    if (c.kind === 'vod') {
      // Sustained window: sample every second; require real progress, buffer margin, no media error.
      sustained = await driver.executeAsyncScript(function (sustainMs) {
        const done = arguments[arguments.length - 1];
        const v = document.querySelector('video');
        if (!v) return done({ error: 'no-video' });
        const samples = [];
        const start = performance.now();
        const p = v.play();
        if (p && p.catch) p.catch(function () {});
        const timer = setInterval(function () {
          const b = v.buffered;
          const bufferedEnd = b.length ? b.end(b.length - 1) : 0;
          samples.push({
            t: v.currentTime,
            bufferedEnd: bufferedEnd,
            paused: v.paused,
            error: v.error ? v.error.code : 0,
          });
          if (performance.now() - start >= sustainMs) {
            clearInterval(timer);
            const first = samples[0];
            const last = samples[samples.length - 1];
            done({
              count: samples.length,
              progress: last.t - first.t,
              bufferedAhead: last.bufferedEnd - last.t,
              bufferedGrowth: last.bufferedEnd - first.bufferedEnd,
              errored: samples.some(function (s) { return s.error; }),
              pausedAtEnd: last.paused,
            });
          }
        }, 1000);
      }, SUSTAIN_MS);

      // Seek to 80 % of duration and require the playhead to resume advancing there.
      seek = await driver.executeAsyncScript(function (seekMs) {
        const done = arguments[arguments.length - 1];
        const v = document.querySelector('video');
        if (!v || !isFinite(v.duration) || v.duration < 30) return done({ skipped: true });
        const target = v.duration * 0.8;
        try {
          v.currentTime = target;
        } catch (e) {
          return done({ skipped: false, error: String(e) });
        }
        const p = v.play();
        if (p && p.catch) p.catch(function () {});
        const deadline = performance.now() + 5000;
        let reached = false;
        const waitReached = setInterval(function () {
          // `reached` latches only while inside the 5 s window; the deadline branch must not
          // count a late land as success just because it is checked after the window closes.
          if (Math.abs(v.currentTime - target) <= 5) {
            reached = true;
          }
          if (reached || performance.now() > deadline) {
            clearInterval(waitReached);
            const t0 = v.currentTime;
            setTimeout(function () {
              done({
                target: target,
                reached: reached,
                t0: t0,
                t1: v.currentTime,
                progress: v.currentTime - t0,
                errored: v.error ? v.error.code : 0,
              });
            }, seekMs);
          }
        }, 250);
      }, SEEK_MS);
    }

    const sustainedOk =
      !sustained ||
      (sustained.count > 0 &&
        sustained.progress >= 0.75 * (SUSTAIN_MS / 1000) &&
        !sustained.errored &&
        (sustained.bufferedAhead >= 3 || sustained.bufferedGrowth >= 3));
    // A skipped seek counts as a failure for VOD cases: the only skip condition is a non-finite
    // duration, which a hijacked direct-audio source should never expose, so treating it as a
    // pass would silently hide exactly the suspicious case.
    const seekOk =
      !!seek && seek.skipped !== true && !!seek.reached && seek.progress >= 3 && !seek.errored;
    const pass =
      c.kind === 'vod'
        ? !!(snap && snap.hijacked && snap.videoWidth === 0 && advanced && sustainedOk && seekOk)
        : // live → fell back to native playback and the page player actually loaded media metadata
          !!(snap && snap.hasVideo && !snap.hijacked && snap.readyState >= 1);
    results.push({
      ...c,
      snap,
      diagnose,
      advance,
      advanced,
      sustained,
      seek,
      sustainedOk,
      seekOk,
      pass,
      blockedKind: classifyCase(pass, diagnose),
    });
  }
} catch (error) {
  results.push({ error: String(error?.stack || error) });
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

const hasSetupError = results.some((r) => r.error);
const incomplete = results.length !== CASES.length;
const measuredFail = results.filter((r) => r.blockedKind === 'measured-fail');
const passed = results.filter((r) => r.blockedKind === 'pass');
const botWalled = results.filter((r) => r.blockedKind === 'bot-wall').length;
const unavailable = results.filter((r) => r.blockedKind === 'unavailable').length;
const blocked = botWalled + unavailable;

let verdict;
let reason;
if (hasSetupError) {
  verdict = 'FAIL';
  reason = 'setup error';
} else if (incomplete) {
  verdict = 'FAIL';
  reason = `${results.length} of ${CASES.length} cases ran`;
} else if (measuredFail.length > 0) {
  verdict = 'FAIL';
  reason = `${measuredFail.length} measurable case(s) failed`;
} else if (passed.length === 0) {
  verdict = 'INCONCLUSIVE';
  reason =
    `${botWalled} bot-walled by YouTube, ${unavailable} unavailable; ` +
    'no playback verdict possible from this network';
} else if (blocked > 0) {
  verdict = 'PASS (partial)';
  reason = `${passed.length} measured pass, ${blocked} environment-blocked`;
} else {
  verdict = 'PASS';
  reason = `${passed.length} case(s)`;
}

for (const r of results) {
  if (r.error) {
    console.log(`[FAIL] ${r.id ?? 'setup'} error=${r.error.split('\n')[0]}`);
    continue;
  }
  const sustainText = r.sustained
    ? r.sustained.error
      ? ` sustain=${r.sustained.error}`
      : ` sustain=${r.sustained.progress?.toFixed?.(1)}s/${(SUSTAIN_MS / 1000).toFixed(0)}s ` +
        `bufferAhead=${r.sustained.bufferedAhead?.toFixed?.(1)}s growth=${r.sustained.bufferedGrowth?.toFixed?.(1)}s`
    : '';
  const seekText = r.seek
    ? r.seek.skipped
      ? ' seek=skipped'
      : ` seek=${r.seek.reached ? 'reached' : 'missed'} +${r.seek.progress?.toFixed?.(1)}s`
    : '';
  const label = r.pass
    ? 'PASS'
    : r.blockedKind === 'bot-wall'
      ? 'BLOCKED'
      : r.blockedKind === 'unavailable'
        ? 'UNAVAILABLE'
        : 'FAIL';
  console.log(
    `[${label}] ${r.id} (${r.label}/${r.kind}) hijacked=${r.snap?.hijacked} ` +
      `vw=${r.snap?.videoWidth} advance=${r.advance?.t0?.toFixed?.(1)}→${r.advance?.t1?.toFixed?.(1)}` +
      ` advanced=${r.advanced}${sustainText}${seekText}` +
      (r.pass ? '' : `\n  signal=${JSON.stringify(r.diagnose)}`)
  );
}
console.log(`\nVERDICT: ${verdict} (${reason})`);
if (verdict !== 'PASS') {
  console.log(`::warning::Live canary ${verdict}: ${reason}`);
}
process.exit(verdict === 'FAIL' ? 1 : 0);
