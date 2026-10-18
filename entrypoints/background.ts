import { defineBackground } from 'wxt/utils/define-background';

import {
  assembleAudioMedia,
  isAllowedAudioUrl,
  isSafeDownloadFilename,
} from '../src/shared/download';
import {
  DEFAULT_SETTINGS,
  initializeSettings,
  getSettings,
  setAdBlockEnabled,
  subscribeSettings,
  watchSettings,
  type ExtensionSettings,
} from '../src/shared/config';
import { createResponseBudget, pruneAdsFromPlayerResponse } from '../src/shared/adblock';
import {
  consentBadgeText,
  consentStorageChangeGrants,
  consentStorageKey,
  createConsentStateController,
  DATA_CONSENT_CHANGED_MESSAGE,
  GET_DATA_CONSENT_MESSAGE,
  resolveDataConsent,
  supportsBuiltInDataConsent,
  type DataConsentState,
} from '../src/shared/consent';
import { DOWNLOADS_PERMISSION, SPONSORBLOCK_ORIGIN } from '../src/shared/permissions';
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
  acceptsFrameReport,
  classifyHost,
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
import {
  createTabScopeStore,
  GET_TAB_SCOPE_MESSAGE,
  parseTabScopeSetMessage,
  resolveTabAudioOnly,
  SET_TAB_SCOPE_MESSAGE,
  TAB_SCOPE_CHANGED_MESSAGE,
  type TabAudioOnlyOverride,
} from '../src/shared/tab-scope';
import { withTimeout } from '../src/shared/timers';
import { TEARDOWN_MESSAGE } from '../src/shared/teardown';

declare const __BENCH__: boolean;

// The `toggle-audio-only` commands entry declared in wxt.config.ts (SPEC-012 §5; ADR-0014). Keep the
// two in lockstep; tests/unit/manifest-declaration.test.ts pins the manifest side.
const TOGGLE_AUDIO_ONLY_COMMAND = 'toggle-audio-only';

const YOUTUBE_REQUESTS = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
  ...(__BENCH__ ? ['http://127.0.0.1/*', 'http://localhost/*'] : []),
];
const SPONSORBLOCK_BASE_URL = 'https://sponsor.ajay.app';
const SPONSOR_SEGMENTS_MESSAGE = 'yta:sponsor-segments';
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
/**
 * In-memory per-tab audio-only overrides (SPEC-012 §5; ADR-0014). Never persisted: entries live
 * only as long as their tab (`tabs.onRemoved` prunes) and this background context.
 */
const tabScope = createTabScopeStore();
let dataConsent: DataConsentState = {
  granted: false,
  sponsorBlockAllowed: false,
  source: 'custom',
  pending: false,
};

type OnboardingInstallDetails = Pick<browser.runtime._OnInstalledDetails, 'reason'>;

export function shouldOpenOnboarding(details: OnboardingInstallDetails): boolean {
  return details.reason === 'install' || details.reason === 'update';
}

export async function handleOnboardingInstalled(details: OnboardingInstallDetails): Promise<void> {
  if (!shouldOpenOnboarding(details)) return;
  const [builtInSupported, consent] = await Promise.all([
    supportsBuiltInDataConsent(),
    resolveDataConsent(),
  ]);
  if (builtInSupported || consent.granted) return;
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('/consent.html'), active: true });
  } catch {
    // A failure to show consent never grants it; all transmission remains fail-closed.
  }
}

export function registerOnboardingInstallHandler(): void {
  try {
    browser.runtime.onInstalled.addListener((details) => {
      void handleOnboardingInstalled(details);
    });
  } catch {
    // Keep initialization fail-closed if this runtime event is unavailable.
  }
}

/**
 * Best-effort teardown on unload (SPEC-021): a disabled or updated extension is unloaded before the
 * pages holding it are, so this is the last moment it can ask every tab to take down what it
 * installed (page-world patches, content-side DOM, and any active audio-only hijack). Only a
 * persistent background gets a suspend that means "unloading": an MV3 event page suspends between
 * events while the extension stays live, so MV3 is deliberately excluded and keeps the documented
 * residual. Sends are fire-and-forget; a failed send is a tab that keeps its installed state until
 * it reloads.
 */
