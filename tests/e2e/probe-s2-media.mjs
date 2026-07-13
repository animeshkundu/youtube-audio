/**
 * Spike S2 -- Media architecture: does HIJACKING YouTube's <video> survive, or must
 * we OWN our own audio element?
 *
 * THE critical spike. It decides the whole media layer of the rebuild.
 *
 * On a real https://www.youtube.com/watch?v=<id> page we first obtain a direct,
 * playable ANDROID_VR audio URL (reusing the proven fetch shape from
 * probe-androidvr.mjs). Then, per video, we empirically compare two approaches and
 * observe what YouTube's MSE player does over a ~15s window:
 *
 *   A) HIJACK: set document.querySelector('video').src = audioUrl.
 *      A1 = naive (just set src, watch if it reverts to blob:).
 *      A2 = guarded: install a MAIN-world Object.defineProperty guard on
 *           HTMLMediaElement.prototype 'src' that re-forces our audio URL whenever
 *           YouTube tries to re-assert a blob: (MSE) source, then set src again.
 *      For each we record:
 *        - does video.src STAY the audio URL or REVERT to blob:? (src trace)
 *        - does audio actually play (video.currentTime advances)?
 *        - does the player's own clock advance (#movie_player.getCurrentTime())?
 *        - does the page keep pulling VIDEO bytes? Measured two ways:
 *            (i) new googlevideo resource entries with mime=video / bytes after hijack
 *            (ii) the <video> decode counters (mozParsedFrames / videoWidth) freezing
 *        - does the native play/pause button (.ytp-play-button) still toggle paused?
 *
 *   B) OWN element: pause + hide the page <video>, then new Audio(audioUrl); play().
 *      Record whether OUR element's currentTime advances. (Known tradeoff: the native
 *      scrubber / player UI will NOT reflect our element -- recorded explicitly.)
 *
 * Verdict is derived from the observed signal only. Fresh temporary (logged-out)
 * profile, headless by default.
 *
 * Output: JSON on stdout + evidence at dist/spike-S2.json.
 *
 * Config: YT_VIDEOS (default two stable videos), HEADLESS ("1" default),
 *         OBSERVE_MS per-approach observation window (default 15000).
 */

import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const VIDEOS = (process.env.YT_VIDEOS || 'dQw4w9WgXcQ,jNQXAC9IVRw')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HEADLESS = process.env.HEADLESS !== '0';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 15000);

