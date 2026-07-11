import { defineBackground } from 'wxt/utils/define-background';

import { isAllowedAudioUrl, isSafeDownloadFilename } from '../src/shared/download';
import {
  initializeSettings,
  subscribeSettings,
  watchSettings,
  type ExtensionSettings,
} from '../src/shared/config';
import { pruneAdsFromPlayerResponse } from '../src/shared/adblock';
import { getExtensionPlatform } from '../src/shared/platform';
import { shouldBlock } from '../src/shared/telemetry';
import { loadRescueConfig } from '../src/shared/rescue';
import {
  hashVideoIdPrefix,
  isSponsorCategory,
  selectSegments,
  type SponsorCategory,
  type SponsorSegment,
} from '../src/shared/sponsorblock';

declare const __BENCH__: boolean;

const YOUTUBE_REQUESTS = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
  ...(__BENCH__ ? ['http://127.0.0.1/*', 'http://localhost/*'] : []),
];
const SPONSORBLOCK_BASE_URL = 'https://sponsor.ajay.app';
const SPONSOR_SEGMENTS_MESSAGE = 'yta:sponsor-segments';
const LYRICS_MESSAGE = 'yta:lyrics';
const LRCLIB_BASE_URL = 'https://lrclib.net';
const DOWNLOAD_MESSAGE = 'yta:download-audio';
const PLAYER_RESPONSE_REQUESTS = [
  '*://*.youtube.com/youtubei/v1/player*',
  '*://*.youtube.com/youtubei/v1/next*',
  '*://*.youtube-nocookie.com/youtubei/v1/player*',
  '*://*.youtube-nocookie.com/youtubei/v1/next*',
  ...(__BENCH__
    ? [
        'http://127.0.0.1/youtubei/v1/player*',
        'http://127.0.0.1/youtubei/v1/next*',
        'http://localhost/youtubei/v1/player*',
        'http://localhost/youtubei/v1/next*',
      ]
    : []),
];

let settings: ExtensionSettings;

function asBenchYouTubeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = 'www.youtube.com';
  parsed.port = '';
  parsed.protocol = 'https:';
  return parsed.href;
}

function blockTelemetry(details: browser.webRequest._OnBeforeRequestDetails): browser.webRequest.BlockingResponse {
  try {
    if (!settings.enabled || !settings.ghostEnabled) return {};
    const policyUrl = __BENCH__ ? asBenchYouTubeUrl(details.url) : details.url;
    return shouldBlock(policyUrl, settings.aggressiveTelemetry ? 'aggressive' : 'conservative')
      ? { cancel: true }
      : {};
  } catch {
    return {};
  }
}

function filterPlayerResponse(details: browser.webRequest._OnBeforeRequestDetails): void {
  try {
    if (!settings.enabled || !settings.adBlockEnabled || details.method !== 'POST') return;
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const chunks: Uint8Array[] = [];
    let settled = false;

    filter.ondata = (event) => {
      if (!settled) chunks.push(new Uint8Array(event.data.slice(0)));
    };
    filter.onstop = () => {
      if (settled) return;
      settled = true;
      const original = joinChunks(chunks);
      try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(original);
        const pruned = pruneAdsFromPlayerResponse(json);
        filter.write(pruned === json ? original : new TextEncoder().encode(pruned));
      } catch {
        filter.write(original);
      } finally {
        filter.close();
      }
    };
    filter.onerror = () => {
      if (settled) return;
      settled = true;
      try {
        filter.write(joinChunks(chunks));
      } catch {
        // The channel may already be closed; never surface the response-filter failure.
      }
      try {
        filter.disconnect();
      } catch {
        // Disconnecting an already-closed channel is harmless to the page.
      }
    };
  } catch {
    // Unsupported APIs, invalid request IDs, and setup failures leave the response untouched.
  }
}

