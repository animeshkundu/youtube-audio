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
import {
  isAllowedAudioUrl,
  isSafeDownloadFilename,
  parseDownloadProgress,
} from '../src/shared/download';
import { parseLrc, type LyricLine } from '../src/shared/lyrics';
import { buildDistractionStyles } from '../src/shared/quality-of-life';
import { isSponsorCategory } from '../src/shared/sponsorblock';
import { isPlaybackStatus, STATUS_UPDATE_MESSAGE, type StatusUpdate } from '../src/shared/status';

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
const PLAYER_TOOLTIP_ID = 'yta-audio-only-tooltip';
const SEGMENT_TOAST_ID = 'yta-segment-toast';
const COACH_ID = 'yta-audio-only-coach';
const COACH_STORAGE_KEY = 'seenAudioOnlyCoach';
const LYRICS_ID = 'yta-synced-lyrics';
const DISTRACTION_STYLE_ID = 'yta-distraction-style';
const PLAYER_CONTROL_STYLE_ID = 'yta-player-control-style';
let lyricsCleanup: () => void = () => undefined;
// The videoId whose lyrics are currently rendered, the last track handleTrack saw (so a duplicate
// event for a just-closed track cannot reopen it), the track the user explicitly closed, a monotonic
// token that drops a superseded lyrics fetch, and the last-seen enabled state so re-enabling lyrics
// clears a prior manual dismiss.
let lyricsVideoId: string | null = null;
let lyricsLastTrackId: string | null = null;
let lyricsFetchingVideoId: string | null = null;
let lyricsDismissedVideoId: string | null = null;
let lyricsRequestGeneration = 0;
let lyricsWasEnabled = false;
let coachRequest: Promise<void> | null = null;
let coachSeenThisPage = false;
let coachCleanup: () => void = () => undefined;
// This content script's lifetime start — a per-tab epoch used to order popup status reports across
// document lifetimes. A full page load must produce a STRICTLY-later value than the previous
// document in the same tab so the background prefers the newer document's report even though the
// page world's operation generation resets per document. Wall-clock time alone is unsafe here: two
// loads can collide within one millisecond, and a system-clock rollback can move it backward —
// either would freeze the popup on the prior document's status. We persist the last epoch in per-tab
// sessionStorage (survives a reload, resets with the tab) and take `max(now, previous + 1)`, which is
// collision- and rollback-proof. sessionStorage is origin-shared with the (hostile) page, so the
// stored epoch is validated as a sane non-negative safe integer no more than a day past `now`: a
// poisoned value (e.g. `1e308`, where `previous + 1 === previous` and would otherwise freeze
// ordering) is discarded and we recover to wall clock. Falls back to `now` when storage is
// unavailable (a rare private-browsing config; only a clock rollback in that same window degrades it,
// and the effect is display-only + fail-open).
export function nextStatusRunStart(): number {
  const now = Date.now();
  try {
    const key = '__yta_run_epoch__';
    const raw = Number(window.sessionStorage.getItem(key));
    const previous = Number.isSafeInteger(raw) && raw >= 0 && raw <= now + 86_400_000 ? raw : 0;
    const next = Math.max(now, previous + 1);
    window.sessionStorage.setItem(key, String(next));
    return next;
  } catch {
    return now;
  }
}
const statusRunStart = nextStatusRunStart();

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
      browser.runtime.onMessage.addListener(handleDownloadProgressMessage);
      subscribeSettings((settings) => {
        window.postMessage(
          { channel: SETTINGS_EVENT, nonce: bridgeNonce, settings },
          location.origin
        );
        updateToggle(settings.enabled && settings.audioOnlyEnabled);
        updateDownloadButton(settings.enabled && settings.downloadEnabled);
        updateDistractionStyle(settings);
        const lyricsOn = settings.enabled && settings.lyricsEnabled;
        if (!lyricsOn) removeLyrics();
        else if (!lyricsWasEnabled) lyricsDismissedVideoId = null; // re-enabled: allow showing again
        lyricsWasEnabled = lyricsOn;
      });
      document.addEventListener(STATUS_EVENT, updateStatusMarker);
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
  const videoId = candidate.videoId;
  // A genuinely different track (vs the last one we saw, not the rendered one which is null after a
  // close) clears a prior manual dismiss; a duplicate event for the track the user just closed stays
  // closed; a track already rendered needs no re-fetch (avoids flicker / resetting a minimized panel).
  if (videoId !== lyricsLastTrackId) lyricsDismissedVideoId = null;
  lyricsLastTrackId = videoId;
  if (videoId === lyricsDismissedVideoId) return;
  if (videoId === lyricsVideoId && document.getElementById(LYRICS_ID)) return;
  // A fetch for this exact track is already in flight: skip a duplicate so it does not supersede the
  // first (which would drop a good result if the duplicate then fails). Only a genuinely different
  // track bumps the generation and supersedes.
  if (videoId === lyricsFetchingVideoId) return;
  const generation = ++lyricsRequestGeneration;
  lyricsFetchingVideoId = videoId;
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: LYRICS_MESSAGE,
      title: candidate.title,
      artist: candidate.artist,
      duration: candidate.duration,
      ...(__BENCH__ ? { benchOrigin: location.origin } : {}),
    });
    // Drop a superseded fetch (a newer track started while this one was in flight) so a slow lookup
    // for the previous song can never overwrite the current one.
    if (generation !== lyricsRequestGeneration) return;
    if (!getSettings().enabled || !getSettings().lyricsEnabled) return;
    if (videoId === lyricsDismissedVideoId) return;
    const syncedLyrics =
      typeof response === 'object' && response !== null
        ? (response as { syncedLyrics?: unknown }).syncedLyrics
        : undefined;
    if (typeof syncedLyrics !== 'string' || syncedLyrics.length > 200_000) {
      // No lyrics for the new track: clear a stale panel from the previous one.
      if (videoId !== lyricsVideoId) removeLyrics();
      return;
    }
    renderLyrics(parseLrc(syncedLyrics), videoId);
  } catch {
    if (generation === lyricsRequestGeneration && videoId !== lyricsVideoId) removeLyrics();
  } finally {
    if (lyricsFetchingVideoId === videoId) lyricsFetchingVideoId = null;
  }
}

