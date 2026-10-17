#!/usr/bin/env node
/**
 * Per-client InnerTube audit (canary, non-gating).
 *
 * Answers, from the running machine's own network position:
 *   - For each pinned media client (VISIONOS, ANDROID_VR): does the credentialless player request
 *     yield a direct audio URL, and does that URL actually serve bytes (not 403 mid-stream)?
 *
 * Method per video:
 *   1. GET the watch page once and extract the page's own INNERTUBE_API_KEY and VISITOR_DATA
 *      (env overrides: INNERTUBE_API_KEY, VISITOR_DATA).
 *   2. For each persona: POST /youtubei/v1/player with no cookies (Node's fetch never sends any).
 *      The HTTP User-Agent defaults to a desktop Firefox UA with the persona only in the body:
 *      that is what the extension can actually send from page context (a page cannot set the
 *      User-Agent header). Set PROBE_HTTP_UA=persona to mirror yt-dlp instead and compare.
 *   3. Range-GET the best direct audio URL up to min(contentLength, 32 MiB) or 8 MiB when the
 *      length is undeclared; record HTTP status, bytes, and a clean/error verdict.
 *
 * Privacy: signed media URLs are NEVER printed. Only ids, statuses, counts, and byte totals.
 *
 * Usage: node tests/e2e/probe-live-client-audit.mjs [videoId ...]
 * Exit:  0 when every video got at least one clean direct-audio download, 1 otherwise, 2 on setup
 *        failure (e.g. API key extraction failed).
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const WATCH_ORIGIN = 'https://www.youtube.com';
const DEFAULT_VIDEOS = ['dQw4w9WgXcQ', 'kSZddHca0ME'];
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0';
const CAP_BYTES = 32 * 1024 * 1024;
const FLOOR_BYTES = 8 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 20_000;
/** 'browser' (default, extension-like) or 'persona' (yt-dlp-like). */
const HTTP_UA_MODE = process.env.PROBE_HTTP_UA === 'persona' ? 'persona' : 'browser';
const httpUserAgent = (persona) =>
  HTTP_UA_MODE === 'persona' ? persona.client.userAgent : BROWSER_UA;

