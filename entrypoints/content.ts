import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';

import {
  getSettings,
  initializeSettings,
  setAudioOnlyEnabled,
  subscribeSettings,
  watchSettings,
} from '../src/shared/config';
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
const BUTTON_ID = 'yta-audio-only-toggle';
const LYRICS_ID = 'yta-synced-lyrics';
const DISTRACTION_STYLE_ID = 'yta-distraction-style';
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
      installPlayerToggle();
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

function installPlayerToggle(): void {
  const attach = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const controls = document.querySelector('.ytp-right-controls, .ytp-left-controls');
    if (!controls) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'ytp-button';
    button.title = 'Toggle audio-only playback';
    button.setAttribute('aria-label', 'Toggle audio-only playback');
    button.style.cssText =
      'font-size:20px;line-height:36px;text-align:center;color:#fff;background:transparent;border:0;cursor:pointer;';
    button.textContent = '♪';
    button.addEventListener('click', () => {
      const settings = getSettings();
      void setAudioOnlyEnabled(!settings.audioOnlyEnabled).catch(() => undefined);
    });
    controls.prepend(button);
    updateToggle(getSettings().enabled && getSettings().audioOnlyEnabled);
  };

  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
}

function updateToggle(active: boolean): void {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  button.setAttribute('aria-pressed', String(active));
  button.style.color = active ? '#22d3b4' : '#fff';
  button.title = active ? 'Audio-only is on' : 'Audio-only is off';
}

function updateStatusMarker(event: Event): void {
  if (!__BENCH__) return;
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) return;
  const status = (detail as { status?: unknown }).status;
  if (typeof status === 'string' && status.length <= 24) document.documentElement.dataset.ytaStatus = status;
}
