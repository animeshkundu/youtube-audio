/**
 * Integration bench runner for the YouTube Audio extension (Firefox / geckodriver).
 *
 * This is the testability backbone: it loads the REAL built extension against a local,
 * hermetic fixture (tests/e2e/bench/fixture-server.mjs) and observes deterministic,
 * JS-driven signals (DOM markers + the fixture's request log) — no live YouTube, no real
 * media decoding.
 *
 * Sessions (each a fresh profile):
 *   - control   = fixture page, NO add-on.
 *   - enabled   = fixture page, add-on installed, DEFAULT settings (audio-only on).
 *   - disabled  = fixture page, add-on installed, settings seeded to enabled:false via the
 *                 extension's own options page + browser.storage (the faithful settings path).
 *
 * Harness-mechanism assertions (prove the bench itself, not a feature):
 *   - control has no content-script marker; the add-on session does.
 *   - the fixture request log records the page's telemetry beacons.
 *   - the fixture InnerTube /player endpoint returns audio adaptiveFormats + loudnessDb + ads.
 *
 * M1 feature assertions (prove real production behavior against the fixture):
 *   - enabled  -> the extension fetches POST /youtubei/v1/player and HIJACKS <video>.src to the
 *                 direct audio URL (status "active").
 *   - disabled -> the extension leaves the page UNTOUCHED: no player fetch, no src swap
 *                 (status "disabled").
 *   - visibility suppression -> background-play swallows `visibilitychange` when enabled, and
 *                 does not in control.
 *
 * Emits a JSON PASS/FAIL summary and sets the process exit code.
 *
 * Config via env:
 *   HEADLESS    "1" (default) headless, "0" headful
 *   SKIP_BUILD  "1" reuse an existing bench XPI (dist/youtube-audio-bench.xpi) instead of building
 *   FIREFOX_BIN explicit Firefox binary path (default: geckodriver auto-discovery)
 */

import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';

import { createFixtureServer } from './fixture-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const binDir = join(repoRoot, 'node_modules', '.bin');

// Make sure geckodriver (and wxt/web-ext) resolve even when run via `node` directly.
process.env.PATH = `${binDir}:${process.env.PATH || ''}`;

const HEADLESS = process.env.HEADLESS !== '0';
const SKIP_BUILD = process.env.SKIP_BUILD === '1';
const OUTPUT_DIR = join(repoRoot, '.output', 'firefox-mv2');
const ARTIFACTS_DIR = join(repoRoot, 'dist', 'bench-web-ext-artifacts');
const BENCH_XPI = join(repoRoot, 'dist', 'youtube-audio-bench.xpi');

// The extension's gecko id (wxt.config.ts) and a pinned internal UUID. Pinning the
// moz-extension UUID lets the bench open the extension's own options page deterministically
// and seed browser.storage — the real settings path the content script reads at startup.
const ADDON_ID = 'youtube-audio@local';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;

const TERMINAL_STATUSES = ['active', 'disabled', 'fallback'];

function log(...a) {
  console.error('[bench]', ...a);
}

/** Build the BENCH extension and package it into a temporary-installable XPI. */
export function buildBenchExtension() {
  log('building bench extension (BENCH=1 wxt build -b firefox --mv2)...');
  execFileSync(join(binDir, 'wxt'), ['build', '-b', 'firefox', '--mv2'], {
    cwd: repoRoot,
    env: { ...process.env, BENCH: '1' },
    stdio: 'inherit',
  });

  log('packaging XPI via web-ext...');
  rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  mkdirSync(dirname(BENCH_XPI), { recursive: true });
  execFileSync(
    join(binDir, 'web-ext'),
    ['build', '--source-dir', OUTPUT_DIR, '--artifacts-dir', ARTIFACTS_DIR, '--overwrite-dest'],
    { cwd: repoRoot, stdio: 'ignore' }
  );

  const zip = readdirSync(ARTIFACTS_DIR).find((f) => f.endsWith('.zip'));
  if (!zip) throw new Error('web-ext produced no artifact');
  copyFileSync(join(ARTIFACTS_DIR, zip), BENCH_XPI);
  log('bench XPI ready:', BENCH_XPI);
}

