#!/usr/bin/env node
/**
 * Non-gating, logged-out, real-Firefox live verification for YouTube Audio.
 *
 * This deliberately targets public YouTube and YouTube Music. Results are evidence,
 * not a release gate: remote availability, consent pages, region rules, and YouTube
 * experiments can make individual observations environmental failures.
 *
 * Usage: node tests/e2e/probe-live-features.mjs [path-to-bench-xpi]
 * Env: HEADLESS=0 for a visible browser, LIVE_TIMEOUT_MS to override 45 seconds.
 */
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const TIMEOUT = Number(process.env.LIVE_TIMEOUT_MS || 45_000);
const ADDON_ID = 'youtube-audio@local';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const DEFAULTS = {
  enabled: true,
  audioOnlyEnabled: true,
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
const videos = {
  normal: 'dQw4w9WgXcQ',
  second: 'M7lc1UVf-VE',
  kids: 'XqZsoesa55w',
  live: 'jfKfPfyJRdk',
  ageRestricted: '7E9Ed9DUQoQ',
  unavailable: '___________',
  sponsor: '0e3GPea1Tyg',
};

const report = {
  generatedAt: new Date().toISOString(),
  firefox: null,
  xpi: XPI,
  loggedOutOnly: true,
  videos,
  observations: [],
};

function options() {
  const value = new firefox.Options();
  if (process.env.HEADLESS !== '0') value.addArguments('-headless');
  value.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  value.setPreference('media.autoplay.default', 0);
  value.setPreference('media.autoplay.blocking_policy', 0);
  value.setPreference('media.autoplay.allow-muted', true);
  value.setPreference('datareporting.policy.dataSubmissionEnabled', false);
  value.setPreference('browser.shell.checkDefaultBrowser', false);
  value.setPreference('browser.download.useDownloadDir', true);
  value.setPreference('browser.download.folderList', 2);
  value.setPreference('browser.download.dir', '/tmp/youtube-audio-live-downloads');
  value.setPreference('browser.helperApps.neverAsk.saveToDisk', 'audio/webm,audio/mp4,application/octet-stream');
  return value;
}

async function waitFor(driver, script, timeout = TIMEOUT) {
  return driver.wait(async () => {
    try {
      return (await driver.executeScript(script)) || false;
    } catch {
      return false;
    }
  }, timeout);
}

function pageSnapshot() {
  const video = document.querySelector('video');
  const src = video ? video.currentSrc || video.src || '' : '';
  const button = document.getElementById('yta-audio-only-toggle');
  const download = document.getElementById('yta-download-audio');
  return {
    url: location.href,
    title: document.title,
    loggedIn: Boolean(document.querySelector('ytd-topbar-menu-button-renderer img#img, button[aria-label*="Account"] img')),
    bench: document.documentElement.dataset.ytaBench || null,
    status: document.documentElement.dataset.ytaStatus || null,
    skipArmed: document.documentElement.dataset.ytaSkipArmed || null,
    audioGraph: document.documentElement.dataset.ytaAudioGraph || null,
    lyrics: document.documentElement.dataset.ytaLyrics || null,
    downloadMarker: document.documentElement.dataset.ytaDownload || null,
    video: video ? {
      src: src.slice(0, 240),
      googlevideo: src.includes('googlevideo.com') && src.includes('videoplayback'),
      width: video.videoWidth,
      time: video.currentTime,
      paused: video.paused,
      error: video.error ? video.error.code : null,
    } : null,
    audioToggle: button ? {
      present: true,
      pressed: button.getAttribute('aria-pressed'),
      label: button.getAttribute('aria-label'),
      className: button.className,
    } : { present: false },
    downloadButton: download ? {
      present: true,
      hidden: download.hidden,
      title: download.title,
      disabled: download.disabled,
    } : { present: false },
    unavailableText: document.body.innerText.slice(0, 4000),
  };
}

async function createSession(settings = DEFAULTS) {
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  await driver.installAddon(XPI, true);
  await driver.get(OPTIONS_URL);
  const seed = await driver.executeAsyncScript(function (nextSettings) {
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ settings: nextSettings }).then(() => done(true), (error) => done(String(error)));
  }, settings);
  if (seed !== true) throw new Error(`settings seed failed: ${seed}`);
  return driver;
}

async function watch(driver, videoId, host = 'www.youtube.com') {
  await driver.get(`https://${host}/watch?v=${encodeURIComponent(videoId)}`);
  await waitFor(driver, () => document.documentElement.dataset.ytaBench === '1');
  await driver.wait(until.elementLocated(By.css('body')), TIMEOUT);
  await driver.sleep(3_000);
  return driver.executeScript(pageSnapshot);
}

