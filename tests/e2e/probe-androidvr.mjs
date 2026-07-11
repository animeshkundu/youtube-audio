/**
 * Architecture probe: can PAGE CONTEXT inside a real youtube.com tab issue an
 * InnerTube /youtubei/v1/player request impersonating the ANDROID_VR client and
 * get back a DIRECTLY-PLAYABLE audio URL?
 *
 * This settles whether "re-fetch player response as ANDROID_VR from page context"
 * is a viable audio-only strategy for the extension, versus being blocked by
 * PoToken / n-scrambling / CORS / User-Agent / login state.
 *
 * Method (per video):
 *   1. Load https://www.youtube.com/watch?v=<id>, wait for window.ytcfg.
 *   2. In page context, read INNERTUBE_API_KEY + INNERTUBE_CONTEXT (+ visitorData).
 *   3. POST /youtubei/v1/player twice with credentials:'same-origin':
 *        CONTROL = page's native WEB client context.
 *        TEST    = context.client overridden to yt-dlp's ANDROID_VR client.
 *      The TEST request iterates a small set of body/header variants until it
 *      yields HTTP 200 + a playabilityStatus, recording which fields were needed.
 *   4. For each response record playabilityStatus, whether streamingData exists,
 *      the AUDIO adaptiveFormats (itag/mimeType/bitrate, direct `url` vs
 *      `signatureCipher`), and serverAbrStreamingUrl presence.
 *   5. DECISIVE playability test (media-element load bypasses fetch/CORS read
 *      limits): for an audio format with a direct `url`, new Audio(url); muted;
 *      play(); wait ~6s; report currentTime / readyState / networkState /
 *      error.code. currentTime > 0 is proof the URL is genuinely playable in the
 *      browser. Done for BOTH the ANDROID_VR url and (if usable) the WEB url.
 *
 * The Firefox profile is a FRESH TEMPORARY (logged-out) profile by default -- a
 * clean, cookie-light test. Set YT_KEEP_PROFILE to note behaviour differences.
 *
 * Output: structured JSON on stdout + an evidence copy at dist/androidvr-probe.json.
 *
 * Config via env:
 *   YT_VIDEOS  comma-separated ids (default: dQw4w9WgXcQ,jNQXAC9IVRw)
 *   HEADLESS   "1" (default) headless, "0" headful
 *   AUDIO_WAIT_MS  media-element observation window (default 6000)
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
const AUDIO_WAIT_MS = Number(process.env.AUDIO_WAIT_MS || 6000);

// Exact yt-dlp ANDROID_VR client (yt_dlp/extractor/youtube/_base.py, master 2026-07).
// NOTE: clientVersion pinned at 1.65.10 on purpose -- yt-dlp warns >1.65 can force
// SABR-only (serverAbrStreamingUrl, no direct urls). INNERTUBE_CONTEXT_CLIENT_NAME = 28.
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
const ANDROID_VR_CLIENT_NAME_ID = '28';

function log(...a) {
  console.error('[probe]', ...a);
}

/**
 * Runs entirely inside the youtube.com page. Returns a plain-JSON findings object.
 * arguments: [videoId, androidVrClient, androidVrClientNameId, audioWaitMs, callback]
 */
