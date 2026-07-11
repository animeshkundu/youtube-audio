import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { createAudioGraph, loudnessDbToGain, type EqualizerBands } from '../src/shared/audiograph';
import { buildAudioFilename, isAllowedAudioUrl } from '../src/shared/download';
import {
  buildAndroidVrPlayerRequest,
  getPlayability,
  isLiveStream,
  pickBestAudioFormat,
  pickBestAudioUrl,
  type PlayerResponse,
} from '../src/shared/innertube';
import { PlayerHandle } from '../src/shared/player';
import { getQualityLabel, isQualityCap, type QualityCap } from '../src/shared/quality-of-life';
import { loadRescueConfig } from '../src/shared/rescue';
import { applyScriptletOperations } from '../src/shared/scriptlets';
import { observeYouTubeSpa } from '../src/shared/spa';
import {
  isSponsorCategory,
  type SponsorCategory,
  type SponsorSegment,
} from '../src/shared/sponsorblock';

const SETTINGS_EVENT = 'yta:settings';
const STATUS_EVENT = 'yta:status';
const SPONSOR_REQUEST_EVENT = 'yta:sponsor-request';
const SPONSOR_RESPONSE_EVENT = 'yta:sponsor-response';
const TRACK_EVENT = 'yta:track';
const DOWNLOAD_REQUEST_EVENT = 'yta:download-request';
const DOWNLOAD_RESPONSE_EVENT = 'yta:download-response';
const VIDEO_WAIT_MS = 8_000;

type PlaybackStatus = 'idle' | 'fetching' | 'active' | 'fallback' | 'disabled';

interface PageSettings {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  backgroundPlayEnabled: boolean;
  adBlockEnabled: boolean;
  segmentSkipEnabled: boolean;
  segmentSkipCategories: readonly SponsorCategory[];
  forceQualityMax: QualityCap;
  disableAutoplayNext: boolean;
  loudnessNormalization: boolean;
  equalizerEnabled: boolean;
  equalizerBands: EqualizerBands;
  lyricsEnabled: boolean;
  downloadEnabled: boolean;
}

interface YouTubeConfig {
  get?(key: string): unknown;
  data_?: Record<string, unknown>;
}

interface YouTubePlayerElement extends HTMLElement {
  setPlaybackQualityRange?(minimum: string, maximum?: string): void;
  setPlaybackQuality?(quality: string): void;
}

declare global {
  interface Window {
    ytcfg?: YouTubeConfig;
  }
}

declare const __BENCH__: boolean;