export function registerSuspendTeardownHandler(): void {
  try {
    if (!getExtensionPlatform().persistentBackground) return;
    browser.runtime.onSuspend.addListener(() => {
      void browser.tabs
        .query({})
        .then((tabs) =>
          Promise.all(
            tabs.map((tab) =>
              typeof tab.id === 'number'
                ? browser.tabs
                    .sendMessage(tab.id, { type: TEARDOWN_MESSAGE })
                    .catch(() => undefined)
                : undefined
            )
          )
        )
        .catch(() => undefined);
    });
  } catch {
    // Keep initialization fail-closed if this runtime event is unavailable.
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
    const budget = createResponseBudget();
    let settled = false;

    filter.ondata = (event) => {
      if (settled) return;
      const flush = budget.push(new Uint8Array(event.data.slice(0)));
      if (!flush) return;
      // The budget was crossed (a non-positive budget streams from the first chunk): everything
      // held so far is written through verbatim and the rest of the body follows unparsed.
      try {
        for (const chunk of flush) filter.write(chunk);
      } catch {
        settled = true;
        try {
          filter.disconnect();
        } catch {
          // The channel may already be closed; never surface the response-filter failure.
        }
      }
    };
    filter.onstop = () => {
      if (settled) return;
      settled = true;
      if (budget.streaming) {
        // Over budget: the whole body was streamed through as it arrived, unparsed on purpose.
        filter.close();
        return;
      }
      const original = joinChunks(budget.bufferedChunks());
      try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(original);
        const pruned = pruneAdsFromPlayerResponse(json);
        const changed = pruned !== json;
        if (changed) diagnostics?.noteAdPruned();
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
        filter.write(joinChunks(budget.bufferedChunks()));
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
  if (candidate.type !== DOWNLOAD_MESSAGE || !isSafeDownloadFilename(candidate.filename))
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
    url: candidate.url,
    filename: candidate.filename,
    ...(benchOrigin ? { benchOrigin } : {}),
  };
}

/** Granted-optional-permission checks for the double gate (SPEC-013); fail closed. */
async function sponsorPermissionGranted(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [SPONSORBLOCK_ORIGIN] });
  } catch {
    return false;
  }
}

async function downloadsPermissionGranted(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: [DOWNLOADS_PERMISSION] });
  } catch {
    return false;
  }
}

type BadgeAction = { setBadgeText?: (details: { text: string }) => Promise<unknown> | void };

/**
 * Reflects the undecided-consent badge (`!`) on the toolbar action (SPEC-013). Cosmetic and
 * best-effort: a missing action API or a rejection never affects consent behavior.
 */
function syncConsentBadge(consent: DataConsentState): void {
  const candidate = browser as unknown as { action?: BadgeAction; browserAction?: BadgeAction };
  const action = candidate.action ?? candidate.browserAction;
  if (typeof action?.setBadgeText !== 'function') return;
  try {
    void Promise.resolve(action.setBadgeText({ text: consentBadgeText(consent) })).catch(
      () => undefined
    );
  } catch {
    // Ignore: the badge is cosmetic.
  }
}

async function downloadAudio(
  request: NonNullable<ReturnType<typeof parseDownloadRequest>>
): Promise<{ ok: boolean }> {
  if (!(await downloadsPermissionGranted())) return { ok: false };
  let objectUrl: string | null = null;
  try {
    const media = await assembleAudioMedia(
      request.url,
      fetch,
      request.benchOrigin ? { benchOrigin: request.benchOrigin } : {}
    );
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

/**
 * Whether a tab URL belongs to the extension's supported YouTube families. Bench fixture hosts are
 * normalized the same way the telemetry filter normalizes them, so the hermetic bench exercises the
 * real rule instead of a bench-only bypass.
 */
function isSupportedTabUrl(url: string | undefined): boolean {
  try {
    const policyUrl = __BENCH__ && typeof url === 'string' ? asBenchYouTubeUrl(url) : url;
    return classifyHost(policyUrl) !== 'not-youtube';
  } catch {
    return false;
  }
}

/** Push a tab's scope to every frame of that tab; a tab without content scripts is a no-op. */
function notifyTabScope(tabId: number, audioOnly: TabAudioOnlyOverride): void {
  void browser.tabs
    .sendMessage(tabId, { type: TAB_SCOPE_CHANGED_MESSAGE, audioOnly })
    .catch(() => undefined);
}

/** Broadcast the scope to the popup, but only when the changed tab is the active one. */
async function broadcastTabScopeIfActive(
  changedTabId: number,
  audioOnly: TabAudioOnlyOverride
): Promise<void> {
  try {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== 'number' || tab.id !== changedTabId) return;
    void browser.runtime
      .sendMessage({ type: TAB_SCOPE_CHANGED_MESSAGE, audioOnly })
      .catch(() => undefined);
  } catch {
    // Fail open: a broadcast failure must never affect the background or the page.
  }
}

/** Apply a tab-scope override: store it, push to the tab's frames, and refresh an open popup. */
function applyTabScope(tabId: number, audioOnly: TabAudioOnlyOverride): void {
  if (audioOnly === null) tabScope.delete(tabId);
  else tabScope.set(tabId, audioOnly);
  notifyTabScope(tabId, audioOnly);
  void broadcastTabScopeIfActive(tabId, audioOnly);
}

/** Toggle the active tab's audio-only override (the `toggle-audio-only` command path). */
async function toggleActiveTabAudioOnly(): Promise<void> {
  try {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== 'number' || !isSupportedTabUrl(tab.url)) return;
    const current = resolveTabAudioOnly(settings.audioOnlyEnabled, tabScope.get(tab.id));
    applyTabScope(tab.id, !current);
  } catch {
    // Fail open: a shortcut failure must never surface.
  }
}