async function pageProbe() {
  const videoId = arguments[0];
  const AVR = arguments[1];
  const AVR_ID = arguments[2];
  const AUDIO_WAIT_MS = arguments[3];
  const done = arguments[arguments.length - 1];

  const out = {
    videoId,
    ytcfg: {},
    control: null,
    test: null,
    error: null,
  };

  try {
    const cfg = window.ytcfg;
    const key =
      (cfg && cfg.get && cfg.get('INNERTUBE_API_KEY')) ||
      (cfg && cfg.data_ && cfg.data_.INNERTUBE_API_KEY) ||
      null;
    const baseCtx =
      (cfg && cfg.get && cfg.get('INNERTUBE_CONTEXT')) ||
      (cfg && cfg.data_ && cfg.data_.INNERTUBE_CONTEXT) ||
      {};
    const webClient = (baseCtx && baseCtx.client) || {};
    const visitorData =
      webClient.visitorData ||
      (cfg && cfg.get && cfg.get('VISITOR_DATA')) ||
      (cfg && cfg.data_ && cfg.data_.VISITOR_DATA) ||
      null;
    const loggedIn = !!(cfg && cfg.get && cfg.get('LOGGED_IN'));

    out.ytcfg = {
      hasKey: !!key,
      keyPrefix: key ? key.slice(0, 10) + '...' : null,
      webClientName: webClient.clientName || null,
      webClientVersion: webClient.clientVersion || null,
      hasVisitorData: !!visitorData,
      loggedIn,
    };

    if (!key) {
      out.error = 'no INNERTUBE_API_KEY';
      return done(out);
    }

    const endpoint =
      '/youtubei/v1/player?key=' + encodeURIComponent(key) + '&prettyPrint=false';

    async function callPlayer(clientObj, extraHeaders) {
      const client = Object.assign({}, clientObj);
      if (visitorData && !client.visitorData) client.visitorData = visitorData;
      const body = {
        context: { client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      };
      const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
      let res, json, httpStatus, netError;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        json = await res.json();
      } catch (e) {
        netError = String((e && e.message) || e);
      }
      return { httpStatus, netError, json, sentBody: body, sentHeaders: headers };
    }

    function summarize(call) {
      const j = (call && call.json) || {};
      const ps = j.playabilityStatus || {};
      const sd = j.streamingData || {};
      const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
      const audio = adaptive
        .filter((f) => (f.mimeType || '').indexOf('audio/') === 0)
        .map((f) => ({
          itag: f.itag,
          mimeType: f.mimeType,
          bitrate: f.bitrate,
          hasDirectUrl: !!f.url,
          hasSignatureCipher: !!(f.signatureCipher || f.cipher),
          urlHasN: !!(f.url && /[?&]n=/.test(f.url)),
          approxDurationMs: f.approxDurationMs,
        }));
      return {
        httpStatus: call ? call.httpStatus : null,
        netError: call ? call.netError : null,
        playabilityStatus: ps.status || null,
        playabilityReason: ps.reason || (ps.errorScreen ? 'errorScreen' : null) || null,
        hasStreamingData: !!j.streamingData,
        formatCount: Array.isArray(sd.formats) ? sd.formats.length : 0,
        adaptiveCount: adaptive.length,
        audioFormats: audio,
        audioWithDirectUrl: audio.filter((a) => a.hasDirectUrl).length,
        audioWithCipher: audio.filter((a) => a.hasSignatureCipher).length,
        hasServerAbrStreamingUrl: !!sd.serverAbrStreamingUrl,
        // PoToken hints: web player exposes STS in playabilityStatus/streamingData.
        // A "requires potoken" style gate usually shows as urls present but 403 on load
        // (measured by the media-element test), or SABR-only streamingData.
        drmOrPotHint:
          (ps.status && ps.status !== 'OK' ? 'status=' + ps.status : null) ||
          (sd.serverAbrStreamingUrl && audio.filter((a) => a.hasDirectUrl).length === 0
            ? 'SABR-only (no direct urls)'
            : null),
      };
    }

    // Pick an audio format's direct url for the media-element test (prefer opus/webm, else any).
    function pickAudioUrl(call) {
      const j = (call && call.json) || {};
      const sd = j.streamingData || {};
      const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
      const audio = adaptive.filter(
        (f) => (f.mimeType || '').indexOf('audio/') === 0 && !!f.url
      );
      if (!audio.length) return null;
      // Prefer a mid/low bitrate to load fast.
      audio.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
      const chosen = audio[Math.floor(audio.length / 2)] || audio[0];
      return { url: chosen.url, itag: chosen.itag, mimeType: chosen.mimeType, bitrate: chosen.bitrate };
    }

    // Decisive: load the url in a real <audio> element (cross-origin media loads are
    // allowed; this is NOT subject to fetch-CORS read restrictions).
    async function playTest(picked) {
      if (!picked || !picked.url) return { attempted: false, reason: 'no direct url' };
      const a = new Audio();
      a.muted = true;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      const eventLog = [];
      ['loadedmetadata', 'canplay', 'playing', 'stalled', 'suspend', 'error', 'waiting'].forEach(
        (ev) => a.addEventListener(ev, () => eventLog.push(ev))
      );
      a.src = picked.url;
      let playErr = null;
      try {
        await a.play();
      } catch (e) {
        playErr = String((e && e.message) || e);
      }
      await new Promise((r) => setTimeout(r, AUDIO_WAIT_MS));
      const result = {
        attempted: true,
        itag: picked.itag,
        mimeType: picked.mimeType,
        bitrate: picked.bitrate,
        currentTime: a.currentTime,
        duration: a.duration,
        readyState: a.readyState, // 0..4 (>=2 = has data; 4 = enough)
        networkState: a.networkState, // 3 = NO_SOURCE (load failed)
        errorCode: a.error ? a.error.code : null, // 4 = SRC_NOT_SUPPORTED
        errorMsg: a.error ? a.error.message : null,
        playError: playErr,
        events: eventLog,
        played: a.currentTime > 0, // THE proof
      };
      try {
        a.pause();
        a.src = '';
      } catch (e) {}
      return result;
    }

    // --- CONTROL: native WEB client context ---
    const controlCall = await callPlayer(webClient, {});
    const controlSummary = summarize(controlCall);
    const controlPick = pickAudioUrl(controlCall);
    const controlPlay = await playTest(controlPick);
    out.control = {
      sentClient: webClient,
      summary: controlSummary,
      pickedAudio: controlPick,
      playback: controlPlay,
    };

    // --- TEST: ANDROID_VR, iterating body/header variants until HTTP 200 + playabilityStatus ---
    const variants = [
      { desc: 'body-context-only', client: AVR, headers: {} },
      {
        desc: 'body-context + X-Youtube-Client-Name/Version headers',
        client: AVR,
        headers: {
          'X-Youtube-Client-Name': AVR_ID,
          'X-Youtube-Client-Version': AVR.clientVersion,
        },
      },
      {
        desc: 'body-context + client headers + X-Goog-Visitor-Id',
        client: AVR,
        headers: Object.assign(
          {
            'X-Youtube-Client-Name': AVR_ID,
            'X-Youtube-Client-Version': AVR.clientVersion,
          },
          visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}
        ),
      },
    ];

    let chosenCall = null;
    let chosenVariant = null;
    const variantTrace = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const call = await callPlayer(v.client, v.headers);
      const ok =
        call.httpStatus === 200 &&
        call.json &&
        call.json.playabilityStatus &&
        call.json.playabilityStatus.status;
      variantTrace.push({
        desc: v.desc,
        httpStatus: call.httpStatus,
        netError: call.netError,
        playabilityStatus:
          call.json && call.json.playabilityStatus
            ? call.json.playabilityStatus.status
            : null,
        hasStreamingData: !!(call.json && call.json.streamingData),
      });
      if (ok && !chosenCall) {
        chosenCall = call;
        chosenVariant = v.desc;
      }
      // If we already have streamingData with a direct audio url, stop early.
      if (
        ok &&
        call.json.streamingData &&
        (call.json.streamingData.adaptiveFormats || []).some(
          (f) => (f.mimeType || '').indexOf('audio/') === 0 && f.url
        )
      ) {
        chosenCall = call;
        chosenVariant = v.desc;
        break;
      }
    }
    if (!chosenCall) {
      // fall back to the first variant's call for reporting even if it failed
      chosenCall = await callPlayer(variants[0].client, variants[0].headers);
      chosenVariant = variants[0].desc + ' (fallback, none succeeded)';
    }

    const testSummary = summarize(chosenCall);
    const testPick = pickAudioUrl(chosenCall);
    const testPlay = await playTest(testPick);
    out.test = {
      sentClient: AVR,
      chosenVariant,
      variantTrace,
      requiredFieldsNote:
        variantTrace.length && variantTrace[0].playabilityStatus
          ? 'body-context-only was sufficient to get a playabilityStatus'
          : 'needed extra headers (see chosenVariant)',
      summary: testSummary,
      pickedAudio: testPick,
      playback: testPlay,
    };

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
  firefox: '152 (temporary fresh/logged-out profile)',
  headless: HEADLESS,
  androidVrClient: ANDROID_VR,
  androidVrClientNameId: ANDROID_VR_CLIENT_NAME_ID,
  audioWaitMs: AUDIO_WAIT_MS,
  videos: [],
  notes: [],
};

