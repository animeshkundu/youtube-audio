/**
 * Spike S3 -- googlevideo CORS / Web-Audio: can we run in-page Web-Audio (EQ +
 * loudness normalization) on ANDROID_VR media, or does createMediaElementSource
 * taint the graph to SILENCE?
 *
 * Background: an <audio>/<video> element can PLAY a cross-origin URL freely (media
 * loads aren't gated by fetch-CORS). But routing that element through Web-Audio
 * (createMediaElementSource) only produces a readable, processable signal if the
 * media resource is CORS-cleared (crossOrigin='anonymous' AND the server returns
 * Access-Control-Allow-Origin). If it's cross-origin-tainted, the Web-Audio graph
 * outputs SILENCE (all zeros) -- so EQ/loudness would be dead in the page and would
 * have to move to a background/proxy path.
 *
 * Method (per video, in page context):
 *   1. Fetch a direct ANDROID_VR audio URL (proven shape).
 *   2. const a = new Audio(url); a.crossOrigin='anonymous'; a.muted=true; a.play().
 *   3. const ctx = new AudioContext(); src = ctx.createMediaElementSource(a);
 *      analyser = ctx.createAnalyser(); src.connect(analyser); analyser.connect(ctx.destination).
 *   4. Wait ~4s (with resume() for autoplay), then read:
 *        - getByteTimeDomainData: is anything != 128 (the zero midpoint)?
 *        - getFloatFrequencyData: is any bin > -Infinity / above a floor?
 *      Non-zero => audio flows through Web-Audio (EQ/loudness viable in page).
 *      Flatline (all 128 / all -Infinity) => CORS-tainted to silence.
 *   5. Independently: fetch(url, {headers:{Range:'bytes=0-1'}}) two ways --
 *        cors (readable? ACAO header?) and no-cors (opaque) -- and record what the
 *        server actually returns for cross-origin reads.
 *
 * Verdict per video + overall: is in-page Web-Audio viable on ANDROID_VR media?
 *
 * Output: JSON on stdout + evidence at dist/spike-S3.json.
 * Config: YT_VIDEOS, HEADLESS ("1" default), WA_WAIT_MS (default 4000).
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
const WA_WAIT_MS = Number(process.env.WA_WAIT_MS || 4000);

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
  console.error('[s3]', ...a);
}

async function pageProbe() {
  const videoId = arguments[0];
  const AVR = arguments[1];
  const WA_WAIT_MS = arguments[2];
  const done = arguments[arguments.length - 1];

  const out = { videoId, fetch: null, webAudio: null, corsProbe: null, error: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const cfg = window.ytcfg;
    const key = (cfg && cfg.get && cfg.get('INNERTUBE_API_KEY')) || null;
    const baseCtx = (cfg && cfg.get && cfg.get('INNERTUBE_CONTEXT')) || {};
    const webClient = (baseCtx && baseCtx.client) || {};
    const visitorData = webClient.visitorData || (cfg && cfg.get && cfg.get('VISITOR_DATA')) || null;
    if (!key) { out.error = 'no INNERTUBE_API_KEY'; return done(out); }

    const client = Object.assign({}, AVR);
    if (visitorData) client.visitorData = visitorData;
    const endpoint = '/youtubei/v1/player?key=' + encodeURIComponent(key) + '&prettyPrint=false';
    let audioUrl = null;
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
      const chosen = audio[Math.floor(audio.length / 2)] || audio[0] || null;
      out.fetch = {
        playabilityStatus: (j.playabilityStatus || {}).status || null,
        audioWithDirectUrl: audio.length,
        picked: chosen ? { itag: chosen.itag, mimeType: chosen.mimeType, bitrate: chosen.bitrate } : null,
      };
      audioUrl = chosen ? chosen.url : null;
    }
    if (!audioUrl) { out.error = 'no direct ANDROID_VR audio url'; return done(out); }

    // ===== Web-Audio taint test =====
    // Run a crossOrigin x muted MATRIX to disambiguate two independent silence causes:
    //   - CORS TAINT: createMediaElementSource on a cross-origin-tainted resource emits
    //     zeros. Untainted requires crossOrigin='anonymous' AND server ACAO.
    //   - MUTE CONFOUND: a MUTED media element can zero its MediaElementSource tap in some
    //     engines, which would masquerade as taint. We must isolate this before any verdict.
    // Signal read from an AnalyserNode (time-domain deviation from 128 + finite freq bins).
    async function runCondition(label, useCrossOrigin, muted) {
      const a = new Audio();
      if (useCrossOrigin) a.crossOrigin = 'anonymous';
      a.muted = muted;
      a.preload = 'auto';
      const evts = [];
      ['loadedmetadata', 'canplay', 'playing', 'stalled', 'error', 'waiting'].forEach(
        (ev) => a.addEventListener(ev, () => evts.push(ev))
      );
      a.src = audioUrl;

      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      let node, graphError = null;
      try { node = ctx.createMediaElementSource(a); }
      catch (e) { graphError = 'createMediaElementSource: ' + String((e && e.message) || e); }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      if (node) { node.connect(analyser); analyser.connect(ctx.destination); }

      let playErr = null;
      try { await a.play(); } catch (e) { playErr = String((e && e.message) || e); }
      try { if (ctx.state === 'suspended') await ctx.resume(); } catch (e) {}
      await sleep(WA_WAIT_MS);

      const timeBuf = new Uint8Array(analyser.fftSize);
      const freqBuf = new Float32Array(analyser.frequencyBinCount);
      let maxAbsTimeDev = 0, nonSilentTimeSamples = 0, maxFreqDb = -Infinity, finiteFreqBins = 0;
      for (let s = 0; s < 5; s++) {
        analyser.getByteTimeDomainData(timeBuf);
        analyser.getFloatFrequencyData(freqBuf);
        for (let i = 0; i < timeBuf.length; i++) {
          const dev = Math.abs(timeBuf[i] - 128);
          if (dev > maxAbsTimeDev) maxAbsTimeDev = dev;
          if (dev > 1) nonSilentTimeSamples++;
        }
        for (let i = 0; i < freqBuf.length; i++) {
          const v = freqBuf[i];
          if (isFinite(v)) { finiteFreqBins++; if (v > maxFreqDb) maxFreqDb = v; }
        }
        await sleep(150);
      }
      const flowed = maxAbsTimeDev > 1 || (isFinite(maxFreqDb) && maxFreqDb > -140);
      const res = {
        label, useCrossOrigin, muted,
        audioContextState: ctx.state,
        graphError, playError: playErr,
        events: evts,
        elementCurrentTime: +a.currentTime.toFixed(3),
        elementAdvanced: a.currentTime > 0.25,
        elementReadyState: a.readyState,
        errorCode: a.error ? a.error.code : null,
        errorMsg: a.error ? a.error.message : null,
        maxAbsTimeDomainDeviationFrom128: maxAbsTimeDev,
        nonSilentTimeSamples,
        maxFrequencyDb: isFinite(maxFreqDb) ? +maxFreqDb.toFixed(1) : 'none (-Infinity)',
        finiteFreqBins,
        signalFlowed: flowed,
      };
      try { a.pause(); a.src = ''; await ctx.close(); } catch (e) {}
      return res;
    }

    const matrix = [];
    matrix.push(await runCondition('xorigin+muted', true, true));
    matrix.push(await runCondition('xorigin+unmuted', true, false));
    matrix.push(await runCondition('noXorigin+muted', false, true));
    matrix.push(await runCondition('noXorigin+unmuted', false, false));

    // Interpret the matrix.
    const byLabel = Object.fromEntries(matrix.map((m) => [m.label, m]));
    const xoUn = byLabel['xorigin+unmuted'];
    const anyFlowed = matrix.some((m) => m.signalFlowed);
    const mutedZeroed =
      byLabel['xorigin+unmuted'] && byLabel['xorigin+muted'] &&
      byLabel['xorigin+unmuted'].signalFlowed && !byLabel['xorigin+muted'].signalFlowed;
    const corsTainted =
      xoUn && !xoUn.signalFlowed && xoUn.elementAdvanced; // best case (xorigin+unmuted) still silent while playing
    out.webAudio = {
      matrix,
      anyConditionFlowed: anyFlowed,
      mutedConfoundZeroedGraph: !!mutedZeroed,
      corsTaintedToSilence: !!corsTainted,
      interpretation: anyFlowed
        ? (mutedZeroed
            ? 'Signal FLOWS when unmuted; MUTING zeroed the tap (the earlier muted-only reading was a confound). In-page Web-Audio EQ/loudness VIABLE.'
            : 'Web-Audio graph carries a real signal => in-page EQ/loudness VIABLE.')
        : (xoUn && xoUn.elementAdvanced
            ? 'Best-case (crossOrigin=anonymous, unmuted) element PLAYS but graph is SILENT => CORS-tainted. In-page Web-Audio NOT viable.'
            : 'Playback failed in all conditions => inconclusive (cannot attribute silence to taint).'),
    };

    // ===== raw CORS header probe =====
    out.corsProbe = await (async () => {
      const result = { cors: null, noCors: null };
      try {
        const r = await fetch(audioUrl, { method: 'GET', headers: { Range: 'bytes=0-1' }, mode: 'cors' });
        const readableHeaders = {};
        try { for (const [k, v] of r.headers.entries()) readableHeaders[k] = v; } catch (e) {}
        result.cors = {
          ok: r.ok,
          status: r.status,
          type: r.type, // 'cors' if allowed, else this fetch throws
          acao: r.headers.get('access-control-allow-origin'),
          contentType: r.headers.get('content-type'),
          contentRange: r.headers.get('content-range'),
          // Enumerate every header JS is allowed to read on this cross-origin response.
          // If the fetch is type:'cors' + body readable but ACAO reads null, googlevideo is
          // echoing Origin and exposing few headers -- captured here for the record.
          readableHeaders,
          bodyReadable: true,
        };
        try { await r.arrayBuffer(); } catch (e) { result.cors.bodyReadable = false; result.cors.bodyErr = String(e); }
      } catch (e) {
        result.cors = { threw: true, error: String((e && e.message) || e) };
      }
      try {
        const r = await fetch(audioUrl, { method: 'GET', headers: {}, mode: 'no-cors' });
        result.noCors = { type: r.type, status: r.status, note: 'opaque response (headers/body unreadable by design)' };
      } catch (e) {
        result.noCors = { threw: true, error: String((e && e.message) || e) };
      }
      return result;
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
  spike: 'S3 googlevideo CORS / Web-Audio',
  firefox: '152 (temporary fresh/logged-out profile)',
  headless: HEADLESS,
  waWaitMs: WA_WAIT_MS,
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
      const findings = await driver.executeAsyncScript(pageProbe, videoId, ANDROID_VR, WA_WAIT_MS);
      Object.assign(entry, findings);
    } catch (e) {
      entry.error = String((e && e.message) || e);
    }
    report.videos.push(entry);
    log(
      'video', videoId,
      '| anyFlowed=', entry.webAudio && entry.webAudio.anyConditionFlowed,
      'mutedConfound=', entry.webAudio && entry.webAudio.mutedConfoundZeroedGraph,
      'corsTainted=', entry.webAudio && entry.webAudio.corsTaintedToSilence,
      'acao=', entry.corsProbe && entry.corsProbe.cors && entry.corsProbe.cors.acao,
      'corsThrew=', entry.corsProbe && entry.corsProbe.cors && entry.corsProbe.cors.threw
    );
  }
} catch (err) {
  report.notes.push('fatal: ' + String((err && err.stack) || err));
} finally {
  if (driver) {
    try { await driver.quit(); } catch { /* ignore */ }
  }
}