// Mirrors src/shared/innertube.ts MEDIA_CLIENTS (pinned 2026-10-15). Exported so tests/unit can
// assert the two stay identical; this probe intentionally has no build step.
export const PERSONAS = [
  {
    id: 'visionos',
    client: {
      clientName: 'VISIONOS',
      clientVersion: '1.02',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    id: 'android-vr',
    client: {
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
    },
  },
  {
    id: 'ios',
    client: {
      clientName: 'IOS',
      clientVersion: '21.26.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    id: 'android',
    client: {
      clientName: 'ANDROID',
      clientVersion: '21.26.364',
      osName: 'Android',
      osVersion: '11',
      androidSdkVersion: 30,
      userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    id: 'mweb',
    client: {
      clientName: 'MWEB',
      clientVersion: '2.20260708.05.00',
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    id: 'tvhtml5',
    client: {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      hl: 'en',
      gl: 'US',
    },
  },
];

const videos = process.argv.slice(2).filter(Boolean);
const VIDEO_IDS = videos.length ? videos : DEFAULT_VIDEOS;

function truncate(value, max = 80) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function extractPageConfig(videoId) {
  if (process.env.INNERTUBE_API_KEY) {
    return { apiKey: process.env.INNERTUBE_API_KEY, visitorData: process.env.VISITOR_DATA || null };
  }
  const response = await fetch(`${WATCH_ORIGIN}/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, {
    headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  const html = await response.text();
  const key = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
  const visitorData = /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? null;
  if (!key) {
    const consent = /consent|before you continue/i.test(html.slice(0, 4000));
    throw new Error(
      `INNERTUBE_API_KEY not found in watch page (http ${response.status}, consentPage=${consent}); ` +
        'set INNERTUBE_API_KEY/VISITOR_DATA env vars or run from a residential network'
    );
  }
  return { apiKey: key, visitorData };
}

async function playerRequest({ apiKey, visitorData }, persona, videoId) {
  const client = visitorData ? { ...persona.client, visitorData } : { ...persona.client };
  const response = await fetch(
    `${WATCH_ORIGIN}/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: WATCH_ORIGIN,
        referer: `${WATCH_ORIGIN}/watch?v=${encodeURIComponent(videoId)}`,
        'user-agent': httpUserAgent(persona),
      },
      body: JSON.stringify({
        context: { client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    }
  );
  if (!response.ok) return { httpStatus: response.status, data: null };
  const data = await response.json().catch(() => null);
  return { httpStatus: response.status, data };
}

function bestAudio(formats) {
  let best = null;
  for (const format of formats) {
    if (typeof format?.url !== 'string' || typeof format?.mimeType !== 'string') continue;
    if (!format.mimeType.startsWith('audio/')) continue;
    if (!best || (format.bitrate ?? 0) > (best.bitrate ?? 0)) best = format;
  }
  return best;
}

async function rangedDownload(url, userAgent) {
  const controller = new AbortController();
  let idleTimer = null;
  let idleFired = false;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleFired = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };
  let bytes = 0;
  let declaredLength = null;
  let httpStatus = null;
  let error = null;
  let firstByteMs = null;
  const started = Date.now();
  try {
    armIdle();
    const response = await fetch(url, {
      headers: {
        range: `bytes=0-${CAP_BYTES - 1}`,
        'user-agent': userAgent,
      },
      signal: controller.signal,
    });
    httpStatus = response.status;
    if (response.status === 206) {
      // Only a canonical `bytes 0-N/M` range proves the full file size. Anything else (a `*`
      // total, an offset start) must NOT fall back to this response's own content-length, or a
      // server stubbing a small range would satisfy the floor with far fewer than 8 MiB.
      const range = /^bytes 0-\d+\/(\d+)$/.exec(response.headers.get('content-range') || '');
      declaredLength = range ? Number(range[1]) : null;
    } else {
      const contentLength = Number(response.headers.get('content-length'));
      declaredLength = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      return { httpStatus, bytes, declaredLength, error: `http-${response.status}` };
    }
    // Proof target: a sustained 8 MiB (or the whole file when shorter). The classic mid-stream
    // cutoff historically lands near 1 MiB, so 8 MiB proves real delivery, not a 200/206 stub.
    const target = declaredLength ? Math.min(declaredLength, FLOOR_BYTES) : FLOOR_BYTES;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs === null) firstByteMs = Date.now() - started;
      bytes += value.byteLength;
      if (bytes >= target) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      armIdle();
    }
  } catch (err) {
    error = idleFired ? 'idle-timeout' : truncate(err?.cause?.code || err?.name || err, 60);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
  const target = declaredLength ? Math.min(declaredLength, FLOOR_BYTES) : FLOOR_BYTES;
  const ok = !error && httpStatus === 206 && bytes >= target;
  return {
    httpStatus,
    bytes,
    declaredLength,
    firstByteMs,
    elapsedMs: Date.now() - started,
    error: error ?? (ok ? null : 'short-stream'),
    ok,
  };
}

async function main() {
  console.log(
    `Live client audit: videos=${VIDEO_IDS.join(',')} httpUa=${HTTP_UA_MODE} ` +
      `proofFloor=${FLOOR_BYTES / (1024 * 1024)}MiB rangeCap=${CAP_BYTES / (1024 * 1024)}MiB`
  );
  let setup;
  try {
    setup = await extractPageConfig(VIDEO_IDS[0]);
  } catch (error) {
    console.error(`SETUP FAIL: ${truncate(error?.message || error, 200)}`);
    process.exit(2);
  }
  console.log(
    `Page config: apiKey=${setup.apiKey ? 'yes' : 'no'} visitorData=${setup.visitorData ? 'yes' : 'no'}`
  );

  const perVideo = [];
  for (const videoId of VIDEO_IDS) {
    const rows = [];
    for (const persona of PERSONAS) {
      const result = await playerRequest(setup, persona, videoId).catch((error) => ({
        httpStatus: 0,
        data: null,
        error: truncate(error?.message || error, 60),
      }));
      const data = result.data;
      const status = data?.playabilityStatus?.status ?? 'NO-RESPONSE';
      const reason = data?.playabilityStatus?.reason ? truncate(data.playabilityStatus.reason) : '';
      const adaptive = Array.isArray(data?.streamingData?.adaptiveFormats)
        ? data.streamingData.adaptiveFormats
        : [];
      const audioWithUrl = adaptive.filter(
        (f) => typeof f?.url === 'string' && String(f?.mimeType || '').startsWith('audio/')
      );
      const best = bestAudio(adaptive);
      const download = best?.url ? await rangedDownload(best.url, httpUserAgent(persona)) : null;
      rows.push({
        persona: persona.id,
        httpStatus: result.httpStatus,
        requestError: result.error ?? null,
        status,
        reason,
        formats: adaptive.length,
        audioWithUrl: audioWithUrl.length,
        itag: best?.itag ?? null,
        download,
      });
    }
    perVideo.push({ videoId, rows });
  }

  let allServed = true;
  for (const { videoId, rows } of perVideo) {
    console.log(`\nvideo ${videoId}`);
    for (const row of rows) {
      const download = row.download;
      const downloadText = download
        ? `download=${download.ok ? 'ok' : 'FAIL'} http=${download.httpStatus} bytes=${download.bytes}` +
          (download.declaredLength ? `/${download.declaredLength}` : '') +
          ` ms=${download.elapsedMs} firstByteMs=${download.firstByteMs}` +
          (download.error ? ` err=${download.error}` : '')
        : 'download=none';
      console.log(
        `  ${row.persona.padEnd(11)} http=${row.httpStatus} status=${row.status} ` +
          `formats=${row.formats} audio+url=${row.audioWithUrl} itag=${row.itag ?? '-'} ${downloadText}` +
          (row.requestError ? ` requestError=${row.requestError}` : '') +
          (row.reason ? ` reason="${row.reason}"` : '')
      );
    }
    const served = rows.some((row) => row.download?.ok);
    allServed = allServed && served;
    if (!served) console.log(`  verdict: NO CLIENT SERVED A CLEAN AUDIO DOWNLOAD`);
  }
  console.log(`\nVERDICT: ${allServed ? 'PASS' : 'FAIL'} (every video served by at least one client)`);
  process.exit(allServed ? 0 : 1);
}

// Only run when executed, not when imported by a unit test that pins the persona table against
// src/shared/innertube.ts.
const isDirectRun =
  typeof process.argv[1] === 'string' && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`FAIL: ${truncate(error?.stack || error, 300)}`);
    process.exit(1);
  });
}
