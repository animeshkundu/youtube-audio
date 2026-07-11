#!/usr/bin/env node
/**
 * DESKTOP BREADTH MATRIX (logged-out, real Firefox) — 35+ diverse videos.
 *
 * Rationale: hand-picking a handful of videos misses edge cases. This harvests a large,
 * currently-valid, category-diverse corpus live from YouTube search, classifies EVERY video
 * through the extension's real credentialless ANDROID_VR path, then deep-verifies a sample on
 * real watch pages.
 *
 *   Phase A — Harvest: scrape videoIds from search results across 11 categories (+8 seeds).
 *   Phase B — Classify: for each video, replicate the extension's exact
 *             `POST /youtubei/v1/player?key=…&prettyPrint=false` (ANDROID_VR, credentials:'omit',
 *             contentCheckOk/racyCheckOk) → record playability + audio-format + live/length.
 *   Phase C — Deep-verify: for a representative sample, load the watch page with the extension
 *             (audio-only ON) and assert the hard discriminator:
 *               eligible  → video.currentSrc becomes a googlevideo URL AND videoWidth === 0
 *               fallback  → NOT hijacked (blob:/empty), page not broken.
 *
 * Usage: node tests/e2e/probe-audio-matrix.mjs [path-to-bench-xpi]
 * Env:   HEADLESS=0 to watch; DEEP=n to change deep-verify sample size (default 8).
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { writeFileSync } from 'node:fs';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADDON_ID = 'youtube-audio@local';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const DEEP_N = Number(process.env.DEEP || 8);

// ANDROID_VR client — mirrors src/shared/innertube.ts exactly (inlined for page context).
const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.65.10',
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  osName: 'Android',
  osVersion: '12L',
  androidSdkVersion: 32,
  userAgent:
    'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  hl: 'en',
  gl: 'US',
};

const SETTINGS = {
  enabled: true,
  audioOnlyEnabled: true,
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

const LIVE_FILTER = 'EgJAAQ%3D%3D'; // YouTube search "Live" filter (sp=).
const QUERIES = [
  { q: 'official music video', cat: 'music', n: 4 },
  { q: 'nursery rhymes for kids', cat: 'kids', n: 3 },
  { q: 'full podcast episode', cat: 'podcast', n: 3 },
  { q: 'classical music full symphony', cat: 'classical', n: 3 },
  { q: 'gaming no commentary walkthrough', cat: 'gaming', n: 3 },
  { q: '10 hours relaxing rain', cat: 'long', n: 3 },
  { q: 'tiny desk concert', cat: 'live-music-clip', n: 3 },
  { q: 'guided meditation sleep', cat: 'ambient', n: 3 },
  { q: 'kpop comeback stage', cat: 'regional', n: 3 },
  { q: 'breaking news', cat: 'live-news', n: 3, live: true },
  { q: 'lofi hip hop radio beats to study', cat: 'live-radio', n: 3, live: true },
];
const SEEDS = [
  { id: 'dQw4w9WgXcQ', cat: 'seed-normal' },
  { id: 'jNQXAC9IVRw', cat: 'seed-oldest-short' },
  { id: '9bZkp7q19f0', cat: 'seed-music' },
  { id: 'fJ9rUzIMcZQ', cat: 'seed-music' },
  { id: 'XqZsoesa55w', cat: 'seed-kids' },
  { id: 'jfKfPfyJRdk', cat: 'seed-live' },
  { id: 'kJQP7kiw5Fk', cat: 'seed-music' },
  { id: 'OPf0YbXqDm0', cat: 'seed-music' },
];

function firefoxOptions() {
  const v = new firefox.Options();
  if (process.env.HEADLESS !== '0') v.addArguments('-headless');
  v.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  v.setPreference('intl.accept_languages', 'en-US, en');
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function harvest(driver) {
  const corpus = new Map(); // id -> {id, cat}
  for (const { q, cat, n, live } of QUERIES) {
    const url =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US` +
      (live ? `&sp=${LIVE_FILTER}` : '');
    try {
      await driver.get(url);
      await sleep(2200);
      const ids = await driver.executeScript(function () {
        const found = [];
        const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
        const src = document.documentElement.innerHTML;
        let m;
        while ((m = re.exec(src)) !== null) found.push(m[1]);
        return found;
      });
      let added = 0;
      for (const id of ids) {
        if (added >= n) break;
        if (!corpus.has(id)) {
          corpus.set(id, { id, cat });
          added += 1;
        }
      }
    } catch (e) {
      // Non-fatal: skip a query that failed to load.
    }
  }
  for (const s of SEEDS) if (!corpus.has(s.id)) corpus.set(s.id, s);
  return [...corpus.values()];
}

async function classifyOne(driver, videoId) {
  return driver.executeAsyncScript(
    function (id, client) {
      const done = arguments[arguments.length - 1];
      try {
        const key = window.ytcfg && window.ytcfg.get('INNERTUBE_API_KEY');
        const visitorData = window.ytcfg && window.ytcfg.get('VISITOR_DATA');
        if (!key) return done({ ok: false, error: 'no-innertube-key' });
        const ctxClient = visitorData ? Object.assign({}, client, { visitorData }) : client;
        fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: ctxClient },
            videoId: id,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (j) {
            const fmts = (j.streamingData && j.streamingData.adaptiveFormats) || [];
            const audio = fmts.filter(function (f) {
              return f && typeof f.mimeType === 'string' && f.mimeType.indexOf('audio/') === 0;
            });
            audio.sort(function (a, b) {
              const pref = function (it) {
                return it === 251 ? 2 : it === 140 ? 1 : 0;
              };
              return pref(b.itag) - pref(a.itag) || (b.bitrate || 0) - (a.bitrate || 0);
            });
            const best = audio[0];
            let host = null;
            try {
              if (best && best.url) host = new URL(best.url).hostname;
            } catch (e) {}
            const vd = j.videoDetails || {};
            done({
              ok: true,
              status: (j.playabilityStatus && j.playabilityStatus.status) || null,
              reason: (j.playabilityStatus && j.playabilityStatus.reason) || null,
              hasAudio: !!(best && best.url),
              bestItag: best ? best.itag : null,
              host: host,
              isGooglevideo: !!(host && host.indexOf('googlevideo.com') >= 0),
              isLive: !!(vd.isLive || vd.isLiveContent),
              lengthSeconds: vd.lengthSeconds || null,
              musicVideoType: vd.musicVideoType || null,
              title: vd.title || null,
            });
          })
          .catch(function (e) {
            done({ ok: false, error: String(e) });
          });
      } catch (e) {
        done({ ok: false, error: String(e) });
      }
    },
    videoId,
    ANDROID_VR_CLIENT
  );
}

async function deepVerify(driver, videoId) {
  await driver.get(`https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`);
  // Poll for hijack signal (currentSrc → googlevideo) or a stable normal state.
  let snap = null;
  for (let i = 0; i < 24; i += 1) {
    await sleep(500);
    snap = await driver.executeScript(function () {
      const v = document.querySelector('video');
      if (!v) return { hasVideo: false };
      const cs = v.currentSrc || v.src || '';
      return {
        hasVideo: true,
        currentSrc: cs.slice(0, 40),
        hijacked: cs.indexOf('googlevideo.com') >= 0,
        blob: cs.indexOf('blob:') === 0,
        videoWidth: v.videoWidth,
        readyState: v.readyState,
        paused: v.paused,
        audioGraph: !!window.ytaAudioGraph,
      };
    });
    if (snap.hasVideo && (snap.hijacked || (snap.blob && snap.readyState > 0))) break;
  }
  return snap;
}

const report = {
  harvestedCount: 0,
  byCategory: {},
  classified: [],
  deep: [],
  summary: {},
  verdict: 'INCONCLUSIVE',
};
let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(firefoxOptions()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  await driver.installAddon(XPI, true);
  await driver.get(OPTIONS_URL);
  await driver.executeAsyncScript(function (settings) {
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ settings }).then(
      () => done(true),
      (e) => done(String(e))
    );
  }, SETTINGS);

  // Phase A — Harvest.
  const corpus = await harvest(driver);
  report.harvestedCount = corpus.length;
  for (const c of corpus) report.byCategory[c.cat] = (report.byCategory[c.cat] || 0) + 1;

  // Phase B — Classify (from home page so the extension stays idle; single ANDROID_VR fetch each).
  await driver.get('https://www.youtube.com/?hl=en&gl=US');
  await sleep(2500);
  for (const c of corpus) {
    const res = await classifyOne(driver, c.id);
    const eligible = !!(res.ok && res.status === 'OK' && res.hasAudio && !res.isLive);
    report.classified.push({ ...c, ...res, eligible });
    await sleep(350);
  }

  // Phase C — Deep-verify a representative sample: eligible across distinct cats + some fallback.
  const eligible = report.classified.filter((r) => r.eligible);
  const fallback = report.classified.filter((r) => !r.eligible && r.ok);
  const pick = [];
  const seenCat = new Set();
  for (const r of eligible) {
    if (pick.length >= Math.ceil(DEEP_N * 0.7)) break;
    if (!seenCat.has(r.cat)) {
      pick.push(r);
      seenCat.add(r.cat);
    }
  }
  for (const r of eligible) {
    if (pick.length >= Math.ceil(DEEP_N * 0.7)) break;
    if (!pick.includes(r)) pick.push(r);
  }
  for (const r of fallback) {
    if (pick.length >= DEEP_N) break;
    pick.push(r);
  }

  for (const r of pick) {
    const snap = await deepVerify(driver, r.id);
    const expectedHijack = r.eligible;
    const pass = expectedHijack
      ? !!(snap && snap.hijacked && snap.videoWidth === 0)
      : !!(snap && (!snap.hijacked || !snap.hasVideo));
    report.deep.push({ id: r.id, cat: r.cat, eligible: r.eligible, status: r.status, snap, pass });
  }

  const cats = new Set(report.classified.map((r) => r.cat));
  report.summary = {
    harvested: report.harvestedCount,
    distinctCategories: cats.size,
    classifiedOk: report.classified.filter((r) => r.ok).length,
    classifyErrors: report.classified.filter((r) => !r.ok).length,
    eligible: eligible.length,
    fallbackExpected: fallback.length,
    liveCount: report.classified.filter((r) => r.isLive).length,
    loginRequired: report.classified.filter((r) => r.status === 'LOGIN_REQUIRED').length,
    unplayable: report.classified.filter((r) => r.status === 'UNPLAYABLE').length,
    deepSample: report.deep.length,
    deepPass: report.deep.filter((d) => d.pass).length,
    deepFail: report.deep.filter((d) => !d.pass).length,
  };
  report.verdict =
    report.harvestedCount >= 35 &&
    report.summary.classifyErrors === 0 &&
    report.summary.deepFail === 0 &&
    report.summary.eligible > 0
      ? 'PASS'
      : 'FAIL';
} catch (error) {
  report.error = String(error?.stack || error);
  report.verdict = 'FAIL';
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

writeFileSync(
  new URL('./audio-matrix-report.json', import.meta.url),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify({ summary: report.summary, verdict: report.verdict, byCategory: report.byCategory, error: report.error }, null, 2));
console.log('\nDeep-verify:');
for (const d of report.deep) {
  console.log(
    `  [${d.pass ? 'PASS' : 'FAIL'}] ${d.id} (${d.cat}) elig=${d.eligible} status=${d.status} ` +
      `hijacked=${d.snap?.hijacked} vw=${d.snap?.videoWidth} rs=${d.snap?.readyState}`
  );
}
console.log('\nClassify (all):');
for (const r of report.classified) {
  console.log(
    `  ${r.id} ${r.cat.padEnd(18)} elig=${r.eligible ? 'Y' : 'n'} status=${String(r.status).padEnd(14)} ` +
      `audio=${r.hasAudio ? 'Y' : 'n'} itag=${r.bestItag ?? '-'} live=${r.isLive ? 'Y' : 'n'} gv=${r.isGooglevideo ? 'Y' : 'n'}`
  );
}
process.exit(report.verdict === 'PASS' ? 0 : 1);
