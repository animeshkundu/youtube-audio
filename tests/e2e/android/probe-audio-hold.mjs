#!/usr/bin/env node
/**
 * Non-gating live Fenix probe for the production audio-only path.
 *
 * The probe installs a temporary MV2 add-on, cold-loads one eligible logged-out VOD, observes the
 * production `yta:status` event, foregrounds the watch page, sends a trusted Android tap to the
 * native Play control, and requires audio-only playback to hold for the full sample window.
 *
 * Usage: node tests/e2e/android/probe-audio-hold.mjs [xpi]
 * Environment: ADB, GECKO, VIDEO_ID, HOLD_SECONDS, SAMPLE_SECONDS, FENIX_PACKAGE
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ServiceBuilder } from 'selenium-webdriver/firefox.js';

const execFile = promisify(execFileCallback);
const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADB = process.env.ADB || 'adb';
const GECKO = process.env.GECKO || `${process.cwd()}/node_modules/.bin/geckodriver`;
const FENIX_PACKAGE = process.env.FENIX_PACKAGE || 'org.mozilla.fenix';
const VIDEO_ID = process.env.VIDEO_ID || 'zkfVxxJFPjM';
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS || 45);
const SAMPLE_SECONDS = Number(process.env.SAMPLE_SECONDS || 5);
const WATCH_URL = `https://m.youtube.com/watch?v=${VIDEO_ID}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firefoxOptions() {
  const options = new firefox.Options();
  options.enableMobile(FENIX_PACKAGE);
  return options;
}

function service() {
  return new ServiceBuilder(GECKO).addArguments('--android-storage', 'internal');
}

async function adb(...args) {
  const { stdout = '' } = await execFile(ADB, args, { timeout: 30_000 });
  return stdout.trim();
}

async function uiXml() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/yta-ui.xml');
  return adb('shell', 'cat', '/sdcard/yta-ui.xml');
}

function nodeCenter(xml, matcher) {
  const nodes = xml.match(/<node\b[^>]*>/g) || [];
  for (const node of nodes) {
    const text = `${node.match(/text="([^"]*)"/)?.[1] || ''} ${
      node.match(/content-desc="([^"]*)"/)?.[1] || ''
    }`;
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (matcher.test(text) && bounds) {
      return {
        x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
        y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
        label: text.trim(),
      };
    }
  }
  return null;
}

async function tapOverlay(label) {
  const deadline = Date.now() + 12_000;
  const matcher = new RegExp(`^\\s*${label}\\s*$`, 'i');
  while (Date.now() < deadline) {
    const target = nodeCenter(await uiXml(), matcher);
    if (target) {
      await adb('shell', 'input', 'tap', String(target.x), String(target.y));
      await sleep(1_000);
      return target;
    }
    await sleep(500);
  }
  return null;
}

async function foregroundWatchPage() {
  await adb(
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    WATCH_URL,
    FENIX_PACKAGE
  );
}

async function waitForPlayControl() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const target = nodeCenter(await uiXml(), /^\s*Play\s*$/i);
    if (target) return target;
    await sleep(1_000);
  }
  throw new Error('Android UI did not expose the YouTube Play control within 60 seconds');
}

async function tapPlayControlUntilActivated(driver) {
  const deadline = Date.now() + 20_000;
  let target;
  let last;
  while (Date.now() < deadline) {
    await foregroundWatchPage();
    await sleep(750);
    target = await waitForPlayControl();
    await adb('shell', 'input', 'tap', String(target.x), String(target.y));
    await sleep(1_000);
    last = await snapshot(driver);
    if (last.userActivation.hasBeenActive === true) return { target, snapshot: last };
  }
  throw new Error(
    `trusted tap did not activate the watch document; last snapshot: ${JSON.stringify(last)}`
  );
}

async function snapshot(driver) {
  return driver.executeScript(function () {
    const video = document.querySelector('video');
    const currentSrc = video ? video.currentSrc || video.src || '' : '';
    const statusEvents = Array.isArray(window.__ytaProbeStatusEvents)
      ? window.__ytaProbeStatusEvents
      : [];
    return {
      url: location.href,
      focused: document.hasFocus(),
      viewport: { width: innerWidth, height: innerHeight },
      userActivation: {
        isActive: navigator.userActivation?.isActive ?? null,
        hasBeenActive: navigator.userActivation?.hasBeenActive ?? null,
      },
      status: document.documentElement.dataset.ytaStatus || null,
      statusEvents,
      activeSeen:
        document.documentElement.dataset.ytaStatus === 'active' ||
        statusEvents.some((event) => event?.status === 'active'),
      hasVideo: Boolean(video),
      paused: video?.paused ?? null,
      readyState: video?.readyState ?? null,
      muted: video?.muted ?? null,
      currentTime: video?.currentTime ?? null,
      currentSrc: currentSrc.slice(0, 120),
      currentSrcKind: currentSrc.includes('/videoplayback') ? 'videoplayback' : currentSrc.startsWith('blob:') ? 'blob' : 'other',
    };
  });
}

async function waitFor(driver, predicate, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await snapshot(driver);
    if (predicate(last)) return last;
    await sleep(500);
  }
  throw new Error(`${description}; last snapshot: ${JSON.stringify(last)}`);
}

const report = {
  xpi: XPI,
  videoId: VIDEO_ID,
  watchUrl: WATCH_URL,
  holdSeconds: HOLD_SECONDS,
  sampleSeconds: SAMPLE_SECONDS,
  overlays: {},
  timeline: [],
  assertions: {},
  verdict: 'FAIL',
};

let driver;
try {
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(firefoxOptions())
    .setFirefoxService(service())
    .build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 90_000 });

  report.addonId = await driver.installAddon(XPI, true);
  report.overlays.addonConfirmation = await tapOverlay('OK');
  report.overlays.onboarding = await tapOverlay('Continue');
  report.overlays.defaultBrowser = await tapOverlay('Not now');

  await driver.get(WATCH_URL);
  await foregroundWatchPage();
  await sleep(1_000);
  await foregroundWatchPage();
  await waitFor(
    driver,
    (value) => value.url.includes(`/watch?v=${VIDEO_ID}`) && value.viewport.width > 0,
    'watch page did not become a visible WebDriver document'
  );

  const coldActive = await waitFor(
    driver,
    (value) => value.activeSeen && value.currentSrcKind === 'videoplayback' && value.readyState >= 2,
    'cold-load activation did not reach active with a playable /videoplayback source'
  );
  report.timeline.push({ elapsedSeconds: 0, phase: 'cold-active', ...coldActive });

  const activation = await tapPlayControlUntilActivated(driver);
  report.playControl = activation.target;

  const playing = await waitFor(
    driver,
    (value) =>
      value.userActivation.hasBeenActive === true &&
      value.paused === false &&
      value.readyState === 4 &&
      value.muted === false &&
      value.currentSrcKind === 'videoplayback',
    'trusted tap did not start decoded, unmuted audio-only playback'
  );
  const startTime = playing.currentTime;
  const startedAt = Date.now();
  report.timeline.push({ elapsedSeconds: 0, phase: 'playing', ...playing });

  while (Date.now() - startedAt < HOLD_SECONDS * 1_000) {
    await sleep(SAMPLE_SECONDS * 1_000);
    const sample = await snapshot(driver);
    report.timeline.push({
      elapsedSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
      phase: 'hold',
      ...sample,
    });
  }

  const holdSamples = report.timeline.filter((sample) => sample.phase === 'hold');
  const final = holdSamples.at(-1);
  report.assertions = {
    coldLoadReachedActive:
      coldActive.activeSeen && coldActive.currentSrcKind === 'videoplayback' && coldActive.readyState >= 2,
    elementSwapRehijackHeld:
      coldActive.currentSrcKind === 'videoplayback' &&
      holdSamples.every((sample) => sample.currentSrcKind === 'videoplayback'),
    trustedActivation: holdSamples.every(
      (sample) => sample.userActivation.hasBeenActive === true
    ),
    playbackDecodedAndUnmuted: holdSamples.every(
      (sample) => sample.paused === false && sample.readyState === 4 && sample.muted === false
    ),
    currentTimeAdvanced:
      Number.isFinite(startTime) &&
      Number.isFinite(final?.currentTime) &&
      final.currentTime > startTime + Math.min(10, HOLD_SECONDS / 2),
    sustainedWindow:
      holdSamples.length >= Math.floor(HOLD_SECONDS / SAMPLE_SECONDS) &&
      (holdSamples.at(-1)?.elapsedSeconds || 0) >= HOLD_SECONDS,
  };
  report.verdict = Object.values(report.assertions).every(Boolean) ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
