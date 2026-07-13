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
const ADDON_ID = 'youtube-audio@animesh.kundus.in';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
// Firefox derives the toolbar widget id from the add-on id: lowercase, then any char outside
// [a-z0-9_-] becomes "_" (so "@" and "." collapse, hyphens are kept).
const BROWSER_ACTION_WIDGET = `${ADDON_ID.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-browser-action`;
// BENCH-ONLY background message that returns the real per-tab status map (see background.ts).
const BENCH_STATUS_MAP_MESSAGE = 'yta:__bench-status-map';

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
  // Permit Marionette's chrome context (openBrowserActionPopup drives the toolbar via it). This is
  // a WebDriver capability flag only; it does not change content-page or extension behavior.
  options.addArguments('-remote-allow-system-access');
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

/**
 * Best-effort open of the REAL toolbar browser-action popup via Marionette's chrome context.
 *
 * DOCUMENTED HEADLESS LIMITATION (not faked): the toolbar's unified-extensions button and our
 * action widget are reachable and clickable in the chrome context, but in headless Firefox the
 * popup's moz-extension <browser> does not attach, so geckodriver cannot switch into it to read the
 * rendered popup document. This helper therefore opens the panel + clicks our action and returns a
 * structured probe (whether the popup <browser> attached and its URL); a later headful stack can
 * extend it to switch into that <browser> and assert the popup DOM across active / fallback /
 * non-YouTube / two-tab / SPA / mid-nav / no-content-script states. It never injects a fake status,
 * and always restores the content context before returning.
 *
 * @returns {Promise<{opened: boolean, actionClicked: boolean, popupBrowserAttached: boolean,
 *   popupUrl: (string|null), note: string}>}
 */
export async function openBrowserActionPopup(driver) {
  const result = {
    opened: false,
    actionClicked: false,
    popupBrowserAttached: false,
    popupUrl: null,
    note: '',
  };
  try {
    await driver.setContext('chrome');
    // Browser actions live in the unified-extensions ("puzzle piece") panel by default.
    try {
      await driver.findElement(By.id('unified-extensions-button')).click();
      result.opened = true;
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // Older layouts place the action directly on the toolbar; fall through to the direct click.
    }
    result.actionClicked = await driver.executeScript((widget) => {
      const button =
        document.querySelector(
          `#unified-extensions-item-${widget} .unified-extensions-item-action-button`
        ) ||
        document.getElementById(widget) ||
        document.getElementById(`${widget}-BAP`);
      if (!button) return false;
      button.click();
      return true;
    }, BROWSER_ACTION_WIDGET);
    await new Promise((r) => setTimeout(r, 800));
    result.popupUrl = await driver.executeScript(() => {
      const src = [...document.querySelectorAll('browser')]
        .map((el) => el.getAttribute('src'))
        .find((value) => value && value.includes('moz-extension') && value.includes('popup'));
      return src || null;
    });
    result.popupBrowserAttached = !!result.popupUrl;
    result.note = result.popupBrowserAttached
      ? 'popup <browser> attached; content DOM readable by a headful stack'
      : 'popup <browser> did not attach (expected headless); popup DOM not readable here';
  } catch (e) {
    result.note = `chrome context unavailable: ${String(e).slice(0, 160)}`;
  } finally {
    try {
      await driver.setContext('content');
    } catch {
      /* ignore */
    }
  }
  return result;
}

// --- Page-context probes (serialized to the browser) -----------------------