/** The active tab's override for the popup (`null` when it follows the global preference). */
async function resolveActiveTabScope(): Promise<{ audioOnly: TabAudioOnlyOverride }> {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== 'number') return { audioOnly: null };
  return { audioOnly: tabScope.get(tab.id) };
}

/** Set the active tab's audio-only override; only extension pages reach this path. */
async function setActiveTabAudioOnly(
  audioOnly: boolean
): Promise<{ audioOnly: TabAudioOnlyOverride }> {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== 'number' || !isSupportedTabUrl(tab.url)) {
    return { audioOnly: null };
  }
  applyTabScope(tab.id, audioOnly);
  return { audioOnly };
}

/** Fold a top-frame content-script status report into the per-tab map. Fire-and-forget. */
function handleStatusUpdate(message: unknown, sender: browser.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  // Accept only a genuine top-frame report tagged with a real tab id (sub-frames and extension
  // pages are ignored). Untrusted shapes are dropped by `parseStatusUpdate`.
  if (typeof tabId !== 'number' || !acceptsFrameReport(sender.frameId)) return;
  const update = parseStatusUpdate(message);
  if (!update) return;
  const current = tabStatus.get(tabId);
  const next = reduceStatusUpdate(current, update, Date.now());
  if (next === current) return; // superseded straggler: nothing changed, no broadcast
  tabStatus.set(tabId, next);
  void broadcastIfActive(tabId);
}

/** Install the tab-keyed channel listeners: status staleness and per-tab scope pruning. */
function installTabChannels(): void {
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
    // The per-tab scope dies with its tab (ADR-0014); nothing is persisted to clean up.
    tabScope.delete(tabId);
  });
}

// BENCH-ONLY message type (dead-code-eliminated in production). It reads the REAL per-tab status
// map the production get-status handler reads and never fabricates a status; it lets the hermetic
// bench verify the content->background status channel end-to-end without the browser-action popup
// (whose content DOM the headless harness cannot drive). See tests/e2e/bench/run-bench.mjs.
const BENCH_STATUS_MAP_MESSAGE = 'yta:__bench-status-map';

// BENCH-ONLY message type (dead-code-eliminated in production): set a tab-scope override for an
// explicit tab id so the hermetic bench can drive the REAL apply path without the popup DOM, which
// the headless harness cannot reach (see openBrowserActionPopup in tests/e2e/bench/run-bench.mjs).
const BENCH_SET_TAB_SCOPE_MESSAGE = 'yta:__bench-set-tab-scope';

async function benchStatusMapSnapshot(): Promise<{
  entries: Array<{
    tabId: number;
    url: string | undefined;
    entry: TabStatusEntry;
    resolved: PlaybackUiState;
  }>;
  scopes: Array<{ tabId: number; audioOnly: boolean }>;
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
  return { entries, scopes: tabScope.entries() };
}