function makeOptions() {
  const options = new firefox.Options();
  if (HEADLESS) options.addArguments('-headless');
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  // Pin the extension's internal UUID so the options page has a stable moz-extension origin.
  options.setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ [ADDON_ID]: PINNED_UUID })
  );
  // Match the existing E2E harness prefs; harmless for the fixture (no real media).
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  options.setPreference('media.autoplay.allow-muted', true);
  options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  return options;
}

/** Poll an async predicate until it returns truthy or the deadline passes. */
async function waitFor(fn, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// --- Page-context probes (serialized to the browser) -----------------------

/** Snapshot the observable DOM signals the bench keys on. */
function snapshotScript() {
  const v = document.querySelector('video');
  return {
    marker: document.documentElement.dataset.ytaBench || null,
    status: document.documentElement.dataset.ytaStatus || null,
    reason: document.documentElement.dataset.ytaReason || null,
    videoSrc: v ? v.src : null,
    ready: document.documentElement.getAttribute('data-fixture-ready'),
    telemetryReady: document.documentElement.getAttribute('data-fixture-telemetry-ready'),
    audioGraph: document.documentElement.dataset.ytaAudioGraph || null,
    lyrics: document.documentElement.dataset.ytaLyrics || null,
    download: document.documentElement.dataset.ytaDownload || null,
    downloadButtonVisible: !!document.querySelector('#yta-download-audio:not([hidden])'),
    skipArmed: document.documentElement.getAttribute('data-yta-skip-armed'),
    autonavChecked:
      document.querySelector('.ytp-autonav-toggle-button')?.getAttribute('aria-checked') || null,
  };
}

/** Detect whether `visibilitychange` is swallowed (background-play suppression). */
function visibilityProbeScript() {
  let received = false;
  const handler = () => {
    received = true;
  };
  document.addEventListener('visibilitychange', handler, true);
  try {
    document.dispatchEvent(new Event('visibilitychange'));
  } catch {
    /* ignore */
  }
  document.removeEventListener('visibilitychange', handler, true);
  return {
    swallowed: received === false,
    received,
    hidden: document.hidden,
    visibilityState: document.visibilityState,
  };
}

/**
 * One fresh-profile browser session against the fixture watch page.
 * @param {{ withAddon: boolean, seedSettings?: object, probePlayerFromPage?: boolean,
 *           origin: string, resetLog: () => void }} opts
 */
export async function runSession({
  withAddon,
  seedSettings,
  probePlayerFromPage,
  probeSegmentSkip,
  probeQol,
  probeDownload,
  probeSpaRearm,
  probeCircuitBreaker,
  origin,
  resetLog,
  videoId = 'FIXTURE0001',
}) {
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(makeOptions()).build();
  try {
    let addonId = null;
    if (withAddon) {
      addonId = await driver.installAddon(BENCH_XPI, true);
      log('installed temporary add-on:', addonId);

      if (seedSettings) {
        // Faithful settings path: write browser.storage from the extension's own options page,
        // exactly what the content script reads via initializeSettings() on the next navigation.
        await driver.get(OPTIONS_URL);
        const seed = await driver.executeAsyncScript(function (settings) {
          const done = arguments[arguments.length - 1];
          try {
            browser.storage.local
              .set({ settings })
              .then(() => done({ ok: true }))
              .catch((e) => done({ ok: false, error: String(e) }));
          } catch (e) {
            done({ ok: false, error: String(e) });
          }
        }, seedSettings);
        if (!seed || !seed.ok) throw new Error(`settings seed failed: ${JSON.stringify(seed)}`);
        log('seeded settings via options page:', JSON.stringify(seedSettings));
      }
    }

    // Clean the fixture request log so this session's traffic is measured in isolation.
    // (The options-page navigation above never touches the fixture host.)
    resetLog();

    await driver.get(`${origin}/watch?v=${videoId}`);
    await driver.wait(until.elementLocated(By.css('video[data-fixture-video]')), 10000);
    await driver.wait(async () => (await driver.executeScript(snapshotScript)).ready === '1', 10000);
    // The fixture fires its telemetry beacons on load and only sets data-fixture-telemetry-ready
    // once every beacon has settled (allowed = received by the fixture server, blocked = fetch
    // rejected). Waiting for it here means the request log is quiescent before any telemetry
    // count assertion reads it, so a "blocked 0 times" check can't pass merely because an
    // un-blocked beacon had not yet reached the server.
    await driver.wait(
      async () => (await driver.executeScript(snapshotScript)).telemetryReady === '1',
      8000,
    );

    // With the add-on, wait for the extension to reach a terminal playback status.
    if (withAddon) {
      await waitFor(async () => {
        const snap = await driver.executeScript(snapshotScript);
        return snap.status && TERMINAL_STATUSES.includes(snap.status) ? snap : null;
      }, 8000);
    }

    if (seedSettings?.lyricsEnabled) {
      await waitFor(async () => {
        const state = await driver.executeScript(snapshotScript);
        return state.lyrics ? state : null;
      }, 4000);
    }
    if (probeDownload) {
      await driver.executeScript(function () {
        const button = document.getElementById('yta-download-audio');
        if (button) button.click();
      });
      await waitFor(async () => {
        const state = await driver.executeScript(snapshotScript);
        return state.download ? state : null;
      }, 8000);
    }

    let spaRearm = null;
    if (probeSpaRearm) {
      const first = await driver.executeScript(snapshotScript);
      await driver.executeScript(function () {
        history.pushState({}, '', '/watch?v=FIXTURE0002');
        document.dispatchEvent(new Event('yt-navigate-finish'));
      });
      const second = await waitFor(async () => {
        const state = await driver.executeScript(snapshotScript);
        return state.status === 'active' && state.videoSrc?.includes('videoId=FIXTURE0002')
          ? state
          : null;
      }, 8000);
      spaRearm = { first, second };
    }

    let circuitBreaker = null;
    if (probeCircuitBreaker) {
      circuitBreaker = await driver.executeScript(function () {
        const video = document.querySelector('video[data-fixture-video]');
        if (!video) return { assignments: [], finalSrc: null };
        const assignments = [];
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          const source = `${location.origin}/native-video?circuit=${attempt}`;
          video.src = source;
          assignments.push({ attempt, requested: source, observed: video.src });
        }
        return { assignments, finalSrc: video.src };
      });
    }

    const snap = await driver.executeScript(snapshotScript);
    const vis = await driver.executeScript(visibilityProbeScript);

    const inlinePlayerResponse = await driver.executeScript(function () {
      const value = window.ytInitialPlayerResponse || {};
      return {
        hasAdPlacements: Object.prototype.hasOwnProperty.call(value, 'adPlacements'),
        hasPlayerAds: Object.prototype.hasOwnProperty.call(value, 'playerAds'),
        playabilityStatus: value.playabilityStatus && value.playabilityStatus.status,
      };
    });

    let player = null;
    if (probePlayerFromPage) {
      player = await driver.executeAsyncScript(function () {
        const done = arguments[arguments.length - 1];
        fetch('/youtubei/v1/player?v=FIXTURE0001', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ videoId: 'FIXTURE0001' }),
        })
          .then((r) => r.json())
          .then((j) => {
            const fmts = (j.streamingData && j.streamingData.adaptiveFormats) || [];
            done({
              ok: true,
              audioFormats: fmts.filter((f) => (f.mimeType || '').indexOf('audio/') === 0).length,
              totalFormats: fmts.length,
              loudnessDb:
                j.playerConfig && j.playerConfig.audioConfig
                  ? j.playerConfig.audioConfig.loudnessDb
                  : null,
              hasAdPlacements: Array.isArray(j.adPlacements) && j.adPlacements.length > 0,
              playabilityStatus: j.playabilityStatus && j.playabilityStatus.status,
            });
          })
          .catch((e) => done({ ok: false, error: String(e) }));
      });
    }

    let segmentSkip = null;
    if (probeSegmentSkip) {
      // Play the (silent WAV) media and watch for a currentTime jump past the fixture's
      // [0, 5.25] sponsor segment. Natural 1x playback cannot reach 5.25 s within the poll
      // window, so reaching it fast proves an actual skip seek (not organic advance).
      segmentSkip = await driver.executeAsyncScript(function () {
        const done = arguments[arguments.length - 1];
        const video = document.querySelector('video[data-fixture-video]');
        if (!video) {
          done({ armed: null, skipped: false, currentTime: null, reason: 'no-video' });
          return;
        }
        video.muted = true;
        const played = video.play();
        if (played && played.catch) played.catch(function () {});
        const started = Date.now();
        const deadline = started + 4000;
        const poll = function () {
          const armed = document.documentElement.getAttribute('data-yta-skip-armed');
          const t = video.currentTime;
          if (typeof t === 'number' && t >= 5.25) {
            done({ armed: armed, skipped: true, currentTime: t, elapsedMs: Date.now() - started });
            return;
          }
          if (Date.now() >= deadline) {
            done({ armed: armed, skipped: false, currentTime: t, elapsedMs: Date.now() - started });
            return;
          }
          setTimeout(poll, 150);
        };
        poll();
      });
    }

    let qol = null;
    if (probeQol) {
      const readQol = function () {
        const hidden = function (sel) {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display === 'none' : null;
        };
        return {
          qualityCalls: window.__ytaQualityCalls || [],
          shortsHidden: hidden('#fixture-shorts'),
          recsHidden: hidden('#secondary'),
          commentsHidden: hidden('#fixture-comments'),
        };
      };
      // Poll until the MAIN-world quality-of-life pass has applied (quality forced AND a
      // distraction hidden) so a slow CI runner cannot read the state before it runs. Falls back
      // to the last read so a genuine failure still surfaces real detail instead of null.
      qol =
        (await waitFor(async () => {
          const state = await driver.executeScript(readQol);
          return state.qualityCalls.length > 0 && state.shortsHidden === true ? state : null;
        }, 8000)) || (await driver.executeScript(readQol));
    }

    return {
      addonId,
      marker: snap.marker,
      status: snap.status,
      reason: snap.reason,
      videoSrc: snap.videoSrc,
      vis,
      player,
      inlinePlayerResponse,
      segmentSkip,
      qol,
      audioGraph: snap.audioGraph,
      lyrics: snap.lyrics,
      download: snap.download,
      downloadButtonVisible: snap.downloadButtonVisible,
      skipArmed: snap.skipArmed,
      autonavChecked: snap.autonavChecked,
      spaRearm,
      circuitBreaker,
    };
  } finally {
    try {
      await driver.quit();
    } catch {
      /* ignore */
    }
  }
}