/** Snapshot the observable DOM signals the bench keys on. */
function snapshotScript() {
  const v = document.querySelector('video');
  const audioOnlyToggle = document.getElementById('yta-audio-only-toggle');
  const rightControls = document.querySelector('.ytp-right-controls');
  const settingsButton = rightControls?.querySelector('.ytp-settings-button') || null;
  const toggleInRightControlsBeforeGear = !!(
    audioOnlyToggle &&
    rightControls?.contains(audioOnlyToggle) &&
    settingsButton &&
    (audioOnlyToggle.compareDocumentPosition(settingsButton) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
      0
  );
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
    audioOnlyTogglePresent: !!audioOnlyToggle,
    audioOnlyToggleAriaPressed: audioOnlyToggle?.getAttribute('aria-pressed') || null,
    audioOnlyToggleDisabled:
      audioOnlyToggle instanceof HTMLButtonElement ? audioOnlyToggle.disabled : null,
    toggleInRightControlsBeforeGear,
    segmentStatusExists: !!document.getElementById('yta-segment-status'),
    ytaArtwork: document.documentElement.dataset.ytaArtwork || null,
    ytaCoach: document.documentElement.dataset.ytaCoach || null,
    ytaReconcileRuns: Number(document.documentElement.dataset.ytaReconcileRuns || 0),
    ytaReconcileSchedules: Number(document.documentElement.dataset.ytaReconcileSchedules || 0),
    ytaNodeCount: document.querySelectorAll('[id^="yta-"]').length,
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
 *           probeCoach?: boolean, origin: string, resetLog: () => void }} opts
 */