function deriveVerdict(report) {
  let anyFlowed = false, anyTainted = false, anyMutedConfound = false, anyCorsReadable = false;
  for (const e of report.videos) {
    const w = e.webAudio;
    if (w && w.anyConditionFlowed) anyFlowed = true;
    if (w && w.corsTaintedToSilence) anyTainted = true;
    if (w && w.mutedConfoundZeroedGraph) anyMutedConfound = true;
    if (e.corsProbe && e.corsProbe.cors && e.corsProbe.cors.bodyReadable && !e.corsProbe.cors.threw) anyCorsReadable = true;
  }
  return {
    inPageWebAudioViable: anyFlowed,
    taintedToSilence: !anyFlowed && anyTainted,
    mutedConfoundObserved: anyMutedConfound,
    corsGetReadable: anyCorsReadable,
    recommendation: anyFlowed
      ? 'IN_PAGE_WEBAUDIO_VIABLE (EQ + loudness normalization can run in the page)'
      : anyTainted
        ? 'TAINTED_TO_SILENCE (EQ/loudness must move to a background/proxy path; plain playback still fine)'
        : 'INCONCLUSIVE (playback failed; cannot attribute silence to taint)',
  };
}
report.verdict = deriveVerdict(report);

mkdirSync(resolve(repoRoot, 'dist'), { recursive: true });
writeFileSync(resolve(repoRoot, 'dist', 'spike-S3.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
