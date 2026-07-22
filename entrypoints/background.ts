import { defineBackground } from 'wxt/utils/define-background';

import {
  assembleAudioMedia,
  isAllowedAudioUrl,
  isDownloadRequestId,
  isSafeDownloadFilename,
} from '../src/shared/download';
import {
  initializeSettings,
  getSettings,
  subscribeSettings,
  watchSettings,
  type ExtensionSettings,
} from '../src/shared/config';
import { pruneAdsFromPlayerResponse } from '../src/shared/adblock';
import {
  createDiagnosticsHub,
  errorFields,
  installGlobalErrorCapture,
  type DiagnosticsHub,
} from '../src/shared/diagnostics';
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
import {
  GET_STATUS_MESSAGE,
  markEntryStale,
  parseStatusUpdate,
  reduceStatusUpdate,
  resolveUiState,
  shouldMarkStale,
  STATUS_CHANGED_MESSAGE,
  STATUS_UPDATE_MESSAGE,
  type PlaybackUiState,
  type TabStatusEntry,
} from '../src/shared/status';

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
let diagnostics: DiagnosticsHub | undefined;

type OnboardingInstallDetails = Pick<browser.runtime._OnInstalledDetails, 'reason'>;

export function shouldOpenOnboarding(details: OnboardingInstallDetails): boolean {
  return details.reason === 'install';
}

export function handleOnboardingInstalled(details: OnboardingInstallDetails): void {
  if (!shouldOpenOnboarding(details)) return;
  try {
    void browser.runtime.openOptionsPage().catch(() => undefined);
  } catch {
    // Onboarding is helpful, but a missing options API must not affect the extension.
  }
}

export function registerOnboardingInstallHandler(): void {
  try {
    browser.runtime.onInstalled.addListener(handleOnboardingInstalled);
  } catch {
    // Keep initialization fail-open if this runtime event is unavailable.
  }
}

function asBenchYouTubeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = 'www.youtube.com';
  parsed.port = '';
  parsed.protocol = 'https:';
  return parsed.href;
}

