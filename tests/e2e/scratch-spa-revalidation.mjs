#!/usr/bin/env node
/**
 * THROWAWAY validation script (not committed, deleted after use). Report-only task: no product
 * code is touched. Real headful Firefox, temporary add-on install, fresh isolated profile, logged
 * out only. Validates:
 *   Part 1: every ExtensionSettings field ON vs OFF with a concrete observable.
 *   Part 2: SPA navigation re-apply via REAL trusted-pointer clicks + back/forward, the regression
 *           check for the new history.pushState/replaceState/popstate hooks in src/shared/spa.ts.
 *
 * Usage: node tests/e2e/scratch-spa-revalidation.mjs
 * Env: XPI (defaults to /tmp/yta-validation/youtube-audio-bench.xpi), HEADLESS=1 for headless.
 */
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const XPI = process.env.XPI || '/tmp/yta-validation/youtube-audio-bench.xpi';
const ADDON_ID = 'youtube-audio@animesh.kundus.in';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const TIMEOUT = 45_000;

const videos = { music: 'dQw4w9WgXcQ', regular: 'aqz-KE-bpKQ', sponsor: '0e3GPea1Tyg' };

const DEFAULT_SETTINGS = {
  enabled: true,
  audioOnlyEnabled: true,
  audioArtworkEnabled: true,
  backgroundPlayEnabled: true,
  ghostEnabled: true,
  aggressiveTelemetry: false,
  adBlockEnabled: true,
  segmentSkipEnabled: true,
  segmentSkipCategories: ['sponsor', 'music_offtopic'],
  forceQualityMax: 'off',
  disableAutoplayNext: false,
  hideShorts: false,
  hideRecommendations: false,
  hideComments: false,
  loudnessNormalization: true,
  equalizerEnabled: false,
  equalizerBands: [0, 0, 0, 0, 0],
  lyricsEnabled: false,
  downloadEnabled: false,
};

const part1 = [];
const part2 = [];
const notes = [];

function ffOptions() {
  const o = new firefox.Options();
  if (process.env.HEADLESS === '1') o.addArguments('-headless');
  o.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  o.setPreference('media.autoplay.default', 0);
  o.setPreference('media.autoplay.blocking_policy', 0);
  o.setPreference('media.autoplay.allow-muted', true);
  o.setPreference('datareporting.policy.dataSubmissionEnabled', false);
  o.setPreference('browser.shell.checkDefaultBrowser', false);
  return o;
}

let driver;
let optHandle;
let ytHandle;

async function toOpt() {
  await driver.switchTo().window(optHandle);
}
async function toYt() {
  await driver.switchTo().window(ytHandle);
}

async function setSettings(patch) {
  await toOpt();
  const result = await driver.executeAsyncScript(function (patch) {
    const done = arguments[arguments.length - 1];
    browser.storage.local
      .get('settings')
      .then((stored) => {
        const next = Object.assign({}, stored.settings || {}, patch);
        return browser.storage.local.set({ settings: next }).then(() => next);
      })
      .then(
        (next) => done({ ok: true, next }),
        (err) => done({ ok: false, error: String(err) })
      );
  }, patch);
  await toYt();
  if (!result.ok) throw new Error('setSettings failed: ' + result.error);
  return result.next;
}

async function seedSettings(full) {
  await toOpt();
  await driver.executeAsyncScript(function (full) {
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ settings: full }).then(
      () => done(true),
      (e) => done(String(e))
    );
  }, full);
}

async function getDiag() {
  await toOpt();
  const bundle = await driver.executeAsyncScript(function () {
    const done = arguments[arguments.length - 1];
    browser.runtime.sendMessage({ type: 'yta:diagnostics-report' }).then(
      (r) => done(r),
      (e) => done({ error: String(e) })
    );
  });
  await toYt();
  return bundle;
}

async function getBenchStatusMap() {
  await toOpt();
  const map = await driver.executeAsyncScript(function () {
    const done = arguments[arguments.length - 1];
    browser.runtime.sendMessage({ type: 'yta:__bench-status-map' }).then(
      (r) => done(r),
      (e) => done({ error: String(e) })
    );
  });
  await toYt();
  return map;
}

function countCode(bundle, code) {
  return (bundle?.events || []).filter((e) => e.code === code).length;
}
function lastEvent(bundle, code) {
  const list = (bundle?.events || []).filter((e) => e.code === code);
  return list.length ? list[list.length - 1] : null;
}