async function stableSnapshot(driver, videoId, host) {
  await watch(driver, videoId, host);
  try {
    await waitFor(driver, function () {
      const status = document.documentElement.dataset.ytaStatus;
      return ['active', 'fallback', 'disabled'].includes(status) ? status : false;
    });
  } catch {
    // The caller classifies a missing terminal status from the captured page evidence.
  }
  return driver.executeScript(pageSnapshot);
}

async function add(name, fn) {
  let driver;
  const started = Date.now();
  try {
    const result = await fn((value) => { driver = value; });
    report.observations.push({ name, ok: true, elapsedMs: Date.now() - started, result });
  } catch (error) {
    report.observations.push({ name, ok: false, elapsedMs: Date.now() - started, error: String(error?.stack || error) });
  } finally {
    if (driver) await driver.quit().catch(() => undefined);
  }
}

await add('default-happy-telemetry-background-ui', async (own) => {
  const driver = await createSession(); own(driver);
  const initial = await stableSnapshot(driver, videos.normal);
  const probes = await driver.executeAsyncScript(function () {
    const done = arguments[arguments.length - 1];
    let visibilityReceived = false;
    const listener = () => { visibilityReceived = true; };
    document.addEventListener('visibilitychange', listener, true);
    document.dispatchEvent(new Event('visibilitychange'));
    document.removeEventListener('visibilitychange', listener, true);
    Promise.allSettled([
      fetch('/api/stats/qoe?live_e2e=' + Date.now(), { method: 'POST', body: '{}' }),
      fetch('/youtubei/v1/log_event?live_e2e=' + Date.now(), { method: 'POST', body: '{}' }),
    ]).then(([qoe, logEvent]) => done({
      visibilityReceived,
      hidden: document.hidden,
      visibilityState: document.visibilityState,
      qoe: qoe.status,
      logEvent: logEvent.status,
    }));
  });
  return { initial, probes };
});

await add('spa-navigation-rearms-audio-only', async (own) => {
  const driver = await createSession(); own(driver);
  const first = await stableSnapshot(driver, videos.normal);
  await driver.executeScript((id) => {
    const anchor = document.createElement('a');
    anchor.href = `/watch?v=${id}`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
  }, videos.second);
  await driver.wait(async () => (await driver.getCurrentUrl()).includes(videos.second), TIMEOUT);
  await driver.sleep(8_000);
  const second = await driver.executeScript(pageSnapshot);
  return { first, second };
});

await add('audio-background-ghost-off', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, backgroundPlayEnabled: false, ghostEnabled: false }); own(driver);
  const snapshot = await stableSnapshot(driver, videos.normal);
  const probes = await driver.executeAsyncScript(function () {
    const done = arguments[arguments.length - 1];
    let visibilityReceived = false;
    const listener = () => { visibilityReceived = true; };
    document.addEventListener('visibilitychange', listener, true);
    document.dispatchEvent(new Event('visibilitychange'));
    document.removeEventListener('visibilitychange', listener, true);
    fetch('/api/stats/qoe?live_e2e_off=' + Date.now(), { method: 'POST', body: '{}' })
      .then((response) => done({ visibilityReceived, qoe: 'fulfilled', status: response.status }))
      .catch((error) => done({ visibilityReceived, qoe: 'rejected', error: String(error) }));
  });
  return { snapshot, probes };
});

for (const [kind, videoId] of Object.entries({ kids: videos.kids, live: videos.live, ageRestricted: videos.ageRestricted, unavailable: videos.unavailable })) {
  await add(`audio-only-fallback-${kind}`, async (own) => {
    const driver = await createSession(); own(driver);
    return stableSnapshot(driver, videoId);
  });
}