export async function runSession({
  withAddon,
  seedSettings,
  probePlayerFromPage,
  probeCoach,
  probeSegmentSkip,
  probeQol,
  probeDownload,
  probeSpaRearm,
  probeCircuitBreaker,
  probeReconcileChurn,
  probeSpaLeak,
  probeReadDiagnostics,
  probeStatusMap,
  probeBrowserActionPopup,
  origin,
  resetLog,
  videoId = 'FIXTURE0001',
  watchQuery,
  probeLateAutonav,
}) {
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(makeOptions()).build();
  try {
    let addonId = null;
    if (withAddon) {
      const workHandle = await driver.getWindowHandle();
      const handlesBeforeInstall = new Set(await driver.getAllWindowHandles());
      addonId = await driver.installAddon(BENCH_XPI, true);
      log('installed temporary add-on:', addonId);

      // First install opens the real onboarding options page in a new tab. Close only that
      // install-created tab and restore the harness work tab so it cannot steal the subsequent
      // fixture navigation. This does not mark onboarding or the coach as seen.
      const handlesAfterInstall = await waitFor(async () => {
        const handles = await driver.getAllWindowHandles();
        return handles.some((handle) => !handlesBeforeInstall.has(handle)) ? handles : null;
      }, 5000, 50);
      for (const handle of handlesAfterInstall || []) {
        if (handlesBeforeInstall.has(handle)) continue;
        await driver.switchTo().window(handle);
        await driver.close();
      }
      await driver.switchTo().window(workHandle);

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

    await driver.get(`${origin}/watch?v=${videoId}${watchQuery ? `&${watchQuery}` : ''}`);
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

    // With the add-on, wait for the in-player reconciler to mount and for playback to reach a
    // terminal status. The optional coach probe latches its transient first-run marker before the
    // tooltip's eight-second dismissal removes it.
    let coachObserved = false;
    let terminalSnap = null;
    if (withAddon) {
      await waitFor(async () => {
        const snap = await driver.executeScript(snapshotScript);
        return snap.audioOnlyTogglePresent ? snap : null;
      }, 4000);
      if (probeCoach) {
        coachObserved = !!(await waitFor(async () => {
          const snap = await driver.executeScript(snapshotScript);
          return snap.ytaCoach === '1' ? snap : null;
        }, 4000));
      }
      terminalSnap = await waitFor(async () => {
        const snap = await driver.executeScript(snapshotScript);
        return snap.status && TERMINAL_STATUSES.includes(snap.status) ? snap : null;
      }, 8000);

      const artworkExpected =
        terminalSnap?.status === 'active' &&
        (seedSettings?.enabled ?? true) &&
        (seedSettings?.audioOnlyEnabled ?? true) &&
        (seedSettings?.audioArtworkEnabled ?? true);
      if (artworkExpected) {
        await waitFor(async () => {
          const snap = await driver.executeScript(snapshotScript);
          return snap.ytaArtwork ? snap : null;
        }, 4000);
      }
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

    let reconcileChurn = null;
    if (probeReconcileChurn) {
      const before = await driver.executeScript(snapshotScript);
      const churn = await driver.executeAsyncScript(function () {
        const done = arguments[arguments.length - 1];
        const playerRoot = document.querySelector('#movie_player, .html5-video-player');
        const targetFrames = 30;
        if (!playerRoot) {
          done({ frames: 0, error: 'no-player-root' });
          return;
        }
        let frames = 0;
        const pump = async function () {
          frames += 1;
          for (let mutation = 0; mutation < 50; mutation += 1) {
            const throwaway = document.createElement('div');
            playerRoot.append(throwaway);
            throwaway.remove();
            await Promise.resolve();
          }
          if (frames < targetFrames) {
            requestAnimationFrame(pump);
            return;
          }
          requestAnimationFrame(() => done({ frames }));
        };
        requestAnimationFrame(pump);
      });
      const after = await driver.executeScript(snapshotScript);
      reconcileChurn = {
        before,
        after,
        frames: churn.frames,
        error: churn.error || null,
        runsDelta: after.ytaReconcileRuns - before.ytaReconcileRuns,
        schedulesDelta: after.ytaReconcileSchedules - before.ytaReconcileSchedules,
      };
    }

    let spaLeak = null;
    if (probeSpaLeak) {
      const census = function () {
        return {
          audioOnlyToggle: document.querySelectorAll('#yta-audio-only-toggle').length,
          audioArtwork: document.querySelectorAll('.yta-audio-artwork').length,
          playerControlStyle: document.querySelectorAll('#yta-player-control-style').length,
          distractionStyle: document.querySelectorAll('#yta-distraction-style').length,
          total: document.querySelectorAll('[id^="yta-"]').length,
        };
      };
      const before = await driver.executeScript(census);
      const navigations = 8;
      const snapshots = [];
      for (let navigation = 1; navigation <= navigations; navigation += 1) {
        const nextVideoId = `FIXTURE${String(navigation + 1).padStart(4, '0')}`;
        await driver.executeScript(function (videoId) {
          history.pushState({}, '', `/watch?v=${videoId}`);
          document.dispatchEvent(new Event('yt-navigate-finish'));
        }, nextVideoId);
        const settled = await waitFor(async () => {
          const state = await driver.executeScript(snapshotScript);
          return state.audioOnlyTogglePresent &&
            state.status === 'active' &&
            state.videoSrc?.includes(`videoId=${nextVideoId}`)
            ? state
            : null;
        }, 8000);
        snapshots.push(settled);
      }
      const after = await driver.executeScript(census);
      spaLeak = { before, after, navigations, snapshots };
    }

    const snap = await driver.executeScript(snapshotScript);
    const vis = await driver.executeScript(visibilityProbeScript);

    // Late-autonav: the fixture inserts the autonav button after the extension's fixed retry
    // schedule (past 3s), so only the MutationObserver fallback can click it. Poll for aria-checked
    // to flip to "false" (a slow poll so the observer has time to catch the late insertion).
    let lateAutonav = null;
    if (probeLateAutonav) {
      lateAutonav =
        (await waitFor(async () => {
          const state = await driver.executeScript(snapshotScript);
          return state.autonavChecked === 'false' ? state.autonavChecked : null;
        }, 8000, 250)) || (await driver.executeScript(snapshotScript)).autonavChecked;
    }

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
          recsHidden: hidden('#fixture-recs'),
          commentsHidden: hidden('#fixture-comments'),
          secondaryPanelCommentsHidden: hidden('#fixture-secondary-comments'),
        };
      };
      // Poll until the MAIN-world quality-of-life pass has applied (quality forced AND at least one
      // distraction hidden) so a slow CI runner cannot read the state before it runs. Uses "any
      // distraction hidden" rather than shorts specifically, so a combo that hides only recs or only
      // comments is still detected as applied. Falls back to the last read so a genuine failure still
      // surfaces real detail instead of null.
      qol =
        (await waitFor(async () => {
          const state = await driver.executeScript(readQol);
          const distractionApplied =
            state.shortsHidden === true ||
            state.recsHidden === true ||
            state.commentsHidden === true;
          return state.qualityCalls.length > 0 && distractionApplied ? state : null;
        }, 8000)) || (await driver.executeScript(readQol));
    }

    let diagnostics = null;
    if (probeReadDiagnostics && withAddon) {
      // Let any in-flight page->content->background log messages settle before reading.
      await new Promise((r) => setTimeout(r, 300));
      // Read the real diagnostics artifact the reporter uses: navigate to the extension's own
      // options page (its moz-extension origin is pinned) and ask the background for the live
      // assembled report, then POLL the persisted storage copy until the debounced flush lands
      // (so a broken-persistence path times out with an empty artifact and fails the assertion).
      await driver.get(OPTIONS_URL);
      diagnostics = await driver.executeAsyncScript(function () {
        const done = arguments[arguments.length - 1];
        const deadline = Date.now() + 6000;
        function readStored() {
          return browser.storage.local
            .get('diagnostics')
            .then((r) => (r && r.diagnostics) || null);
        }
        function poll(report) {
          readStored()
            .then((stored) => {
              const persisted =
                stored && Array.isArray(stored.events) && stored.events.length > 0;
              if (persisted || Date.now() > deadline) {
                done({ ok: true, report: report, stored: stored });
              } else {
                setTimeout(() => poll(report), 200);
              }
            })
            .catch((e) => done({ ok: false, error: String(e) }));
        }
        browser.runtime
          .sendMessage({ type: 'yta:diagnostics-report' })
          .then((report) => poll(report || null))
          .catch((e) => done({ ok: false, error: String(e) }));
      });
    }

    // --- Playback-status channel (content -> background per-tab map) ----------
    // Faithfully verifies the honest per-video status reached the background map. The task's
    // sanctioned "read the map" path: we exercise the real popup lane (best-effort, headless-
    // limited) while the fixture tab is active, then read the REAL map from the extension's own
    // page. Asserting the raw entry (status + reason) is robust to the navigation to options.html
    // marking that tab's entry stale (markEntryStale preserves the payload).
    let browserActionPopup = null;
    let statusMap = null;
    if ((probeStatusMap || probeBrowserActionPopup) && withAddon) {
      try {
        // Let the async content->background status push land in the map.
        await new Promise((r) => setTimeout(r, 300));
        if (probeBrowserActionPopup) {
          browserActionPopup = await openBrowserActionPopup(driver);
        }
        if (probeStatusMap) {
          await driver.get(OPTIONS_URL);
          statusMap = await driver.executeAsyncScript(function (messageType) {
            const done = arguments[arguments.length - 1];
            browser.runtime
              .sendMessage({ type: messageType })
              .then((r) => done({ ok: true, entries: (r && r.entries) || [] }))
              .catch((e) => done({ ok: false, error: String(e) }));
          }, BENCH_STATUS_MAP_MESSAGE);
        }
      } catch (e) {
        statusMap = statusMap || { ok: false, error: String(e).slice(0, 200) };
      }
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
      audioOnlyTogglePresent: snap.audioOnlyTogglePresent,
      audioOnlyToggleAriaPressed: snap.audioOnlyToggleAriaPressed,
      audioOnlyToggleDisabled: snap.audioOnlyToggleDisabled,
      toggleInRightControlsBeforeGear: snap.toggleInRightControlsBeforeGear,
      segmentStatusExists: snap.segmentStatusExists,
      ytaArtwork: snap.ytaArtwork,
      ytaCoach: snap.ytaCoach,
      coachObserved,
      skipArmed: snap.skipArmed,
      autonavChecked: snap.autonavChecked,
      lateAutonav,
      spaRearm,
      circuitBreaker,
      reconcileChurn,
      spaLeak,
      diagnostics,
      browserActionPopup,
      statusMap,
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

// Pick the watch-tab entry from a bench status-map snapshot (one content tab per session): prefer
// an entry carrying a videoId, else the only entry. Returns null when the snapshot is empty/failed.
function statusMapEntry(statusMap) {
  const entries = statusMap && statusMap.ok && Array.isArray(statusMap.entries) ? statusMap.entries : [];
  return entries.find((e) => e && e.entry && e.entry.videoId) || entries[0] || null;
}

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
      probeCoach: true,
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
    record(
      'ux:toggle-mounts-in-right-controls-before-gear',
      enabled.audioOnlyTogglePresent === true &&
        enabled.toggleInRightControlsBeforeGear === true,
      {
        present: enabled.audioOnlyTogglePresent,
        inRightControlsBeforeGear: enabled.toggleInRightControlsBeforeGear,
      }
    );
    record(
      'ux:toggle-is-not-disabled',
      enabled.audioOnlyTogglePresent === true && enabled.audioOnlyToggleDisabled === false,
      {
        present: enabled.audioOnlyTogglePresent,
        disabled: enabled.audioOnlyToggleDisabled,
      }
    );
    record('ux:dead-segment-status-pill-absent', enabled.segmentStatusExists === false, {
      segmentStatusExists: enabled.segmentStatusExists,
    });

    let artworkData = null;
    try {
      artworkData = enabled.ytaArtwork ? JSON.parse(enabled.ytaArtwork) : null;
    } catch {
      /* leave null */
    }
    const intendedArtworkPath = '/vi/FIXTURE0001/maxresdefault.jpg';
    const artworkRequests = enabledLog.filter((r) => r.path.startsWith('/vi/'));
    const expectedEnabledRequest = (request) =>
      (request.method === 'GET' &&
        [
          '/watch',
          '/favicon.ico',
          '/native-video',
          '/videoplayback',
          '/api/stats/watchtime',
          '/api/stats/playback',
          intendedArtworkPath,
        ].includes(request.path)) ||
      (request.method === 'GET' && /^\/api\/skipSegments\/[0-9a-f]{4}$/.test(request.path)) ||
      (request.method === 'POST' &&
        ['/youtubei/v1/player', '/youtubei/v1/log_event'].includes(request.path));
    const unexpectedArtworkSessionRequests = enabledLog.filter(
      (request) => !expectedEnabledRequest(request)
    );
    record(
      'ux:active-audio-only-artwork-marker-present',
      enabled.status === 'active' &&
        artworkData?.src === `${origin}${intendedArtworkPath}`,
      { status: enabled.status, artwork: artworkData }
    );
    record(
      'ux:artwork-requests-only-intended-thumbnail-no-extra-egress',
      artworkRequests.length === 1 &&
        artworkRequests[0]?.method === 'GET' &&
        artworkRequests[0]?.path === intendedArtworkPath &&
        unexpectedArtworkSessionRequests.length === 0,
      { artworkRequests, unexpectedRequests: unexpectedArtworkSessionRequests }
    );
    record('ux:first-run-coach-marker-present', enabled.coachObserved === true, {
      observed: enabled.coachObserved,
      finalMarker: enabled.ytaCoach,
    });

    // --- diagnostics + issue reporter (PII-free local logging) ----------------
    const diagRun = await runSession({
      withAddon: true,
      probeReadDiagnostics: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const diag = diagRun.diagnostics;
    const report = diag && diag.ok ? diag.report : null;
    const serialized = report ? JSON.stringify(report) : '';
    const storedEvents =
      diag && diag.stored && Array.isArray(diag.stored.events) ? diag.stored.events : null;
    const storedSerialized = diag && diag.stored ? JSON.stringify(diag.stored) : '';
    const eventCodes = report && Array.isArray(report.events) ? report.events.map((e) => e.code) : [];

    record(
      'diagnostics:report-available-with-env',
      !!report &&
        !!report.environment &&
        typeof report.environment.extensionVersion === 'string' &&
        report.environment.extensionVersion !== 'unknown' &&
        typeof report.environment.os === 'string' &&
        report.environment.os.length > 0,
      {
        environment: report && report.environment,
        ok: diag && diag.ok,
        error: diag && diag.error,
      }
    );
    record('diagnostics:captures-playback-outcome', eventCodes.includes('playback.status'), {
      eventCodes,
    });
    // Persistence must actually work: require a non-empty stored artifact so a broken flush fails.
    record(
      'diagnostics:log-persisted-to-storage',
      !!storedEvents && storedEvents.length > 0,
      {
        storedEventCount: storedEvents ? storedEvents.length : 0,
        ok: diag && diag.ok,
        error: diag && diag.error,
      }
    );
    record(
      'diagnostics:no-pii-in-report',
      !!report &&
        !serialized.includes('FIXTURE0001') &&
        !/\/videoplayback\?itag=/.test(serialized),
      {
        containsVideoId: serialized.includes('FIXTURE0001'),
        containsMediaUrl: /\/videoplayback\?itag=/.test(serialized),
        markdownSample: report ? String(report.markdown).slice(0, 400) : null,
      }
    );
    record(
      'diagnostics:no-pii-in-stored',
      !!storedSerialized &&
        !storedSerialized.includes('FIXTURE0001') &&
        !/\/videoplayback\?itag=/.test(storedSerialized),
      { hasStored: !!storedSerialized, storedEventCount: storedEvents ? storedEvents.length : 0 }
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
      probeStatusMap: true,
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
    const liveEntry = statusMapEntry(liveRun.statusMap);
    record(
      'status-channel:fallback-live-reaches-background-map',
      liveEntry?.entry?.status === 'fallback' && liveEntry?.entry?.reason === 'live',
      { entry: liveEntry?.entry, statusMap: liveRun.statusMap }
    );

    const authRequiredRun = await runSession({
      withAddon: true,
      videoId: 'AUTHVIDEO01',
      probeStatusMap: true,
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
    const authEntry = statusMapEntry(authRequiredRun.statusMap);
    record(
      'status-channel:fallback-auth-reaches-background-map',
      authEntry?.entry?.status === 'fallback' && authEntry?.entry?.reason === 'LOGIN_REQUIRED',
      { entry: authEntry?.entry, statusMap: authRequiredRun.statusMap }
    );

    // Active case + best-effort real browser-action popup lane (documented headless limitation).
    const statusActiveRun = await runSession({
      withAddon: true,
      probeStatusMap: true,
      probeBrowserActionPopup: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const activeEntry = statusMapEntry(statusActiveRun.statusMap);
    record(
      'status-channel:active-reaches-background-map',
      activeEntry?.entry?.status === 'active' && activeEntry?.entry?.videoId === 'FIXTURE0001',
      { entry: activeEntry?.entry, statusMap: statusActiveRun.statusMap }
    );
    record(
      'status-channel:browser-action-popup-lane-opens',
      statusActiveRun.browserActionPopup?.opened === true &&
        statusActiveRun.browserActionPopup?.actionClicked === true,
      statusActiveRun.browserActionPopup
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

    const reconcileChurnRun = await runSession({
      withAddon: true,
      probeReconcileChurn: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const reconcileChurn = reconcileChurnRun.reconcileChurn;
    record(
      'ux:reconcile-churn-is-coalesced-per-animation-frame',
      reconcileChurn?.schedulesDelta >= 100 &&
        reconcileChurn?.runsDelta <= reconcileChurn?.frames * 2,
      {
        runsDelta: reconcileChurn?.runsDelta,
        schedulesDelta: reconcileChurn?.schedulesDelta,
        frames: reconcileChurn?.frames,
        error: reconcileChurn?.error,
      }
    );
    record(
      'ux:reconcile-churn-still-runs',
      reconcileChurn?.runsDelta >= 1,
      {
        runsDelta: reconcileChurn?.runsDelta,
        schedulesDelta: reconcileChurn?.schedulesDelta,
        frames: reconcileChurn?.frames,
        error: reconcileChurn?.error,
      }
    );

    const spaLeakRun = await runSession({
      withAddon: true,
      probeSpaLeak: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const spaLeak = spaLeakRun.spaLeak;
    record(
      'ux:spa-navigation-does-not-accumulate-injected-dom',
      // Leak semantics: the audio-only control must re-mount exactly once (never duplicate); the
      // injected style singletons are 0-or-1 depending on which features the seed enables; and the
      // total injected-node census must not grow across N navigations. A real leak shows growth or a
      // duplicated singleton, not the identical before/after census of a clean teardown+remount.
      spaLeak?.after?.audioOnlyToggle === 1 &&
        spaLeak?.after?.audioArtwork <= 1 &&
        spaLeak?.after?.playerControlStyle <= 1 &&
        spaLeak?.after?.distractionStyle <= 1 &&
        spaLeak?.after?.total <= spaLeak?.before?.total,
      {
        before: spaLeak?.before,
        after: spaLeak?.after,
        navigations: spaLeak?.navigations,
      }
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
    record(
      'ux:toggle-aria-pressed-tracks-audio-only-state',
      enabled.audioOnlyToggleAriaPressed === 'true' &&
        loudnessDisabled.audioOnlyToggleAriaPressed === 'false',
      {
        audioOnlyOn: enabled.audioOnlyToggleAriaPressed,
        audioOnlyOff: loudnessDisabled.audioOnlyToggleAriaPressed,
      }
    );
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
        downloadData?.filename === 'Fixture Watch Page.m4a' &&
        typeof downloadData?.url === 'string' &&
        downloadData.url.includes('/videoplayback?itag=140'),
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

    // Regression lock for the "comments vanish when only Hide-recommendations is on" bug: with
    // hideRecommendations ON and hideComments OFF, the recommendations renderer must be hidden while
    // BOTH comments nodes stay visible — the #primary block AND the comments-bearing engagement panel
    // that YouTube reparents into #secondary at the wide layout. A revert to a broad
    // `#secondary{display:none}` selector would hide `#fixture-secondary-comments` and fail here.
    const recsOnlyRun = await runSession({
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
        disableAutoplayNext: false,
        hideShorts: false,
        hideRecommendations: true,
        hideComments: false,
      },
      probeQol: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm3b:hide-recs-preserves-comments',
      recsOnlyRun.qol?.recsHidden === true &&
        recsOnlyRun.qol?.commentsHidden === false &&
        recsOnlyRun.qol?.secondaryPanelCommentsHidden === false,
      { treatment: recsOnlyRun.qol }
    );

    // Regression lock for the disable-autoplay slow-load race: the fixture inserts the autonav button
    // after the extension's fixed retry schedule (3.5s > the last 3s timer), so ONLY the
    // MutationObserver fallback can click it. Before the fallback, the fixed timers missed a
    // late-rendered button and autonav stayed "true" (the intermittent real-Firefox failure).
    const lateAutonavRun = await runSession({
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
        disableAutoplayNext: true,
        hideShorts: false,
        hideRecommendations: false,
        hideComments: false,
      },
      watchQuery: 'yta-late-autonav=1',
      probeLateAutonav: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record('m3b:disable-autoplay-late-button', lateAutonavRun.lateAutonav === 'false', {
      lateAutonav: lateAutonavRun.lateAutonav,
    });
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
