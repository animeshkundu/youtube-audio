import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';

import {
  getSettings,
  initializeSettings,
  setAudioOnlyEnabled,
  subscribeSettings,
  watchSettings,
} from '../src/shared/config';
import {
  errorFields,
  installDiagnosticsRelay,
  installGlobalErrorCapture,
  logFromContent,
} from '../src/shared/diagnostics';
import { isAllowedAudioUrl, isSafeDownloadFilename } from '../src/shared/download';
import { parseLrc, type LyricLine } from '../src/shared/lyrics';
import { buildDistractionStyles } from '../src/shared/quality-of-life';
import { isSponsorCategory } from '../src/shared/sponsorblock';
import { parseVideoId, STATUS_UPDATE_MESSAGE } from '../src/shared/status';

// Compile-time flag injected by wxt.config.ts (vite `define`). `false` in production
// builds, so the marker below is dead-code-eliminated and never runs on real YouTube.
declare const __BENCH__: boolean;

const MATCHES = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
];
const SETTINGS_EVENT = 'yta:settings';
const STATUS_EVENT = 'yta:status';
const SPONSOR_REQUEST_EVENT = 'yta:sponsor-request';
const SPONSOR_RESPONSE_EVENT = 'yta:sponsor-response';
const SPONSOR_SEGMENTS_MESSAGE = 'yta:sponsor-segments';
const TRACK_EVENT = 'yta:track';
const LYRICS_MESSAGE = 'yta:lyrics';
const DOWNLOAD_REQUEST_EVENT = 'yta:download-request';
const DOWNLOAD_RESPONSE_EVENT = 'yta:download-response';
const DOWNLOAD_MESSAGE = 'yta:download-audio';
const SEGMENT_SKIPPED_EVENT = 'yta:segment-skipped';
const BUTTON_ID = 'yta-audio-only-toggle';
const LEGACY_SEGMENT_BUTTON_ID = 'yta-segment-status';
const DOWNLOAD_BUTTON_ID = 'yta-download-audio';
const PLAYER_STATUS_ID = 'yta-player-status';
const COACH_ID = 'yta-audio-only-coach';
const COACH_STORAGE_KEY = 'seenAudioOnlyCoach';
const LYRICS_ID = 'yta-synced-lyrics';
const DISTRACTION_STYLE_ID = 'yta-distraction-style';
const PLAYER_CONTROL_STYLE_ID = 'yta-player-control-style';
let lyricsCleanup: () => void = () => undefined;
let coachRequest: Promise<void> | null = null;
let coachSeenThisPage = false;
let coachCleanup: () => void = () => undefined;
// This content script's lifetime start. A full page load starts a fresh content script with a
// strictly-later `runStart`, so the background prefers the newer document's report even though the
// per-lifetime `statusGeneration` below resets to 0. Together they order every status the popup sees.
const statusRunStart = Date.now();
// Monotonic per-lifetime navigation epoch, bumped when a YouTube SPA navigation starts, so a status
// still in flight from the previous video (same lifetime) cannot clobber the next one.
let statusGeneration = 0;