export default defineUnlistedScript(() => {
  const player = new PlayerHandle();
  const bridgeNonce = readAndClearBridgeNonce();
  let settings: PageSettings = {
    enabled: false,
    audioOnlyEnabled: false,
    backgroundPlayEnabled: false,
    adBlockEnabled: false,
    segmentSkipEnabled: false,
    segmentSkipCategories: [],
    forceQualityMax: 'off',
    disableAutoplayNext: false,
    loudnessNormalization: false,
    equalizerEnabled: false,
    equalizerBands: [],
    lyricsEnabled: false,
    downloadEnabled: false,
  };
  let generation = player.navigate();
  let visibilityCleanup: () => void = () => undefined;
  let scriptletCleanup: () => void = () => undefined;
  let segmentSkipCleanup: () => void = () => undefined;
  let qualityOfLifeCleanup: () => void = () => undefined;
  let scriptletGeneration = 0;
  let segmentSkipGeneration = 0;
  let lastSkipKey = '';
  let audioGraphCleanup: () => void = () => undefined;

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
    visibilityCleanup =
      settings.enabled && settings.backgroundPlayEnabled ? enableBackgroundPlay() : () => undefined;
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
    restartSegmentSkipping();
    qualityOfLifeCleanup();
    qualityOfLifeCleanup = applyQualityOfLife(settings);
    audioGraphCleanup();
    audioGraphCleanup = () => undefined;
    if (!settings.enabled) {
      emitStatus('disabled');
      return;
    }
    if (
      settings.audioOnlyEnabled ||
      settings.loudnessNormalization ||
      settings.equalizerEnabled ||
      settings.lyricsEnabled
    ) {
      void activateEnhancements(generation);
    } else {
      emitStatus('disabled');
    }
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

  document.addEventListener(DOWNLOAD_REQUEST_EVENT, (event) => {
    void handleDownloadRequest(event);
  });

  async function handleDownloadRequest(event: Event): Promise<void> {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string' || !bridgeNonce) return;
    let requestId: string;
    try {
      const parsed: unknown = JSON.parse(detail);
      if (typeof parsed !== 'object' || parsed === null) return;
      const candidate = parsed as { nonce?: unknown; requestId?: unknown };
      if (
        candidate.nonce !== bridgeNonce ||
        typeof candidate.requestId !== 'string' ||
        candidate.requestId.length > 64
      ) {
        return;
      }
      requestId = candidate.requestId;
    } catch {
      return;
    }

    const respond = (payload: Record<string, unknown>) => {
      document.dispatchEvent(
        new CustomEvent(DOWNLOAD_RESPONSE_EVENT, {
          detail: JSON.stringify({ nonce: bridgeNonce, requestId, ...payload }),
        })
      );
    };
    if (!settings.enabled || !settings.downloadEnabled) {
      respond({ ok: false, reason: 'disabled' });
      return;
    }
    try {
      const videoId = getVideoId();
      const apiKey = getConfigString('INNERTUBE_API_KEY');
      if (!videoId || !apiKey) {
        respond({ ok: false, reason: 'not-a-watch-page' });
        return;
      }
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
      if (!response.ok) {
        respond({ ok: false, reason: `http-${response.status}` });
        return;
      }
      const playerResponse: unknown = await response.json();
      if (!getPlayability(playerResponse).isPlayable) {
        respond({ ok: false, reason: 'unplayable' });
        return;
      }
      if (isLiveStream(playerResponse)) {
        // A live-edge audio url is not a finite downloadable file.
        respond({ ok: false, reason: 'live' });
        return;
      }
      const format = pickBestAudioFormat(playerResponse);
      const url = format?.url;
      const title = (playerResponse as PlayerResponse).videoDetails?.title;
      const benchOrigin = __BENCH__ ? location.origin : undefined;
      if (!url || !isAllowedAudioUrl(url, benchOrigin) || typeof title !== 'string') {
        respond({ ok: false, reason: 'no-direct-audio' });
        return;
      }
      respond({ ok: true, url, filename: buildAudioFilename(title, format.itag) });
    } catch {
      respond({ ok: false, reason: 'request-failed' });
    }
  }

  observeYouTubeSpa(() => {
    generation = player.navigate();
    restartSegmentSkipping();
    qualityOfLifeCleanup();
    qualityOfLifeCleanup = applyQualityOfLife(settings);
    if (
      settings.enabled &&
      (settings.audioOnlyEnabled ||
        settings.loudnessNormalization ||
        settings.equalizerEnabled ||
        settings.lyricsEnabled)
    ) {
      void activateEnhancements(generation);
    }
  });

  function restartSegmentSkipping(): void {
    const videoId = settings.enabled && settings.segmentSkipEnabled ? getVideoId() : null;
    const categories = settings.segmentSkipCategories;
    // Skip redundant restarts (settings echoes, duplicate SPA "initial" ticks): re-triggering
    // for identical (video, categories) state would cancel an in-flight install via the
    // generation guard below. Only restart when the effective state actually changes.
    const key = videoId && categories.length > 0 ? `${videoId}|${categories.join(',')}` : '';
    if (key === lastSkipKey) return;
    lastSkipKey = key;
    const operationGeneration = ++segmentSkipGeneration;
    segmentSkipCleanup();
    segmentSkipCleanup = () => undefined;
    if (!videoId || categories.length === 0) return;
    void requestSponsorSegments(videoId, categories)
      .then(async (segments) => {
        if (operationGeneration !== segmentSkipGeneration || segments.length === 0) return;
        const mediaElement = await waitForCurrentVideo(operationGeneration);
        if (!mediaElement || operationGeneration !== segmentSkipGeneration) return;
        segmentSkipCleanup = installSegmentSkipping(mediaElement, segments);
      })
      .catch(() => undefined);
  }

  async function waitForCurrentVideo(
    operationGeneration: number
  ): Promise<HTMLMediaElement | null> {
    const existing = document.querySelector<HTMLMediaElement>('video');
    if (existing) return existing;
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (operationGeneration !== segmentSkipGeneration) finish(null);
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

  async function activateEnhancements(operationGeneration: number): Promise<void> {
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

      const mediaElement = await waitForVideo(operationGeneration);
      if (!mediaElement || operationGeneration !== player.generation) return;
      const responseData = playerResponse as PlayerResponse;
      armAudioGraph(mediaElement, responseData.playerConfig?.audioConfig?.loudnessDb);
      emitTrack(responseData);

      if (!settings.audioOnlyEnabled) {
        emitStatus('active');
        return;
      }
      // Live/DVR broadcasts return OK + an audio url, but that url is a live-edge segment that
      // stalls when hijacked as a progressive <video>.src. Leave YouTube's native player in control
      // (the audio graph armed above still applies loudness/EQ to normal playback).
      if (isLiveStream(playerResponse)) {
        emitStatus('fallback', 'live');
        return;
      }
      const audioUrl = pickBestAudioUrl(playerResponse);
      if (!audioUrl || !isAllowedAudioUrl(audioUrl, __BENCH__ ? location.origin : undefined)) {
        emitStatus('fallback', 'no-direct-audio');
        return;
      }
      if (player.attach(mediaElement, audioUrl, operationGeneration)) emitStatus('active');
      else emitStatus('fallback', 'media-attach-failed');
    } catch {
      if (operationGeneration === player.generation) emitStatus('fallback', 'request-failed');
    }
  }

  function armAudioGraph(media: HTMLMediaElement, loudnessDb: number | undefined): void {
    if (!settings.loudnessNormalization && !settings.equalizerEnabled) return;
    const graph = createAudioGraph(media);
    if (!graph) return;
    const gain = settings.loudnessNormalization ? loudnessDbToGain(loudnessDb ?? Number.NaN) : 1;
    graph.setGain(gain);
    graph.setEqualizer(settings.equalizerEnabled, settings.equalizerBands);
    audioGraphCleanup = () => graph.dispose();
    if (__BENCH__) {
      document.documentElement.dataset.ytaAudioGraph = JSON.stringify({ gain });
    }
  }

  function emitTrack(response: PlayerResponse): void {
    if (!settings.lyricsEnabled) return;
    const details = response.videoDetails;
    const duration = Number(details?.lengthSeconds);
    if (
      typeof details?.videoId !== 'string' ||
      typeof details.title !== 'string' ||
      typeof details.author !== 'string' ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }
    document.dispatchEvent(
      new CustomEvent(TRACK_EVENT, {
        // Firefox drops non-string detail across the MAIN to isolated boundary too.
        detail: JSON.stringify({
          videoId: details.videoId,
          title: details.title.slice(0, 200),
          artist: details.author.slice(0, 200),
          duration,
        }),
      })
    );
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

function applyQualityOfLife(settings: PageSettings): () => void {
  if (!settings.enabled) return () => undefined;
  const qualityLabel = getQualityLabel(settings.forceQualityMax);
  const timers: number[] = [];
  let observedPlayer: YouTubePlayerElement | null = null;
  const reassertQuality = () => {
    if (!qualityLabel) return;
    try {
      const player = document.querySelector<YouTubePlayerElement>(
        '#movie_player, .html5-video-player'
      );
      if (!player) return;
      observedPlayer ??= player;
      player.setPlaybackQualityRange?.(qualityLabel, qualityLabel);
      player.setPlaybackQuality?.(qualityLabel);
    } catch {
      // Undocumented player APIs are optional; native ABR remains in control on failure.
    }
  };
  const disableAutoplay = () => {
    if (!settings.disableAutoplayNext) return;
    try {
      const toggle = document.querySelector<HTMLElement>('.ytp-autonav-toggle-button');
      if (toggle?.getAttribute('aria-checked') === 'true') toggle.click();
    } catch {
      // A missing or changing native control leaves YouTube's current state untouched.
    }
  };
  const apply = () => {
    reassertQuality();
    disableAutoplay();
  };
  const qualityChanged = () => reassertQuality();
  apply();
  for (const delay of [300, 800, 1_500, 3_000]) {
    timers.push(window.setTimeout(apply, delay));
  }
  try {
    const eventPlayer = document.querySelector<YouTubePlayerElement>(
      '#movie_player, .html5-video-player'
    );
    if (eventPlayer) {
      observedPlayer = eventPlayer;
      eventPlayer.addEventListener('onPlaybackQualityChange', qualityChanged);
    }
  } catch {
    // Timed retries still provide bounded reassertion.
  }
  return () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    try {
      observedPlayer?.removeEventListener?.('onPlaybackQualityChange', qualityChanged);
    } catch {
      // Cleanup failures must not affect the page.
    }
  };
}

function requestSponsorSegments(
  videoId: string,
  categories: readonly SponsorCategory[]
): Promise<readonly SponsorSegment[]> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const bridgeNonce = readBridgeNonceForRequest();
    if (!bridgeNonce) {
      resolve([]);
      return;
    }
    let settled = false;
    const finish = (segments: readonly SponsorSegment[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      document.removeEventListener(SPONSOR_RESPONSE_EVENT, handleResponse);
      resolve(segments);
    };
    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      let candidate: { nonce?: unknown; requestId?: unknown; segments?: unknown };
      try {
        const parsed: unknown = JSON.parse(detail);
        if (typeof parsed !== 'object' || parsed === null) return;
        candidate = parsed;
      } catch {
        return;
      }
      if (candidate.nonce !== bridgeNonce || candidate.requestId !== requestId) return;
      finish(parseSponsorSegments(candidate.segments));
    };
    const timeout = window.setTimeout(() => finish([]), VIDEO_WAIT_MS);
    document.addEventListener(SPONSOR_RESPONSE_EVENT, handleResponse);
    document.dispatchEvent(
      new CustomEvent(SPONSOR_REQUEST_EVENT, {
        detail: { nonce: bridgeNonce, requestId, videoId, categories },
      })
    );
  });
}