async function waitYt(fn, args = [], timeout = TIMEOUT, interval = 300) {
  return driver.wait(async () => {
    try {
      return (await driver.executeScript(fn, ...args)) || false;
    } catch {
      return false;
    }
  }, timeout, undefined, interval);
}

function pageSnapshot() {
  const video = document.querySelector('video');
  const src = video ? video.currentSrc || video.src || '' : '';
  return {
    url: location.href,
    status: document.documentElement.dataset.ytaStatus || null,
    reason: document.documentElement.dataset.ytaReason || null,
    video: video
      ? {
          src: src.slice(0, 240),
          googlevideo: src.includes('googlevideo.com') && src.includes('videoplayback'),
          currentTime: video.currentTime,
          paused: video.paused,
          readyState: video.readyState,
        }
      : null,
  };
}

async function navigateYt(videoId, host = 'www.youtube.com') {
  await toYt();
  await driver.get(`https://${host}/watch?v=${encodeURIComponent(videoId)}`);
  await waitYt(() => document.documentElement.dataset.ytaBench === '1');
  await driver.sleep(1500);
}

async function waitStatus(target = ['active', 'fallback', 'disabled'], timeout = TIMEOUT) {
  try {
    await waitYt(
      function (target) {
        const s = document.documentElement.dataset.ytaStatus;
        return target.includes(s) ? s : false;
      },
      [target],
      timeout
    );
  } catch {
    notes.push('waitStatus timed out waiting for ' + JSON.stringify(target));
  }
}

async function t1(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    part1.push({ name, ok: true, elapsedMs: Date.now() - started, result });
  } catch (e) {
    part1.push({ name, ok: false, elapsedMs: Date.now() - started, error: String(e?.stack || e) });
  }
}
async function t2(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    part2.push({ name, ok: true, elapsedMs: Date.now() - started, result });
  } catch (e) {
    part2.push({ name, ok: false, elapsedMs: Date.now() - started, error: String(e?.stack || e) });
  }
}