export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_start',
  async main() {
    if (__BENCH__) {
      // Observable proof that the content script ran, used only by the integration bench.
      document.documentElement.dataset.ytaBench = '1';
    }

    try {
      const bridgeNonce = crypto.randomUUID();
      installDiagnosticsRelay(bridgeNonce);
      installGlobalErrorCapture('content.uncaught', logFromContent);
      await initializeSettings();
      watchSettings();
      subscribeSettings((settings) => {
        window.postMessage(
          { channel: SETTINGS_EVENT, nonce: bridgeNonce, settings },
          location.origin
        );
        updateToggle(settings.enabled && settings.audioOnlyEnabled);
        updateDownloadButton(settings.enabled && settings.downloadEnabled);
        updateDistractionStyle(settings);
        if (!settings.enabled || !settings.lyricsEnabled) removeLyrics();
      });
      document.addEventListener(STATUS_EVENT, updateStatusMarker);
      // A YouTube SPA navigation opens a new epoch: a status still in flight from the previous video
      // must not clobber the next one. Bumping here (before the page world re-arms) tags the next
      // report with a fresh generation the background uses to order updates.
      document.addEventListener('yt-navigate-start', bumpStatusGeneration);
      document.addEventListener(SPONSOR_REQUEST_EVENT, (event) => {
        void handleSponsorRequest(event, bridgeNonce);
      });
      document.addEventListener(TRACK_EVENT, (event) => {
        void handleTrack(event);
      });
      // Hand the per-load nonce to the MAIN-world script, which reads and clears it on load.
      document.documentElement.dataset.ytaBridge = bridgeNonce;
      await injectScript('/main-world.js');
      window.postMessage(
        { channel: SETTINGS_EVENT, nonce: bridgeNonce, settings: getSettings() },
        location.origin
      );
      installPlayerControls(bridgeNonce);
    } catch (error) {
      logFromContent('error', { where: 'content.init', ...errorFields(error) });
      console.error('[YouTube Audio] Content initialization failed', error);
    }
  },
});

async function handleTrack(event: Event): Promise<void> {
  if (!getSettings().enabled || !getSettings().lyricsEnabled) return;
  if (location.hostname !== 'music.youtube.com' && !__BENCH__) return;
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'string') return;
  let candidate: {
    videoId?: unknown;
    title?: unknown;
    artist?: unknown;
    duration?: unknown;
  };
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== 'object' || parsed === null) return;
    candidate = parsed;
  } catch {
    return;
  }
  if (
    typeof candidate.videoId !== 'string' ||
    !/^[A-Za-z0-9_-]{6,20}$/.test(candidate.videoId) ||
    typeof candidate.title !== 'string' ||
    candidate.title.length === 0 ||
    candidate.title.length > 200 ||
    typeof candidate.artist !== 'string' ||
    candidate.artist.length === 0 ||
    candidate.artist.length > 200 ||
    typeof candidate.duration !== 'number' ||
    !Number.isFinite(candidate.duration) ||
    candidate.duration <= 0
  ) {
    return;
  }
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: LYRICS_MESSAGE,
      title: candidate.title,
      artist: candidate.artist,
      duration: candidate.duration,
      ...(__BENCH__ ? { benchOrigin: location.origin } : {}),
    });
    if (!getSettings().enabled || !getSettings().lyricsEnabled) return;
    if (typeof response !== 'object' || response === null) return;
    const syncedLyrics = (response as { syncedLyrics?: unknown }).syncedLyrics;
    if (typeof syncedLyrics !== 'string' || syncedLyrics.length > 200_000) return;
    renderLyrics(parseLrc(syncedLyrics), candidate.videoId);
  } catch {
    removeLyrics();
  }
}

function renderLyrics(lines: readonly LyricLine[], videoId: string): void {
  removeLyrics();
  if (lines.length === 0) return;
  const container = document.createElement('section');
  container.id = LYRICS_ID;
  container.setAttribute('aria-label', 'Synced lyrics');
  container.style.cssText =
    'position:fixed;right:16px;bottom:72px;z-index:2147483646;max-width:min(420px,calc(100vw - 32px));max-height:40vh;overflow:auto;padding:12px 16px;border-radius:12px;background:rgba(15,15,15,.9);color:#fff;font:16px/1.5 system-ui,sans-serif;';
  const elements = lines.map((line) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line.text;
    paragraph.style.cssText = 'margin:4px 0;opacity:.55;';
    container.append(paragraph);
    return paragraph;
  });
  const video = document.querySelector<HTMLMediaElement>('video');
  if (!video) return;
  let activeIndex = -1;
  const sync = () => {
    let nextIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if ((lines[index]?.time ?? Number.POSITIVE_INFINITY) <= video.currentTime) nextIndex = index;
      else break;
    }
    if (nextIndex === activeIndex) return;
    if (activeIndex >= 0) elements[activeIndex]?.style.setProperty('opacity', '.55');
    activeIndex = nextIndex;
    if (activeIndex >= 0) {
      elements[activeIndex]?.style.setProperty('opacity', '1');
      elements[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  };
  video.addEventListener('timeupdate', sync);
  lyricsCleanup = () => video.removeEventListener('timeupdate', sync);
  container.dataset.videoId = videoId;
  document.body.append(container);
  if (__BENCH__) document.documentElement.dataset.ytaLyrics = String(lines.length);
  sync();
}