function blockTelemetry(
  details: browser.webRequest._OnBeforeRequestDetails
): browser.webRequest.BlockingResponse {
  try {
    if (!settings.enabled || !settings.ghostEnabled) return {};
    const policyUrl = __BENCH__ ? asBenchYouTubeUrl(details.url) : details.url;
    if (shouldBlock(policyUrl, settings.aggressiveTelemetry ? 'aggressive' : 'conservative')) {
      diagnostics?.noteTelemetryBlocked();
      return { cancel: true };
    }
    return {};
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
        const changed = pruned !== json;
        if (changed) diagnostics?.noteAdPruned();
        diagnostics?.logLocal('adblock.pruned', { changed });
        filter.write(changed ? new TextEncoder().encode(pruned) : original);
      } catch (error) {
        diagnostics?.logLocal('error', { where: 'bg.adblock', ...errorFields(error) });
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
    if (!response.ok) {
      diagnostics?.logLocal('sponsor.result', { ok: false, count: 0 });
      return [];
    }
    const selected = selectSegments(await response.json(), videoId, categories);
    diagnostics?.logLocal('sponsor.result', { ok: true, count: selected.length });
    return selected;
  } catch (error) {
    diagnostics?.logLocal('error', { where: 'bg.sponsor', ...errorFields(error) });
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

async function fetchLyrics(
  request: NonNullable<ReturnType<typeof parseLyricsRequest>>
): Promise<unknown> {
  const base = request.benchOrigin ?? LRCLIB_BASE_URL;
  const duration = Math.round(request.duration);
  const primary = await lrclibGet(base, request.title, request.artist, duration);
  if (primary) return primary;
  // YouTube Music canonical (Content-ID) tracks report the author as "<Artist> - Topic"; lrclib often
  // files those under the plain artist name, so retry once with the suffix stripped.
  const stripped = request.artist.replace(/\s*-\s*topic\s*$/i, '').trim();
  if (stripped && stripped !== request.artist) {
    return lrclibGet(base, request.title, stripped, duration);
  }
  return null;
}

async function lrclibGet(
  base: string,
  title: string,
  artist: string,
  duration: number
): Promise<{ syncedLyrics: string } | null> {
  try {
    const url = new URL('/api/get', base);
    url.searchParams.set('track_name', title);
    url.searchParams.set('artist_name', artist);
    url.searchParams.set('duration', String(duration));
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
): { requestId: string; url: string; filename: string; benchOrigin?: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as {
    type?: unknown;
    requestId?: unknown;
    url?: unknown;
    filename?: unknown;
    benchOrigin?: unknown;
  };
  if (
    candidate.type !== DOWNLOAD_MESSAGE ||
    !isDownloadRequestId(candidate.requestId) ||
    !isSafeDownloadFilename(candidate.filename)
  )
    return null;
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
    requestId: candidate.requestId,
    url: candidate.url,
    filename: candidate.filename,
    ...(benchOrigin ? { benchOrigin } : {}),
  };
}

async function downloadAudio(
  request: NonNullable<ReturnType<typeof parseDownloadRequest>>,
  tabId: number
): Promise<{ ok: boolean }> {
  let objectUrl: string | null = null;
  try {
    const media = await assembleAudioMedia(request.url, fetch, {
      onProgress: async (loaded, total) => {
        try {
          await browser.tabs.sendMessage(tabId, {
            type: 'yta:download-progress',
            requestId: request.requestId,
            loaded,
            total,
          });
        } catch {
          // The originating tab can close while background assembly is still active.
        }
      },
    });
    objectUrl = URL.createObjectURL(new Blob([media.bytes], { type: media.mimeType }));
    const downloadId = await browser.downloads.download({
      url: objectUrl,
      filename: request.filename,
      saveAs: false,
    });
    const urlToRevoke = objectUrl;
    const onChanged = (delta: browser.downloads._OnChangedDownloadDelta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      browser.downloads.onChanged.removeListener(onChanged);
      URL.revokeObjectURL(urlToRevoke);
    };
    browser.downloads.onChanged.addListener(onChanged);
    window.setTimeout(
      () => {
        browser.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(urlToRevoke);
      },
      60 * 60 * 1_000
    );
    objectUrl = null;
    diagnostics?.logLocal('download.assembled', { ok: true });
    return { ok: true };
  } catch (error) {
    diagnostics?.logLocal('download.assembled', { ok: false });
    diagnostics?.logLocal('error', { where: 'bg.download', ...errorFields(error) });
    return { ok: false };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
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

// --- Playback-status channel ------------------------------------------------
// The honest per-tab playback status, keyed by tab id, fed by the content script's
// `yta:status-update` relay of what the page world actually did on this video. The popup reads a
// tab's resolved state via `yta:get-status`; the background pushes `yta:status-changed` when the
// active tab's state changes so an open popup re-renders. Multi-tab is isolated by the map key;
// SPA-staleness and injection races are handled by the update reducer + the navigation clear below.
const tabStatus = new Map<number, TabStatusEntry>();
// Bounded so a slow tab query can never hang the popup waiting on a status answer.
const GET_STATUS_TIMEOUT_MS = 1_000;

function messageType(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const { type } = message as { type?: unknown };
  return typeof type === 'string' ? type : undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

async function getActiveTab(): Promise<browser.tabs.Tab | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveActiveUiState(): Promise<PlaybackUiState> {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== 'number') return { kind: 'not-youtube' };
  return resolveUiState(tab.url, tabStatus.get(tab.id));
}

function broadcastUiState(state: PlaybackUiState): void {
  // A closed popup has no receiver; swallow the resulting rejection so a broadcast never surfaces.
  void browser.runtime.sendMessage({ type: STATUS_CHANGED_MESSAGE, state }).catch(() => undefined);
}

/** Broadcast the resolved active-tab state, but only when the change is on the active tab. */
async function broadcastIfActive(changedTabId: number): Promise<void> {
  try {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== 'number' || tab.id !== changedTabId) return;
    broadcastUiState(resolveUiState(tab.url, tabStatus.get(tab.id)));
  } catch {
    // Fail open: a broadcast failure must never affect the background or the page.
  }
}

/** Fold a top-frame content-script status report into the per-tab map. Fire-and-forget. */
function handleStatusUpdate(message: unknown, sender: browser.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  // Accept only a genuine top-frame report tagged with a real tab id (sub-frames and extension
  // pages are ignored). Untrusted shapes are dropped by `parseStatusUpdate`.
  if (typeof tabId !== 'number' || sender.frameId !== 0) return;
  const update = parseStatusUpdate(message);
  if (!update) return;
  const current = tabStatus.get(tabId);
  const next = reduceStatusUpdate(current, update, Date.now());
  if (next === current) return; // superseded straggler: nothing changed, no broadcast
  tabStatus.set(tabId, next);
  void broadcastIfActive(tabId);
}

function installStatusChannel(): void {
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // A document reload (status 'loading', fires even when the url is unchanged) or a navigation to a
    // DIFFERENT video means the stored status describes the previous document — mark it stale so the
    // resolver falls back to `connecting` until fresh content reports. A same-video url rewrite
    // (YouTube appending &t=/list params during playback, or the content script already reporting the
    // new video before this event) is NOT stale: marking it so would reject the same operation's own
    // `active` report and strand the popup on `connecting`. See shouldMarkStale.
    if (typeof changeInfo.url !== 'string' && changeInfo.status !== 'loading') return;
    const current = tabStatus.get(tabId);
    if (current && current.stale !== true && shouldMarkStale(current, changeInfo)) {
      tabStatus.set(tabId, markEntryStale(current));
    }
    void broadcastIfActive(tabId);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    tabStatus.delete(tabId);
  });
}

// BENCH-ONLY message type (dead-code-eliminated in production). It reads the REAL per-tab status
// map the production get-status handler reads and never fabricates a status; it lets the hermetic
// bench verify the content->background status channel end-to-end without the browser-action popup
// (whose content DOM the headless harness cannot drive). See tests/e2e/bench/run-bench.mjs.
const BENCH_STATUS_MAP_MESSAGE = 'yta:__bench-status-map';

async function benchStatusMapSnapshot(): Promise<{
  entries: Array<{
    tabId: number;
    url: string | undefined;
    entry: TabStatusEntry;
    resolved: PlaybackUiState;
  }>;
}> {
  const entries = [];
  for (const [tabId, entry] of tabStatus) {
    let url: string | undefined;
    try {
      url = (await browser.tabs.get(tabId)).url;
    } catch {
      url = undefined;
    }
    entries.push({ tabId, url, entry, resolved: resolveUiState(url, entry) });
  }
  return { entries };
}

export default defineBackground({
  persistent: { firefox: true },
  async main() {
    registerOnboardingInstallHandler();
    try {
      getExtensionPlatform();
      void loadRescueConfig;
      diagnostics = createDiagnosticsHub(() => getSettings());
      installGlobalErrorCapture('bg.uncaught', (code, data) => diagnostics?.logLocal(code, data));
      settings = await initializeSettings();
      subscribeSettings((nextSettings) => {
        settings = nextSettings;
      });
      watchSettings();
      browser.runtime.onMessage.addListener(
        (message: unknown, sender: browser.runtime.MessageSender) => {
          const diagnosticsResponse = diagnostics?.handleMessage(message);
          if (diagnosticsResponse) return diagnosticsResponse;
          const type = messageType(message);
          if (type === STATUS_UPDATE_MESSAGE) {
            handleStatusUpdate(message, sender);
            return undefined;
          }
          if (type === GET_STATUS_MESSAGE) {
            return withTimeout(resolveActiveUiState(), GET_STATUS_TIMEOUT_MS, {
              kind: 'connecting',
            });
          }
          if (__BENCH__ && type === BENCH_STATUS_MAP_MESSAGE) {
            return benchStatusMapSnapshot();
          }
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
          const tabId = sender.tab?.id;
          return downloadRequest && typeof tabId === 'number'
            ? downloadAudio(downloadRequest, tabId)
            : undefined;
        }
      );
      installStatusChannel();
      browser.webRequest.onBeforeRequest.addListener(blockTelemetry, { urls: YOUTUBE_REQUESTS }, [
        'blocking',
      ]);
      browser.webRequest.onBeforeRequest.addListener(filterPlayerResponse, {
        urls: PLAYER_RESPONSE_REQUESTS,
        types: ['xmlhttprequest'],
      });
    } catch (error) {
      diagnostics?.logLocal('error', { where: 'bg.init', ...errorFields(error) });
      console.error('[YouTube Audio] Background initialization failed', error);
    }
  },
});