async function main() {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(ffOptions()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  await driver.installAddon(XPI, true);
  optHandle = await driver.getWindowHandle();
  await driver.get(OPTIONS_URL);
  await seedSettings(DEFAULT_SETTINGS);

  await driver.switchTo().newWindow('tab');
  const handles = await driver.getAllWindowHandles();
  ytHandle = handles.find((h) => h !== optHandle);
  await toYt();
  await navigateYt(videos.regular);
  await waitStatus();

  // ---------------- PART 1 ----------------

  await t1('audioOnlyEnabled ON vs OFF', async () => {
    const onSnap1 = await driver.executeScript(pageSnapshot);
    await driver.sleep(2000);
    const onSnap2 = await driver.executeScript(pageSnapshot);
    await setSettings({ audioOnlyEnabled: false });
    await driver.sleep(3000);
    const offSnap = await driver.executeScript(pageSnapshot);
    await setSettings({ audioOnlyEnabled: true });
    await waitStatus(['active']);
    const restored = await driver.executeScript(pageSnapshot);
    return { onSnap1, onSnap2, advanced: onSnap2.video?.currentTime > onSnap1.video?.currentTime, offSnap, restored };
  });

  await t1('audioArtworkEnabled ON vs OFF', async () => {
    const overlayCheck = () => {
      const el = document.querySelector('.yta-audio-artwork');
      return { present: Boolean(el), visible: el ? el.dataset.visible === 'true' : false, marker: document.documentElement.dataset.ytaArtwork || null };
    };
    await driver.sleep(1500);
    const onState = await driver.executeScript(overlayCheck);
    await setSettings({ audioArtworkEnabled: false });
    await driver.sleep(1500);
    const offState = await driver.executeScript(overlayCheck);
    await setSettings({ audioArtworkEnabled: true });
    await driver.sleep(1500);
    const restoredState = await driver.executeScript(overlayCheck);
    return { onState, offState, restoredState };
  });

  await t1('backgroundPlayEnabled ON vs OFF (visibilitychange swallow)', async () => {
    const bgTest = () => {
      let fired = false;
      const l = () => {
        fired = true;
      };
      document.addEventListener('visibilitychange', l);
      document.dispatchEvent(new Event('visibilitychange'));
      document.removeEventListener('visibilitychange', l);
      return { fired, hidden: document.hidden, visibilityState: document.visibilityState };
    };
    const onResult = await driver.executeScript(bgTest);
    await setSettings({ backgroundPlayEnabled: false });
    await driver.sleep(1000);
    const offResult = await driver.executeScript(bgTest);
    await setSettings({ backgroundPlayEnabled: true });
    await driver.sleep(1000);
    const restoredResult = await driver.executeScript(bgTest);
    return { onResult, offResult, restoredResult };
  });

  await t1('ghostEnabled + aggressiveTelemetry tiered blocking', async () => {
    const probe = () => {
      const endpoints = {
        conservative: ['/api/stats/qoe', '/api/stats/atr', '/api/stats/ads', '/pagead/x', '/ptracking', '/csi_204', '/generate_204'],
        aggressiveOnly: ['/api/stats/watchtime', '/api/stats/playback'],
        neverBlocked: ['/youtubei/v1/log_event'],
      };
      const tag = '?live_e2e=' + Date.now() + Math.random();
      const probeOne = (path) =>
        fetch(path + tag, { method: 'POST', body: '{}' })
          .then((r) => ({ path, outcome: 'fulfilled', status: r.status }))
          .catch((e) => ({ path, outcome: 'rejected', error: String(e) }));
      const all = [...endpoints.conservative, ...endpoints.aggressiveOnly, ...endpoints.neverBlocked];
      return Promise.all(all.map(probeOne)).then((results) => {
        const byPath = Object.fromEntries(results.map((r) => [r.path, r]));
        return { conservative: endpoints.conservative.map((p) => byPath[p]), aggressiveOnly: endpoints.aggressiveOnly.map((p) => byPath[p]), neverBlocked: endpoints.neverBlocked.map((p) => byPath[p]) };
      });
    };
    const conservativeMode = await driver.executeAsyncScript(function (probeSrc) {
      const done = arguments[arguments.length - 1];
      // eslint-disable-next-line no-eval
      eval('(' + probeSrc + ')')().then(done);
    }, probe.toString());
    await setSettings({ aggressiveTelemetry: true });
    await driver.sleep(500);
    const aggressiveMode = await driver.executeAsyncScript(function (probeSrc) {
      const done = arguments[arguments.length - 1];
      eval('(' + probeSrc + ')')().then(done);
    }, probe.toString());
    await setSettings({ ghostEnabled: false });
    await driver.sleep(500);
    const ghostOff = await driver.executeAsyncScript(function (probeSrc) {
      const done = arguments[arguments.length - 1];
      eval('(' + probeSrc + ')')().then(done);
    }, probe.toString());
    await setSettings({ ghostEnabled: true, aggressiveTelemetry: false });
    await driver.sleep(500);
    return { conservativeMode, aggressiveMode, ghostOff };
  });

  await t1('adBlockEnabled ON vs OFF (direct player-response fetch)', async () => {
    const fetchPlayer = (id) => {
      const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
      const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
      if (!key || !context) return Promise.resolve({ ok: false, reason: 'missing-config' });
      return fetch(`/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, videoId: id, contentCheckOk: true, racyCheckOk: true }),
      })
        .then((r) => r.json())
        .then((j) => ({
          ok: true,
          playability: j.playabilityStatus?.status,
          adPlacements: Object.prototype.hasOwnProperty.call(j, 'adPlacements'),
          playerAds: Object.prototype.hasOwnProperty.call(j, 'playerAds'),
          adSlots: Object.prototype.hasOwnProperty.call(j, 'adSlots'),
        }))
        .catch((e) => ({ ok: false, error: String(e) }));
    };
    const onResult = await driver.executeAsyncScript(function (id, fnSrc) {
      const done = arguments[arguments.length - 1];
      eval('(' + fnSrc + ')')(id).then(done);
    }, videos.regular, fetchPlayer.toString());
    await setSettings({ adBlockEnabled: false });
    await driver.sleep(500);
    const offResult = await driver.executeAsyncScript(function (id, fnSrc) {
      const done = arguments[arguments.length - 1];
      eval('(' + fnSrc + ')')(id).then(done);
    }, videos.regular, fetchPlayer.toString());
    await setSettings({ adBlockEnabled: true });
    await driver.sleep(500);
    return { onResult, offResult };
  });

  await t1('segmentSkipEnabled ON vs OFF (real sponsor segment)', async () => {
    await navigateYt(videos.sponsor);
    await waitStatus();
    const seek = () => {
      const video = document.querySelector('video');
      if (!video) return Promise.resolve({ ok: false, reason: 'no-video' });
      return new Promise((resolve) => {
        const started = Date.now();
        video.currentTime = 862;
        video.dispatchEvent(new Event('timeupdate'));
        const poll = () => {
          const currentTime = video.currentTime;
          if (currentTime >= 869.7 || Date.now() - started >= 8000) {
            resolve({ currentTime, armed: document.documentElement.dataset.ytaSkipArmed || null, skipped: currentTime >= 869.7 });
            return;
          }
          setTimeout(poll, 200);
        };
        poll();
      });
    };
    const onResult = await driver.executeAsyncScript(function (fnSrc) {
      const done = arguments[arguments.length - 1];
      eval('(' + fnSrc + ')')().then(done);
    }, seek.toString());

    await setSettings({ segmentSkipEnabled: false });
    await driver.navigate().refresh();
    await waitYt(() => document.documentElement.dataset.ytaBench === '1');
    await driver.sleep(1500);
    await waitStatus();
    const offResult = await driver.executeAsyncScript(function (fnSrc) {
      const done = arguments[arguments.length - 1];
      eval('(' + fnSrc + ')')().then(done);
    }, seek.toString());

    await setSettings({ segmentSkipEnabled: true });
    await navigateYt(videos.regular);
    await waitStatus();
    return { onResult, offResult };
  });

  await t1('forceQualityMax 240p vs off (causal)', async () => {
    await setSettings({ audioOnlyEnabled: false });
    await driver.sleep(2500);
    const quality = () => {
      const player = document.querySelector('#movie_player');
      return { current: player?.getPlaybackQuality?.() || null, available: player?.getAvailableQualityLevels?.() || [] };
    };
    const offCap = await driver.executeScript(quality);
    await setSettings({ forceQualityMax: '240p' });
    await driver.sleep(3000);
    const cap240 = await driver.executeScript(quality);
    // Leave quality cap at 480p + audioOnly restored for the Part 2 baseline.
    await setSettings({ forceQualityMax: '480p', audioOnlyEnabled: true });
    await waitStatus(['active']);
    return { offCap, cap240 };
  });

  await t1('disableAutoplayNext ON vs OFF (native aria-checked)', async () => {
    const ariaChecked = () => {
      const btn = document.querySelector('.ytp-autonav-toggle-button');
      return btn ? btn.getAttribute('aria-checked') : null;
    };
    const nativeDefault = await driver.executeScript(ariaChecked);
    await setSettings({ disableAutoplayNext: true });
    let flipped = null;
    try {
      flipped = await driver.wait(async () => {
        const v = await driver.executeScript(ariaChecked);
        return v === 'false' ? v : false;
      }, 12_000);
    } catch {
      notes.push('disableAutoplayNext: aria-checked did not flip to false within 12s');
    }
    // Leave ON for the Part 2 baseline.
    return { nativeDefault, flipped };
  });

  await t1('hideShorts / hideRecommendations / hideComments singles + critical combo', async () => {
    const scrollForComments = async () => {
      await driver.executeScript(() => window.scrollTo(0, document.body.scrollHeight));
      try {
        await waitYt(() => Boolean(document.querySelector('ytd-comments#comments, #comments')), [], 15_000);
      } catch {
        notes.push('comments section never appeared in DOM even after scroll (best-effort lazy-load)');
      }
      await driver.executeScript(() => window.scrollTo(0, 0));
    };
    const stylesSnapshot = () => {
      const disp = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display : 'absent';
      };
      return {
        related: disp('ytd-watch-flexy #related'),
        watchNextSecondary: disp('ytd-watch-next-secondary-results-renderer'),
        comments: disp('ytd-comments#comments, #comments'),
        stylePresent: Boolean(document.getElementById('yta-distraction-style')),
      };
    };
    await scrollForComments();
    const allOff = await driver.executeScript(stylesSnapshot);

    await setSettings({ hideShorts: true });
    await driver.sleep(1200);
    const shortsOnly = await driver.executeScript(stylesSnapshot);

    await setSettings({ hideShorts: false, hideRecommendations: true, hideComments: false });
    await driver.sleep(1200);
    const recsOnlyCriticalEdgeCase = await driver.executeScript(stylesSnapshot);

    await setSettings({ hideRecommendations: false, hideComments: true });
    await driver.sleep(1200);
    const commentsOnly = await driver.executeScript(stylesSnapshot);

    await setSettings({ hideRecommendations: true, hideComments: true });
    await driver.sleep(1200);
    const both = await driver.executeScript(stylesSnapshot);

    // Leave hideRecommendations ON, hideComments/hideShorts OFF for the Part 2 baseline.
    await setSettings({ hideShorts: false, hideRecommendations: true, hideComments: false });
    await driver.sleep(1200);

    return { allOff, shortsOnly, recsOnlyCriticalEdgeCase, commentsOnly, both };
  });

  await t1('loudnessNormalization / equalizerEnabled audio graph armed', async () => {
    let diag = await getDiag();
    const initialCount = countCode(diag, 'audio.graph');
    const initialLast = lastEvent(diag, 'audio.graph');

    await setSettings({ equalizerEnabled: true });
    await driver.sleep(1500);
    diag = await getDiag();
    const bothOnCount = countCode(diag, 'audio.graph');
    const bothOnLast = lastEvent(diag, 'audio.graph');

    await setSettings({ loudnessNormalization: false, equalizerEnabled: false });
    await driver.sleep(1500);
    diag = await getDiag();
    const bothOffCount = countCode(diag, 'audio.graph');

    await setSettings({ loudnessNormalization: true, equalizerEnabled: false });
    await driver.sleep(1000);
    return { initialCount, initialLast, bothOnCount, bothOnLast, bothOffCount, noNewEventWhenBothOff: bothOffCount === bothOnCount };
  });

  await t1('lyricsEnabled on music.youtube.com (best-effort logged out)', async () => {
    await setSettings({ lyricsEnabled: true });
    await navigateYt(videos.music, 'music.youtube.com');
    await waitStatus();
    await driver.sleep(6000);
    const lyricsPresent = await driver.executeScript(() => Boolean(document.getElementById('yta-synced-lyrics')));
    await setSettings({ lyricsEnabled: false });
    await navigateYt(videos.regular);
    await waitStatus();
    return { lyricsPresent };
  });

  // ---------------- PART 2: SPA navigation re-apply ----------------

  const PART2_BASELINE = {
    ...DEFAULT_SETTINGS,
    forceQualityMax: '480p',
    hideRecommendations: true,
    disableAutoplayNext: true,
  };
  await setSettings(PART2_BASELINE);
  await navigateYt(videos.regular);
  await waitStatus(['active']);

  function currentVideoId(url) {
    try {
      return new URL(url).searchParams.get('v');
    } catch {
      return null;
    }
  }

  async function fullFeatureSnapshot() {
    return driver.executeScript(() => {
      const video = document.querySelector('video');
      const src = video ? video.currentSrc || video.src || '' : '';
      const player = document.querySelector('#movie_player');
      const autonav = document.querySelector('.ytp-autonav-toggle-button');
      const related = document.querySelector('ytd-watch-flexy #related');
      const watchNext = document.querySelector('ytd-watch-next-secondary-results-renderer');
      return {
        url: location.href,
        status: document.documentElement.dataset.ytaStatus || null,
        reason: document.documentElement.dataset.ytaReason || null,
        video: video
          ? {
              src: src.slice(0, 240),
              googlevideo: src.includes('googlevideo.com') && src.includes('videoplayback'),
              currentTime: video.currentTime,
              readyState: video.readyState,
            }
          : null,
        quality: { current: player?.getPlaybackQuality?.() || null },
        autonavAriaChecked: autonav ? autonav.getAttribute('aria-checked') : null,
        relatedDisplay: related ? getComputedStyle(related).display : 'absent',
        watchNextDisplay: watchNext ? getComputedStyle(watchNext).display : 'absent',
        marker: window.__ytaNavMarker || null,
      };
    });
  }

  async function realClickNextVideo(label) {
    await driver.executeScript(() => {
      window.__ytaNavMarker = Math.random();
    });
    const beforeUrl = await driver.getCurrentUrl();
    const beforeVideoId = currentVideoId(beforeUrl);

    let clicked = false;
    let mechanism = null;
    try {
      const player = await driver.findElement(By.css('#movie_player'));
      await driver.actions({ bridge: true }).move({ origin: player }).perform();
      await driver.sleep(400);
      const nextBtn = await driver.findElement(By.css('.ytp-next-button'));
      await driver.actions({ bridge: true }).move({ origin: nextBtn }).perform();
      await nextBtn.click();
      clicked = true;
      mechanism = 'ytp-next-button';
    } catch (e) {
      notes.push(`${label}: ytp-next-button click failed (${String(e).slice(0, 200)}), falling back to sidebar thumbnail`);
    }

    if (!clicked) {
      // Fallback: sidebar thumbnails are hidden by hideRecommendations CSS; toggle it off briefly
      // only to make the element interactable for the click, then restore it immediately after.
      await setSettings({ hideRecommendations: false });
      await driver.sleep(800);
      const candidates = await driver.findElements(
        By.css(
          '#related ytd-compact-video-renderer a#thumbnail, ytd-watch-next-secondary-results-renderer a#thumbnail, #items ytd-compact-video-renderer a#thumbnail'
        )
      );
      let target = null;
      for (const el of candidates) {
        try {
          const href = await el.getAttribute('href');
          if (href && href.includes('/watch?v=') && !href.includes(beforeVideoId)) {
            target = el;
            break;
          }
        } catch {
          // skip
        }
      }
      if (!target) throw new Error('no clickable related-video thumbnail found');
      await driver.executeScript((el) => el.scrollIntoView({ block: 'center' }), target);
      await driver.sleep(300);
      await target.click();
      clicked = true;
      mechanism = 'sidebar-thumbnail-fallback';
      await setSettings({ hideRecommendations: true });
    }

    await driver.wait(async () => {
      const url = await driver.getCurrentUrl();
      return currentVideoId(url) !== beforeVideoId;
    }, TIMEOUT);
    const markerSurvived = await driver.executeScript(() => window.__ytaNavMarker || null);
    await waitStatus(['active', 'fallback', 'disabled']);
    await driver.sleep(1500);
    const afterUrl = await driver.getCurrentUrl();
    return { mechanism, beforeVideoId, afterVideoId: currentVideoId(afterUrl), markerSurvivedNoFullReload: Boolean(markerSurvived), afterUrl };
  }

  const rearmHistory = [];
  async function checkRearm(label, expectVideoId) {
    const diag = await getDiag();
    const rearmCount = countCode(diag, 'spa.rearm');
    rearmHistory.push({ label, rearmCount });
    const snap = await fullFeatureSnapshot();
    const statusMap = await getBenchStatusMap();
    const matchingEntries = (statusMap?.entries || statusMap || []).filter?.((e) => (e.url || '').includes(expectVideoId)) || [];
    return { rearmCount, snap, matchingStatusMapEntries: matchingEntries.slice(0, 3), rawStatusMapType: typeof statusMap };
  }

  await t2('initial load (baseline)', async () => {
    return checkRearm('initial', videos.regular);
  });

  let lastNavResult;
  const visitedVideoIds = [videos.regular];

  for (let i = 1; i <= 3; i++) {
    await t2(`real click navigation #${i}`, async () => {
      lastNavResult = await realClickNextVideo(`nav-${i}`);
      visitedVideoIds.push(lastNavResult.afterVideoId);
      const rearm = await checkRearm(`after-nav-${i}`, lastNavResult.afterVideoId);
      return { nav: lastNavResult, rearm };
    });
  }

  await t2('browser back navigation (popstate)', async () => {
    const beforeUrl = await driver.getCurrentUrl();
    const beforeVideoId = currentVideoId(beforeUrl);
    await driver.navigate().back();
    await driver.wait(async () => currentVideoId(await driver.getCurrentUrl()) !== beforeVideoId, TIMEOUT);
    await waitStatus(['active', 'fallback', 'disabled']);
    await driver.sleep(1500);
    const afterUrl = await driver.getCurrentUrl();
    const afterVideoId = currentVideoId(afterUrl);
    const rearm = await checkRearm('after-back', afterVideoId);
    return { beforeVideoId, afterVideoId, expectedPrevVideoId: visitedVideoIds[visitedVideoIds.length - 2], rearm };
  });

  await t2('browser forward navigation (popstate)', async () => {
    const beforeUrl = await driver.getCurrentUrl();
    const beforeVideoId = currentVideoId(beforeUrl);
    await driver.navigate().forward();
    await driver.wait(async () => currentVideoId(await driver.getCurrentUrl()) !== beforeVideoId, TIMEOUT);
    await waitStatus(['active', 'fallback', 'disabled']);
    await driver.sleep(1500);
    const afterUrl = await driver.getCurrentUrl();
    const afterVideoId = currentVideoId(afterUrl);
    const rearm = await checkRearm('after-forward', afterVideoId);
    return { beforeVideoId, afterVideoId, expectedVideoId: visitedVideoIds[visitedVideoIds.length - 1], rearm };
  });

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), xpi: XPI, videos, visitedVideoIds, rearmHistory, notes, part1, part2 }, null, 2));
}

main()
  .catch((e) => {
    console.error('FATAL', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (driver) await driver.quit().catch(() => undefined);
  });