await add('adblock-player-response-on', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false }); own(driver);
  const snapshot = await stableSnapshot(driver, videos.normal);
  const player = await driver.executeAsyncScript(function (id) {
    const done = arguments[arguments.length - 1];
    const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
    const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!key || !context) { done({ ok: false, reason: 'missing-config' }); return; }
    fetch(`/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    }).then((r) => r.json()).then((j) => done({
      ok: true,
      playability: j.playabilityStatus?.status,
      adPlacements: Object.prototype.hasOwnProperty.call(j, 'adPlacements'),
      playerAds: Object.prototype.hasOwnProperty.call(j, 'playerAds'),
      streaming: Boolean(j.streamingData),
    }), (error) => done({ ok: false, error: String(error) }));
  }, videos.normal);
  return { snapshot, player };
});

await add('adblock-player-response-off', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, adBlockEnabled: false }); own(driver);
  await stableSnapshot(driver, videos.normal);
  return driver.executeAsyncScript(function (id) {
    const done = arguments[arguments.length - 1];
    const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
    const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
    fetch(`/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context, videoId: id }),
    }).then((r) => r.json()).then((j) => done({
      ok: true,
      playability: j.playabilityStatus?.status,
      adPlacements: Object.prototype.hasOwnProperty.call(j, 'adPlacements'),
      playerAds: Object.prototype.hasOwnProperty.call(j, 'playerAds'),
      streaming: Boolean(j.streamingData),
    }), (error) => done({ ok: false, error: String(error) }));
  }, videos.normal);
});

await add('segment-skip-real-segments', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false }); own(driver);
  const snapshot = await stableSnapshot(driver, videos.sponsor);
  const seek = await driver.executeAsyncScript(function () {
    const done = arguments[arguments.length - 1];
    const video = document.querySelector('video');
    if (!video) { done({ ok: false, reason: 'no-video' }); return; }
    const started = Date.now();
    video.currentTime = 862;
    video.dispatchEvent(new Event('timeupdate'));
    const poll = () => {
      const currentTime = video.currentTime;
      if (currentTime >= 869.7 || Date.now() - started >= 8_000) {
        done({ currentTime, armed: document.documentElement.dataset.ytaSkipArmed || null, readyState: video.readyState });
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  });
  return { snapshot, seek };
});

await add('segment-skip-no-segments', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false }); own(driver);
  return stableSnapshot(driver, videos.second);
});

await add('segment-skip-off', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, segmentSkipEnabled: false }); own(driver);
  return stableSnapshot(driver, videos.sponsor);
});

await add('quality-and-cosmetics-on', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, forceQualityMax: '1080p', hideShorts: true, hideRecommendations: true, hideComments: true }); own(driver);
  await stableSnapshot(driver, videos.normal);
  return driver.executeScript(function () {
    const hidden = (selector) => {
      const elements = [...document.querySelectorAll(selector)];
      return { count: elements.length, displays: elements.slice(0, 5).map((node) => getComputedStyle(node).display) };
    };
    const player = document.querySelector('#movie_player');
    const video = document.querySelector('video');
    return {
      url: location.href,
      status: document.documentElement.dataset.ytaStatus || null,
      video: video ? { src: (video.currentSrc || video.src || '').slice(0, 240), width: video.videoWidth } : null,
      quality: {
        current: player?.getPlaybackQuality?.() || null,
        available: player?.getAvailableQualityLevels?.() || [],
      },
      shorts: hidden('ytd-reel-shelf-renderer, ytd-rich-section-renderer:has(ytd-reel-shelf-renderer), [is-shorts]'),
      recommendations: hidden('#secondary'),
      comments: hidden('ytd-comments#comments, #comments'),
    };
  });
});

await add('quality-and-cosmetics-off', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false }); own(driver);
  await stableSnapshot(driver, videos.normal);
  return driver.executeScript(function () {
    const state = (selector) => [...document.querySelectorAll(selector)].slice(0, 5).map((node) => getComputedStyle(node).display);
    return { recommendations: state('#secondary'), comments: state('ytd-comments#comments, #comments'), stylePresent: Boolean(document.getElementById('yta-distraction-style')) };
  });
});

await add('youtube-music-loudness-and-lyrics', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, lyricsEnabled: true }); own(driver);
  const snapshot = await stableSnapshot(driver, videos.normal, 'music.youtube.com');
  await driver.sleep(8_000);
  return { ...snapshot, final: await driver.executeScript(pageSnapshot), lyricsElement: await driver.executeScript(() => Boolean(document.getElementById('yta-synced-lyrics'))) };
});

await add('download-on', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, downloadEnabled: true }); own(driver);
  const before = await stableSnapshot(driver, videos.normal);
  await driver.executeScript(() => document.getElementById('yta-download-audio')?.click());
  await driver.sleep(10_000);
  return { before, after: await driver.executeScript(pageSnapshot) };
});

await add('download-off', async (own) => {
  const driver = await createSession({ ...DEFAULTS, audioOnlyEnabled: false, downloadEnabled: false }); own(driver);
  return stableSnapshot(driver, videos.normal);
});

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.observations.some((item) => !item.ok) ? 2 : 0;