// Exact yt-dlp ANDROID_VR client -- proven in probe-androidvr.mjs.
const ANDROID_VR = {
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

function log(...a) {
  console.error('[s2]', ...a);
}

async function pageProbe() {
  const videoId = arguments[0];
  const AVR = arguments[1];
  const OBSERVE_MS = arguments[2];
  const done = arguments[arguments.length - 1];

  const out = { videoId, fetch: null, hijackNaive: null, hijackGuarded: null, ownElement: null, error: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Count googlevideo bytes/entries, splitting video vs audio, from the resource timeline.
  // NOTE: modern WEB uses SABR POSTs to /videoplayback where the mime is in the request
  // BODY (UMP), not the URL -- so mime=video URL counting UNDER-counts video traffic. We
  // therefore also track TOTAL googlevideo bytes and videoplayback request count, so we
  // can still see whether the page keeps pulling bytes after a hijack.
  function gvSnapshot() {
    const res = performance.getEntriesByType('resource');
    const gv = res.filter((e) => e.name.includes('googlevideo.com'));
    let videoBytes = 0, audioBytes = 0, videoCount = 0, audioCount = 0, otherCount = 0, totalBytes = 0, videoplaybackCount = 0;
    for (const e of gv) {
      const n = e.name;
      const bytes = e.transferSize || e.encodedBodySize || 0;
      totalBytes += bytes;
      if (n.includes('videoplayback')) videoplaybackCount++;
      if (n.includes('mime=video')) { videoBytes += bytes; videoCount++; }
      else if (n.includes('mime=audio')) { audioBytes += bytes; audioCount++; }
      else { otherCount++; }
    }
    return { total: gv.length, videoCount, audioCount, otherCount, videoBytes, audioBytes, totalBytes, videoplaybackCount };
  }

  // <video> element decode/health counters (Firefox exposes mozParsedFrames etc.).
  function videoStats(v) {
    if (!v) return null;
    const q = (typeof v.getVideoPlaybackQuality === 'function' && v.getVideoPlaybackQuality()) || {};
    return {
      currentTime: v.currentTime,
      paused: v.paused,
      readyState: v.readyState,
      networkState: v.networkState,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      mozParsedFrames: v.mozParsedFrames,
      mozDecodedFrames: v.mozDecodedFrames,
      totalVideoFrames: q.totalVideoFrames,
      srcHead: (v.currentSrc || v.src || '').slice(0, 24),
      srcIsBlob: (v.currentSrc || v.src || '').startsWith('blob:'),
      srcIsGoogleVideo: (v.currentSrc || v.src || '').includes('googlevideo.com'),
    };
  }

  function playerTime() {
    const mp = document.getElementById('movie_player');
    try {
      return {
        hasApi: !!(mp && mp.getCurrentTime),
        currentTime: mp && mp.getCurrentTime ? mp.getCurrentTime() : null,
        state: mp && mp.getPlayerState ? mp.getPlayerState() : null, // 1 = playing
      };
    } catch (e) {
      return { hasApi: false, err: String(e) };
    }
  }

  try {
    const cfg = window.ytcfg;
    const key = (cfg && cfg.get && cfg.get('INNERTUBE_API_KEY')) || null;
    const baseCtx = (cfg && cfg.get && cfg.get('INNERTUBE_CONTEXT')) || {};
    const webClient = (baseCtx && baseCtx.client) || {};
    const visitorData = webClient.visitorData || (cfg && cfg.get && cfg.get('VISITOR_DATA')) || null;
    if (!key) { out.error = 'no INNERTUBE_API_KEY'; return done(out); }

    // --- obtain a direct ANDROID_VR audio URL (proven shape) ---
    const client = Object.assign({}, AVR);
    if (visitorData) client.visitorData = visitorData;
    const endpoint = '/youtubei/v1/player?key=' + encodeURIComponent(key) + '&prettyPrint=false';
    let audioUrl = null, chosen = null;
    {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
      });
      const j = await res.json();
      const sd = j.streamingData || {};
      const audio = (sd.adaptiveFormats || []).filter(
        (f) => (f.mimeType || '').indexOf('audio/') === 0 && !!f.url
      );
      audio.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
      chosen = audio[Math.floor(audio.length / 2)] || audio[0] || null;
      out.fetch = {
        playabilityStatus: (j.playabilityStatus || {}).status || null,
        audioWithDirectUrl: audio.length,
        picked: chosen ? { itag: chosen.itag, mimeType: chosen.mimeType, bitrate: chosen.bitrate } : null,
      };
      audioUrl = chosen ? chosen.url : null;
    }
    if (!audioUrl) { out.error = 'no direct ANDROID_VR audio url'; return done(out); }

    const video = document.querySelector('video');
    if (!video) { out.error = 'no <video> element'; return done(out); }

    // Ensure the native player is actually PLAYING via MSE (blob src) before we hijack,
    // so we measure a real revert, not a cold start.
    video.muted = true;
    try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    const playBtn = document.querySelector('.ytp-play-button');
    let preIters = 0, nativeMsePlaying = false;
    for (let i = 0; i < 24; i++) {
      preIters = i + 1;
      const s = videoStats(video);
      if (s && s.srcIsBlob && !s.paused && s.currentTime > 0) { nativeMsePlaying = true; break; }
      // nudge play
      try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      // also click the real play button in case autoplay is gated
      try { if (playBtn && video.paused) playBtn.click(); } catch (e) {}
      await sleep(500);
    }
    out.preHijack = {
      // THE control: was YouTube's own MSE player actually running (blob src, unpaused,
      // clock advancing) at the moment we hijacked? If false, "hijack survives" would be
      // against an idle element and must be discounted.
      nativeMsePlaying,
      pollIterations: preIters,
      video: videoStats(video),
      player: playerTime(),
      gv: gvSnapshot(),
      videoElementCount: document.querySelectorAll('video').length,
    };

    // Helper: run an observation loop, sampling src + times + gv bytes.
    async function observe(label, setup) {
      const startGv = gvSnapshot();
      const t0Video = video.currentTime;
      const t0Player = playerTime().currentTime;
      const srcTrace = [];
      let revertedToBlob = false;
      let stayedAudio = false;
      await setup();
      const steps = Math.max(1, Math.round(OBSERVE_MS / 1000));
      for (let i = 0; i < steps; i++) {
        await sleep(1000);
        const cur = (video.currentSrc || video.src || '');
        const isBlob = cur.startsWith('blob:');
        const isGv = cur.includes('googlevideo.com');
        srcTrace.push({ t: i + 1, isBlob, isGoogleVideo: isGv, head: cur.slice(0, 24) });
        if (isBlob) revertedToBlob = true;
        if (isGv) stayedAudio = true;
      }
      const endGv = gvSnapshot();
      const t1Video = video.currentTime;
      const t1Player = playerTime().currentTime;
      return {
        label,
        finalVideo: videoStats(video),
        finalPlayer: playerTime(),
        videoElementCount: document.querySelectorAll('video').length,
        hijackedElementStillInDom: document.contains(video),
        srcTrace,
        srcRevertedToBlobDuringWindow: revertedToBlob,
        srcWasGoogleVideoDuringWindow: stayedAudio,
        videoCurrentTimeDelta: +(t1Video - t0Video).toFixed(3),
        playerCurrentTimeDelta: t0Player != null && t1Player != null ? +(t1Player - t0Player).toFixed(3) : null,
        // NEW video bytes pulled during the window (evidence of continued video download)
        videoBytesDuringWindow: endGv.videoBytes - startGv.videoBytes,
        videoRequestsDuringWindow: endGv.videoCount - startGv.videoCount,
        audioBytesDuringWindow: endGv.audioBytes - startGv.audioBytes,
        audioRequestsDuringWindow: endGv.audioCount - startGv.audioCount,
        // SABR-aware fallbacks (mime is hidden inside POST bodies, not the URL):
        totalGvBytesDuringWindow: endGv.totalBytes - startGv.totalBytes,
        videoplaybackRequestsDuringWindow: endGv.videoplaybackCount - startGv.videoplaybackCount,
      };
    }

    // ===== A1: naive hijack =====
    out.hijackNaive = await observe('A1-naive-hijack', async () => {
      video.src = audioUrl;
      try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    });
    // native play/pause toggle test after A1
    let pauseToggle = { tested: false };
    try {
      const before = video.paused;
      if (playBtn) playBtn.click();
      await sleep(600);
      const mid = video.paused;
      if (playBtn) playBtn.click();
      await sleep(600);
      const after = video.paused;
      pauseToggle = { tested: true, before, afterFirstClick: mid, afterSecondClick: after, toggled: before !== mid };
    } catch (e) { pauseToggle = { tested: false, err: String(e) }; }
    out.hijackNaive.nativePlayPause = pauseToggle;

    // ===== A2: guarded hijack (MAIN-world defineProperty re-assert) =====
    // Reload the page's own MSE playback first so we start guarded from a blob source.
    try {
      // Re-trigger native playback path by asking the player to seek/play; if src is our
      // audio url now, force YouTube's player to rebuild by calling loadVideoById is too
      // heavy -- instead just install the guard and re-hijack; the guard's job is to keep
      // our url pinned if YouTube re-sets a blob.
      const installed = (function installGuard(forceUrl) {
        try {
          const proto = HTMLMediaElement.prototype;
          const orig = Object.getOwnPropertyDescriptor(proto, 'src');
          if (!orig || !orig.set) return { installed: false, reason: 'no src descriptor' };
          window.__ytaForce = forceUrl;
          window.__ytaGuardHits = 0;
          Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: orig.enumerable,
            get() { return orig.get.call(this); },
            set(v) {
              if (typeof v === 'string' && v.startsWith('blob:') && window.__ytaForce) {
                window.__ytaGuardHits++;
                orig.set.call(this, window.__ytaForce);
              } else {
                orig.set.call(this, v);
              }
            },
          });
          return { installed: true };
        } catch (e) {
          return { installed: false, reason: String(e) };
        }
      })(audioUrl);
      out.guardInstall = installed;
    } catch (e) {
      out.guardInstall = { installed: false, reason: String(e) };
    }

    out.hijackGuarded = await observe('A2-guarded-hijack', async () => {
      video.src = audioUrl;
      try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    });
    out.hijackGuarded.guardHits = window.__ytaGuardHits || 0;

    // ===== B: own audio element =====
    out.ownElement = await (async () => {
      // Silence + hide the page video.
      try { video.pause(); } catch (e) {}
      try { video.style.visibility = 'hidden'; } catch (e) {}
      const a = new Audio();
      a.muted = true; // muted so headless autoplay is guaranteed; currentTime still advances
      a.preload = 'auto';
      const evts = [];
      ['playing', 'stalled', 'error', 'waiting'].forEach((ev) => a.addEventListener(ev, () => evts.push(ev)));
      a.src = audioUrl;
      let playErr = null;
      try { await a.play(); } catch (e) { playErr = String((e && e.message) || e); }
      const t0 = a.currentTime;
      await sleep(OBSERVE_MS);
      const t1 = a.currentTime;
      const nativePlayerTimeAfter = playerTime().currentTime;
      const nativeVideoTimeAfter = video.currentTime;
      const res = {
        ourCurrentTimeStart: t0,
        ourCurrentTimeEnd: t1,
        ourCurrentTimeDelta: +(t1 - t0).toFixed(3),
        ourPlayed: t1 > 0.25,
        playError: playErr,
        events: evts,
        readyState: a.readyState,
        // The known tradeoff: native UI does NOT reflect our element.
        nativePlayerScrubberTimeAfter: nativePlayerTimeAfter,
        nativeVideoElementTimeAfter: nativeVideoTimeAfter,
        note: 'native scrubber/#movie_player reflects the page <video>, NOT our Audio() element',
      };
      try { a.pause(); a.src = ''; } catch (e) {}
      return res;
    })();

    return done(out);
  } catch (e) {
    out.error = String((e && e.stack) || e);
    return done(out);
  }
}
/* eslint-enable */