async function fetchSponsorSegments(
  videoId: string,
  categories: readonly SponsorCategory[],
  benchOrigin?: string
): Promise<readonly SponsorSegment[]> {
  try {
    const prefix = await hashVideoIdPrefix(videoId);
    const baseUrl = __BENCH__ && benchOrigin ? benchOrigin : SPONSORBLOCK_BASE_URL;
    const response = await fetch(`${baseUrl}/api/skipSegments/${prefix}`, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return [];
    return selectSegments(await response.json(), videoId, categories);
  } catch {
    return [];
  }
}

function parseSponsorRequest(
  value: unknown
): { videoId: string; categories: readonly SponsorCategory[]; benchOrigin?: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as {
    type?: unknown;
    videoId?: unknown;
    categories?: unknown;
    benchOrigin?: unknown;
  };
  if (candidate.type !== SPONSOR_SEGMENTS_MESSAGE) return null;
  if (
    typeof candidate.videoId !== 'string' ||
    !/^[A-Za-z0-9_-]{6,20}$/.test(candidate.videoId) ||
    !Array.isArray(candidate.categories)
  ) {
    return null;
  }
  const categories = candidate.categories.filter(isSponsorCategory);
  if (categories.length !== candidate.categories.length) return null;
  let benchOrigin: string | undefined;
  if (__BENCH__ && typeof candidate.benchOrigin === 'string') {
    try {
      const origin = new URL(candidate.benchOrigin);
      if (
        origin.protocol === 'http:' &&
        (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost')
      ) {
        benchOrigin = origin.origin;
      }
    } catch {
      return null;
    }
  }
  return { videoId: candidate.videoId, categories, ...(benchOrigin ? { benchOrigin } : {}) };
}

function parseLyricsRequest(
  value: unknown
): { title: string; artist: string; duration: number; benchOrigin?: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as {
    type?: unknown;
    title?: unknown;
    artist?: unknown;
    duration?: unknown;
    benchOrigin?: unknown;
  };
  if (
    candidate.type !== LYRICS_MESSAGE ||
    typeof candidate.title !== 'string' ||
    candidate.title.length === 0 ||
    candidate.title.length > 200 ||
    typeof candidate.artist !== 'string' ||
    candidate.artist.length === 0 ||
    candidate.artist.length > 200 ||
    typeof candidate.duration !== 'number' ||
    !Number.isFinite(candidate.duration) ||
    candidate.duration <= 0 ||
    candidate.duration > 86_400
  ) {
    return null;
  }
  let benchOrigin: string | undefined;
  if (__BENCH__ && typeof candidate.benchOrigin === 'string') {
    try {
      const origin = new URL(candidate.benchOrigin);
      if (
        origin.protocol === 'http:' &&
        (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost')
      ) {
        benchOrigin = origin.origin;
      }
    } catch {
      return null;
    }
  }
  return {
    title: candidate.title,
    artist: candidate.artist,
    duration: candidate.duration,
    ...(benchOrigin ? { benchOrigin } : {}),
  };
}

async function fetchLyrics(request: NonNullable<ReturnType<typeof parseLyricsRequest>>): Promise<unknown> {
  try {
    const url = new URL('/api/get', request.benchOrigin ?? LRCLIB_BASE_URL);
    url.searchParams.set('track_name', request.title);
    url.searchParams.set('artist_name', request.artist);
    url.searchParams.set('duration', String(Math.round(request.duration)));
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null) return null;
    const syncedLyrics = (value as { syncedLyrics?: unknown }).syncedLyrics;
    return typeof syncedLyrics === 'string' && syncedLyrics.length <= 200_000
      ? { syncedLyrics }
      : null;
  } catch {
    return null;
  }
}

function parseDownloadRequest(
  value: unknown
): { url: string; filename: string; benchOrigin?: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as {
    type?: unknown;
    url?: unknown;
    filename?: unknown;
    benchOrigin?: unknown;
  };
  if (candidate.type !== DOWNLOAD_MESSAGE || !isSafeDownloadFilename(candidate.filename)) return null;
  let benchOrigin: string | undefined;
  if (__BENCH__ && typeof candidate.benchOrigin === 'string') {
    try {
      const origin = new URL(candidate.benchOrigin);
      if (
        origin.protocol === 'http:' &&
        (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost')
      ) {
        benchOrigin = origin.origin;
      }
    } catch {
      return null;
    }
  }
  if (!isAllowedAudioUrl(candidate.url, benchOrigin)) return null;
  return {
    url: candidate.url,
    filename: candidate.filename,
    ...(benchOrigin ? { benchOrigin } : {}),
  };
}

async function downloadAudio(
  request: NonNullable<ReturnType<typeof parseDownloadRequest>>
): Promise<{ ok: boolean }> {
  try {
    await browser.downloads.download({ url: request.url, filename: request.filename });
    return { ok: true };
  } catch {
    let objectUrl: string | null = null;
    try {
      const response = await fetch(request.url, { credentials: 'omit' });
      if (!response.ok) return { ok: false };
      objectUrl = URL.createObjectURL(await response.blob());
      const downloadId = await browser.downloads.download({
        url: objectUrl,
        filename: request.filename,
      });
      const urlToRevoke = objectUrl;
      const onChanged = (delta: browser.downloads._OnChangedDownloadDelta) => {
        if (delta.id !== downloadId || !delta.state?.current) return;
        browser.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(urlToRevoke);
      };
      browser.downloads.onChanged.addListener(onChanged);
      window.setTimeout(() => {
        browser.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(urlToRevoke);
      }, 60 * 60 * 1_000);
      objectUrl = null;
      return { ok: true };
    } catch {
      return { ok: false };
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
}

function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export default defineBackground({
  persistent: { firefox: true },
  async main() {
    try {
      getExtensionPlatform();
      void loadRescueConfig;
      settings = await initializeSettings();
      subscribeSettings((nextSettings) => {
        settings = nextSettings;
      });
      watchSettings();
      browser.runtime.onMessage.addListener((message: unknown) => {
        const sponsorRequest = parseSponsorRequest(message);
        if (sponsorRequest) {
          return fetchSponsorSegments(
            sponsorRequest.videoId,
            sponsorRequest.categories,
            sponsorRequest.benchOrigin
          );
        }
        const lyricsRequest = parseLyricsRequest(message);
        if (lyricsRequest) return fetchLyrics(lyricsRequest);
        const downloadRequest = parseDownloadRequest(message);
        return downloadRequest ? downloadAudio(downloadRequest) : undefined;
      });
      browser.webRequest.onBeforeRequest.addListener(
        blockTelemetry,
        { urls: YOUTUBE_REQUESTS },
        ['blocking']
      );
      browser.webRequest.onBeforeRequest.addListener(
        filterPlayerResponse,
        { urls: PLAYER_RESPONSE_REQUESTS, types: ['xmlhttprequest'] }
      );
    } catch (error) {
      console.error('[YouTube Audio] Background initialization failed', error);
    }
  },
});
