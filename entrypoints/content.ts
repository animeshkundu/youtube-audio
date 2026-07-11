import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';

import {
  getSettings,
  initializeSettings,
  setAudioOnlyEnabled,
  subscribeSettings,
  watchSettings,
} from '../src/shared/config';
import { isAllowedAudioUrl, isSafeDownloadFilename } from '../src/shared/download';
import { parseLrc, type LyricLine } from '../src/shared/lyrics';
import { buildDistractionStyles } from '../src/shared/quality-of-life';
import { isSponsorCategory } from '../src/shared/sponsorblock';

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
const BUTTON_ID = 'yta-audio-only-toggle';
const SEGMENT_BUTTON_ID = 'yta-segment-status';
const DOWNLOAD_BUTTON_ID = 'yta-download-audio';
const LYRICS_ID = 'yta-synced-lyrics';
const DISTRACTION_STYLE_ID = 'yta-distraction-style';
const PLAYER_CONTROL_STYLE_ID = 'yta-player-control-style';
let lyricsCleanup: () => void = () => undefined;

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
      await initializeSettings();
      watchSettings();
      subscribeSettings((settings) => {
        window.postMessage({ channel: SETTINGS_EVENT, nonce: bridgeNonce, settings }, location.origin);
        updateToggle(settings.enabled && settings.audioOnlyEnabled);
        updateSegmentStatus(settings.enabled && settings.segmentSkipEnabled);
        updateDownloadButton(settings.enabled && settings.downloadEnabled);
        updateDistractionStyle(settings);
        if (!settings.enabled || !settings.lyricsEnabled) removeLyrics();
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

function installPlayerControls(bridgeNonce: string): void {
  installPlayerControlStyles();
  const attach = () => {
    const controls = document.querySelector('.ytp-right-controls, .ytp-left-controls');
    if (!controls) return;

    if (!document.getElementById(BUTTON_ID)) {
      const button = createPlayerButton(BUTTON_ID, 'Toggle audio-only playback', '♪');
      button.addEventListener('click', () => {
        const settings = getSettings();
        void setAudioOnlyEnabled(!settings.audioOnlyEnabled).catch(() => undefined);
      });
      controls.prepend(button);
      updateToggle(getSettings().enabled && getSettings().audioOnlyEnabled);
    }

    if (!document.getElementById(SEGMENT_BUTTON_ID)) {
      const button = createPlayerButton(SEGMENT_BUTTON_ID, 'Segment skipping status', '↗');
      button.disabled = true;
      controls.prepend(button);
      updateSegmentStatus(getSettings().enabled && getSettings().segmentSkipEnabled);
    }

    if (!document.getElementById(DOWNLOAD_BUTTON_ID)) {
      const button = createPlayerButton(DOWNLOAD_BUTTON_ID, 'Download audio', '↓');
      button.addEventListener('click', () => {
        void requestAudioDownload(bridgeNonce, button);
      });
      controls.prepend(button);
      updateDownloadButton(getSettings().enabled && getSettings().downloadEnabled);
    }
  };

  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
}

function createPlayerButton(id: string, label: string, glyph: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'ytp-button yta-player-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = glyph;
  return button;
}

function installPlayerControlStyles(): void {
  if (document.getElementById(PLAYER_CONTROL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PLAYER_CONTROL_STYLE_ID;
  style.textContent = `
    .yta-player-button {
      min-width: 44px;
      min-height: 44px;
      color: #fff;
      background: transparent;
      border: 0;
      font: 500 20px/44px Roboto, Arial, Helvetica, sans-serif;
      text-align: center;
      cursor: pointer;
      transition: color 120ms cubic-bezier(.2,0,0,1), transform 90ms cubic-bezier(.2,0,0,1);
    }
    .yta-player-button:hover { transform: scale(1.06); }
    .yta-player-button:focus-visible { outline: 2px solid #3fe0c4; outline-offset: -4px; }
    .yta-player-button[aria-pressed="true"],
    .yta-player-button[data-active="true"] { color: #22d3b4; }
    .yta-player-button:disabled { cursor: default; opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .yta-player-button { transition-duration: .001ms; }
      .yta-player-button:hover { transform: none; }
    }
  `;
  (document.head ?? document.documentElement).append(style);
}

async function requestAudioDownload(bridgeNonce: string, button: HTMLButtonElement): Promise<void> {
  if (!getSettings().enabled || !getSettings().downloadEnabled || button.disabled) return;
  button.disabled = true;
  button.title = 'Preparing audio download';
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
    if (typeof response !== 'object' || response === null || (response as { ok?: unknown }).ok !== true) {
      throw new Error('download-failed');
    }
    button.title = 'Audio download started';
    if (__BENCH__) document.documentElement.dataset.ytaDownload = JSON.stringify(payload);
  } catch {
    button.title = 'Audio download failed';
  } finally {
    button.disabled = false;
  }
}

function updateDownloadButton(visible: boolean): void {
  const button = document.getElementById(DOWNLOAD_BUTTON_ID);
  if (button) button.hidden = !visible;
}

function updateSegmentStatus(active: boolean): void {
  const button = document.getElementById(SEGMENT_BUTTON_ID);
  if (!button) return;
  button.dataset.active = String(active);
  button.setAttribute('aria-label', active ? 'Segment skipping is on' : 'Segment skipping is off');
  button.title = active ? 'Segment skipping is on' : 'Segment skipping is off';
}

function updateToggle(active: boolean): void {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Audio-only is on' : 'Audio-only is off');
  button.title = active ? 'Audio-only is on' : 'Audio-only is off';
}

function updateStatusMarker(event: Event): void {
  if (!__BENCH__) return;
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) return;
  const status = (detail as { status?: unknown }).status;
  if (typeof status === 'string' && status.length <= 24) document.documentElement.dataset.ytaStatus = status;
}