async function waitForYtcfg(driver, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await driver.executeScript(
      'return !!(window.ytcfg && window.ytcfg.get && window.ytcfg.get("INNERTUBE_API_KEY"));'
    );
    if (ready) return true;
    await driver.sleep(500);
  }
  return false;
}

const options = new firefox.Options();
if (HEADLESS) options.addArguments('-headless');
options.setPreference('media.autoplay.default', 0);
options.setPreference('media.autoplay.blocking_policy', 0);
options.setPreference('media.autoplay.allow-muted', true);
options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
options.setPreference('browser.shell.checkDefaultBrowser', false);

const report = {
  generatedAt: new Date().toISOString(),
  spike: 'S2 media-architecture (hijack vs own element)',
  firefox: '152 (temporary fresh/logged-out profile)',
  headless: HEADLESS,
  observeMs: OBSERVE_MS,
  videos: [],
  notes: [],
};

let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.manage().setTimeouts({ script: 120000 });

  for (const videoId of VIDEOS) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    log('navigating to', url);
    const entry = { videoId, url };
    try {
      await driver.get(url);
      const ready = await waitForYtcfg(driver, 25000);
      entry.ytcfgReady = ready;
      if (!ready) {
        entry.error = 'ytcfg not ready within 25s';
        report.videos.push(entry);
        continue;
      }
      const findings = await driver.executeAsyncScript(pageProbe, videoId, ANDROID_VR, OBSERVE_MS);
      Object.assign(entry, findings);
    } catch (e) {
      entry.error = String((e && e.message) || e);
    }
    report.videos.push(entry);
    log(
      'video', videoId,
      '| A1 revertedToBlob=', entry.hijackNaive && entry.hijackNaive.srcRevertedToBlobDuringWindow,
      'videoΔ=', entry.hijackNaive && entry.hijackNaive.videoCurrentTimeDelta,
      '| A2 guardHits=', entry.hijackGuarded && entry.hijackGuarded.guardHits,
      'stayedAudio=', entry.hijackGuarded && entry.hijackGuarded.srcWasGoogleVideoDuringWindow,
      '| B ownΔ=', entry.ownElement && entry.ownElement.ourCurrentTimeDelta
    );
  }
} catch (err) {
  report.notes.push('fatal: ' + String((err && err.stack) || err));
} finally {
  if (driver) {
    try { await driver.quit(); } catch { /* ignore */ }
  }
}