let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.manage().setTimeouts({ script: 90000 });

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
      log('ytcfg ready, running page probe for', videoId);
      const findings = await driver.executeAsyncScript(
        pageProbe,
        videoId,
        ANDROID_VR,
        ANDROID_VR_CLIENT_NAME_ID,
        AUDIO_WAIT_MS
      );
      Object.assign(entry, findings);
    } catch (e) {
      entry.error = String((e && e.message) || e);
    }
    report.videos.push(entry);
    log(
      'video',
      videoId,
      'control.play=',
      entry.control && entry.control.playback ? entry.control.playback.played : 'n/a',
      'test.play=',
      entry.test && entry.test.playback ? entry.test.playback.played : 'n/a'
    );
  }
} catch (err) {
  report.notes.push('fatal: ' + String((err && err.stack) || err));
} finally {
  if (driver) {
    try {
      await driver.quit();
    } catch {
      /* ignore */
    }
  }
}

// Derive a top-level verdict.
function verdictFor(report) {
  const v = { androidVrReturnsDirectAudioUrl: false, androidVrAudioPlays: false, webAudioPlays: false };
  for (const e of report.videos) {
    if (e.test && e.test.summary && e.test.summary.audioWithDirectUrl > 0)
      v.androidVrReturnsDirectAudioUrl = true;
    if (e.test && e.test.playback && e.test.playback.played) v.androidVrAudioPlays = true;
    if (e.control && e.control.playback && e.control.playback.played) v.webAudioPlays = true;
  }
  v.verdict = v.androidVrAudioPlays
    ? 'ANDROID_VR_PLAYS'
    : v.androidVrReturnsDirectAudioUrl
      ? 'ANDROID_VR_URLS_BUT_NO_PLAYBACK'
      : 'ANDROID_VR_NO_DIRECT_URLS';
  return v;
}
report.verdict = verdictFor(report);

mkdirSync(resolve(repoRoot, 'dist'), { recursive: true });
writeFileSync(resolve(repoRoot, 'dist', 'androidvr-probe.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
process.exit(0);