let sponsorBridgeNonce: string | null = null;

function readBridgeNonceForRequest(): string | null {
  return sponsorBridgeNonce;
}

function installSegmentSkipping(
  video: HTMLMediaElement,
  segments: readonly SponsorSegment[]
): () => void {
  const handled = new Set<number>();
  if (__BENCH__) document.documentElement.dataset.ytaSkipArmed = String(segments.length);
  const onTimeUpdate = () => {
    try {
      if (video.readyState < 1) return;
      const currentTime = video.currentTime;
      // A segment counts as handled only once playback has actually moved past its end, so a
      // seek that fails to stick (e.g. a media reset during load) is retried, not consumed.
      for (let index = 0; index < segments.length; index += 1) {
        const seg = segments[index];
        if (seg && currentTime >= seg.segment[1]) handled.add(index);
      }
      for (let index = 0; index < segments.length; index += 1) {
        if (handled.has(index)) continue;
        const segment = segments[index];
        if (!segment) continue;
        const [start, end] = segment.segment;
        if (currentTime < start || currentTime >= end) continue;
        const target =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(end, video.duration)
            : end;
        if (target > currentTime) video.currentTime = target;
        return;
      }
    } catch {
      // Seeking failures leave the page's current playback state untouched.
    }
  };
  try {
    video.addEventListener('timeupdate', onTimeUpdate);
    onTimeUpdate();
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  } catch {
    return () => undefined;
  }
}