export default defineBackground({
  persistent: { firefox: true },
  async main() {
    registerOnboardingInstallHandler();
    registerSuspendTeardownHandler();
    try {
      getExtensionPlatform();
      void loadRescueConfig;
      diagnostics = createDiagnosticsHub(() => getSettings());
      installGlobalErrorCapture('bg.uncaught', (code, data) => diagnostics?.logLocal(code, data));
      // Registered BEFORE the awaits below: a content script that asks for consent while this
      // background is still initializing must get a truthful reply, not a missing receiver it can
      // never retry. `dataConsent` is denied until resolution completes, so an early answer is
      // fail-closed, and `publishConsent()` broadcasts the real state once it is known.
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
          if (type === GET_TAB_SCOPE_MESSAGE) {
            // A content script (any frame) reads its own tab's scope; the popup (no sender tab)
            // reads the active tab's scope.
            const senderTabId = sender.tab?.id;
            if (typeof senderTabId === 'number') {
              return Promise.resolve({ audioOnly: tabScope.get(senderTabId) });
            }
            return withTimeout(resolveActiveTabScope(), GET_STATUS_TIMEOUT_MS, {
              audioOnly: null,
            });
          }
          if (type === SET_TAB_SCOPE_MESSAGE) {
            const scopeSet = parseTabScopeSetMessage(message);
            if (!scopeSet) return undefined;
            // Top-frame only: an embedded player in a subframe (SPEC-015) must never flip the
            // tab's scope. The popup (no sender frame) sets the active tab instead.
            if (sender.frameId !== undefined && sender.frameId !== 0) return undefined;
            const senderTabId = sender.tab?.id;
            if (typeof senderTabId === 'number') {
              // A content script may set only its own tab's scope (the in-player quick control):
              // the target is derived from the sender, never from the payload.
              applyTabScope(senderTabId, scopeSet.audioOnly);
              return Promise.resolve({ audioOnly: scopeSet.audioOnly });
            }
            // The popup (an extension page, no sender tab) sets the active tab; the background
            // resolves that target itself rather than trusting a caller.
            return withTimeout(setActiveTabAudioOnly(scopeSet.audioOnly), GET_STATUS_TIMEOUT_MS, {
              audioOnly: null,
            });
          }
          if (type === GET_DATA_CONSENT_MESSAGE) return Promise.resolve(dataConsent);
          if (__BENCH__ && type === BENCH_STATUS_MAP_MESSAGE) {
            return benchStatusMapSnapshot();
          }
          if (__BENCH__ && type === BENCH_SET_TAB_SCOPE_MESSAGE) {
            const candidate = message as { tabId?: unknown; audioOnly?: unknown };
            if (typeof candidate.tabId !== 'number' || typeof candidate.audioOnly !== 'boolean') {
              return undefined;
            }
            applyTabScope(candidate.tabId, candidate.audioOnly);
            return Promise.resolve({ audioOnly: candidate.audioOnly });
          }
          const sponsorRequest = parseSponsorRequest(message);
          if (sponsorRequest) {
            if (!dataConsent.granted || !dataConsent.sponsorBlockAllowed)
              return Promise.resolve([]);
            // Double gate (SPEC-013): consent alone never authorizes third-party transmission.
            return sponsorPermissionGranted().then((granted) =>
              granted
                ? fetchSponsorSegments(
                    sponsorRequest.videoId,
                    sponsorRequest.categories,
                    sponsorRequest.benchOrigin
                  )
                : []
            );
          }
          const downloadRequest = parseDownloadRequest(message);
          return downloadRequest ? downloadAudio(downloadRequest) : undefined;
        }
      );
      // Registered BEFORE the settings await below, for the same reason as the message listener
      // above: a storage failure must never leave pages without network protection or a status
      // channel. The handlers read `settings` per request and no-op while it is still unset, so
      // early registration cannot act on unloaded values.
      installTabChannels();
      // `commands` is unavailable on Firefox for Android (its manifest entry is ignored there);
      // guard the registration so an unsupported API can never abort the rest of startup.
      browser.commands?.onCommand?.addListener((command) => {
        if (command !== TOGGLE_AUDIO_ONLY_COMMAND) return;
        void toggleActiveTabAudioOnly();
      });
      // Network-filter listeners need the optional `webRequest` + `webRequestBlocking` grants
      // (ADR-0018): registering a blocking listener without the permission throws, so sync
      // registration with the live grants and with runtime grant/revoke events. The handlers read
      // `settings` per request and no-op while it is still unset, so early registration cannot act
      // on unloaded values. BENCH builds declare the permissions as required, so the listeners
      // attach unconditionally there.
      let networkListenersActive = false;
      const syncNetworkListeners = async (): Promise<void> => {
        let granted = __BENCH__;
        if (!granted) {
          try {
            granted = await browser.permissions.contains({
              permissions: ['webRequest', 'webRequestBlocking'],
            });
          } catch {
            granted = false;
          }
        }
        if (granted === networkListenersActive) return;
        networkListenersActive = granted;
        try {
          if (granted) {
            browser.webRequest.onBeforeRequest.addListener(
              blockTelemetry,
              { urls: YOUTUBE_REQUESTS },
              ['blocking']
            );
            browser.webRequest.onBeforeRequest.addListener(filterPlayerResponse, {
              urls: PLAYER_RESPONSE_REQUESTS,
              types: ['xmlhttprequest'],
            });
          } else {
            if (browser.webRequest.onBeforeRequest.hasListener(blockTelemetry)) {
              browser.webRequest.onBeforeRequest.removeListener(blockTelemetry);
            }
            if (browser.webRequest.onBeforeRequest.hasListener(filterPlayerResponse)) {
              browser.webRequest.onBeforeRequest.removeListener(filterPlayerResponse);
            }
          }
        } catch {
          networkListenersActive = false;
        }
      };
      try {
        browser.permissions.onAdded?.addListener(() => void syncNetworkListeners());
        browser.permissions.onRemoved?.addListener((removed) => {
          void syncNetworkListeners();
          // A revoke must never leave the UI claiming blocking that cannot run: turn the setting
          // off, but ONLY when a network-filter grant was actually removed. Revoking an unrelated
          // grant (downloads, SponsorBlock origin) must not kill ad blocking while its listeners
          // are intact. Fail-closed on storage errors.
          try {
            const gone = (removed as { permissions?: unknown })?.permissions;
            const lostNetwork =
              !Array.isArray(gone) ||
              gone.includes('webRequest') ||
              gone.includes('webRequestBlocking');
            if (lostNetwork && getSettings().adBlockEnabled) {
              void setAdBlockEnabled(false).catch(() => undefined);
            }
          } catch {
            // Fail open: the listeners are already re-synced above.
          }
        });
      } catch {
        // Permissions events unavailable: sync once below and rely on startup state.
      }
      void syncNetworkListeners();
      try {
        settings = await initializeSettings();
      } catch (error) {
        // Default settings on a storage failure: the extension must still protect and play.
        diagnostics?.logLocal('error', { where: 'bg.init', ...errorFields(error) });
        settings = { ...DEFAULT_SETTINGS };
      }
      subscribeSettings((nextSettings) => {
        settings = nextSettings;
      });
      watchSettings();
      // Serialises publications so a slow denial broadcast cannot be overtaken by a later grant.
      let publishChain: Promise<unknown> = Promise.resolve();
      const publishConsent = (consent: DataConsentState) => {
        dataConsent = consent;
        syncConsentBadge(consent);
        const message = { type: DATA_CONSENT_CHANGED_MESSAGE, consent };
        publishChain = publishChain
          .then(() => browser.tabs.query({}))
          .then((tabs) =>
            Promise.all(
              tabs.map((tab) =>
                typeof tab.id === 'number'
                  ? browser.tabs.sendMessage(tab.id, message).catch(() => undefined)
                  : Promise.resolve(undefined)
              )
            )
          )
          .catch(() => undefined);
      };
      const consentController = createConsentStateController(resolveDataConsent, publishConsent);
      const reresolveConsent = () => {
        void consentController.resolve();
      };
      // Deny first, then re-resolve, so no request slips through while a revocation-sensitive
      // lookup is in flight. Storage can carry a revocation, so it takes this path too.
      const revokeThenReresolve = () => {
        void consentController.denyThenResolve();
      };
      browser.storage.onChanged.addListener((changes) => {
        const change = changes[consentStorageKey()];
        if (!change) return;
        // A well-formed grant is additive, like permissions.onAdded: resolve it without publishing
        // a transient denial that can reach MAIN world after the granted snapshot. Removal,
        // revocation, and malformed replacements remain deny-first.
        if (consentStorageChangeGrants(change.newValue)) reresolveConsent();
        else revokeThenReresolve();
      });
      // Firefox's add-on manager changes required data permission without writing extension storage.
      browser.permissions.onRemoved?.addListener(revokeThenReresolve);
      // Addition cannot revoke consent: resolve and publish without a synchronous denied snapshot.
      browser.permissions.onAdded?.addListener(reresolveConsent);
      // The initial resolution runs through the same guarded path as every later one, AFTER the
      // change listeners exist. That does two things a bare `await` at startup could not: a
      // revocation landing mid-startup bumps the generation and discards this stale result, and
      // the resolved state is broadcast to any content script that already received the
      // fail-closed default while this background was still initializing.
      reresolveConsent();
    } catch (error) {
      diagnostics?.logLocal('error', { where: 'bg.init', ...errorFields(error) });
      console.error('[YouTube Audio] Background initialization failed', error);
    }
  },
});