function removeLyrics(): void {
  lyricsCleanup();
  lyricsCleanup = () => undefined;
  document.getElementById(LYRICS_ID)?.remove();
  if (__BENCH__) delete document.documentElement.dataset.ytaLyrics;
}

async function handleSponsorRequest(event: Event, bridgeNonce: string): Promise<void> {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) return;
  const candidate = detail as {
    nonce?: unknown;
    requestId?: unknown;
    videoId?: unknown;
    categories?: unknown;
  };
  if (
    candidate.nonce !== bridgeNonce ||
    typeof candidate.requestId !== 'string' ||
    candidate.requestId.length > 64 ||
    typeof candidate.videoId !== 'string' ||
    !/^[A-Za-z0-9_-]{6,20}$/.test(candidate.videoId) ||
    !Array.isArray(candidate.categories) ||
    !candidate.categories.every(isSponsorCategory)
  ) {
    return;
  }

  let segments: unknown = [];
  try {
    segments = await browser.runtime.sendMessage({
      type: SPONSOR_SEGMENTS_MESSAGE,
      videoId: candidate.videoId,
      categories: candidate.categories,
      ...(__BENCH__ ? { benchOrigin: location.origin } : {}),
    });
  } catch {
    // An unavailable background context disables skipping without affecting playback.
  }
  document.dispatchEvent(
    new CustomEvent(SPONSOR_RESPONSE_EVENT, {
      // Firefox does not expose non-string CustomEvent detail from an isolated world to MAIN.
      detail: JSON.stringify({ nonce: bridgeNonce, requestId: candidate.requestId, segments }),
    })
  );
}

function updateDistractionStyle(settings: ReturnType<typeof getSettings>): void {
  try {
    const css = buildDistractionStyles(settings);
    let style = document.getElementById(DISTRACTION_STYLE_ID);
    if (!css) {
      style?.remove();
      return;
    }
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.id = DISTRACTION_STYLE_ID;
      (document.head ?? document.documentElement).append(style);
    }
    style.textContent = css;
  } catch {
    document.getElementById(DISTRACTION_STYLE_ID)?.remove();
  }
}

interface InPlayerMountOptions {
  playerRoot: ParentNode;
  audioOnlyActive: boolean;
  downloadVisible: boolean;
  mobile?: boolean;
  onAudioOnlyToggle?: (button: HTMLButtonElement) => void;
  onDownload?: (button: HTMLButtonElement) => void;
}

export interface InPlayerMountResult {
  audioOnlyButton: HTMLButtonElement;
  downloadButton: HTMLButtonElement;
  statusRegion: HTMLElement;
}

/**
 * Reconciles extension-owned controls into one physical player root. The helper is deliberately
 * synchronous and storage-free so repeated YouTube mutation batches can call it safely.
 */