function parseSponsorSegments(value: unknown): readonly SponsorSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: SponsorSegment[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return [];
    const candidate = item as { segment?: unknown; category?: unknown; actionType?: unknown };
    if (
      !Array.isArray(candidate.segment) ||
      candidate.segment.length !== 2 ||
      typeof candidate.segment[0] !== 'number' ||
      typeof candidate.segment[1] !== 'number' ||
      !Number.isFinite(candidate.segment[0]) ||
      !Number.isFinite(candidate.segment[1]) ||
      candidate.segment[0] < 0 ||
      candidate.segment[1] <= candidate.segment[0] ||
      !isSponsorCategory(candidate.category) ||
      candidate.actionType !== 'skip'
    ) {
      return [];
    }
    segments.push({
      segment: [candidate.segment[0], candidate.segment[1]],
      category: candidate.category,
      actionType: 'skip',
    });
  }
  return segments;
}

function readAndClearBridgeNonce(): string | null {
  try {
    const el = document.documentElement;
    const nonce = el.dataset.ytaBridge ?? null;
    delete el.dataset.ytaBridge;
    sponsorBridgeNonce = nonce;
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

function parseSettings(value: unknown): PageSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<PageSettings>;
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.audioOnlyEnabled !== 'boolean' ||
    typeof candidate.backgroundPlayEnabled !== 'boolean' ||
    typeof candidate.adBlockEnabled !== 'boolean' ||
    typeof candidate.segmentSkipEnabled !== 'boolean' ||
    !Array.isArray(candidate.segmentSkipCategories) ||
    !candidate.segmentSkipCategories.every(isSponsorCategory) ||
    !isQualityCap(candidate.forceQualityMax) ||
    typeof candidate.disableAutoplayNext !== 'boolean' ||
    typeof candidate.loudnessNormalization !== 'boolean' ||
    typeof candidate.equalizerEnabled !== 'boolean' ||
    !Array.isArray(candidate.equalizerBands) ||
    candidate.equalizerBands.length !== 5 ||
    !candidate.equalizerBands.every(
      (gain) => typeof gain === 'number' && Number.isFinite(gain) && gain >= -12 && gain <= 12
    ) ||
    typeof candidate.lyricsEnabled !== 'boolean' ||
    typeof candidate.downloadEnabled !== 'boolean'
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    audioOnlyEnabled: candidate.audioOnlyEnabled,
    backgroundPlayEnabled: candidate.backgroundPlayEnabled,
    adBlockEnabled: candidate.adBlockEnabled,
    segmentSkipEnabled: candidate.segmentSkipEnabled,
    segmentSkipCategories: candidate.segmentSkipCategories,
    forceQualityMax: candidate.forceQualityMax,
    disableAutoplayNext: candidate.disableAutoplayNext,
    loudnessNormalization: candidate.loudnessNormalization,
    equalizerEnabled: candidate.equalizerEnabled,
    equalizerBands: candidate.equalizerBands,
    lyricsEnabled: candidate.lyricsEnabled,
    downloadEnabled: candidate.downloadEnabled,
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
        if (visibilityDescriptor)
          Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
        else delete (document as unknown as Record<string, unknown>).visibilityState;
      }
    } catch {
      // Keep the fail-open page boundary intact.
    }
  };

  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    hiddenPatched = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
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
