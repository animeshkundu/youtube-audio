/**
 * Spike S1 (partial, logged-out) -- video-type coverage of the ANDROID_VR player fetch.
 *
 * Runs the proven ANDROID_VR /youtubei/v1/player fetch for several video ids of
 * different TYPES and records, per video:
 *   - the hypothesized type vs the ACTUAL playabilityStatus.status
 *   - whether audio adaptiveFormats with DIRECT urls are present (the thing we need)
 *   - serverAbrStreamingUrl presence (SABR-only fallback signal)
 *   - a WEB-client control fetch for the same id, so we can see where ANDROID_VR
 *     succeeds while the native WEB client is gated (classic age-gate bypass).
 *   - credentials:'omit' vs 'same-origin' on the ANDROID_VR fetch.
 *
 * IMPORTANT HONESTY NOTE: the Firefox profile is FRESH/LOGGED-OUT, so 'omit' and
 * 'same-origin' are BOTH cookieless here -- this run cannot test the true logged-in
 * behaviour. The real logged-in test (does sending YouTube cookies with an ANDROID_VR
 * body trigger bot-detection / different gating?) needs a burner account and is OUT OF
 * SCOPE for this automated run. That gap is flagged in the output and the doc.
 *
 * Type labels are HYPOTHESES; the probe reports the real status and flags divergence.
 * Members-only needs a channel membership; no stable public id -- flagged, not tested.
 *
 * Output: JSON on stdout + evidence at dist/spike-S1.json.
 * Config: HEADLESS ("1" default). Video set is fixed below (edit VIDEO_SET to extend).
 */

import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const HEADLESS = process.env.HEADLESS !== '0';

// Hypothesized types. The probe reports the ACTUAL playabilityStatus regardless.
const VIDEO_SET = [
  { id: 'dQw4w9WgXcQ', type: 'normal', note: 'Rick Astley - Never Gonna Give You Up' },
  { id: 'jNQXAC9IVRw', type: 'normal', note: 'Me at the zoo (first YouTube video)' },
  { id: '07FYdnEawAQ', type: 'age-restricted', note: 'Justin Timberlake - Tunnel Vision (historically 18+)' },
  { id: 'XqZsoesa55w', type: 'made-for-kids', note: 'Pinkfong - Baby Shark Dance' },
  { id: 'jfKfPfyJRdk', type: 'live', note: 'Lofi Girl - 24/7 lofi radio live stream' },
];
// Allow override: YT_VIDEO_SET="id:type,id:type"
if (process.env.YT_VIDEO_SET) {
  VIDEO_SET.length = 0;
  for (const pair of process.env.YT_VIDEO_SET.split(',')) {
    const [id, type] = pair.split(':');
    if (id) VIDEO_SET.push({ id: id.trim(), type: (type || 'unknown').trim(), note: 'override' });
  }
}

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
  console.error('[s1]', ...a);
}

