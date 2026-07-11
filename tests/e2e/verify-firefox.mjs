/**
 * End-to-end verification harness for the YouTube Audio extension (Firefox).
 *
 * What it does:
 *   1. Launches Firefox via geckodriver.
 *   2. Installs the built extension (dist/youtube-audio.xpi) as a TEMPORARY add-on.
 *   3. Opens a real YouTube watch page and starts playback.
 *   4. Observes the DOM to determine, deterministically, whether the extension's
 *      core mechanism fired: the <video>.src is swapped from a blob: (MSE) URL to a
 *      direct googlevideo ...mime=audio... URL, and the ".audio_only_div" alert is injected.
 *   5. Separately observes whether ad markers are present (the extension does NOT
 *      block ads; this is measured to prove/disprove that expectation).
 *
 * Output: a JSON verdict on stdout plus a screenshot in dist/ for evidence.
 *
 * Config via env:
 *   YT_VIDEO   YouTube video id (default: a stable music video)
 *   HEADLESS   "1" (default) headless, "0" headful
 *   TIMEOUT_MS overall observation window after play (default 45000)
 */

import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const xpiPath = resolve(repoRoot, 'dist', process.env.XPI || 'youtube-audio.xpi');

const VIDEO = process.env.YT_VIDEO || 'dQw4w9WgXcQ';
const HEADLESS = process.env.HEADLESS !== '0';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 45000);
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO}`;

function log(...a) {
  console.error('[e2e]', ...a);
}

if (!existsSync(xpiPath)) {
  console.error(`Missing ${xpiPath}. Build it first: npm run build:ext`);
  process.exit(2);
}
const options = new firefox.Options();
if (HEADLESS) options.addArguments('-headless');
// Allow autoplay so a media request actually flows (the extension only reacts to media requests).
options.setPreference('media.autoplay.default', 0);
options.setPreference('media.autoplay.blocking_policy', 0);
options.setPreference('media.autoplay.allow-muted', true);
// Reduce first-run noise.
options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
options.setPreference('browser.shell.checkDefaultBrowser', false);

const result = {
  watchUrl: WATCH_URL,
  headless: HEADLESS,
  extensionInstalled: false,
  addonId: null,
  videoFound: false,
  initialSrc: null,
  finalSrc: null,
  srcIsBlob: null,
  srcIsGoogleVideo: null,
  srcHasMimeAudio: null,
  // Primary proof: the <video>.src was actually swapped to a direct audio URL.
  srcSwapped: false,
  // Corroborating (weaker): the content script received a mime=audio url and drew the banner.
  bannerObserved: false,
  // Did audio actually progress (currentTime advanced) while audio-only?
  playbackAdvanced: false,
  maxCurrentTime: 0,
  extensionMechanismFired: false,
  adMarkersPresent: false,
  adMarkerDetail: [],
  diag: {
    contentScriptInjected: false,
    backgroundMessagedTab: 0,
    lastAudioUrl: null,
    srcRightAfterSet: null,
  },
  notes: [],
  verdict: 'UNKNOWN',
};

let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

  log('installing extension as temporary add-on...');
  const addonId = await driver.installAddon(xpiPath, true);
  result.extensionInstalled = true;
  result.addonId = addonId;
  log('installed add-on id:', addonId);

  log('navigating to', WATCH_URL);
  await driver.get(WATCH_URL);

  // Best-effort: dismiss a consent/cookie dialog if one appears.
  try {
    const consent = await driver.wait(
      until.elementLocated(
        By.css('button[aria-label*="Accept"], button[aria-label*="accept"], form[action*="consent"] button')
      ),
      4000
    );
    await consent.click();
    result.notes.push('dismissed a consent dialog');
    log('dismissed consent dialog');
  } catch {
    // no consent dialog — fine
  }

  // Wait for the video element.
  const video = await driver.wait(until.elementLocated(By.css('video')), 20000);
  result.videoFound = true;
  result.initialSrc = await video.getAttribute('src');
  log('initial video.src:', result.initialSrc);

  // Force playback so YouTube issues media (googlevideo) requests.
  await driver.executeScript(`
    const v = document.querySelector('video');
    if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(()=>{}); }
    const btn = document.querySelector('.ytp-play-button, button.ytp-large-play-button');
    if (btn && document.querySelector('video')?.paused) btn.click();
  `);
  log('requested playback; observing for', TIMEOUT_MS, 'ms');

  // Poll until the src looks swapped to a direct audio URL, or timeout.
  const deadline = Date.now() + TIMEOUT_MS;
  let lastSrc = result.initialSrc;
  while (Date.now() < deadline) {
    const snap = await driver.executeScript(`
      const v = document.querySelector('video');
      const adEl = document.querySelector('.ad-showing, .ad-interrupting, .video-ads .ytp-ad-player-overlay, .ytp-ad-text');
      return {
        src: v ? v.src : null,
        currentTime: v ? v.currentTime : null,
        paused: v ? v.paused : null,
        audioOnlyDiv: !!document.querySelector('.audio_only_div'),
        adShowing: document.querySelector('.html5-video-player')?.classList.contains('ad-showing') || false,
        adMarker: adEl ? adEl.className : null,
        contentLoaded: document.documentElement.getAttribute('data-yta-content-loaded'),
        msgCount: document.documentElement.getAttribute('data-yta-msg-count'),
        lastUrl: document.documentElement.getAttribute('data-yta-last-url'),
        srcAfterSet: document.documentElement.getAttribute('data-yta-src-after-set'),
      };
    `);
    lastSrc = snap.src;
    if (snap.contentLoaded) result.diag.contentScriptInjected = true;
    if (snap.msgCount) result.diag.backgroundMessagedTab = Number(snap.msgCount);
    if (snap.lastUrl) result.diag.lastAudioUrl = snap.lastUrl;
    if (snap.srcAfterSet) result.diag.srcRightAfterSet = snap.srcAfterSet;
    if (snap.audioOnlyDiv) result.bannerObserved = true;
    if (typeof snap.currentTime === 'number' && snap.currentTime > result.maxCurrentTime) {
      result.maxCurrentTime = snap.currentTime;
    }
    if (snap.adShowing || snap.adMarker) {
      result.adMarkersPresent = true;
      if (snap.adMarker && !result.adMarkerDetail.includes(snap.adMarker)) {
        result.adMarkerDetail.push(snap.adMarker);
      }
    }
    const hasMimeAudio = typeof snap.src === 'string' && snap.src.includes('mime=audio');
    if (hasMimeAudio) {
      result.srcSwapped = true;
      log('src swapped to a direct mime=audio URL (primary proof)');
      break;
    }
    await driver.sleep(1500);
  }

  result.finalSrc = lastSrc;

  // Network probe: what did the page actually fetch from googlevideo?
  // This tells us whether YouTube still exposes `mime=audio` in the request URL
  // (the signal the extension keys on) or has moved it out of the query string.
  try {
    result.netProbe = await driver.executeScript(`
      const res = performance.getEntriesByType('resource').map(e => e.name);
      const gv = res.filter(u => u.includes('googlevideo.com'));
      return {
        totalResources: res.length,
        googlevideoCount: gv.length,
        withMimeAudioInUrl: gv.filter(u => u.includes('mime=audio')).length,
        withMimeVideoInUrl: gv.filter(u => u.includes('mime=video')).length,
        videoplaybackCount: gv.filter(u => u.includes('videoplayback')).length,
        sample: gv.slice(0, 3).map(u => u.slice(0, 200)),
      };
    `);
  } catch (e) {
    result.notes.push('netProbe failed: ' + e.message);
  }

  result.srcIsBlob = typeof lastSrc === 'string' && lastSrc.startsWith('blob:');
  result.srcIsGoogleVideo = typeof lastSrc === 'string' && lastSrc.includes('googlevideo.com');
  result.srcHasMimeAudio = typeof lastSrc === 'string' && lastSrc.includes('mime=audio');

  // Confirm audio actually PROGRESSED under the swapped source (not just paused/stalled).
  // Sample currentTime, wait, sample again.
  try {
    const t0 = await driver.executeScript('return document.querySelector("video")?.currentTime ?? null;');
    await driver.sleep(3000);
    const t1 = await driver.executeScript('return document.querySelector("video")?.currentTime ?? null;');
    if (typeof t1 === 'number' && t1 > result.maxCurrentTime) result.maxCurrentTime = t1;
    result.playbackAdvanced =
      typeof t0 === 'number' && typeof t1 === 'number' && t1 - t0 > 0.25;
  } catch (e) {
    result.notes.push('playback-advance check failed: ' + e.message);
  }

  // Primary proof of the audio-only mechanism is the actual <video>.src swap to a
  // direct mime=audio URL. The banner alone only proves the content-script message
  // handler ran; it is reported but is NOT sufficient for a pass.
  result.extensionMechanismFired = result.srcSwapped || result.srcHasMimeAudio;

  // Evidence screenshot.
  try {
    const png = await driver.takeScreenshot();
    const shot = resolve(repoRoot, 'dist', 'e2e-screenshot.png');
    writeFileSync(shot, png, 'base64');
    result.notes.push(`screenshot: ${shot}`);
  } catch (e) {
    result.notes.push('screenshot failed: ' + e.message);
  }

  // Verdict.
  if (!result.extensionInstalled) result.verdict = 'INSTALL_FAILED';
  else if (!result.videoFound) result.verdict = 'NO_VIDEO_ELEMENT';
  else if (result.extensionMechanismFired && result.playbackAdvanced)
    result.verdict = 'MECHANISM_FIRED';
  else if (result.extensionMechanismFired)
    result.verdict = 'SRC_SWAPPED_NO_PLAYBACK'; // swapped but audio did not progress
  else if (result.bannerObserved)
    result.verdict = 'BANNER_ONLY'; // handler ran but src never actually swapped
  else result.verdict = 'MECHANISM_DID_NOT_FIRE';
} catch (err) {
  result.verdict = 'ERROR';
  result.notes.push('exception: ' + (err && err.message ? err.message : String(err)));
} finally {
  if (driver) {
    try {
      await driver.quit();
    } catch {
      /* ignore */
    }
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'MECHANISM_FIRED' ? 0 : 1);