function renderLyrics(lines: readonly LyricLine[], videoId: string): void {
  removeLyrics();
  if (lines.length === 0) return;
  const video = document.querySelector<HTMLMediaElement>('video');
  if (!video) return;

  const container = document.createElement('section');
  container.id = LYRICS_ID;
  container.setAttribute('aria-label', 'Synced lyrics');
  container.dataset.videoId = videoId;
  container.style.cssText =
    'position:fixed;right:16px;bottom:72px;z-index:2147483646;max-width:min(420px,calc(100vw - 32px));max-height:40vh;display:flex;flex-direction:column;overflow:hidden;border-radius:12px;background:rgba(15,15,15,.92);color:#fff;font:16px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:none;';

  // Header with minimize + close controls. The panel is click-through (container `pointer-events:none`,
  // only the buttons re-enable events), so on YouTube Music the lyric text no longer swallows clicks
  // meant for the Up Next queue behind it (a click on a queue row passes through and switches songs).
  // Minimize collapses to just this header; close removes the panel.
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 12px;flex:0 0 auto;';
  const label = document.createElement('span');
  label.textContent = 'Lyrics';
  label.style.cssText =
    'font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.7;';
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:2px;';
  const body = document.createElement('div');
  body.style.cssText = 'overflow:auto;padding:2px 16px 12px;flex:1 1 auto;';

  const makeButton = (
    symbol: string,
    ariaLabel: string,
    onClick: () => void
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = symbol;
    button.setAttribute('aria-label', ariaLabel);
    button.style.cssText =
      'appearance:none;border:0;background:transparent;color:#fff;opacity:.65;cursor:pointer;width:28px;height:28px;border-radius:6px;font:16px/1 system-ui,sans-serif;pointer-events:auto;';
    button.addEventListener('mouseenter', () => button.style.setProperty('opacity', '1'));
    button.addEventListener('mouseleave', () => button.style.setProperty('opacity', '.65'));
    button.addEventListener('click', onClick);
    return button;
  };

  let minimized = false;
  const minimizeButton = makeButton('–', 'Minimize lyrics', () => {
    minimized = !minimized;
    body.style.setProperty('display', minimized ? 'none' : 'block');
    minimizeButton.textContent = minimized ? '▸' : '–';
    minimizeButton.setAttribute('aria-label', minimized ? 'Expand lyrics' : 'Minimize lyrics');
  });
  const closeButton = makeButton('×', 'Close lyrics', () => {
    lyricsDismissedVideoId = videoId;
    removeLyrics();
  });
  controls.append(minimizeButton, closeButton);
  header.append(label, controls);

  const elements = lines.map((line) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = line.text;
    paragraph.style.cssText = 'margin:4px 0;opacity:.55;';
    body.append(paragraph);
    return paragraph;
  });
  container.append(header, body);

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
      if (!minimized) elements[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  };
  video.addEventListener('timeupdate', sync);
  lyricsCleanup = () => video.removeEventListener('timeupdate', sync);
  document.body.append(container);
  lyricsVideoId = videoId;
  if (__BENCH__) document.documentElement.dataset.ytaLyrics = String(lines.length);
  sync();
}