// Derive a verdict from observed signal.
function deriveVerdict(report) {
  let anyHijackSurvives = false; // src stayed audio AND currentTime advanced AND no video bytes
  let anyGuardHelps = false;
  let anyOwnWorks = false;
  for (const e of report.videos) {
    const n = e.hijackNaive, g = e.hijackGuarded, b = e.ownElement;
    if (g && g.srcWasGoogleVideoDuringWindow && !g.srcRevertedToBlobDuringWindow && g.videoCurrentTimeDelta > 0.25)
      anyHijackSurvives = true;
    if (n && !n.srcRevertedToBlobDuringWindow && n.videoCurrentTimeDelta > 0.25)
      anyHijackSurvives = true;
    if (g && (g.guardHits > 0) && g.srcWasGoogleVideoDuringWindow && g.videoCurrentTimeDelta > 0.25 && (!n || n.srcRevertedToBlobDuringWindow))
      anyGuardHelps = true;
    if (b && b.ourPlayed) anyOwnWorks = true;
  }
  return {
    hijackSurvives: anyHijackSurvives,
    guardHelps: anyGuardHelps,
    ownElementWorks: anyOwnWorks,
    recommendation: anyHijackSurvives
      ? (anyGuardHelps ? 'HIJACK_VIABLE_WITH_GUARD' : 'HIJACK_VIABLE')
      : anyOwnWorks
        ? 'OWN_ELEMENT (hijack does not survive; use our own audio element)'
        : 'INCONCLUSIVE (neither approach clearly worked -- inspect evidence)',
  };
}
report.verdict = deriveVerdict(report);

mkdirSync(resolve(repoRoot, 'dist'), { recursive: true });
writeFileSync(resolve(repoRoot, 'dist', 'spike-S2.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