export function reconcileInPlayerControls(
  options: InPlayerMountOptions
): InPlayerMountResult | null {
  const { playerRoot } = options;
  const documentRef =
    playerRoot instanceof Document ? playerRoot : ((playerRoot as Node).ownerDocument ?? document);
  const isMobile = options.mobile ?? documentRef.location.hostname === 'm.youtube.com';

  let controls: HTMLElement | null;
  let gear: Element | null = null;
  if (isMobile) {
    // Real-Fenix confirmation is still required for this selector set. The owner-gated device lane
    // must snapshot current portrait, landscape, and fullscreen mobile control DOM before it is
    // treated as stable.
    const mobileBar = playerRoot.querySelector<HTMLElement>(
      '.player-controls-bottom, .player-controls-bottom-container'
    );
    controls =
      mobileBar?.querySelector<HTMLElement>(
        '.player-controls-right, .player-controls-bottom-right, .player-controls-content'
      ) ?? mobileBar;
  } else {
    controls = playerRoot.querySelector<HTMLElement>('.ytp-right-controls');
    gear = controls?.querySelector('.ytp-settings-button') ?? null;
  }
  if (!controls) return null;

  for (const legacy of documentRef.querySelectorAll(`#${LEGACY_SEGMENT_BUTTON_ID}`))
    legacy.remove();

  const audioOnlyButton = getOrCreatePlayerButton(
    documentRef,
    BUTTON_ID,
    'Toggle audio-only playback',
    AUDIO_ONLY_ICON_PATH
  );
  if (isMobile) audioOnlyButton.classList.add('yta-player-button--mobile');
  else audioOnlyButton.classList.remove('yta-player-button--mobile');
  if (audioOnlyButton.dataset.ytaBound !== 'true' && options.onAudioOnlyToggle) {
    audioOnlyButton.dataset.ytaBound = 'true';
    audioOnlyButton.addEventListener('click', () => options.onAudioOnlyToggle?.(audioOnlyButton));
  }
  audioOnlyButton.setAttribute('aria-label', 'Toggle audio-only playback');
  audioOnlyButton.setAttribute('aria-pressed', String(options.audioOnlyActive));
  audioOnlyButton.disabled = false;

  const downloadButton = getOrCreatePlayerButton(
    documentRef,
    DOWNLOAD_BUTTON_ID,
    'Download audio',
    DOWNLOAD_ICON_PATH
  );
  if (isMobile) downloadButton.classList.add('yta-player-button--mobile');
  else downloadButton.classList.remove('yta-player-button--mobile');
  if (downloadButton.dataset.ytaBound !== 'true' && options.onDownload) {
    downloadButton.dataset.ytaBound = 'true';
    downloadButton.addEventListener('click', () => options.onDownload?.(downloadButton));
  }
  downloadButton.hidden = !options.downloadVisible;

  let statusRegion = controls.querySelector<HTMLElement>(`#${PLAYER_STATUS_ID}`);
  if (!statusRegion) {
    statusRegion = documentRef.createElement('div');
    statusRegion.id = PLAYER_STATUS_ID;
    statusRegion.className = 'yta-player-status';
    statusRegion.setAttribute('role', 'status');
    statusRegion.setAttribute('aria-live', 'polite');
    statusRegion.setAttribute('aria-atomic', 'true');
    controls.append(statusRegion);
  }

  const orderedButtons = [downloadButton, audioOnlyButton];
  const anchor =
    gear?.parentElement === controls
      ? gear
      : (Array.from(controls.children).find((child) => child !== statusRegion) ?? statusRegion);
  const correctlyPlaced = orderedButtons.every((button, index) => {
    if (button.parentElement !== controls) return false;
    const expectedNext = orderedButtons[index + 1] ?? anchor;
    if (expectedNext) return button.nextElementSibling === expectedNext;
    return button === controls?.lastElementChild;
  });
  if (!correctlyPlaced) {
    const focusedButton = orderedButtons.find((button) =>
      button.contains(documentRef.activeElement)
    );
    const fragment = documentRef.createDocumentFragment();
    for (const button of orderedButtons) fragment.append(button);
    controls.insertBefore(fragment, anchor);
    focusedButton?.focus({ preventScroll: true });
  }

  return { audioOnlyButton, downloadButton, statusRegion };
}