function removeLyrics(): void {
  lyricsCleanup();
  lyricsCleanup = () => undefined;
  lyricsVideoId = null;
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
  updateAudioOnlyButtonShape(audioOnlyButton, options.audioOnlyActive);
  installAudioOnlyTooltip(audioOnlyButton);

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
  // The insertion anchor must be a node we are NOT about to move into the fragment: the native gear,
  // else the first native control, else null (append at the end). Never statusRegion or one of our
  // own buttons — anchoring on a to-be-moved node makes `insertBefore` throw once that node is
  // detached into the fragment, and under the observer that throw turns into a
  // reconcile -> throw -> mutation hot loop whenever the settings gear is absent.
  const managed = new Set<Node>([downloadButton, audioOnlyButton, statusRegion]);
  const anchor =
    gear?.parentElement === controls
      ? gear
      : (Array.from(controls.children).find((child) => !managed.has(child)) ?? null);
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

export interface CoalescedFrameScheduler {
  schedule(): void;
  cancel(): void;
}

/** Coalesce repeated requests onto one callback in the next animation frame. */
export function createCoalescedFrameScheduler(
  run: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
  onSchedule: () => void = () => undefined
): CoalescedFrameScheduler {
  let frame: number | null = null;
  return {
    schedule(): void {
      onSchedule();
      if (frame !== null) return;
      frame = requestFrame(() => {
        frame = null;
        run();
      });
    },
    cancel(): void {
      if (frame !== null) cancelFrame(frame);
      frame = null;
    },
  };
}

export function installPlayerControls(bridgeNonce: string): () => void {
  installPlayerControlStyles();
  let observedPlayer: HTMLElement | null = null;
  let playerObserver: MutationObserver | null = null;
  let documentObserver: MutationObserver | null = null;
  let segmentToast: SegmentToastController | null = null;
  let lastPlaybackSample: { media: HTMLMediaElement; time: number } | null = null;
  let observersActive = false;

  const reconcile = () => {
    if (!observersActive) return;
    if (__BENCH__) {
      const runs = Number(document.documentElement.dataset.ytaReconcileRuns ?? '0') + 1;
      document.documentElement.dataset.ytaReconcileRuns = String(runs);
    }
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
    if (result) {
      if (!segmentToast || !segmentToast.toast.isConnected) {
        segmentToast?.dispose();
        segmentToast = createSegmentToastController(observedPlayer, announcePlayerStatus);
      }
      if (settings.enabled && settings.audioOnlyEnabled) {
        void showAudioOnlyCoachOnce(result.audioOnlyButton);
      }
    }
  };

  const reconcileScheduler = createCoalescedFrameScheduler(
    reconcile,
    requestAnimationFrame,
    cancelAnimationFrame,
    () => {
      if (__BENCH__) {
        const schedules = Number(document.documentElement.dataset.ytaReconcileSchedules ?? '0') + 1;
        document.documentElement.dataset.ytaReconcileSchedules = String(schedules);
      }
    }
  );
  const scheduleReconcile = () => {
    if (observersActive) reconcileScheduler.schedule();
  };
  const playerSelector =
    location.hostname === 'm.youtube.com'
      ? '.html5-video-player, #player-container-id, #player'
      : '#movie_player, .html5-video-player';

  const findPlayerRoot = () => document.querySelector<HTMLElement>(playerSelector);

  const reconnectPlayerObserver = () => {
    if (!observersActive) return;
    const nextPlayer = findPlayerRoot();
    if (nextPlayer === observedPlayer) {
      scheduleReconcile();
      return;
    }
    reconcileScheduler.cancel();
    playerObserver?.disconnect();
    playerObserver = null;
    segmentToast?.dispose();
    segmentToast = null;
    coachCleanup();
    observedPlayer = nextPlayer;
    if (!observedPlayer) return;
    scheduleReconcile();
    playerObserver = new MutationObserver(scheduleReconcile);
    playerObserver.observe(observedPlayer, { childList: true, subtree: true });
  };

  const reconnectScheduler = createCoalescedFrameScheduler(() => {
    if (observersActive) reconnectPlayerObserver();
  });
  const mutationMayReplacePlayer = (records: readonly MutationRecord[]): boolean => {
    if (observedPlayer && !observedPlayer.isConnected) return true;
    const containsPlayer = (node: Node) =>
      node instanceof Element &&
      (node.matches(playerSelector) || node.querySelector(playerSelector) !== null);
    return records.some(
      (record) =>
        Array.from(record.addedNodes).some(containsPlayer) ||
        Array.from(record.removedNodes).some(
          (node) =>
            containsPlayer(node) ||
            (observedPlayer !== null && node instanceof Element && node.contains(observedPlayer))
        )
    );
  };

  const stopObservers = () => {
    observersActive = false;
    reconcileScheduler.cancel();
    reconnectScheduler.cancel();
    playerObserver?.disconnect();
    documentObserver?.disconnect();
    playerObserver = null;
    documentObserver = null;
    segmentToast?.dispose();
    segmentToast = null;
    lastPlaybackSample = null;
    observedPlayer = null;
    coachCleanup();
  };
  const startObservers = () => {
    if (observersActive || document.visibilityState === 'hidden') return;
    observersActive = true;
    reconnectPlayerObserver();
    documentObserver = new MutationObserver((records) => {
      if (observersActive && mutationMayReplacePlayer(records)) reconnectScheduler.schedule();
    });
    // The document root is stable across YouTube SPA navigation. Filtering the records above keeps
    // routine player churn from scheduling a document-wide player lookup.
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  };

  const rememberPlaybackPosition = (event: Event) => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement)) return;
    const time = media.currentTime;
    if (Number.isFinite(time) && time >= 0) lastPlaybackSample = { media, time };
  };
  const handleSegmentSkipped = (event: Event) => {
    try {
      const message = getSkippedSegmentMessage((event as CustomEvent<unknown>).detail);
      if (!message) return;
      const sample = lastPlaybackSample;
      segmentToast?.show(message, () => {
        if (!sample || !sample.media.isConnected || !Number.isFinite(sample.time)) return;
        sample.media.currentTime = sample.time;
      });
      if (!segmentToast) announcePlayerStatus(message);
    } catch {
      // Feedback failures must never affect playback after the page world has skipped a segment.
    }
  };
  const syncObserverVisibility = () => {
    if (document.visibilityState === 'hidden') stopObservers();
    else startObservers();
  };
  const onPageHide = () => stopObservers();
  const onPageShow = () => syncObserverVisibility();
  document.addEventListener('timeupdate', rememberPlaybackPosition, true);
  document.addEventListener(SEGMENT_SKIPPED_EVENT, handleSegmentSkipped);
  document.addEventListener('visibilitychange', syncObserverVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  syncObserverVisibility();

  return () => {
    stopObservers();
    document.removeEventListener('timeupdate', rememberPlaybackPosition, true);
    document.removeEventListener(SEGMENT_SKIPPED_EVENT, handleSegmentSkipped);
    document.removeEventListener('visibilitychange', syncObserverVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}

const AUDIO_ONLY_ICON_PATH =
  'M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z';
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
  svg.classList.add('yta-player-icon', 'yta-player-icon--default');
  // Match YouTube's own icon viewBox (0 0 36 36): our 0-24 glyph then occupies ~2/3 of the box, so a
  // full-size SVG renders it at native weight (~20px, verified vs the native gear on real YouTube) and
  // scales in theater/fullscreen. YouTube's ytp-button CSS sizes + centers the SVG (hence inline-block,
  // not flex, on the button).
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  button.append(svg);
  return button;
}

function updateAudioOnlyButtonShape(button: HTMLButtonElement, active: boolean): void {
  try {
    button.dataset.audioState = active ? 'on' : 'off';
    const svg = button.querySelector<SVGSVGElement>('.yta-player-icon--default');
    if (!svg) return;
    let slash = svg.querySelector<SVGPathElement>('.yta-audio-only-slash');
    if (!slash) {
      slash = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      slash.classList.add('yta-audio-only-slash');
      slash.setAttribute('d', 'M4.5 4.5 19.5 19.5');
      svg.append(slash);
    }
    slash.toggleAttribute('hidden', active);
  } catch {
    // A decorative shape failure must not affect the toggle.
  }
}

const audioOnlyTooltipButtons = new WeakSet<HTMLButtonElement>();

/** Installs the visual-only tooltip once while preserving the button's stable accessible name. */
export function installAudioOnlyTooltip(button: HTMLButtonElement): void {
  if (audioOnlyTooltipButtons.has(button)) return;
  audioOnlyTooltipButtons.add(button);

  try {
    const documentRef = button.ownerDocument;
    let tooltip = documentRef.getElementById(PLAYER_TOOLTIP_ID);
    if (!tooltip) {
      tooltip = documentRef.createElement('div');
      tooltip.id = PLAYER_TOOLTIP_ID;
      tooltip.className = 'yta-player-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.textContent = 'Audio only';
      tooltip.hidden = true;
      (documentRef.body ?? documentRef.documentElement).append(tooltip);
    }

    let hovered = false;
    let focused = false;
    let touchFocus = false;
    const position = () => {
      if (!tooltip || tooltip.hidden || !button.isConnected) return;
      const anchor = button.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - tip.width - 8,
        Math.max(8, anchor.left + anchor.width / 2 - tip.width / 2)
      );
      const above = anchor.top - tip.height - 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${above >= 8 ? above : anchor.bottom + 8}px`;
    };
    const update = () => {
      if (!tooltip) return;
      const visible = button.isConnected && !touchFocus && (hovered || focused);
      tooltip.hidden = !visible;
      if (visible) position();
    };
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touchFocus = true;
        hovered = false;
      } else {
        touchFocus = false;
        hovered = true;
      }
      update();
    };
    const onPointerLeave = () => {
      hovered = false;
      update();
    };
    const onPointerDown = (event: PointerEvent) => {
      touchFocus = event.pointerType === 'touch';
      if (touchFocus) hovered = false;
      update();
    };
    const onTouchStart = () => {
      touchFocus = true;
      hovered = false;
      update();
    };
    const onKeyDown = () => {
      touchFocus = false;
      update();
    };
    const onFocus = () => {
      focused = true;
      update();
    };
    const onBlur = () => {
      focused = false;
      touchFocus = false;
      update();
    };

    button.addEventListener('pointerenter', onPointerEnter);
    button.addEventListener('pointerleave', onPointerLeave);
    button.addEventListener('pointerdown', onPointerDown);
    button.addEventListener('touchstart', onTouchStart, { passive: true });
    button.addEventListener('keydown', onKeyDown);
    button.addEventListener('focus', onFocus);
    button.addEventListener('blur', onBlur);
  } catch {
    // Tooltip failures must never make the underlying player control unavailable.
  }
}

export type DownloadFeedbackState =
  | { kind: 'idle' }
  | { kind: 'progress'; ratio: number | null }
  | { kind: 'success' }
  | { kind: 'failure'; reason: string };

export type DownloadFeedbackEvent =
  | { type: 'start' }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'succeed' }
  | { type: 'fail'; reason: string }
  | { type: 'reset' };

export function reduceDownloadFeedbackState(
  state: DownloadFeedbackState,
  event: DownloadFeedbackEvent
): DownloadFeedbackState {
  if (event.type === 'start') return { kind: 'progress', ratio: null };
  if (event.type === 'reset') return { kind: 'idle' };
  if (state.kind !== 'progress') return state;
  if (event.type === 'progress') {
    if (
      !Number.isSafeInteger(event.loaded) ||
      !Number.isSafeInteger(event.total) ||
      event.loaded < 0 ||
      event.total <= 0 ||
      event.loaded > event.total
    ) {
      return state;
    }
    return { kind: 'progress', ratio: event.loaded / event.total };
  }
  if (event.type === 'succeed') return { kind: 'success' };
  if (event.type === 'fail') {
    const reason = event.reason.trim().slice(0, 120) || 'Could not download audio';
    return { kind: 'failure', reason };
  }
  return state;
}

export interface DownloadFeedbackController {
  getState(): DownloadFeedbackState;
  bind(button: HTMLButtonElement, statusRegion: HTMLElement | (() => HTMLElement | null)): void;
  transition(event: DownloadFeedbackEvent): DownloadFeedbackState;
  dispose(): void;
}

function createFeedbackIcon(
  documentRef: Document,
  className: string,
  pathData: string
): SVGSVGElement {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('yta-player-icon', 'yta-download-feedback', className);
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

/** Owns visible and announced download feedback without owning the download request itself. */
export function createDownloadFeedbackController(
  initialButton: HTMLButtonElement,
  initialStatusRegion: HTMLElement | (() => HTMLElement | null),
  resetAfterMs = 2_400
): DownloadFeedbackController {
  let button = initialButton;
  let statusRegion = initialStatusRegion;
  let state: DownloadFeedbackState = { kind: 'idle' };
  let resetTimer: number | null = null;
  let announcedProgressBucket = -1;

  const prepareButton = (target: HTMLButtonElement) => {
    const documentRef = target.ownerDocument;
    const defaultIcon = target.querySelector<SVGSVGElement>('svg.yta-player-icon');
    defaultIcon?.classList.add('yta-player-icon--default');
    if (!target.querySelector('.yta-download-progress')) {
      const progress = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
      progress.classList.add('yta-player-icon', 'yta-download-feedback', 'yta-download-progress');
      progress.setAttribute('viewBox', '0 0 36 36');
      progress.setAttribute('aria-hidden', 'true');
      progress.setAttribute('focusable', 'false');
      const track = documentRef.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.classList.add('yta-download-progress-track');
      track.setAttribute('cx', '12');
      track.setAttribute('cy', '12');
      track.setAttribute('r', '8');
      const indicator = documentRef.createElementNS('http://www.w3.org/2000/svg', 'circle');
      indicator.classList.add('yta-download-progress-indicator');
      indicator.setAttribute('cx', '12');
      indicator.setAttribute('cy', '12');
      indicator.setAttribute('r', '8');
      const value = documentRef.createElementNS('http://www.w3.org/2000/svg', 'text');
      value.classList.add('yta-download-progress-value');
      value.setAttribute('x', '12');
      value.setAttribute('y', '14');
      value.setAttribute('text-anchor', 'middle');
      progress.append(track, indicator, value);
      target.append(progress);
    }
    if (!target.querySelector('.yta-download-success')) {
      target.append(
        createFeedbackIcon(
          documentRef,
          'yta-download-success',
          'M9.2 16.2 4.8 11.8l-1.6 1.6 6 6L21 7.6 19.4 6l-10.2 10.2Z'
        )
      );
    }
    if (!target.querySelector('.yta-download-failure')) {
      target.append(
        createFeedbackIcon(documentRef, 'yta-download-failure', 'M11 6h2v8h-2V6Zm0 10h2v2h-2v-2Z')
      );
    }
    if (!target.querySelector('.yta-download-reason')) {
      const reason = documentRef.createElement('span');
      reason.className = 'yta-download-reason';
      reason.setAttribute('aria-hidden', 'true');
      target.append(reason);
    }
  };
  const announce = (message: string) => {
    try {
      const region = typeof statusRegion === 'function' ? statusRegion() : statusRegion;
      if (region) region.textContent = message;
    } catch {
      // Live-region failure is non-fatal and must not block state rendering.
    }
  };
  const render = (shouldAnnounce: boolean) => {
    try {
      prepareButton(button);
      button.dataset.downloadState = state.kind;
      button.classList.toggle('yta-download-button--failure', state.kind === 'failure');
      button.disabled = state.kind === 'progress';
      if (state.kind === 'progress') button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
      const reason = button.querySelector<HTMLElement>('.yta-download-reason');
      if (reason) reason.textContent = state.kind === 'failure' ? state.reason : '';
      const indicator = button.querySelector<SVGCircleElement>('.yta-download-progress-indicator');
      const value = button.querySelector<SVGTextElement>('.yta-download-progress-value');
      if (state.kind === 'progress' && state.ratio !== null) {
        const percent = Math.min(100, Math.max(0, Math.floor(state.ratio * 100)));
        button.dataset.downloadProgress = String(percent);
        if (indicator) indicator.style.strokeDashoffset = String(50.27 * (1 - state.ratio));
        if (value) value.textContent = String(percent);
      } else {
        delete button.dataset.downloadProgress;
        if (indicator) indicator.style.strokeDashoffset = '';
        if (value) value.textContent = '';
      }

      if (!shouldAnnounce) return;
      if (state.kind === 'progress' && state.ratio === null) {
        announcedProgressBucket = -1;
        announce('Preparing audio download');
      } else if (state.kind === 'progress' && state.ratio !== null) {
        const percent = Math.min(100, Math.max(0, Math.floor(state.ratio * 100)));
        const bucket = Math.floor(percent / 10) * 10;
        if (bucket > announcedProgressBucket) {
          announcedProgressBucket = bucket;
          announce(`Audio download ${bucket}%`);
        }
      } else if (state.kind === 'success') announce('Audio download started');
      else if (state.kind === 'failure') announce(`Audio download failed: ${state.reason}`);
    } catch {
      // Visual feedback must never interfere with downloading or player controls.
    }
  };
  const bind = (
    nextButton: HTMLButtonElement,
    nextStatusRegion: HTMLElement | (() => HTMLElement | null)
  ) => {
    button = nextButton;
    statusRegion = nextStatusRegion;
    render(false);
  };
  const transition = (event: DownloadFeedbackEvent) => {
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
    state = reduceDownloadFeedbackState(state, event);
    render(true);
    if (state.kind === 'success' || state.kind === 'failure') {
      resetTimer = window.setTimeout(() => {
        resetTimer = null;
        state = reduceDownloadFeedbackState(state, { type: 'reset' });
        render(false);
      }, resetAfterMs);
    }
    return state;
  };
  render(false);
  return {
    getState: () => state,
    bind,
    transition,
    dispose: () => {
      if (resetTimer !== null) window.clearTimeout(resetTimer);
      resetTimer = null;
    },
  };
}

export interface SegmentToastController {
  toast: HTMLElement;
  show(message: string, undo: () => void): void;
  dismiss(immediate?: boolean): void;
  dispose(): void;
}

/** Creates one timer-tokenized contextual toast so stale timers cannot dismiss a newer skip. */
export function createSegmentToastController(
  host: HTMLElement,
  announce: (message: string) => void,
  hideAfterMs = 4_000,
  exitAfterMs = 180
): SegmentToastController {
  const documentRef = host.ownerDocument;
  const toast = documentRef.createElement('div');
  toast.id = SEGMENT_TOAST_ID;
  toast.className = 'yta-segment-toast';
  toast.hidden = true;
  toast.dataset.state = 'hidden';
  const text = documentRef.createElement('span');
  text.className = 'yta-segment-toast__text';
  const undoButton = documentRef.createElement('button');
  undoButton.type = 'button';
  undoButton.className = 'yta-segment-toast__undo';
  undoButton.textContent = 'Undo';
  toast.append(text, undoButton);
  host.append(toast);

  let generation = 0;
  let hideTimer: number | null = null;
  let exitTimer: number | null = null;
  let undoAction: (() => void) | null = null;
  const clearTimers = () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    if (exitTimer !== null) window.clearTimeout(exitTimer);
    hideTimer = null;
    exitTimer = null;
  };
  const finishHide = (token: number) => {
    if (token !== generation) return;
    toast.hidden = true;
    toast.dataset.state = 'hidden';
    undoAction = null;
  };
  const dismiss = (immediate = false) => {
    generation += 1;
    const token = generation;
    clearTimers();
    if (immediate || toast.hidden) {
      finishHide(token);
      return;
    }
    toast.dataset.state = 'exiting';
    exitTimer = window.setTimeout(() => finishHide(token), exitAfterMs);
  };
  const show = (message: string, undo: () => void) => {
    generation += 1;
    const token = generation;
    clearTimers();
    text.textContent = message;
    undoAction = undo;
    toast.hidden = false;
    toast.dataset.state = 'visible';
    try {
      announce(message);
    } catch {
      // The visible contextual action remains useful if the live region is unavailable.
    }
    hideTimer = window.setTimeout(() => {
      if (token !== generation) return;
      toast.dataset.state = 'exiting';
      exitTimer = window.setTimeout(() => finishHide(token), exitAfterMs);
    }, hideAfterMs);
  };
  undoButton.addEventListener('click', () => {
    const action = undoAction;
    if (!action) return;
    try {
      action();
    } catch {
      // Seeking can fail during media replacement; the toast must still dismiss.
    }
    try {
      announce('Skip undone');
    } catch {
      // Keep Undo fail-open if its confirmation cannot be announced.
    }
    dismiss(true);
  });

  return {
    toast,
    show,
    dismiss,
    dispose: () => {
      dismiss(true);
      toast.remove();
    },
  };
}

function installPlayerControlStyles(): void {
  if (document.getElementById(PLAYER_CONTROL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PLAYER_CONTROL_STYLE_ID;
  style.textContent = `
    .yta-player-button {
      position: relative;
      display: inline-block;
      color: #fff;
      background: transparent;
      border: 0;
      cursor: pointer;
    }
    .yta-player-button--mobile { width: 44px; height: 44px; }
    /* inline-block (not flex) so we do not fight YouTube's ytp-button layout, which sizes + centers
       the SVG itself; the 0 0 36 36 viewBox in createPlayerButton matches YouTube's own icon viewBox
       so a full-size SVG renders our 0-24 glyph at native weight and scales in theater/fullscreen. */
    .yta-player-icon { display: block; width: 100%; height: 100%; pointer-events: none; }
    .yta-player-icon path { fill: currentColor; }
    .yta-audio-only-slash {
      fill: none !important;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
    }
    .yta-audio-only-slash[hidden] { display: none; }
    .yta-player-button:focus-visible { outline: 2px solid #3fe0c4; outline-offset: -4px; }
    .yta-player-tooltip {
      position: fixed;
      z-index: 2147483646;
      padding: 5px 8px;
      border-radius: 2px;
      color: #fff;
      background: rgba(28, 28, 28, .96);
      box-shadow: 0 2px 8px rgb(0 0 0 / 35%);
      font: 500 12px/1.4 Roboto, Arial, Helvetica, sans-serif;
      white-space: nowrap;
      pointer-events: none;
    }
    .yta-segment-toast {
      position: absolute;
      left: 16px;
      bottom: 58px;
      z-index: 61;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(360px, calc(100% - 32px));
      padding: 8px 8px 8px 12px;
      border-radius: 4px;
      color: #fff;
      background: rgba(28, 28, 28, .96);
      box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
      font: 500 13px/1.4 Roboto, Arial, Helvetica, sans-serif;
      opacity: 1;
      transform: translateY(0);
      transition: opacity 180ms cubic-bezier(.4, 0, 1, 1),
        transform 180ms cubic-bezier(.4, 0, 1, 1);
    }
    .yta-segment-toast[hidden] { display: none; }
    .yta-segment-toast[data-state="exiting"] {
      opacity: 0;
      transform: translateY(4px);
      pointer-events: none;
    }
    .yta-segment-toast__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .yta-segment-toast__undo {
      flex: none;
      min-width: 44px;
      min-height: 32px;
      padding: 0 8px;
      border: 0;
      border-radius: 2px;
      color: #5fead2;
      background: transparent;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .yta-segment-toast__undo:hover { background: rgb(34 211 180 / 14%); }
    .yta-segment-toast__undo:focus-visible { outline: 2px solid #3fe0c4; outline-offset: -2px; }
    .yta-download-feedback { display: none; }
    .yta-player-button[data-download-state="progress"] .yta-player-icon--default,
    .yta-player-button[data-download-state="success"] .yta-player-icon--default,
    .yta-player-button[data-download-state="failure"] .yta-player-icon--default { display: none; }
    .yta-player-button[data-download-state="progress"] .yta-download-progress,
    .yta-player-button[data-download-state="success"] .yta-download-success,
    .yta-player-button[data-download-state="failure"] .yta-download-failure { display: block; }
    .yta-download-progress circle {
      fill: none;
      stroke-width: 2;
    }
    .yta-download-progress-track { stroke: rgb(255 255 255 / 35%); }
    .yta-download-progress-indicator {
      stroke: #22d3b4;
      stroke-linecap: round;
      stroke-dasharray: 25.13 25.13;
      transform-origin: 12px 12px;
      transform: rotate(-90deg);
      animation: yta-download-spin 800ms linear infinite;
    }
    .yta-player-button[data-download-progress] .yta-download-progress-indicator {
      stroke-dasharray: 50.27;
      animation: none;
    }
    .yta-download-progress-value {
      fill: currentColor;
      font: 600 6px/1 Roboto, Arial, Helvetica, sans-serif;
    }
    .yta-download-success { color: #22d3b4; }
    .yta-download-failure { color: #ff5b57; }
    .yta-download-button--failure { animation: yta-download-shake 240ms ease-out 1; }
    .yta-download-reason {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      display: none;
      width: max-content;
      max-width: 240px;
      padding: 6px 8px;
      border-radius: 2px;
      color: #fff;
      background: rgba(28, 28, 28, .96);
      box-shadow: 0 2px 8px rgb(0 0 0 / 35%);
      font: 500 12px/1.4 Roboto, Arial, Helvetica, sans-serif;
      white-space: normal;
      pointer-events: none;
    }
    .yta-player-button[data-download-state="failure"] .yta-download-reason { display: block; }
    @keyframes yta-download-spin { to { transform: rotate(270deg); } }
    @keyframes yta-download-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-2px); }
      50% { transform: translateX(2px); }
      75% { transform: translateX(-1px); }
    }
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
      .yta-audio-only-coach, .yta-segment-toast { transition-duration: .001ms; }
      .yta-download-progress-indicator { animation: none; stroke-dasharray: 17 34; }
      .yta-download-button--failure { animation: none; }
    }
    @media (forced-colors: active) {
      .yta-player-button:focus-visible, .yta-segment-toast__undo:focus-visible {
        outline-color: Highlight;
      }
      .yta-player-button[aria-pressed="true"] .yta-player-icon path,
      .yta-download-success path { fill: Highlight; }
      .yta-audio-only-slash { stroke: CanvasText; }
      .yta-download-failure path { fill: Mark; }
      .yta-player-tooltip, .yta-segment-toast, .yta-download-reason {
        color: CanvasText;
        background: Canvas;
        border: 1px solid CanvasText;
      }
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

function getSkippedSegmentMessage(category: unknown): string | null {
  if (!isSponsorCategory(category)) return null;
  const label = category === 'music_offtopic' ? 'music off-topic' : category;
  return `Skipped ${label}`;
}

function announcePlayerStatus(message: string): void {
  const region = document.getElementById(PLAYER_STATUS_ID);
  if (region) region.textContent = message;
}

const downloadFeedbackControllers = new WeakMap<HTMLButtonElement, DownloadFeedbackController>();
const activeDownloadFeedback = new Map<string, DownloadFeedbackController>();

function handleDownloadProgressMessage(message: unknown): undefined {
  const progress = parseDownloadProgress(message);
  if (!progress) return undefined;
  const feedback = activeDownloadFeedback.get(progress.requestId);
  if (!feedback) return undefined;
  feedback.transition({ type: 'progress', loaded: progress.loaded, total: progress.total });
  if (__BENCH__) {
    document.documentElement.dataset.ytaDownloadProgress = String(
      Math.floor((progress.loaded / progress.total) * 100)
    );
  }
  return undefined;
}

function getDownloadFeedbackController(button: HTMLButtonElement): DownloadFeedbackController {
  const existing = downloadFeedbackControllers.get(button);
  if (existing) return existing;
  const controller = createDownloadFeedbackController(button, () =>
    document.getElementById(PLAYER_STATUS_ID)
  );
  downloadFeedbackControllers.set(button, controller);
  return controller;
}

function getDownloadFailureReason(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'download-timeout') return 'Timed out while preparing audio';
    if (error.message === 'download-unavailable') return 'Audio is unavailable';
    if (error.message === 'download-failed') return 'Browser could not start the download';
  }
  return 'Could not download audio';
}

async function requestAudioDownload(bridgeNonce: string, button: HTMLButtonElement): Promise<void> {
  if (!getSettings().enabled || !getSettings().downloadEnabled || button.disabled) return;
  let feedback: DownloadFeedbackController | null = null;
  try {
    feedback = getDownloadFeedbackController(button);
    feedback.transition({ type: 'start' });
  } catch {
    button.disabled = true;
    announcePlayerStatus('Preparing audio download');
  }
  const requestId = crypto.randomUUID();
  if (feedback) activeDownloadFeedback.set(requestId, feedback);
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
      requestId,
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
    if (feedback) feedback.transition({ type: 'succeed' });
    else announcePlayerStatus('Audio download started');
    if (__BENCH__) document.documentElement.dataset.ytaDownload = JSON.stringify(payload);
  } catch (error) {
    const reason = getDownloadFailureReason(error);
    if (feedback) feedback.transition({ type: 'fail', reason });
    else announcePlayerStatus(`Audio download failed: ${reason}`);
  } finally {
    activeDownloadFeedback.delete(requestId);
    if (!feedback) button.disabled = false;
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
  updateAudioOnlyButtonShape(button as HTMLButtonElement, active);
}

type StatusUpdateMessage = StatusUpdate & { type: typeof STATUS_UPDATE_MESSAGE };

/**
 * Build the background status message from a `yta:status` event. The ORDERING provenance is generated
 * in this isolated content context and never trusted from the page: the `yta:status` DOM event is
 * observable and forgeable by arbitrary page JS, so `generation` is the content-owned counter passed
 * in (a forged event cannot poison the popup's ordering with a huge generation), and `runStart` is the
 * isolated per-tab epoch. Only the display fields (`status`, `reason`, `videoId`) come from the event;
 * a forged `videoId` is harmless because the background's `resolveUiState` cross-checks it against the
 * real tab URL, and a momentary forged `status` is superseded by the next genuine report.
 */
export function buildStatusUpdateMessage(
  detail: unknown,
  runStart: number,
  generation: number
): StatusUpdateMessage | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const candidate = detail as { status?: unknown; reason?: unknown; videoId?: unknown };
  if (!isPlaybackStatus(candidate.status)) return null;
  const reason =
    typeof candidate.reason === 'string' && candidate.reason.length <= 120
      ? candidate.reason
      : undefined;
  const videoId =
    typeof candidate.videoId === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(candidate.videoId)
      ? candidate.videoId
      : undefined;
  return {
    type: STATUS_UPDATE_MESSAGE,
    status: candidate.status,
    ...(reason !== undefined ? { reason } : {}),
    ...(videoId !== undefined ? { videoId } : {}),
    runStart,
    generation,
  };
}

// Content-owned status ordering. Each distinct video begins a new generation, so a superseded SPA
// navigation's late status is dropped while a same-operation `fetching`→`active` (same video) keeps
// its generation. Because the counter lives here (isolated world) and is never read from the
// page-observable event, a hostile page cannot forge a huge generation to freeze the popup.
let statusGeneration = 0;
let lastStatusVideoId: string | null = null;

function nextStatusGeneration(detail: unknown): number {
  const videoId =
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as { videoId?: unknown }).videoId === 'string'
      ? (detail as { videoId: string }).videoId
      : null;
  if (videoId !== null && videoId !== lastStatusVideoId) {
    lastStatusVideoId = videoId;
    statusGeneration += 1;
  }
  return statusGeneration;
}

function updateStatusMarker(event: Event): void {
  const detail = (event as CustomEvent<unknown>).detail;
  const message = buildStatusUpdateMessage(detail, statusRunStart, nextStatusGeneration(detail));
  if (!message) return;

  // Bench-only observable DOM marker (unchanged): the hermetic integration bench reads these.
  if (__BENCH__) {
    document.documentElement.dataset.ytaStatus = message.status;
    if (message.reason) document.documentElement.dataset.ytaReason = message.reason;
    else delete document.documentElement.dataset.ytaReason;
  }

  // Production: relay the real per-video status to the background per-tab map so the popup can read
  // the honest state of THIS tab. Additive to the bench marker; both run under the bench build.
  pushStatusToBackground(message);
}

/**
 * Forward the page world's status to the background. Fail-open by contract: a torn-down or
 * unavailable background context (or any messaging rejection) must never surface into the page or
 * disturb playback, so every failure is swallowed.
 */
function pushStatusToBackground(message: StatusUpdateMessage): void {
  try {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Never let a status relay failure break the page.
  }
}
