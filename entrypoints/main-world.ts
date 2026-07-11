import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { buildAndroidVrPlayerRequest, getPlayability, pickBestAudioUrl } from '../src/shared/innertube';
import { PlayerHandle } from '../src/shared/player';
import { loadRescueConfig } from '../src/shared/rescue';
import { applyScriptletOperations } from '../src/shared/scriptlets';
import { observeYouTubeSpa } from '../src/shared/spa';

const SETTINGS_EVENT = 'yta:settings';
const STATUS_EVENT = 'yta:status';
const VIDEO_WAIT_MS = 8_000;

type PlaybackStatus = 'idle' | 'fetching' | 'active' | 'fallback' | 'disabled';

interface PageSettings {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  backgroundPlayEnabled: boolean;
  adBlockEnabled: boolean;
}

interface YouTubeConfig {
  get?(key: string): unknown;
  data_?: Record<string, unknown>;
}

declare global {
  interface Window {
    ytcfg?: YouTubeConfig;
  }
}

export default defineUnlistedScript(() => {
  const player = new PlayerHandle();
  const bridgeNonce = readAndClearBridgeNonce();
  let settings: PageSettings = {
    enabled: false,
    audioOnlyEnabled: false,
    backgroundPlayEnabled: false,
    adBlockEnabled: false,
  };
  let generation = player.navigate();
  let visibilityCleanup: () => void = () => undefined;
  let scriptletCleanup: () => void = () => undefined;
  let scriptletGeneration = 0;

  const emitStatus = (status: PlaybackStatus, reason?: string) => {
    document.dispatchEvent(
      new CustomEvent(STATUS_EVENT, {
        detail: { status, ...(reason ? { reason: reason.slice(0, 120) } : {}) },
      })
    );
  };

  const applySettings = (next: PageSettings) => {
    settings = next;
    visibilityCleanup();
    visibilityCleanup = settings.enabled && settings.backgroundPlayEnabled ? enableBackgroundPlay() : () => undefined;
    const nextScriptletGeneration = ++scriptletGeneration;
    scriptletCleanup();
    scriptletCleanup = () => undefined;
    if (settings.enabled && settings.adBlockEnabled) {
      void loadRescueConfig()
        .then((config) => {
          if (nextScriptletGeneration !== scriptletGeneration) return;
          scriptletCleanup = applyScriptletOperations(config.scriptlets).cleanup;
        })
        .catch(() => undefined);
    }
    generation = player.navigate();
    if (!settings.enabled || !settings.audioOnlyEnabled) {
      emitStatus('disabled');
      return;
    }
    void activateAudioOnly(generation);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { channel?: unknown; nonce?: unknown; settings?: unknown } | null;
    if (!data || data.channel !== SETTINGS_EVENT) return;
    // Reject forged same-origin messages: only the content script knows this per-load nonce.
    if (!bridgeNonce || data.nonce !== bridgeNonce) return;
    const next = parseSettings(data.settings);
    if (next) applySettings(next);
  });

  observeYouTubeSpa(() => {
    generation = player.navigate();
    if (settings.enabled && settings.audioOnlyEnabled) void activateAudioOnly(generation);
  });

  async function activateAudioOnly(operationGeneration: number): Promise<void> {
    try {
      const videoId = getVideoId();
      const apiKey = getConfigString('INNERTUBE_API_KEY');
      if (!videoId || !apiKey) {
        emitStatus('fallback', 'not-a-watch-page');
        return;
      }

      emitStatus('fetching');
      const visitorData = getConfigString('VISITOR_DATA');
      const response = await fetch(
        `/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
        {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildAndroidVrPlayerRequest(videoId, visitorData ?? undefined)),
        }
      );
      if (operationGeneration !== player.generation) return;
      if (!response.ok) {
        emitStatus('fallback', `http-${response.status}`);
        return;
      }

      const playerResponse: unknown = await response.json();
      if (operationGeneration !== player.generation) return;
      const playability = getPlayability(playerResponse);
      if (!playability.isPlayable) {
        emitStatus('fallback', playability.status ?? 'unplayable');
        return;
      }

      const audioUrl = pickBestAudioUrl(playerResponse);
      if (!audioUrl || !isAllowedAudioUrl(audioUrl)) {
        emitStatus('fallback', 'no-direct-audio');
        return;
      }
      const mediaElement = await waitForVideo(operationGeneration);
      if (!mediaElement || operationGeneration !== player.generation) return;
      if (player.attach(mediaElement, audioUrl, operationGeneration)) emitStatus('active');
      else emitStatus('fallback', 'media-attach-failed');
    } catch {
      if (operationGeneration === player.generation) emitStatus('fallback', 'request-failed');
    }
  }

  async function waitForVideo(operationGeneration: number): Promise<HTMLMediaElement | null> {
    const existing = document.querySelector<HTMLMediaElement>('video');
    if (existing) return existing;
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (operationGeneration !== player.generation) finish(null);
        const video = document.querySelector<HTMLMediaElement>('video');
        if (video) finish(video);
      });
      const timeout = window.setTimeout(() => finish(null), VIDEO_WAIT_MS);
      const finish = (video: HTMLMediaElement | null) => {
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(video);
      };
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
});

function readAndClearBridgeNonce(): string | null {
  try {
    const el = document.documentElement;
    const nonce = el.dataset.ytaBridge ?? null;
    delete el.dataset.ytaBridge;
    return nonce;
  } catch {
    return null;
  }
}

function getVideoId(): string | null {
  try {
    const id = new URL(location.href).searchParams.get('v');
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function getConfigString(key: string): string | null {
  try {
    const value = window.ytcfg?.get?.(key) ?? window.ytcfg?.data_?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function isAllowedAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isBench = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    return (
      (url.protocol === 'https:' &&
        (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'))) ||
      (isBench && url.origin === location.origin)
    );
  } catch {
    return false;
  }
}

function parseSettings(value: unknown): PageSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<PageSettings>;
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.audioOnlyEnabled !== 'boolean' ||
    typeof candidate.backgroundPlayEnabled !== 'boolean' ||
    typeof candidate.adBlockEnabled !== 'boolean'
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    audioOnlyEnabled: candidate.audioOnlyEnabled,
    backgroundPlayEnabled: candidate.backgroundPlayEnabled,
    adBlockEnabled: candidate.adBlockEnabled,
  };
}

function enableBackgroundPlay(): () => void {
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  const swallow = (event: Event) => event.stopImmediatePropagation();
  let hiddenPatched = false;
  let visibilityPatched = false;
  let listenerAdded = false;

  const cleanup = () => {
    if (listenerAdded) document.removeEventListener('visibilitychange', swallow, true);
    try {
      if (hiddenPatched) {
        if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
        else delete (document as unknown as Record<string, unknown>).hidden;
      }
      if (visibilityPatched) {
        if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
        else delete (document as unknown as Record<string, unknown>).visibilityState;
      }
    } catch {
      // Keep the fail-open page boundary intact.
    }
  };

  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    hiddenPatched = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    visibilityPatched = true;
    document.addEventListener('visibilitychange', swallow, true);
    listenerAdded = true;
  } catch {
    // Roll back any partial override so normal YouTube visibility behaviour is preserved.
    cleanup();
    return () => undefined;
  }

  return cleanup;
}