async function pageProbe() {
  const videoId = arguments[0];
  const AVR = arguments[1];
  const done = arguments[arguments.length - 1];

  const out = { videoId, ytcfg: {}, web: null, androidVrSameOrigin: null, androidVrOmit: null, error: null };

  try {
    const cfg = window.ytcfg;
    const key = (cfg && cfg.get && cfg.get('INNERTUBE_API_KEY')) || null;
    const baseCtx = (cfg && cfg.get && cfg.get('INNERTUBE_CONTEXT')) || {};
    const webClient = (baseCtx && baseCtx.client) || {};
    const visitorData = webClient.visitorData || (cfg && cfg.get && cfg.get('VISITOR_DATA')) || null;
    const loggedIn = !!(cfg && cfg.get && cfg.get('LOGGED_IN'));
    out.ytcfg = { hasKey: !!key, loggedIn, hasVisitorData: !!visitorData };
    if (!key) { out.error = 'no INNERTUBE_API_KEY'; return done(out); }

    const endpoint = '/youtubei/v1/player?key=' + encodeURIComponent(key) + '&prettyPrint=false';

    async function callPlayer(clientObj, creds) {
      const client = Object.assign({}, clientObj);
      if (visitorData && !client.visitorData) client.visitorData = visitorData;
      const body = { context: { client }, videoId, contentCheckOk: true, racyCheckOk: true };
      let httpStatus = null, json = null, netError = null;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: creds,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        json = await res.json();
      } catch (e) {
        netError = String((e && e.message) || e);
      }
      return { httpStatus, netError, json };
    }

    function summarize(call) {
      const j = (call && call.json) || {};
      const ps = j.playabilityStatus || {};
      const sd = j.streamingData || {};
      const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
      const audio = adaptive.filter((f) => (f.mimeType || '').indexOf('audio/') === 0);
      const audioDirect = audio.filter((f) => !!f.url);
      const vd = j.videoDetails || {};
      return {
        httpStatus: call ? call.httpStatus : null,
        netError: call ? call.netError : null,
        playabilityStatus: ps.status || null,
        playabilityReason: ps.reason || (ps.errorScreen ? 'errorScreen' : null) || null,
        hasStreamingData: !!j.streamingData,
        adaptiveCount: adaptive.length,
        audioFormatCount: audio.length,
        audioWithDirectUrl: audioDirect.length,
        audioWithCipher: audio.filter((f) => !!(f.signatureCipher || f.cipher)).length,
        hasServerAbrStreamingUrl: !!sd.serverAbrStreamingUrl,
        isLive: !!vd.isLive || !!vd.isLiveContent,
        isLiveDvrEnabled: !!vd.isLiveDvrEnabled,
        hlsManifestUrl: !!sd.hlsManifestUrl,
        dashManifestUrl: !!sd.dashManifestUrl,
        lengthSeconds: vd.lengthSeconds || null,
      };
    }

    out.web = summarize(await callPlayer(webClient, 'same-origin'));
    out.androidVrSameOrigin = summarize(await callPlayer(AVR, 'same-origin'));
    out.androidVrOmit = summarize(await callPlayer(AVR, 'omit'));

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
options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
options.setPreference('browser.shell.checkDefaultBrowser', false);

const report = {
  generatedAt: new Date().toISOString(),
  spike: 'S1 video-type coverage (logged-out)',
  firefox: '152 (temporary fresh/logged-out profile)',
  headless: HEADLESS,
  loggedInGap:
    'PROFILE IS LOGGED-OUT: credentials omit vs same-origin are BOTH cookieless here. ' +
    'True logged-in behaviour (cookies + ANDROID_VR body -> possible bot-detection/gating) ' +
    'needs a burner account and is OUT OF SCOPE for this automated run.',
  videos: [],
  notes: [],
};

let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.manage().setTimeouts({ script: 90000 });

  for (const spec of VIDEO_SET) {
    const url = `https://www.youtube.com/watch?v=${spec.id}`;
    log('navigating to', url, '(' + spec.type + ')');
    const entry = { videoId: spec.id, hypothesizedType: spec.type, note: spec.note, url };
    try {
      await driver.get(url);
      const ready = await waitForYtcfg(driver, 25000);
      entry.ytcfgReady = ready;
      if (!ready) {
        entry.error = 'ytcfg not ready within 25s';
        report.videos.push(entry);
        continue;
      }
      const findings = await driver.executeAsyncScript(pageProbe, spec.id, ANDROID_VR);
      Object.assign(entry, findings);
      // flag hypothesis divergence
      entry.androidVrUsable =
        !!(entry.androidVrSameOrigin && entry.androidVrSameOrigin.audioWithDirectUrl > 0);
      entry.omitVsSameOriginDiffers =
        entry.androidVrOmit && entry.androidVrSameOrigin &&
        (entry.androidVrOmit.playabilityStatus !== entry.androidVrSameOrigin.playabilityStatus ||
          entry.androidVrOmit.audioWithDirectUrl !== entry.androidVrSameOrigin.audioWithDirectUrl);
      entry.androidVrBypassesWebGate =
        entry.web && entry.androidVrSameOrigin &&
        entry.web.playabilityStatus !== 'OK' && entry.androidVrSameOrigin.playabilityStatus === 'OK';
    } catch (e) {
      entry.error = String((e && e.message) || e);
    }
    report.videos.push(entry);
    log(
      'video', spec.id, '(' + spec.type + ')',
      '| web=', entry.web && entry.web.playabilityStatus,
      'avr=', entry.androidVrSameOrigin && entry.androidVrSameOrigin.playabilityStatus,
      'audioDirect=', entry.androidVrSameOrigin && entry.androidVrSameOrigin.audioWithDirectUrl,
      'usable=', entry.androidVrUsable
    );
  }
} catch (err) {
  report.notes.push('fatal: ' + String((err && err.stack) || err));
} finally {
  if (driver) {
    try { await driver.quit(); } catch { /* ignore */ }
  }
}

report.membersOnlyNote =
  'Members-only was NOT tested: no stable public id exists (requires channel membership). ' +
  'Flagged as an untested type; expect LOGIN_REQUIRED / membership gate on ANDROID_VR when logged-out.';

// Coverage table verdict.
report.coverage = report.videos.map((e) => ({
  videoId: e.videoId,
  hypothesizedType: e.hypothesizedType,
  actualAndroidVrStatus: e.androidVrSameOrigin ? e.androidVrSameOrigin.playabilityStatus : null,
  webStatus: e.web ? e.web.playabilityStatus : null,
  audioDirectUrls: e.androidVrSameOrigin ? e.androidVrSameOrigin.audioWithDirectUrl : null,
  sabrOnly: e.androidVrSameOrigin ? (e.androidVrSameOrigin.hasServerAbrStreamingUrl && e.androidVrSameOrigin.audioWithDirectUrl === 0) : null,
  usable: e.androidVrUsable || false,
  androidVrBypassesWebGate: e.androidVrBypassesWebGate || false,
  omitVsSameOriginDiffers: e.omitVsSameOriginDiffers || false,
}));

mkdirSync(resolve(repoRoot, 'dist'), { recursive: true });
writeFileSync(resolve(repoRoot, 'dist', 'spike-S1.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
