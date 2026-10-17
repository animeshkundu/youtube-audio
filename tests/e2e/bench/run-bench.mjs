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
 *   GECKODRIVER_BIN explicit geckodriver binary path (default: npm package binary)
 */

import { Builder, By, until } from 'selenium-webdriver';
import { Command } from 'selenium-webdriver/lib/command.js';
import firefox, { ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';

import { seedDataConsent } from '../consent-helper.mjs';
import { createFixtureServer } from './fixture-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const binDir = join(repoRoot, 'node_modules', '.bin');

// Make sure geckodriver (and wxt/web-ext) resolve even when run via `node` directly.
process.env.PATH = `${binDir}:${process.env.PATH || ''}`;

const HEADLESS = process.env.HEADLESS !== '0';
const SKIP_BUILD = process.env.SKIP_BUILD === '1';
const GECKODRIVER_BIN = process.env.GECKODRIVER_BIN || join(binDir, 'geckodriver');
const OUTPUT_DIR = join(repoRoot, '.output', 'firefox-mv2');
const ARTIFACTS_DIR = join(repoRoot, 'dist', 'bench-web-ext-artifacts');
const BENCH_XPI = join(repoRoot, 'dist', 'youtube-audio-bench.xpi');

// The extension's gecko id (wxt.config.ts) and a pinned internal UUID. Pinning the
// moz-extension UUID lets the bench open the extension's own options page deterministically
// and seed browser.storage — the real settings path the content script reads at startup.
const ADDON_ID = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
// Firefox derives the toolbar widget id from the add-on id: lowercase, then any char outside
// [a-z0-9_-] becomes "_" (so "@" and "." collapse, hyphens are kept).
const BROWSER_ACTION_WIDGET = `${ADDON_ID.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-browser-action`;
// BENCH-ONLY background message that returns the real per-tab status map (see background.ts).
const BENCH_STATUS_MAP_MESSAGE = 'yta:__bench-status-map';
// Background consent message (SPEC-013); same string the content script and popup send.
const GET_DATA_CONSENT_MESSAGE = 'yta:get-data-consent';
// BENCH-ONLY background message that sets a tab-scope override for an explicit tab id, driving the
// real apply path without the popup DOM (see background.ts; SPEC-012 §5; ADR-0014).
const BENCH_SET_TAB_SCOPE_MESSAGE = 'yta:__bench-set-tab-scope';

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

function makeOptions({ disableBuiltInDataConsent = false } = {}) {
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
  // The named fresh-profile case deliberately suppresses Firefox's automatic grant for a required
  // category. Every treatment session leaves the pref at its real default and asserts that the
  // seeded state resolves granted.
  if (disableBuiltInDataConsent) {
    options.setPreference('extensions.dataCollectionPermissions.enabled', false);
  }
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

/**
 * Change one persisted setting while keeping the fixture watch page alive.
 * The extension options tab is opened once per session and reused for later mutations.
 */
export async function mutateSettingMidSession(driver, context, setting, value) {
  context.watchHandle ||= await driver.getWindowHandle();
  let result;
  try {
    if (context.optionsHandle) {
      await driver.switchTo().window(context.optionsHandle);
    } else {
      await driver.switchTo().newWindow('tab');
      context.optionsHandle = await driver.getWindowHandle();
      await driver.get(OPTIONS_URL);
    }
    result = await driver.executeAsyncScript(
      function (settingName, nextValue) {
        const done = arguments[arguments.length - 1];
        try {
          browser.storage.local
            .get('settings')
            .then((stored) => {
              const current =
                stored && typeof stored.settings === 'object' && stored.settings
                  ? stored.settings
                  : {};
              const previous = current[settingName];
              return browser.storage.local
                .set({ settings: { ...current, [settingName]: nextValue } })
                .then(() => ({
                  ok: true,
                  setting: settingName,
                  previous,
                  value: nextValue,
                }));
            })
            .then(done)
            .catch((error) => done({ ok: false, error: String(error) }));
        } catch (error) {
          done({ ok: false, error: String(error) });
        }
      },
      setting,
      value
    );
  } finally {
    await driver.switchTo().window(context.watchHandle);
  }
  if (!result?.ok) {
    throw new Error(`setting mutation failed: ${JSON.stringify(result)}`);
  }
  return result;
}

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
    videoSrc: v ? v.currentSrc || v.src : null,
    videoDeclaredSrc: v ? v.src : null,
    videoCurrentTime: v ? v.currentTime : null,
    videoPaused: v ? v.paused : null,
    videoReadyState: v ? v.readyState : null,
    nativeReclaimCalls: Array.isArray(window.__ytaNativeReclaimCalls)
      ? window.__ytaNativeReclaimCalls.slice()
      : [],
    swapped: v?.dataset.swapped || null,
    ready: document.documentElement.getAttribute('data-fixture-ready'),
    telemetryReady: document.documentElement.getAttribute('data-fixture-telemetry-ready'),
    audioGraph: document.documentElement.dataset.ytaAudioGraph || null,
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
 * @param {{ withAddon: boolean, seedSettings?: object, seedConsent?: boolean,
 *           sponsorBlockAllowed?: boolean, probePlayerFromPage?: boolean, probeCoach?: boolean,
 *           probeToggleOffReclaim?: boolean, probeRapidRetoggle?: boolean,
 *           frameHost?: boolean, probeEmbedFrame?: boolean, probeTabScope?: boolean,
 *           probeIdleNag?: 'confirmed' | 'untouched', probeFallbackQuality?: boolean,
 *           origin: string, resetLog: () => void }} opts
 */
export async function runSession({
  withAddon,
  seedSettings,
  seedConsent = true,
  sponsorBlockAllowed,
  probePlayerFromPage,
  probePlayerVideoId,
  probeCoach,
  probeSegmentSkip,
  probeQol,
  probeFallbackQuality,
  probeDownload,
  probeSpaRearm,
  probeCircuitBreaker,
  probeReconcileChurn,
  probeSpaLeak,
  probeReadDiagnostics,
  probeStatusMap,
  probeBrowserActionPopup,
  probeElementSwap,
  probeToggleOffReclaim,
  probeRapidRetoggle,
  frameHost,
  probeEmbedFrame,
  probeTabScope,
  probeIdleNag,
  origin,
  resetLog,
  videoId = 'FIXTURE0001',
  watchQuery,
  probeLateAutonav,
  expectedTerminalStatus,
}) {
  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(makeOptions({ disableBuiltInDataConsent: withAddon && !seedConsent }))
    .setFirefoxService(new ServiceBuilder(GECKODRIVER_BIN).addArguments('--allow-system-access'))
    .build();
  try {
    let addonId = null;
    if (withAddon) {
      const workHandle = await driver.getWindowHandle();
      const handlesBeforeInstall = new Set(await driver.getAllWindowHandles());
      addonId = await driver.execute(
        new Command('install addon')
          .setParameter('path', BENCH_XPI)
          .setParameter('temporary', true)
      );
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

      if (seedConsent) {
        const consent = await seedDataConsent(driver, OPTIONS_URL, {
          sponsorBlockAllowed: sponsorBlockAllowed ?? seedSettings?.segmentSkipEnabled === true,
        });
        log('seeded data consent via options page:', JSON.stringify(consent));
      }

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
      }, seedSettings ?? {});
      if (!seed || !seed.ok) throw new Error(`settings seed failed: ${JSON.stringify(seed)}`);
      if (seedSettings) log('seeded settings via options page:', JSON.stringify(seedSettings));
    }

    // Clean the fixture request log so this session's traffic is measured in isolation.
    // (The options-page navigation above never touches the fixture host.)
    resetLog();

    if (frameHost) {
      // Embedded-player session (SPEC-015): a third-party host page frames the player, so the top
      // document owns no video and none of the watch-page readiness markers.
      await driver.get(`${origin}/frame-host?embed=${encodeURIComponent(videoId)}`);
      await driver.wait(until.elementLocated(By.css('#fixture-embed')), 10000);
    } else {
      await driver.get(`${origin}/watch?v=${videoId}${watchQuery ? `&${watchQuery}` : ''}`);
      await driver.wait(until.elementLocated(By.css('video')), 10000);
      await driver.wait(
        async () => (await driver.executeScript(snapshotScript)).ready === '1',
        10000
      );
      // The fixture fires its telemetry beacons on load and only sets data-fixture-telemetry-ready
      // once every beacon has settled (allowed = received by the fixture server, blocked = fetch
      // rejected). Waiting for it here means the request log is quiescent before any telemetry
      // count assertion reads it, so a "blocked 0 times" check can't pass merely because an
      // un-blocked beacon had not yet reached the server.
      await driver.wait(
        async () => (await driver.executeScript(snapshotScript)).telemetryReady === '1',
        8000
      );
    }

    // With the add-on, wait for the in-player reconciler to mount and for playback to reach a
    // terminal status. The optional coach probe latches its transient first-run marker before the
    // tooltip's eight-second dismissal removes it.
    let coachObserved = false;
    let terminalSnap = null;
    if (withAddon && !frameHost) {
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
      if (seedConsent && !frameHost) {
        terminalSnap = await waitFor(async () => {
          const snap = await driver.executeScript(snapshotScript);
          if (expectedTerminalStatus) {
            return snap.status === expectedTerminalStatus ? snap : null;
          }
          return snap.status && TERMINAL_STATUSES.includes(snap.status) ? snap : null;
        }, 8000);
      }

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

    let embedFrame = null;
    if (probeEmbedFrame) {
      // The framed player must hijack on its own document (SPEC-015) while the top document stays
      // untouched. The fixture frame is same-origin, so its document can be read directly.
      await driver.switchTo().frame(await driver.findElement(By.css('#fixture-embed')));
      const readFrame = function () {
        const root = document.documentElement;
        const video = document.querySelector('video');
        return {
          status: root.dataset.ytaStatus || null,
          reason: root.dataset.ytaReason || null,
          videoSrc: video ? video.src : null,
          videoDeclaredSrc: video ? video.getAttribute('src') : null,
          toggleButton: document.getElementById('yta-audio-only-toggle') !== null,
          downloadButton: document.getElementById('yta-download-audio') !== null,
          tooltip: document.querySelector('.yta-player-tooltip') !== null,
          segmentToast: document.querySelector('.yta-segment-toast') !== null,
          distractionStyle: document.getElementById('yta-distraction-style') !== null,
        };
      };
      const frameTerminal = await waitFor(async () => {
        const state = await driver.executeScript(readFrame);
        return state.status === 'active' ? state : null;
      }, 12000);
      embedFrame = frameTerminal || (await driver.executeScript(readFrame));
      await driver.switchTo().defaultContent();
    }

    let tabScope = null;
    if (probeTabScope) {
      // Per-tab audio-only scope (SPEC-012 §5; ADR-0014). The headless harness cannot drive the
      // popup DOM (see openBrowserActionPopup), so this probe drives the REAL background apply path
      // through the `__BENCH__`-only set message and asserts the observable consequences: the
      // override flips the tab's hijack while the global preference stays untouched in storage, a
      // second tab without an override follows the global, the override survives a reload of its
      // tab, an explicit override beats a later global change in both directions, and closing a tab
      // prunes its entry from the in-memory store.
      const scopeContext = { watchHandle: await driver.getWindowHandle() };
      const scopeSecondVideoId = 'SCOPE0002';
      const withOptionsTab = async (script, ...args) => {
        const returnHandle = await driver.getWindowHandle();
        if (scopeContext.optionsHandle) {
          await driver.switchTo().window(scopeContext.optionsHandle);
        } else {
          await driver.switchTo().newWindow('tab');
          scopeContext.optionsHandle = await driver.getWindowHandle();
          await driver.get(OPTIONS_URL);
        }
        try {
          return await driver.executeAsyncScript(script, ...args);
        } finally {
          await driver.switchTo().window(returnHandle);
        }
      };
      const findTabId = (needle) =>
        withOptionsTab(function (urlNeedle) {
          const done = arguments[arguments.length - 1];
          browser.tabs
            .query({})
            .then((tabs) => {
              const match = tabs.find(
                (tab) => typeof tab.url === 'string' && tab.url.includes(urlNeedle)
              );
              done(match && typeof match.id === 'number' ? match.id : null);
            })
            .catch(() => done(null));
        }, needle);
      const setScope = (tabId, audioOnly) =>
        withOptionsTab(function (messageType, id, value) {
          const done = arguments[arguments.length - 1];
          browser.runtime
            .sendMessage({ type: messageType, tabId: id, audioOnly: value })
            .then((reply) => done(reply || null))
            .catch((error) => done({ error: String(error) }));
        }, BENCH_SET_TAB_SCOPE_MESSAGE, tabId, audioOnly);
      const readScopes = () =>
        withOptionsTab(function (messageType) {
          const done = arguments[arguments.length - 1];
          browser.runtime
            .sendMessage({ type: messageType })
            .then((snapshot) =>
              done(snapshot && Array.isArray(snapshot.scopes) ? snapshot.scopes : null)
            )
            .catch(() => done(null));
        }, BENCH_STATUS_MAP_MESSAGE);
      const readGlobalAudioOnly = () =>
        withOptionsTab(function () {
          const done = arguments[arguments.length - 1];
          browser.storage.local
            .get('settings')
            .then((stored) => {
              const storedSettings =
                stored && typeof stored.settings === 'object' && stored.settings
                  ? stored.settings
                  : {};
              done(
                typeof storedSettings.audioOnlyEnabled === 'boolean'
                  ? storedSettings.audioOnlyEnabled
                  : null
              );
            })
            .catch(() => done(null));
        });
      const waitForStatus = (wanted, timeoutMs = 8000) =>
        waitFor(async () => {
          const snap = await driver.executeScript(snapshotScript);
          return snap.status === wanted ? snap : null;
        }, timeoutMs, 50);

      const watchTabId = await findTabId(videoId);
      if (typeof watchTabId !== 'number') {
        tabScope = { error: 'watch-tab-id-not-found' };
      } else {
        const disabledBefore = await driver.executeScript(snapshotScript);
        await setScope(watchTabId, true);
        const activeAfterOverride = await waitFor(async () => {
          const snap = await driver.executeScript(snapshotScript);
          return snap.status === 'active' &&
            typeof snap.videoSrc === 'string' &&
            snap.videoSrc.includes('/videoplayback')
            ? snap
            : null;
        }, 8000, 50);
        const globalAfterOverride = await readGlobalAudioOnly();

        // A second YouTube tab with no override follows the global preference, then flips to active
        // when it gets its own override: the override is per tab, not per window.
        await driver.switchTo().newWindow('tab');
        await driver.get(`${origin}/watch?v=${scopeSecondVideoId}`);
        await driver.wait(until.elementLocated(By.css('video')), 10000);
        const secondDisabled = await waitForStatus('disabled');
        const secondTabId = await findTabId(scopeSecondVideoId);
        await setScope(secondTabId, true);
        const secondActive = await waitForStatus('active');
        const scopesBeforeClose = await readScopes();

        await driver.close();
        await driver.switchTo().window(scopeContext.watchHandle);
        const scopesAfterClose = await waitFor(async () => {
          const scopes = await readScopes();
          return Array.isArray(scopes) && !scopes.some((entry) => entry.tabId === secondTabId)
            ? scopes
            : null;
        }, 4000, 100);

        // The override is tab-keyed, so a document reload of the same tab keeps it.
        await driver.get(`${origin}/watch?v=${videoId}`);
        await driver.wait(until.elementLocated(By.css('video')), 10000);
        const persistedAcrossReload = await waitForStatus('active', 10000);

        // The override is tab-keyed, so an in-page SPA navigation in the same tab keeps it and
        // re-hijacks the next video as well.
        await driver.executeScript(function () {
          history.pushState({}, '', '/watch?v=SCOPE0003');
          document.dispatchEvent(new Event('yt-navigate-finish'));
        });
        const persistedAcrossSpa = await waitFor(async () => {
          const snap = await driver.executeScript(snapshotScript);
          return snap.status === 'active' &&
            typeof snap.videoSrc === 'string' &&
            snap.videoSrc.includes('videoId=SCOPE0003')
            ? snap
            : null;
        }, 8000, 50);

        // An explicit override wins over a later global change both ways: global on keeps the
        // overridden-on tab active, and flipping the override off disables it under global on.
        await mutateSettingMidSession(driver, scopeContext, 'audioOnlyEnabled', true);
        const stillActiveWithGlobalOn = await waitForStatus('active', 6000);
        await setScope(watchTabId, false);
        const disabledAfterOverrideOff = await waitForStatus('disabled');
        const scopesFinal = await readScopes();
        const globalFinal = await readGlobalAudioOnly();

        tabScope = {
          watchTabId,
          secondTabId,
          disabledBefore: disabledBefore.status,
          activeAfterOverride: !!activeAfterOverride,
          overrideVideoSrc: activeAfterOverride?.videoSrc || null,
          globalAfterOverride,
          secondDisabled: !!secondDisabled,
          secondActiveAfterOverride: !!secondActive,
          scopesBeforeClose,
          scopesAfterClose,
          prunedSecondTab:
            Array.isArray(scopesAfterClose) &&
            !scopesAfterClose.some((entry) => entry.tabId === secondTabId),
          primaryStillPresent:
            Array.isArray(scopesAfterClose) &&
            scopesAfterClose.some((entry) => entry.tabId === watchTabId),
          persistedAcrossReload: !!persistedAcrossReload,
          persistedAcrossSpa: !!persistedAcrossSpa,
          stillActiveWithGlobalOn: !!stillActiveWithGlobalOn,
          disabledAfterOverrideOff: !!disabledAfterOverrideOff,
          scopesFinal,
          globalFinal,
        };
      }
    }

    let idleNag = null;
    if (probeIdleNag) {
      // Idle-nag defeat (SPEC-016): the nag fixture seeds a stale activity clock, then (after the
      // extension has armed) pauses the media and raises a scripted "are you still there?" dialog.
      // `probeIdleNag` names the expected outcome ('confirmed' in the armed sessions, 'untouched'
      // in the gated ones) so the off sessions fail fast instead of waiting out the confirm window.
      const opened = await waitFor(
        () =>
          driver.executeScript(function () {
            return window.__fixtureNagOpened === true ? true : null;
          }),
        20000,
        250
      );
      let confirmed = false;
      if (opened) {
        if (probeIdleNag === 'confirmed') {
          confirmed =
            (await waitFor(
              () =>
                driver.executeScript(function () {
                  return window.__fixtureNagConfirmed === true ? true : null;
                }),
              15000,
              250
            )) === true;
        } else {
          await new Promise((r) => setTimeout(r, 3000));
          confirmed =
            (await driver.executeScript(function () {
              return window.__fixtureNagConfirmed === true;
            })) === true;
        }
      }
      const lact = await driver.executeScript(function () {
        return typeof window._lact === 'number' ? window._lact : null;
      });
      const dialogStillOpen = await driver.executeScript(function () {
        return !!document.querySelector('yt-confirm-dialog-renderer, ytmusic-you-there-renderer');
      });
      const paused = await driver.executeScript(function () {
        const video = document.querySelector('video[data-fixture-video]');
        return video ? video.paused : null;
      });
      idleNag = { opened: !!opened, confirmed, lact, dialogStillOpen, paused };
    }

    let toggleOffReclaim = null;
    let rapidRetoggle = null;
    if (probeToggleOffReclaim || probeRapidRetoggle) {
      const target = probeRapidRetoggle ? 91.5 : 73.25;
      const mutationContext = {};
      await waitFor(async () => {
        const state = await driver.executeScript(snapshotScript);
        return state.status === 'active' && state.videoReadyState >= 1 ? state : null;
      }, 8000, 50);
      await driver.executeScript(function (currentTime) {
        const video = document.querySelector('video[data-fixture-video]');
        if (!video) return;
        video.pause();
        video.currentTime = currentTime;
      }, target);
      const frozen =
        (await waitFor(async () => {
          const state = await driver.executeScript(snapshotScript);
          return state.status === 'active' &&
            state.videoPaused === true &&
            Math.abs(state.videoCurrentTime - target) < 0.1
            ? state
            : null;
        }, 4000, 50)) || (await driver.executeScript(snapshotScript));
      const reclaimCallBaseline = frozen.nativeReclaimCalls.length;
      const offMutation = await mutateSettingMidSession(
        driver,
        mutationContext,
        'audioOnlyEnabled',
        false
      );
      const reclaimed =
        (await waitFor(async () => {
          const state = await driver.executeScript(snapshotScript);
          const calls = state.nativeReclaimCalls.slice(reclaimCallBaseline);
          return state.status === 'disabled' &&
            calls.some((call) => call.method === 'loadVideoById')
            ? state
            : null;
        }, 4000, 50)) || (await driver.executeScript(snapshotScript));

      if (probeToggleOffReclaim) {
        const settled =
          (await waitFor(async () => {
            const state = await driver.executeScript(snapshotScript);
            const calls = state.nativeReclaimCalls.slice(reclaimCallBaseline);
            return state.status === 'disabled' &&
              state.videoDeclaredSrc?.includes('/native-video?') &&
              state.videoDeclaredSrc.includes('ytaReclaim=1') &&
              state.videoReadyState >= 2 &&
              state.videoPaused === true &&
              calls.some((call) => call.method === 'pauseVideo')
              ? state
              : null;
          }, 12000, 100)) || (await driver.executeScript(snapshotScript));
        toggleOffReclaim = {
          target,
          reclaimCallBaseline,
          frozen,
          mutation: offMutation,
          reclaimed,
          settled,
        };
      }

      if (probeRapidRetoggle) {
        const transient =
          (await waitFor(async () => {
            const state = await driver.executeScript(snapshotScript);
            return state.status === 'disabled' &&
              state.videoDeclaredSrc?.includes('/native-video?') &&
              state.videoDeclaredSrc.includes('ytaReclaim=1') &&
              state.videoCurrentTime < 0.5 &&
              state.videoPaused === false
              ? state
              : null;
          }, 3000, 25)) || (await driver.executeScript(snapshotScript));
        const onMutation = await mutateSettingMidSession(
          driver,
          mutationContext,
          'audioOnlyEnabled',
          true
        );
        const observedRehijacked = await waitFor(async () => {
          const state = await driver.executeScript(snapshotScript);
          return state.status === 'active' && state.videoDeclaredSrc?.includes('/videoplayback')
            ? state
            : null;
        }, 8000, 50);
        const rehijacked = observedRehijacked || (await driver.executeScript(snapshotScript));
        const rehijackedCallCount = observedRehijacked
          ? observedRehijacked.nativeReclaimCalls.length
          : null;
        await new Promise((resolveWait) => setTimeout(resolveWait, 8500));
        const final = await driver.executeScript(snapshotScript);
        rapidRetoggle = {
          target,
          reclaimCallBaseline,
          frozen,
          mutation: { off: offMutation, on: onMutation },
          reclaimed,
          transient,
          rehijacked,
          rehijackedCallCount,
          final,
        };
      }
    }

    let elementSwap = null;
    if (probeElementSwap) {
      elementSwap =
        (await waitFor(async () => {
          const state = await driver.executeScript(snapshotScript);
          return state.swapped === '1' && state.videoSrc?.includes('/videoplayback')
            ? state
            : null;
        }, 8000, 50)) || (await driver.executeScript(snapshotScript));
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
      const probeVideoId = probePlayerVideoId || 'FIXTURE0001';
      player = await driver.executeAsyncScript(function (videoId) {
        const done = arguments[arguments.length - 1];
        fetch('/youtubei/v1/player?v=' + encodeURIComponent(videoId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ videoId: videoId }),
        })
          .then((r) => r.text())
          .then((text) => {
            // Read the network-level body directly: when ad-block is on, the page-world scriptlets
            // wrap Response.json() and JSON.parse (never Response.text()), so `rawAdKeys` observes
            // exactly what the background response filter delivered.
            const rawAdKeys = [
              'adPlacements',
              'playerAds',
              'adSlots',
              'adPlacementRenderer',
            ].some((key) => text.indexOf('"' + key + '"') !== -1);
            let j = null;
            try {
              j = JSON.parse(text);
            } catch {
              j = null;
            }
            const fmts = (j && j.streamingData && j.streamingData.adaptiveFormats) || [];
            done({
              ok: !!j,
              textLength: text.length,
              rawAdKeys,
              audioFormats: fmts.filter((f) => (f.mimeType || '').indexOf('audio/') === 0).length,
              totalFormats: fmts.length,
              loudnessDb:
                j && j.playerConfig && j.playerConfig.audioConfig
                  ? j.playerConfig.audioConfig.loudnessDb
                  : null,
              hasAdPlacements: !!j && Array.isArray(j.adPlacements) && j.adPlacements.length > 0,
              playabilityStatus: j && j.playabilityStatus && j.playabilityStatus.status,
            });
          })
          .catch((e) => done({ ok: false, error: String(e) }));
      }, [probeVideoId]);
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

    let fallbackQuality = null;
    if (probeFallbackQuality) {
      // SPEC-017: read the recorded quality calls and the fixture's song-mode marker. The
      // extension applies the fallback request synchronously inside the status emission, and the
      // terminal-status wait above already observed that emission, so a single read is enough.
      fallbackQuality = await driver.executeScript(function () {
        return {
          qualityCalls: window.__ytaQualityCalls || [],
          songMode: window.__fixtureSongMode || null,
        };
      });
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
    // page. Asserting the raw entry (status + reason) is robust to tab-focus effects: the map
    // stores what the content script reported, before any URL cross-check.
    //
    // The read happens from a SECOND tab (the pinned options page) so the fixture tab keeps its
    // watch URL. That matters for SPEC-013: `browser.tabs.get(tabId).url` inside the background
    // resolves the fixture URL through host permissions alone (the bench manifest deliberately
    // has no `tabs` permission), so a visible fixture URL in the snapshot is the no-`tabs`
    // classification proof. The same read returns the resolved consent state, the toolbar badge
    // text, and the real manifest permission lists for the permission-model cases.
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
          const fixtureHandle = await driver.getWindowHandle();
          await driver.switchTo().newWindow('tab');
          try {
            await driver.get(OPTIONS_URL);
            statusMap = await driver.executeAsyncScript(function (
              messageType,
              getConsentType
            ) {
              const done = arguments[arguments.length - 1];
              const action = browser.browserAction || browser.action;
              const badge = action
                ? Promise.resolve(action.getBadgeText({})).catch(() => null)
                : Promise.resolve(null);
              Promise.all([
                browser.runtime.sendMessage({ type: messageType }),
                browser.runtime.sendMessage({ type: getConsentType }),
                badge,
              ])
                .then(([map, consent, text]) => {
                  const manifest = browser.runtime.getManifest();
                  done({
                    ok: true,
                    entries: (map && map.entries) || [],
                    consent: consent || null,
                    badge: typeof text === 'string' ? text : null,
                    manifest: {
                      permissions: manifest.permissions || [],
                      optional_permissions: manifest.optional_permissions || [],
                      optional_host_permissions: manifest.optional_host_permissions || [],
                      host_permissions: manifest.host_permissions || [],
                    },
                  });
                })
                .catch((e) => done({ ok: false, error: String(e) }));
            },
            BENCH_STATUS_MAP_MESSAGE,
            GET_DATA_CONSENT_MESSAGE);
          } finally {
            await driver.close();
            await driver.switchTo().window(fixtureHandle);
          }
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
      fallbackQuality,
      audioGraph: snap.audioGraph,
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
      elementSwap,
      diagnostics,
      browserActionPopup,
      statusMap,
      toggleOffReclaim,
      rapidRetoggle,
      embedFrame,
      tabScope,
      idleNag,
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
      sponsorBlockAllowed: true,
      probePlayerFromPage: true,
      probeCoach: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const enabledLog = fixture.getRequests();

    const unconsented = await runSession({
      withAddon: true,
      seedConsent: false,
      probeStatusMap: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const unconsentedLog = fixture.getRequests();
    record(
      'consent:fresh-unconsented-profile-fails-closed',
      unconsented.marker === '1' &&
        unconsented.status === 'disabled' &&
        !unconsented.videoSrc?.includes('/videoplayback') &&
        !hasPlayerPost(unconsentedLog) &&
        unconsented.ytaArtwork === null &&
        !unconsentedLog.some((request) => request.path.startsWith('/vi/')),
      {
        marker: unconsented.marker,
        status: unconsented.status,
        videoSrc: unconsented.videoSrc,
        playerPost: hasPlayerPost(unconsentedLog),
        artwork: unconsented.ytaArtwork,
        artworkRequests: unconsentedLog.filter((request) => request.path.startsWith('/vi/')),
      }
    );
    // SPEC-013: the toolbar badge marks exactly the undecided custom-consent state and stays
    // clear otherwise. On Firefox < 140 an unseeded profile is pending (custom path, no record)
    // and must badge `!`; on 140+ the built-in category is denied-but-decided (pending false)
    // because the bench suppresses the automatic grant, so no badge may appear.
    record(
      'consent:badge-marks-undecided-installs',
      unconsented.statusMap?.consent?.granted === false &&
        unconsented.statusMap?.badge ===
          (unconsented.statusMap?.consent?.pending === true ? '!' : ''),
      { consent: unconsented.statusMap?.consent, badge: unconsented.statusMap?.badge }
    );

    // SPEC-013 (1.1.0 permission model). One real seeded session asserts the shipped manifest
    // shape and that classification still works without the `tabs` permission:
    // - the bench build keeps `downloads` and the SponsorBlock origin REQUIRED (build-only
    //   divergence so no browser-chrome prompt is ever needed) and declares no optional keys;
    // - `tabs` is absent, yet `browser.tabs.get(tabId).url` inside the background resolves the
    //   fixture tab's URL through its host permission, which is the input classification needs;
    // - a granted install clears the toolbar badge.
    const permissionRun = await runSession({
      withAddon: true,
      probeStatusMap: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const permissionEntry = statusMapEntry(permissionRun.statusMap);
    const manifestPermissions = permissionRun.statusMap?.manifest?.permissions || [];
    record(
      'manifest:no-tabs-with-bench-optional-grants-required',
      permissionRun.statusMap?.ok === true &&
        !manifestPermissions.includes('tabs') &&
        manifestPermissions.includes('downloads') &&
        manifestPermissions.includes('https://sponsor.ajay.app/*') &&
        (permissionRun.statusMap?.manifest?.optional_permissions || []).length === 0 &&
        (permissionRun.statusMap?.manifest?.optional_host_permissions || []).length === 0,
      { manifest: permissionRun.statusMap?.manifest }
    );
    record(
      'status-channel:fixture-url-visible-without-tabs-permission',
      typeof permissionEntry?.url === 'string' && permissionEntry.url.startsWith(`${origin}/watch`),
      { url: permissionEntry?.url, entries: permissionRun.statusMap?.entries?.length }
    );
    record(
      'consent:badge-stays-clear-once-granted',
      permissionRun.statusMap?.consent?.granted === true && permissionRun.statusMap?.badge === '',
      { consent: permissionRun.statusMap?.consent, badge: permissionRun.statusMap?.badge }
    );

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
    const reclaimSeedSettings = {
      enabled: true,
      audioOnlyEnabled: true,
      audioArtworkEnabled: false,
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
      downloadEnabled: false,
    };
    const toggleOffRun = await runSession({
      withAddon: true,
      seedSettings: reclaimSeedSettings,
      probeToggleOffReclaim: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const toggleOff = toggleOffRun.toggleOffReclaim;
    const toggleOffCalls =
      toggleOff?.settled?.nativeReclaimCalls.slice(toggleOff.reclaimCallBaseline) || [];
    const toggleOffLoadIndex = toggleOffCalls.findIndex(
      (call) => call.method === 'loadVideoById'
    );
    const toggleOffPauseIndex = toggleOffCalls.findIndex((call) => call.method === 'pauseVideo');
    const toggleOffLoad = toggleOffCalls[toggleOffLoadIndex];
    const toggleOffPause = toggleOffCalls[toggleOffPauseIndex];
    record(
      'm1:toggle-off-reclaims-native-in-place',
      toggleOff?.frozen?.status === 'active' &&
        toggleOff.frozen.videoPaused === true &&
        toggleOff.mutation?.previous === true &&
        toggleOff.mutation.value === false &&
        toggleOffLoad?.request?.videoId === 'FIXTURE0001' &&
        toggleOffLoad.request.startSeconds > 0 &&
        Math.abs(toggleOffLoad.request.startSeconds - toggleOff.frozen.videoCurrentTime) < 0.5 &&
        toggleOffLoad.sourceBefore?.includes('/videoplayback') &&
        !toggleOffLoad.sourceBefore.includes('/native-video') &&
        toggleOffPauseIndex > toggleOffLoadIndex &&
        toggleOffPause?.readyState >= 2 &&
        toggleOff.settled?.status === 'disabled' &&
        toggleOff.settled.videoDeclaredSrc?.includes('/native-video?') &&
        toggleOff.settled.videoDeclaredSrc.includes('ytaReclaim=1') &&
        !toggleOff.settled.videoDeclaredSrc.startsWith('blob:') &&
        toggleOff.settled.videoReadyState >= 2 &&
        toggleOff.settled.videoPaused === true,
      {
        target: toggleOff?.target,
        frozen: toggleOff?.frozen,
        mutation: toggleOff?.mutation,
        reclaimed: toggleOff?.reclaimed,
        settled: toggleOff?.settled,
        calls: toggleOffCalls,
      }
    );

    const rapidRetoggleRun = await runSession({
      withAddon: true,
      seedSettings: reclaimSeedSettings,
      probeRapidRetoggle: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const rapid = rapidRetoggleRun.rapidRetoggle;
    const rapidCalls = rapid?.final?.nativeReclaimCalls.slice(rapid.reclaimCallBaseline) || [];
    const rapidLoads = rapidCalls.filter((call) => call.method === 'loadVideoById');
    const staleRapidPauses =
      rapid?.final?.nativeReclaimCalls
        .slice(rapid.rehijackedCallCount)
        .filter((call) => call.method === 'pauseVideo') || [];
    const rapidLoad = rapidLoads[0];
    record(
      'm1:rapid-retoggle-preserves-position-and-pause',
      rapid?.frozen?.status === 'active' &&
        rapid.frozen.videoPaused === true &&
        rapid.mutation?.off?.previous === true &&
        rapid.mutation.off.value === false &&
        rapid.mutation.on?.previous === false &&
        rapid.mutation.on.value === true &&
        rapid.transient?.status === 'disabled' &&
        rapid.transient.videoDeclaredSrc?.includes('/native-video?') &&
        rapid.transient.videoDeclaredSrc.includes('ytaReclaim=1') &&
        rapid.transient.videoCurrentTime < 0.5 &&
        rapid.transient.videoPaused === false &&
        rapidLoads.length === 1 &&
        rapidLoad?.request?.videoId === 'FIXTURE0001' &&
        rapidLoad.request.startSeconds > 0 &&
        Math.abs(rapidLoad.request.startSeconds - rapid.frozen.videoCurrentTime) < 0.5 &&
        rapid.rehijacked?.status === 'active' &&
        rapid.rehijacked.videoDeclaredSrc?.includes('/videoplayback') &&
        Number.isInteger(rapid.rehijackedCallCount) &&
        staleRapidPauses.length === 0 &&
        rapid.final?.status === 'active' &&
        rapid.final.videoDeclaredSrc?.includes('/videoplayback') &&
        Math.abs(rapid.final.videoCurrentTime - rapid.frozen.videoCurrentTime) < 0.5 &&
        rapid.final.videoPaused === true,
      {
        target: rapid?.target,
        frozen: rapid?.frozen,
        mutation: rapid?.mutation,
        reclaimed: rapid?.reclaimed,
        transient: rapid?.transient,
        rehijacked: rapid?.rehijacked,
        final: rapid?.final,
        calls: rapidCalls,
        stalePausesAfterRehijack: staleRapidPauses,
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

    // SPEC-017: fallback quality. A fallback leaves native video playing, so the extension should
    // request the lowest available tier once; the toggle can forbid it, an explicit user maximum
    // quality wins untouched, and a Music page prefers its own song playback instead.
    const fallbackQualityRun = await runSession({
      withAddon: true,
      videoId: 'LIVESTREAM01',
      probeFallbackQuality: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'fallback-quality:lowest-available-on-fallback',
      fallbackQualityRun.status === 'fallback' &&
        (fallbackQualityRun.fallbackQuality?.qualityCalls || []).some(
          (c) => c.min === 'tiny' && c.max === 'tiny'
        ),
      {
        status: fallbackQualityRun.status,
        qualityCalls: fallbackQualityRun.fallbackQuality?.qualityCalls,
      }
    );

    const fallbackQualityOffRun = await runSession({
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
        fallbackQualityCapEnabled: false,
      },
      videoId: 'LIVESTREAM01',
      probeFallbackQuality: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'fallback-quality:disabled-does-not-cap',
      fallbackQualityOffRun.status === 'fallback' &&
        (fallbackQualityOffRun.fallbackQuality?.qualityCalls || []).length === 0,
      {
        status: fallbackQualityOffRun.status,
        qualityCalls: fallbackQualityOffRun.fallbackQuality?.qualityCalls,
      }
    );

    const fallbackQualityMaxRun = await runSession({
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
        forceQualityMax: '720p',
      },
      videoId: 'LIVESTREAM01',
      probeFallbackQuality: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const fallbackQualityMaxCalls = fallbackQualityMaxRun.fallbackQuality?.qualityCalls || [];
    record(
      'fallback-quality:force-quality-max-wins',
      fallbackQualityMaxRun.status === 'fallback' &&
        fallbackQualityMaxCalls.length > 0 &&
        fallbackQualityMaxCalls.every((c) => (c.min ?? c.quality) === 'hd720'),
      { status: fallbackQualityMaxRun.status, qualityCalls: fallbackQualityMaxCalls }
    );

    const musicSongRun = await runSession({
      withAddon: true,
      videoId: 'LIVESTREAM01',
      watchQuery: 'ytm=1',
      probeFallbackQuality: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'fallback-quality:music-prefers-song',
      musicSongRun.status === 'fallback' &&
        musicSongRun.fallbackQuality?.songMode === '1' &&
        (musicSongRun.fallbackQuality?.qualityCalls || []).length === 0,
      { status: musicSongRun.status, fallbackQuality: musicSongRun.fallbackQuality }
    );

    const musicNoSongRun = await runSession({
      withAddon: true,
      videoId: 'LIVESTREAM01',
      watchQuery: 'ytm=1&nosong=1',
      probeFallbackQuality: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'fallback-quality:music-caps-without-song',
      musicNoSongRun.status === 'fallback' &&
        musicNoSongRun.fallbackQuality?.songMode === null &&
        (musicNoSongRun.fallbackQuality?.qualityCalls || []).some(
          (c) => c.min === 'tiny' && c.max === 'tiny'
        ),
      { status: musicNoSongRun.status, fallbackQuality: musicNoSongRun.fallbackQuality }
    );

    // A user maximum quality suppresses the cap but NOT the Music song preference: the two are
    // orthogonal, and song mode is what the extension is for. The user's cap may still be applied
    // to the video element (its hd1080 request is expected); the fallback tier must not appear.
    const musicSongMaxRun = await runSession({
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
        forceQualityMax: '1080p',
      },
      videoId: 'LIVESTREAM01',
      watchQuery: 'ytm=1',
      probeFallbackQuality: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'fallback-quality:music-song-despite-user-cap',
      musicSongMaxRun.status === 'fallback' &&
        musicSongMaxRun.fallbackQuality?.songMode === '1' &&
        !(musicSongMaxRun.fallbackQuality?.qualityCalls || []).some(
          (c) => (c.min ?? c.quality) === 'tiny'
        ),
      { status: musicSongMaxRun.status, fallbackQuality: musicSongMaxRun.fallbackQuality }
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

    const coldConfigRun = await runSession({
      withAddon: true,
      watchQuery: 'coldConfig=1',
      expectedTerminalStatus: 'active',
      probeStatusMap: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const coldConfigEntry = statusMapEntry(coldConfigRun.statusMap);
    record(
      'm0:cold-config-hydration-activates',
      coldConfigRun.status === 'active' &&
        typeof coldConfigRun.videoSrc === 'string' &&
        coldConfigRun.videoSrc.includes('/videoplayback') &&
        coldConfigEntry?.entry?.status === 'active',
      {
        status: coldConfigRun.status,
        videoSrc: coldConfigRun.videoSrc,
        entry: coldConfigEntry?.entry,
        statusMap: coldConfigRun.statusMap,
      }
    );

    const elementSwapRun = await runSession({
      withAddon: true,
      watchQuery: 'elementSwap=1',
      expectedTerminalStatus: 'active',
      probeStatusMap: true,
      probeElementSwap: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const elementSwapEntry = statusMapEntry(elementSwapRun.statusMap);
    record(
      'm0:element-swap-rehijack',
      elementSwapRun.elementSwap?.swapped === '1' &&
        elementSwapRun.elementSwap.videoSrc?.includes('/videoplayback') &&
        elementSwapRun.elementSwap.status === 'active' &&
        elementSwapEntry?.entry?.status === 'active',
      {
        swapped: elementSwapRun.elementSwap?.swapped,
        status: elementSwapRun.elementSwap?.status,
        videoSrc: elementSwapRun.elementSwap?.videoSrc,
        entry: elementSwapEntry?.entry,
        statusMap: elementSwapRun.statusMap,
      }
    );

    // Embedded player frames (SPEC-015): a third-party host page frames a player. The frame hijacks
    // audio-only on its own document, the frame receives no extension UI (top-frame-only mounts),
    // and the top document neither hijacks nor inherits the frame's status: it reports its own
    // not-a-watch-page fallback.
    const embedRun = await runSession({
      withAddon: true,
      videoId: 'EMBED0001',
      frameHost: true,
      probeEmbedFrame: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'm9:embedded-frame-hijacks-audio-only-without-ui',
      embedRun.embedFrame?.status === 'active' &&
        (embedRun.embedFrame.videoSrc || '').includes('/videoplayback') &&
        embedRun.embedFrame.toggleButton === false &&
        embedRun.embedFrame.downloadButton === false &&
        embedRun.embedFrame.tooltip === false &&
        embedRun.embedFrame.segmentToast === false &&
        embedRun.embedFrame.distractionStyle === false &&
        embedRun.status === 'fallback' &&
        embedRun.reason === 'not-a-watch-page' &&
        embedRun.audioOnlyTogglePresent === false,
      {
        embedFrame: embedRun.embedFrame,
        status: embedRun.status,
        reason: embedRun.reason,
        audioOnlyTogglePresent: embedRun.audioOnlyTogglePresent,
      }
    );

    // Idle-nag defeat (SPEC-016): the fixture seeds a stale activity clock, then pauses the media
    // and raises a scripted "are you still there?" dialog (as on the real page, the pause comes
    // first). With the defaults the extension confirms the dialog, resumes the media, and
    // refreshes the clock; both gated sessions leave dialog, clock, and playback untouched.
    const nagRun = await runSession({
      withAddon: true,
      videoId: 'NAG0001',
      watchQuery: 'nag=1',
      probeIdleNag: 'confirmed',
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'idle-nag:confirmed-and-clock-refreshed',
      nagRun.status === 'active' &&
        nagRun.idleNag?.opened === true &&
        nagRun.idleNag.confirmed === true &&
        nagRun.idleNag.dialogStillOpen === false &&
        nagRun.idleNag.paused === false &&
        typeof nagRun.idleNag.lact === 'number' &&
        nagRun.idleNag.lact > 1 &&
        Math.abs(Date.now() - nagRun.idleNag.lact) < 120_000,
      { idleNag: nagRun.idleNag, status: nagRun.status }
    );
    const nagDisabledRun = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: true,
        backgroundPlayEnabled: true,
        idleNagDefeatEnabled: false,
      },
      videoId: 'NAG0001',
      watchQuery: 'nag=1',
      probeIdleNag: 'untouched',
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'idle-nag:disabled-keeps-dialog-and-clock',
      nagDisabledRun.idleNag?.opened === true &&
        nagDisabledRun.idleNag.confirmed === false &&
        nagDisabledRun.idleNag.dialogStillOpen === true &&
        nagDisabledRun.idleNag.paused === true &&
        nagDisabledRun.idleNag.lact === 1,
      { idleNag: nagDisabledRun.idleNag, status: nagDisabledRun.status }
    );
    const nagGatedRun = await runSession({
      withAddon: true,
      seedSettings: {
        enabled: true,
        audioOnlyEnabled: true,
        backgroundPlayEnabled: false,
        idleNagDefeatEnabled: true,
      },
      videoId: 'NAG0001',
      watchQuery: 'nag=1',
      probeIdleNag: 'untouched',
      origin,
      resetLog: () => fixture.reset(),
    });
    record(
      'idle-nag:background-play-off-gates',
      nagGatedRun.idleNag?.opened === true &&
        nagGatedRun.idleNag.confirmed === false &&
        nagGatedRun.idleNag.dialogStillOpen === true &&
        nagGatedRun.idleNag.paused === true &&
        nagGatedRun.idleNag.lact === 1,
      { idleNag: nagGatedRun.idleNag, status: nagGatedRun.status }
    );

    // Per-tab audio-only scope (SPEC-012 §5; ADR-0014): the override flips one tab's hijack while
    // the global preference stays untouched in storage, a second tab follows the global, the
    // override survives a reload, it beats a later global change both ways, and closing its tab
    // prunes it from the in-memory store.
    const scopeRun = await runSession({
      withAddon: true,
      seedSettings: { audioOnlyEnabled: false },
      videoId: 'SCOPE0001',
      expectedTerminalStatus: 'disabled',
      probeTabScope: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const scope = scopeRun.tabScope;
    record(
      'per-tab-scope:override-beats-global-and-prunes',
      scope?.disabledBefore === 'disabled' &&
        scope?.activeAfterOverride === true &&
        scope?.globalAfterOverride === false &&
        scope?.secondDisabled === true &&
        scope?.secondActiveAfterOverride === true &&
        scope?.prunedSecondTab === true &&
        scope?.primaryStillPresent === true &&
        scope?.persistedAcrossReload === true &&
        scope?.persistedAcrossSpa === true &&
        scope?.stillActiveWithGlobalOn === true &&
        scope?.disabledAfterOverrideOff === true &&
        scope?.globalFinal === true,
      {
        watchTabId: scope?.watchTabId,
        secondTabId: scope?.secondTabId,
        disabledBefore: scope?.disabledBefore,
        activeAfterOverride: scope?.activeAfterOverride,
        overrideVideoSrc: scope?.overrideVideoSrc,
        globalAfterOverride: scope?.globalAfterOverride,
        secondDisabled: scope?.secondDisabled,
        secondActiveAfterOverride: scope?.secondActiveAfterOverride,
        scopesBeforeClose: scope?.scopesBeforeClose,
        scopesAfterClose: scope?.scopesAfterClose,
        persistedAcrossReload: scope?.persistedAcrossReload,
        persistedAcrossSpa: scope?.persistedAcrossSpa,
        stillActiveWithGlobalOn: scope?.stillActiveWithGlobalOn,
        disabledAfterOverrideOff: scope?.disabledAfterOverrideOff,
        scopesFinal: scope?.scopesFinal,
        globalFinal: scope?.globalFinal,
        error: scope?.error,
      }
    );

    // Rotation (SPEC-014, ADR-0012): the fixture rejects VISIONOS with LOGIN_REQUIRED for ROTATE*
    // ids and accepts ANDROID_VR, so this case is deterministically red if the walk is collapsed
    // to the primary client only.
    const rotationRun = await runSession({
      withAddon: true,
      videoId: 'ROTATE0001',
      expectedTerminalStatus: 'active',
      probeStatusMap: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const rotationPosts = fixture
      .getRequests()
      .filter((request) => request.path === '/youtubei/v1/player');
    const rotationClients = rotationPosts.map((request) => request.clientName);
    // The critical fallback attempt is the FIRST ANDROID_VR post; the primary must immediately
    // precede it. The exact global count is not asserted: a duplicate activation generation (a
    // settings/visibility-driven re-arm) can interleave an extra aborted attempt, which the
    // extension is designed to allow. Collapsing the walk to the primary only leaves no
    // ANDROID_VR post; reversing the order breaks the predecessor check.
    const fallbackIndex = rotationClients.indexOf('ANDROID_VR');
    const rotationEntry = statusMapEntry(rotationRun.statusMap);
    record(
      'm8:client-rotation-falls-back-to-second-client',
      rotationRun.status === 'active' &&
        typeof rotationRun.videoSrc === 'string' &&
        rotationRun.videoSrc.includes('/videoplayback') &&
        rotationEntry?.entry?.status === 'active' &&
        rotationClients.length >= 2 &&
        rotationClients.length <= 4 &&
        rotationClients[0] === 'VISIONOS' &&
        fallbackIndex >= 1 &&
        rotationClients[fallbackIndex - 1] === 'VISIONOS',
      {
        status: rotationRun.status,
        videoSrc: rotationRun.videoSrc,
        entry: rotationEntry?.entry,
        posts: rotationClients,
      }
    );

    // The bounded visitorData retry (SPEC-014): the fixture rejects any attempt without the fresh
    // token it handed back and accepts the retried request that carries it. The per-walk attempt
    // cap itself is pinned by unit tests over the extracted walk; here the integration facts are
    // that the page-world request starts without a token, a token appears in a later request, and
    // the retry is what unlocks the active state (the fixture accepts nothing else).
    const visitorRetryRun = await runSession({
      withAddon: true,
      videoId: 'VISITOR0001',
      expectedTerminalStatus: 'active',
      probeStatusMap: true,
      origin,
      resetLog: () => fixture.reset(),
    });
    const visitorPosts = fixture
      .getRequests()
      .filter((request) => request.path === '/youtubei/v1/player');
    const visitorRetryEntry = statusMapEntry(visitorRetryRun.statusMap);
    record(
      'm8:visitorData-retry-is-bounded-and-effective',
      visitorRetryRun.status === 'active' &&
        visitorRetryRun.videoSrc?.includes('/videoplayback') &&
        visitorRetryEntry?.entry?.status === 'active' &&
        visitorPosts.length >= 2 &&
        visitorPosts.length <= 4 &&
        visitorPosts.every((request) => request.clientName === 'VISIONOS') &&
        visitorPosts[0].visitorData === null &&
        visitorPosts.some((request) => request.visitorData === 'v2') &&
        visitorPosts.every(
          (request) => request.visitorData === null || request.visitorData === 'v2'
        ),
      {
        status: visitorRetryRun.status,
        entry: visitorRetryEntry?.entry,
        posts: visitorPosts.map((request) => ({
          client: request.clientName,
          visitorData: request.visitorData,
        })),
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
    record(
      'm2b:enabled-prunes-player-ads',
      enabled.player?.ok && !enabled.player.hasAdPlacements && !enabled.player.rawAdKeys,
      { player: enabled.player }
    );
    record(
      'm2b:enabled-prunes-inline-player-response',
      !enabled.inlinePlayerResponse.hasAdPlacements && !enabled.inlinePlayerResponse.hasPlayerAds,
      enabled.inlinePlayerResponse
    );
    // Over-budget responses stream through unparsed (SPEC-004 bounded parse): the fixture serves a
    // 9 MiB padded body far above MAX_PRUNABLE_RESPONSE_BYTES, so the network-level body the page
    // receives keeps its ad descriptors and its full byte count (proving it was never buffered for
    // pruning) while the session still reaches active promptly. The probe reads the raw text because
    // the page-world scriptlets wrap Response.json()/JSON.parse (never Response.text()); the sibling
    // m2b:enabled-prunes-player-ads case proves the same filter buffers and prunes an in-budget body.
    // The bounded-memory contract itself is pinned by the unit tests; this case is the end-to-end
    // fail-open plus latency-sanity proof.
    const overBudgetStarted = Date.now();
    const overBudget = await runSession({
      withAddon: true,
      videoId: 'BIGRESP0001',
      expectedTerminalStatus: 'active',
      probePlayerFromPage: true,
      probePlayerVideoId: 'BIGRESP0001',
      origin,
      resetLog: () => fixture.reset(),
    });
    const overBudgetElapsedMs = Date.now() - overBudgetStarted;
    record(
      'm2b:over-budget-response-streams-through-unparsed',
      overBudget.status === 'active' &&
        typeof overBudget.videoSrc === 'string' &&
        overBudget.videoSrc.includes('/videoplayback') &&
        overBudget.player?.ok === true &&
        overBudget.player.textLength > 8 * 1024 * 1024 &&
        overBudget.player.rawAdKeys === true &&
        overBudgetElapsedMs < 20_000,
      {
        status: overBudget.status,
        videoSrc: overBudget.videoSrc,
        player: overBudget.player,
        elapsedMs: overBudgetElapsedMs,
      }
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
      // Reads the dedicated segment-skip session's log, not `enabledLog`: SponsorBlock is now
      // opt-in and default-off, so the general enabled session legitimately never contacts it.
      segmentSkipLog.some(
        (r) => r.method === 'GET' && /^\/api\/skipSegments\/[0-9a-f]{4}$/.test(r.path)
      ) && !segmentSkipLog.some((r) => r.path.includes('viewedVideoSponsorTime')),
      {
        skipSegmentsRequests: segmentSkipLog
          .filter((r) => r.path.startsWith('/api/skipSegments/'))
          .map((r) => `${r.method} ${r.path}`),
        viewCountLeaks: segmentSkipLog.filter((r) => r.path.includes('viewedVideoSponsorTime'))
          .length,
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
      adBlockDisabled.player?.ok &&
        adBlockDisabled.player.hasAdPlacements &&
        adBlockDisabled.player.rawAdKeys === true,
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