const hasPlayerPost = (requests) =>
  requests.some((r) => r.method === 'POST' && r.path === '/youtubei/v1/player');
const requestCount = (requests, path) => requests.filter((r) => r.path === path).length;

async function main() {
  if (!SKIP_BUILD) {
    buildBenchExtension();
  } else if (!existsSync(BENCH_XPI)) {
    throw new Error(`SKIP_BUILD set but ${BENCH_XPI} does not exist`);
  }

  const fixture = createFixtureServer();
  const { origin, port } = await fixture.start();
  log('fixture server listening on', origin);

  const tests = [];
  const record = (name, pass, detail) => tests.push({ name, pass: !!pass, detail });

  try {
    // --- control (no add-on) --------------------------------------------------
    const control = await runSession({
      withAddon: false,
      probePlayerFromPage: true,
      probeQol: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const controlLog = fixture.getRequests();

    record('control:no-marker-without-extension', control.marker === null, {
      marker: control.marker,
    });
    record(
      'control:request-log-records-telemetry',
      controlLog.some((r) => r.path === '/youtubei/v1/log_event'),
      { recordedPaths: controlLog.map((r) => `${r.method} ${r.path}`) }
    );
    record(
      'm2b:control-preserves-inline-player-response-ads',
      control.inlinePlayerResponse.hasAdPlacements && control.inlinePlayerResponse.hasPlayerAds,
      control.inlinePlayerResponse
    );
    const cp = control.player || {};
    record(
      'fixture:player-endpoint-shape',
      cp.ok && cp.audioFormats >= 1 && cp.hasAdPlacements && typeof cp.loudnessDb === 'number',
      cp
    );

    // --- enabled (default settings) -------------------------------------------
    const enabled = await runSession({
      withAddon: true,
      probePlayerFromPage: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const enabledLog = fixture.getRequests();

    record('treatment:content-script-marker', enabled.marker === '1', {
      marker: enabled.marker,
      addonId: enabled.addonId,
    });
    record(
      'ab:marker-differs-control-vs-treatment',
      control.marker === null && enabled.marker === '1',
      { control: control.marker, treatment: enabled.marker }
    );
    record(
      'm1:enabled-fetch-and-hijack',
      enabled.status === 'active' &&
        typeof enabled.videoSrc === 'string' &&
        enabled.videoSrc.includes('/videoplayback') &&
        hasPlayerPost(enabledLog),
      {
        status: enabled.status,
        videoSrc: enabled.videoSrc,
        playerPost: hasPlayerPost(enabledLog),
        recordedPaths: enabledLog.map((r) => `${r.method} ${r.path}`),
      }
    );
    // Regression: a live/DVR stream returns OK + an audio url, but hijacking that live-edge url as
    // <video>.src stalls playback at 0. The extension MUST fall back to YouTube's native player.
    const liveRun = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: true,
        backgroundPlayEnabled: false,
        ghostEnabled: true,
        aggressiveTelemetry: false,
        adBlockEnabled: true,
        segmentSkipEnabled: false,
        segmentSkipCategories: [],
      },
      videoId: 'LIVESTREAM01',
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm1:live-stream-falls-back-no-hijack',
      liveRun.status === 'fallback' &&
        liveRun.reason === 'live' &&
        !(typeof liveRun.videoSrc === 'string' && liveRun.videoSrc.includes('/videoplayback')),
      { status: liveRun.status, reason: liveRun.reason, videoSrc: liveRun.videoSrc }
    );

    const authRequiredRun = await runSession({
      withAddon: true,
      videoId: 'AUTHVIDEO01',
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm1:auth-required-falls-back-no-hijack',
      authRequiredRun.status === 'fallback' &&
        authRequiredRun.reason === 'LOGIN_REQUIRED' &&
        !(typeof authRequiredRun.videoSrc === 'string' &&
          authRequiredRun.videoSrc.includes('/videoplayback')),
      {
        status: authRequiredRun.status,
        reason: authRequiredRun.reason,
        videoSrc: authRequiredRun.videoSrc,
      }
    );

    const spaRun = await runSession({
      withAddon: true,
      probeSpaRearm: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm1:spa-navigation-rearms-second-hijack',
      spaRun.spaRearm?.first?.status === 'active' &&
        spaRun.spaRearm.first.videoSrc?.includes('videoId=FIXTURE0001') &&
        spaRun.spaRearm?.second?.status === 'active' &&
        spaRun.spaRearm.second.videoSrc?.includes('videoId=FIXTURE0002'),
      spaRun.spaRearm
    );

    const circuitRun = await runSession({
      withAddon: true,
      probeCircuitBreaker: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const circuitAssignments = circuitRun.circuitBreaker?.assignments || [];
    record(
      'm1:source-guard-opens-circuit-after-bounded-reassertions',
      circuitAssignments.length === 4 &&
        circuitAssignments.slice(0, 3).every((entry) => entry.observed.includes('/videoplayback')) &&
        circuitAssignments[3].observed.includes('/native-video?circuit=4') &&
        !circuitRun.circuitBreaker.finalSrc.includes('/videoplayback'),
      circuitRun.circuitBreaker
    );

    record(
      'm2a:conservative-telemetry-policy',
      requestCount(enabledLog, '/api/stats/qoe') === 0 &&
        requestCount(enabledLog, '/youtubei/v1/log_event') >= 1,
      {
        qoeCount: requestCount(enabledLog, '/api/stats/qoe'),
        logEventCount: requestCount(enabledLog, '/youtubei/v1/log_event'),
        recordedPaths: enabledLog.map((r) => `${r.method} ${r.path}`),
      }
    );
    record('m2b:enabled-prunes-player-ads', enabled.player?.ok && !enabled.player.hasAdPlacements, {
      player: enabled.player,
    });
    record(
      'm2b:enabled-prunes-inline-player-response',
      !enabled.inlinePlayerResponse.hasAdPlacements && !enabled.inlinePlayerResponse.hasPlayerAds,
      enabled.inlinePlayerResponse
    );
    // Dedicated segment-skip session: audio-only OFF so no hijack reset races the skip's
    // one-shot seek on the (preload=auto, seekable) fixture WAV timeline.
    const segmentSkipRun = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: false,
        backgroundPlayEnabled: false,
        ghostEnabled: true,
        aggressiveTelemetry: false,
        adBlockEnabled: true,
        segmentSkipEnabled: true,
        segmentSkipCategories: ['sponsor', 'music_offtopic'],
      },
      probeSegmentSkip: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const segmentSkipLog = fixture.getRequests();
    record(
      'm3a:segment-skip-seeks-past-sponsor',
      segmentSkipRun.segmentSkip?.skipped === true,
      {
        ...segmentSkipRun.segmentSkip,
        status: segmentSkipRun.status,
        fetched: segmentSkipLog
          .filter((r) => r.path.startsWith('/api/skipSegments/'))
          .map((r) => `${r.method} ${r.path}`),
      }
    );
    record(
      'm3a:privacy-k-anon-prefix-no-viewcount',
      enabledLog.some(
        (r) => r.method === 'GET' && /^\/api\/skipSegments\/[0-9a-f]{4}$/.test(r.path)
      ) && !enabledLog.some((r) => r.path.includes('viewedVideoSponsorTime')),
      {
        skipSegmentsRequests: enabledLog
          .filter((r) => r.path.startsWith('/api/skipSegments/'))
          .map((r) => `${r.method} ${r.path}`),
        viewCountLeaks: enabledLog.filter((r) => r.path.includes('viewedVideoSponsorTime')).length,
      }
    );

    const loudnessDisabled = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: false,
        backgroundPlayEnabled: false,
        ghostEnabled: false,
        aggressiveTelemetry: false,
        adBlockEnabled: false,
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
      },
      origin,
      resetLog: () => fixture.reset(),
    });
    const graphData = enabled.audioGraph ? JSON.parse(enabled.audioGraph) : null;
    record(
      'm4:loudness-normalization-arms-bounded-gain',
      graphData && graphData.gain === 2,
      { treatment: graphData, loudnessDb: -8.5 }
    );
    record('m4:loudness-disabled-leaves-graph-unarmed', loudnessDisabled.audioGraph === null, {
      marker: loudnessDisabled.audioGraph,
    });

    const lyricsRun = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: false,
        backgroundPlayEnabled: false,
        ghostEnabled: false,
        aggressiveTelemetry: false,
        adBlockEnabled: false,
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
        lyricsEnabled: true,
      },
      origin,
      resetLog: () => fixture.reset(),
    });
    const lyricsLog = fixture.getRequests();
    record(
      'm4:lyrics-opt-in-fetches-and-renders',
      lyricsRun.lyrics === '2' && lyricsLog.some((r) => r.path === '/api/get'),
      { marker: lyricsRun.lyrics, fetched: lyricsLog.filter((r) => r.path === '/api/get') }
    );

    const downloadDisabled = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: false,
        backgroundPlayEnabled: false,
        ghostEnabled: false,
        aggressiveTelemetry: false,
        adBlockEnabled: false,
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
      },
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm5:download-disabled-hides-button',
      downloadDisabled.downloadButtonVisible === false && downloadDisabled.download === null,
      { visible: downloadDisabled.downloadButtonVisible, marker: downloadDisabled.download }
    );

    const downloadEnabled = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: false,
        backgroundPlayEnabled: false,
        ghostEnabled: false,
        aggressiveTelemetry: false,
        adBlockEnabled: false,
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
        downloadEnabled: true,
      },
      probeDownload: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const downloadData = downloadEnabled.download ? JSON.parse(downloadEnabled.download) : null;
    record(
      'm5:download-enabled-initiates-selected-audio',
      downloadEnabled.downloadButtonVisible === true &&
        downloadData?.filename === 'Fixture Watch Page.webm' &&
        typeof downloadData?.url === 'string' &&
        downloadData.url.includes('/videoplayback?itag=251'),
      { visible: downloadEnabled.downloadButtonVisible, download: downloadData }
    );

    // --- ad-block disabled (all other features on) ----------------------------
    const adBlockDisabled = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: true,
        backgroundPlayEnabled: true,
        ghostEnabled: true,
        aggressiveTelemetry: false,
        adBlockEnabled: false,
      },
      probePlayerFromPage: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm2b:disabled-preserves-player-ads',
      adBlockDisabled.player?.ok && adBlockDisabled.player.hasAdPlacements,
      { player: adBlockDisabled.player }
    );
    record(
      'm2b:disabled-preserves-inline-player-response-ads',
      adBlockDisabled.inlinePlayerResponse.hasAdPlacements &&
        adBlockDisabled.inlinePlayerResponse.hasPlayerAds,
      adBlockDisabled.inlinePlayerResponse
    );

    // --- disabled (enabled:false, faithfully seeded) --------------------------
    const disabled = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: false,
        audioOnlyEnabled: true,
        backgroundPlayEnabled: true,
        ghostEnabled: true,
        aggressiveTelemetry: false,
        adBlockEnabled: true,
      },
      origin,
      resetLog: () => fixture.reset(),
    });
    const disabledLog = fixture.getRequests();

    record(
      'm1:disabled-untouched',
      disabled.status === 'disabled' &&
        !(typeof disabled.videoSrc === 'string' && disabled.videoSrc.includes('/videoplayback')) &&
        !hasPlayerPost(disabledLog),
      {
        status: disabled.status,
        videoSrc: disabled.videoSrc,
        playerPost: hasPlayerPost(disabledLog),
        recordedPaths: disabledLog.map((r) => `${r.method} ${r.path}`),
      }
    );

    // --- visibility suppression (A/B) -----------------------------------------
    record(
      'm1:visibility-suppression',
      enabled.vis.swallowed === true && control.vis.swallowed === false,
      { control: control.vis, treatment: enabled.vis }
    );
    // --- quality-of-life (audio-only/skip off to isolate QoL) -----------------
    const qolRun = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: false,
        backgroundPlayEnabled: false,
        ghostEnabled: false,
        aggressiveTelemetry: false,
        adBlockEnabled: false,
        segmentSkipEnabled: false,
        segmentSkipCategories: [],
        forceQualityMax: '480p',
        disableAutoplayNext: true,
        hideShorts: true,
        hideRecommendations: true,
        hideComments: true,
      },
      probeQol: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm3b:quality-forced-when-on',
      (qolRun.qol?.qualityCalls || []).some(
        (c) => c.max === 'large' || c.min === 'large' || c.quality === 'large'
      ),
      { qualityCalls: qolRun.qol?.qualityCalls }
    );
    record(
      'm3b:distractions-hidden-when-on',
      qolRun.qol?.shortsHidden === true &&
        qolRun.qol?.recsHidden === true &&
        qolRun.qol?.commentsHidden === true &&
        control.qol?.shortsHidden === false,
      { treatment: qolRun.qol, control: control.qol }
    );
  } finally {
    await fixture.close();
  }

  const passed = tests.filter((t) => t.pass).length;
  const failed = tests.length - passed;
  const verdict = failed === 0 ? 'PASS' : 'FAIL';

  const summary = {
    bench: 'youtube-audio integration bench',
    headless: HEADLESS,
    fixtureOrigin: origin,
    fixturePort: port,
    benchXpi: BENCH_XPI,
    passed,
    failed,
    total: tests.length,
    verdict,
    tests,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(verdict === 'PASS' ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.log(
      JSON.stringify(
        {
          bench: 'youtube-audio integration bench',
          verdict: 'ERROR',
          error: String(err && err.stack ? err.stack : err),
        },
        null,
        2
      )
    );
    process.exit(2);
  });
}