function installPlayerControls(bridgeNonce: string): () => void {
  installPlayerControlStyles();
  let observedPlayer: HTMLElement | null = null;
  let playerObserver: MutationObserver | null = null;
  let documentObserver: MutationObserver | null = null;

  const reconcile = () => {
    if (!observedPlayer?.isConnected) return;
    const settings = getSettings();
    const result = reconcileInPlayerControls({
      playerRoot: observedPlayer,
      audioOnlyActive: settings.enabled && settings.audioOnlyEnabled,
      downloadVisible: settings.enabled && settings.downloadEnabled,
      mobile: location.hostname === 'm.youtube.com',
      onAudioOnlyToggle: () => {
        const current = getSettings();
        void setAudioOnlyEnabled(!current.audioOnlyEnabled).catch(() => undefined);
      },
      onDownload: (button) => {
        void requestAudioDownload(bridgeNonce, button);
      },
    });
    if (result && settings.enabled && settings.audioOnlyEnabled) {
      void showAudioOnlyCoachOnce(result.audioOnlyButton);
    }
  };

  const findPlayerRoot = () => {
    if (location.hostname === 'm.youtube.com') {
      return document.querySelector<HTMLElement>(
        '.html5-video-player, #player-container-id, #player'
      );
    }
    return document.querySelector<HTMLElement>('#movie_player, .html5-video-player');
  };

  const reconnectPlayerObserver = () => {
    const nextPlayer = findPlayerRoot();
    if (nextPlayer === observedPlayer) {
      reconcile();
      return;
    }
    playerObserver?.disconnect();
    playerObserver = null;
    coachCleanup();
    observedPlayer = nextPlayer;
    if (!observedPlayer) return;
    reconcile();
    playerObserver = new MutationObserver(reconcile);
    playerObserver.observe(observedPlayer, { childList: true, subtree: true });
  };

  const stopObservers = () => {
    playerObserver?.disconnect();
    documentObserver?.disconnect();
    playerObserver = null;
    documentObserver = null;
    observedPlayer = null;
    coachCleanup();
  };
  const startObservers = () => {
    if (documentObserver) return;
    reconnectPlayerObserver();
    documentObserver = new MutationObserver(reconnectPlayerObserver);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  };

  const onPageHide = () => stopObservers();
  const onPageShow = () => startObservers();
  document.addEventListener(SEGMENT_SKIPPED_EVENT, announceSkippedSegment);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  startObservers();

  return () => {
    stopObservers();
    document.removeEventListener(SEGMENT_SKIPPED_EVENT, announceSkippedSegment);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}

const AUDIO_ONLY_ICON_PATH =
  'M4 5h10v2H6v10h8v2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm13 4v6.17a3 3 0 1 0 2 2.83V11h3V9h-5Zm-2 8.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z';
const DOWNLOAD_ICON_PATH =
  'M11 4h2v9.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V4ZM5 19h14v2H5v-2Z';

function getOrCreatePlayerButton(
  documentRef: Document,
  id: string,
  label: string,
  pathData: string
): HTMLButtonElement {
  const matches = Array.from(documentRef.querySelectorAll<HTMLButtonElement>(`button#${id}`));
  const focused = matches.find((button) => button.contains(documentRef.activeElement));
  const button = focused ?? matches[0] ?? createPlayerButton(documentRef, id, label, pathData);
  for (const duplicate of matches) {
    if (duplicate !== button) duplicate.remove();
  }
  return button;
}

function createPlayerButton(
  documentRef: Document,
  id: string,
  label: string,
  pathData: string
): HTMLButtonElement {
  const button = documentRef.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'ytp-button yta-player-button';
  button.setAttribute('aria-label', label);
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('yta-player-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  button.append(svg);
  return button;
}

function installPlayerControlStyles(): void {
  if (document.getElementById(PLAYER_CONTROL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PLAYER_CONTROL_STYLE_ID;
  style.textContent = `
    .yta-player-button {
      color: #fff;
      background: transparent;
      border: 0;
      cursor: pointer;
    }
    .yta-player-button--mobile { width: 44px; height: 44px; }
    .yta-player-icon { display: block; width: 100%; height: 100%; pointer-events: none; }
    .yta-player-icon path { fill: currentColor; }
    .yta-player-button:focus-visible { outline: 2px solid #3fe0c4; outline-offset: -4px; }
    .yta-player-button[aria-pressed="true"] .yta-player-icon path { fill: #22d3b4; }
    .yta-player-status {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .yta-audio-only-coach {
      position: fixed;
      z-index: 2147483646;
      max-width: min(260px, calc(100vw - 24px));
      padding: 8px 12px;
      border-radius: 4px;
      color: #fff;
      background: rgba(28, 28, 28, .96);
      box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
      font: 500 13px/1.4 Roboto, Arial, Helvetica, sans-serif;
      pointer-events: none;
      opacity: 1;
      transition: opacity 120ms cubic-bezier(.2, 0, 0, 1);
    }
    @media (prefers-reduced-motion: reduce) {
      .yta-audio-only-coach { transition-duration: .001ms; }
    }
    @media (forced-colors: active) {
      .yta-player-button:focus-visible { outline-color: Highlight; }
      .yta-player-button[aria-pressed="true"] .yta-player-icon path { fill: Highlight; }
    }
  `;
  (document.head ?? document.documentElement).append(style);
}

async function showAudioOnlyCoachOnce(button: HTMLButtonElement): Promise<void> {
  if (coachSeenThisPage || coachRequest || !button.isConnected) return coachRequest ?? undefined;
  coachRequest = (async () => {
    try {
      const stored = await browser.storage.local.get(COACH_STORAGE_KEY);
      if (coachSeenThisPage || stored[COACH_STORAGE_KEY] === true || !button.isConnected) return;

      const coach = document.createElement('div');
      coach.id = COACH_ID;
      coach.className = 'yta-audio-only-coach';
      coach.setAttribute('role', 'tooltip');
      coach.textContent = 'Audio-only is on. Tap here for video.';
      document.body.append(coach);
      coachSeenThisPage = true;
      void browser.storage.local.set({ [COACH_STORAGE_KEY]: true }).catch(() => undefined);
      if (__BENCH__) document.documentElement.dataset.ytaCoach = '1';

      const position = () => {
        if (!button.isConnected || !coach.isConnected) return;
        const anchor = button.getBoundingClientRect();
        const tooltip = coach.getBoundingClientRect();
        const left = Math.min(
          window.innerWidth - tooltip.width - 12,
          Math.max(12, anchor.left + anchor.width / 2 - tooltip.width / 2)
        );
        coach.style.left = `${left}px`;
        coach.style.top = `${Math.max(8, anchor.top - tooltip.height - 8)}px`;
      };
      const dismiss = () => coachCleanup();
      const timeout = window.setTimeout(dismiss, 8_000);
      coachCleanup = () => {
        window.clearTimeout(timeout);
        button.removeEventListener('click', dismiss);
        window.removeEventListener('resize', position);
        coach.remove();
        if (__BENCH__) delete document.documentElement.dataset.ytaCoach;
        coachCleanup = () => undefined;
      };
      button.addEventListener('click', dismiss, { once: true });
      window.addEventListener('resize', position);
      position();
    } catch {
      // Storage or DOM failures leave playback and the control unaffected.
    }
  })().finally(() => {
    coachRequest = null;
  });
  return coachRequest;
}

function announceSkippedSegment(event: Event): void {
  const category = (event as CustomEvent<unknown>).detail;
  if (typeof category !== 'string' || !isSponsorCategory(category)) return;
  const label = category === 'music_offtopic' ? 'music off-topic' : category;
  announcePlayerStatus(`Skipped ${label}`);
}

function announcePlayerStatus(message: string): void {
  const region = document.getElementById(PLAYER_STATUS_ID);
  if (region) region.textContent = message;
}

async function requestAudioDownload(bridgeNonce: string, button: HTMLButtonElement): Promise<void> {
  if (!getSettings().enabled || !getSettings().downloadEnabled || button.disabled) return;
  button.disabled = true;
  announcePlayerStatus('Preparing audio download');
  const requestId = crypto.randomUUID();
  try {
    const payload = await new Promise<{ url: string; filename: string }>((resolve, reject) => {
      const finish = () => {
        window.clearTimeout(timeout);
        document.removeEventListener(DOWNLOAD_RESPONSE_EVENT, onResponse);
      };
      const onResponse = (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (typeof detail !== 'string') return;
        try {
          const parsed: unknown = JSON.parse(detail);
          if (typeof parsed !== 'object' || parsed === null) return;
          const candidate = parsed as {
            nonce?: unknown;
            requestId?: unknown;
            ok?: unknown;
            url?: unknown;
            filename?: unknown;
          };
          if (candidate.nonce !== bridgeNonce || candidate.requestId !== requestId) return;
          finish();
          const benchOrigin = __BENCH__ ? location.origin : undefined;
          if (
            candidate.ok === true &&
            isAllowedAudioUrl(candidate.url, benchOrigin) &&
            isSafeDownloadFilename(candidate.filename)
          ) {
            resolve({ url: candidate.url, filename: candidate.filename });
          } else {
            reject(new Error('download-unavailable'));
          }
        } catch {
          // Ignore malformed page events until the bounded timeout.
        }
      };
      const timeout = window.setTimeout(() => {
        document.removeEventListener(DOWNLOAD_RESPONSE_EVENT, onResponse);
        reject(new Error('download-timeout'));
      }, 8_000);
      document.addEventListener(DOWNLOAD_RESPONSE_EVENT, onResponse);
      document.dispatchEvent(
        new CustomEvent(DOWNLOAD_REQUEST_EVENT, {
          detail: JSON.stringify({ nonce: bridgeNonce, requestId }),
        })
      );
    });
    const response: unknown = await browser.runtime.sendMessage({
      type: DOWNLOAD_MESSAGE,
      ...payload,
      ...(__BENCH__ ? { benchOrigin: location.origin } : {}),
    });
    if (
      typeof response !== 'object' ||
      response === null ||
      (response as { ok?: unknown }).ok !== true
    ) {
      throw new Error('download-failed');
    }
    announcePlayerStatus('Audio download started');
    if (__BENCH__) document.documentElement.dataset.ytaDownload = JSON.stringify(payload);
  } catch {
    announcePlayerStatus('Audio download failed');
  } finally {
    button.disabled = false;
  }
}

function updateDownloadButton(visible: boolean): void {
  const button = document.getElementById(DOWNLOAD_BUTTON_ID);
  if (button) button.hidden = !visible;
}

function updateToggle(active: boolean): void {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', 'Toggle audio-only playback');
}

function updateStatusMarker(event: Event): void {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) return;
  const rawStatus = (detail as { status?: unknown }).status;
  const status = typeof rawStatus === 'string' && rawStatus.length <= 24 ? rawStatus : null;
  const rawReason = (detail as { reason?: unknown }).reason;
  const reason = typeof rawReason === 'string' && rawReason.length <= 120 ? rawReason : undefined;

  // Bench-only observable DOM marker (unchanged): the hermetic integration bench reads these.
  if (__BENCH__) {
    if (status) document.documentElement.dataset.ytaStatus = status;
    if (reason) document.documentElement.dataset.ytaReason = reason;
    else delete document.documentElement.dataset.ytaReason;
  }

  // Production: relay the real per-video status to the background per-tab map so the popup can read
  // the honest state of THIS tab. Additive to the bench marker; both run under the bench build.
  if (status) pushStatusToBackground(status, reason);
}

function bumpStatusGeneration(): void {
  statusGeneration += 1;
}

/**
 * Forward the page world's status to the background. Fail-open by contract: a torn-down or
 * unavailable background context (or any messaging rejection) must never surface into the page or
 * disturb playback, so every failure is swallowed.
 */
function pushStatusToBackground(status: string, reason: string | undefined): void {
  try {
    const videoId = parseVideoId(location.href) ?? undefined;
    void browser.runtime
      .sendMessage({
        type: STATUS_UPDATE_MESSAGE,
        status,
        ...(reason ? { reason } : {}),
        ...(videoId ? { videoId } : {}),
        runStart: statusRunStart,
        generation: statusGeneration,
      })
      .catch(() => undefined);
  } catch {
    // Never let a status relay failure break the page.
  }
}
