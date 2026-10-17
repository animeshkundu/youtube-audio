import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { createAudioGraph, loudnessDbToGain, type EqualizerBands } from '../src/shared/audiograph';
import { pickArtworkUrl, showArtworkOverlay } from '../src/shared/artwork';
import { createPageLogger, errorFields } from '../src/shared/diagnostics';
import { buildAudioFilename, isAllowedAudioUrl } from '../src/shared/download';
import {
  fallbackQualityEngaged,
  selectLowestQualityLabel,
  switchToSongMode,
} from '../src/shared/fallback-quality';
import {
  IDLE_NAG_PRIME_MS,
  dismissIdleNag,
  findIdleNagRenderer,
  isIdleNagNodeName,
  nextIdleNagDelayMs,
} from '../src/shared/idle-nag';
import {
  buildPlayerRequest,
  getPlayability,
  isLiveStream,
  pickBestAudioFormat,
  pickBestAudioUrl,
  walkMediaClients,
  type MediaClientWalkOutcome,
  type PlayerResponse,
} from '../src/shared/innertube';
import { PlayerHandle } from '../src/shared/player';
import { getQualityLabel, isQualityCap, type QualityCap } from '../src/shared/quality-of-life';
import { armOneShotPause, createReclaimTracker } from '../src/shared/reclaim';
import { loadRescueConfig } from '../src/shared/rescue';
import { applyScriptletOperations } from '../src/shared/scriptlets';
import { observeYouTubeSpa } from '../src/shared/spa';
import { parseVideoId, type PlaybackStatus } from '../src/shared/status';
import {
  isSponsorCategory,
  type SponsorCategory,
  type SponsorSegment,
} from '../src/shared/sponsorblock';

const SETTINGS_EVENT = 'yta:settings';
const STATUS_EVENT = 'yta:status';
const SPONSOR_REQUEST_EVENT = 'yta:sponsor-request';
const SPONSOR_RESPONSE_EVENT = 'yta:sponsor-response';
const DOWNLOAD_REQUEST_EVENT = 'yta:download-request';
const DOWNLOAD_RESPONSE_EVENT = 'yta:download-response';
const SEGMENT_SKIPPED_EVENT = 'yta:segment-skipped';
const VIDEO_WAIT_MS = 8_000;
// SPEC-017: one bounded retry when the player (or, on Music, the song toggle) has not mounted yet.
const FALLBACK_QUALITY_RETRY_MS = 1_000;

interface PageSettings {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  audioArtworkEnabled: boolean;
  backgroundPlayEnabled: boolean;
  idleNagDefeatEnabled: boolean;
  fallbackQualityCapEnabled: boolean;
  adBlockEnabled: boolean;
  segmentSkipEnabled: boolean;
  segmentSkipCategories: readonly SponsorCategory[];
  forceQualityMax: QualityCap;
  disableAutoplayNext: boolean;
  loudnessNormalization: boolean;
  equalizerEnabled: boolean;
  equalizerBands: EqualizerBands;
  downloadEnabled: boolean;
}

interface YouTubeConfig {
  get?(key: string): unknown;
  data_?: Record<string, unknown>;
}

interface PlaybackOperation {
  videoId: string | null;
  generation: number;
}

interface YouTubePlayerElement extends HTMLElement {
  setPlaybackQualityRange?(minimum: string, maximum?: string): void;
  setPlaybackQuality?(quality: string): void;
  getAvailableQualityLevels?(): unknown;
  loadVideoById?(request: { videoId: string; startSeconds?: number }): void;
  pauseVideo?(): void;
}

declare global {
  interface Window {
    ytcfg?: YouTubeConfig;
  }
}

declare const __BENCH__: boolean;

export default defineUnlistedScript(() => {
  const player = new PlayerHandle();
  // Native-playback reclaim: PlayerHandle never rewrites <video>.src on teardown (the stale native
  // blob is dead), so when an active hijack is released we re-establish native playback here via
  // YouTube's own player API. A release only becomes an actual reclaim once the operation's terminal
  // status is known: 'active' means a (re-)hijack owns the element (drop it); a terminal
  // 'disabled'/'fallback' means we are NOT hijacking, so reclaim. Circuit-breaker/disable releases
  // are not followed by a status emit, so they drive the reclaim directly. `videoId` pins the reclaim
  // to the exact video we hijacked, so an SPA navigation (which changes the live videoId) never
  // reloads the wrong video at the old position.
  let currentHijackVideoId: string | null = null;
  // The single pending reclaim, held by the bounded, atomically-consumed tracker in
  // src/shared/reclaim.ts (TTL plus a one-generation skew bound; interleavings unit-tested there).
  const reclaims = createReclaimTracker();
  // Set while a toggle-off reclaim's loadVideoById is still reloading the native element (which is
  // transiently at currentTime 0 / playing). A fast re-hijack of the same video reads this intent so
  // it resumes at the real pre-toggle-off position/paused instead of that transient. Cleared once the
  // element settles (loadeddata) or a bounded timeout, or when consumed by a re-attach.
  let settlingReclaim: {
    videoId: string;
    currentTime: number;
    paused: boolean;
    dispose: () => void;
  } | null = null;
  // Tear down the current settling arm's loadeddata listener + timeout and forget it. Every
  // transition (re-arm, consume-on-attach, settle) routes through here, so a superseded arm's
  // callback can never fire and clobber a newer one, and listeners/timers never accumulate.
  const clearSettling = () => {
    if (!settlingReclaim) return;
    settlingReclaim.dispose();
    settlingReclaim = null;
  };
  // The single armed one-shot pause for a paused reclaim. Single-winner: arming for a newer reclaim
  // disposes the previous arm, and a re-hijack that attaches clears it, so two terminal statuses for
  // one release can never pause twice.
  let reclaimPauseArm: () => void = () => undefined;
  const clearReclaimPause = () => {
    reclaimPauseArm();
    reclaimPauseArm = () => undefined;
  };
  player.onRelease((record, reason) => {
    reclaims.set(record, currentHijackVideoId, player.generation);
    if (reason === 'circuit' || reason === 'disable') queueMicrotask(reclaimNativePlayback);
  });
  let artworkCleanup: () => void = () => undefined;
  let artworkEpoch = 0;
  player.onRestore(() => {
    artworkEpoch += 1;
    const cleanup = artworkCleanup;
    artworkCleanup = () => undefined;
    cleanup();
  });
  const bridgeNonce = readAndClearBridgeNonce();
  const log = createPageLogger(bridgeNonce);
  let settings: PageSettings = {
    enabled: false,
    audioOnlyEnabled: false,
    audioArtworkEnabled: true,
    backgroundPlayEnabled: false,
    idleNagDefeatEnabled: false,
    fallbackQualityCapEnabled: false,
    adBlockEnabled: false,
    segmentSkipEnabled: false,
    segmentSkipCategories: [],
    forceQualityMax: 'off',
    disableAutoplayNext: false,
    loudnessNormalization: false,
    equalizerEnabled: false,
    equalizerBands: [],
    downloadEnabled: false,
  };
  // SPEC-017: keep the data cost of a native fallback low. The Music path prefers the site's own
  // song playback when the item offers it; otherwise one request for the lowest available quality
  // tier. One bounded retry covers a player that has not mounted yet, and the live settings are
  // re-read at retry time so a toggle change in between wins. Never a re-assert loop, and never a
  // restore promise (there is no getter for the user's previous quality preference).
  const applyLowestQualityCap = (): boolean => {
    // An explicit user maximum quality stays the only quality writer; report "done" so the caller
    // does not retry.
    if (!fallbackQualityEngaged(settings)) return true;
    try {
      const player = document.querySelector<YouTubePlayerElement>(
        '#movie_player, .html5-video-player'
      );
      if (!player) return false;
      const label = selectLowestQualityLabel(player.getAvailableQualityLevels?.());
      player.setPlaybackQualityRange?.(label, label);
      player.setPlaybackQuality?.(label);
      return true;
    } catch {
      // Undocumented player APIs are optional; native ABR remains in control.
      return false;
    }
  };
  const tryFallbackQuality = (): boolean => {
    // Song mode is not a quality choice, so a user maximum quality never suppresses it.
    if (isMusicPage() && switchToSongMode(document)) return true;
    return applyLowestQualityCap();
  };
  const applyFallbackQuality = () => {
    if (!settings.enabled || !settings.fallbackQualityCapEnabled) return;
    if (tryFallbackQuality()) return;
    window.setTimeout(() => {
      if (!settings.enabled || !settings.fallbackQualityCapEnabled) return;
      tryFallbackQuality();
    }, FALLBACK_QUALITY_RETRY_MS);
  };
  player.navigate();
  let visibilityCleanup: () => void = () => undefined;
  let idleNagCleanup: () => void = () => undefined;
  let scriptletCleanup: () => void = () => undefined;
  let segmentSkipCleanup: () => void = () => undefined;
  let qualityOfLifeCleanup: () => void = () => undefined;
  let scriptletGeneration = 0;
  let segmentSkipGeneration = 0;
  let lastSkipKey = '';
  let audioGraphCleanup: () => void = () => undefined;

  const emitStatus = (status: PlaybackStatus, operation: PlaybackOperation, reason?: string) => {
    log('playback.status', { status, ...(reason ? { reason } : {}) });
    // Resolve any pending native reclaim against this operation's outcome BEFORE dispatching (the
    // dispatch is synchronous, so ordering the bookkeeping first keeps it insulated from listeners).
    // 'fetching' is transient, so it neither reclaims nor clears.
    if (status === 'active') reclaims.clear();
    else if (status === 'disabled' || status === 'fallback') reclaimNativePlayback();
    if (status === 'fallback') applyFallbackQuality();
    // Carries only display fields. The ordering provenance (runStart + generation) is owned by the
    // isolated content script, which never trusts this page-observable event for ordering.
    document.dispatchEvent(
      new CustomEvent(STATUS_EVENT, {
        detail: {
          status,
          ...(operation.videoId ? { videoId: operation.videoId } : {}),
          ...(reason ? { reason: reason.slice(0, 120) } : {}),
        },
      })
    );
  };

  // Re-establish native YouTube playback in place after an audio-only hijack is released, at the live
  // position, using YouTube's own (authorized) player API. One-shot and fail-open: it never retries.
  // It reclaims ONLY when we are reverting to native ON THE VIDEO WE HIJACKED and the element still
  // holds the exact URL we installed. If the user SPA-navigated away (videoId changed) or YouTube has
  // already reasserted its own src, native playback is (or will be) restored by YouTube itself, so we
  // drop the record and never touch the element (preserving the sole-writer + fail-open invariants).
  function reclaimNativePlayback(): void {
    const record = reclaims.match(undefined, player.generation);
    if (!record) return;
    if (
      !record.videoId ||
      record.videoId !== getVideoId() ||
      record.element.src !== record.ownedUrl
    ) {
      reclaims.clear();
      return;
    }
    const playerElement = document.querySelector<YouTubePlayerElement>(
      '#movie_player, .html5-video-player'
    );
    if (!playerElement) return; // Player not mounted yet: keep the record for the next terminal status.
    const consumed = reclaims.take(record.videoId, player.generation);
    if (!consumed) return; // Another path consumed the reclaim: at most one reclaim may ever run.
    try {
      const videoId = record.videoId;
      const startSeconds = Number.isFinite(consumed.currentTime)
        ? Math.max(0, consumed.currentTime)
        : 0;
      // Always load (never cue): cueVideoById only fetches a thumbnail and, per YouTube's own
      // player-API contract, defers requesting the actual media stream until playVideo()/seekTo()
      // is called. Using it here left a paused-toggle-off release permanently stalled at
      // readyState 0 (confirmed directly against the real #movie_player element). loadVideoById
      // is the call that reliably attaches real media. If the user had paused, pause back once the
      // freshly-loaded media has actually attached to the element (calling pauseVideo()
      // synchronously right after loadVideoById is a race YouTube silently drops, so we wait for
      // the load to land first, mirroring the readyState-then-event pattern PlayerHandle already
      // uses for restorePlaybackState).
      playerElement.loadVideoById?.({ videoId, startSeconds });
      armReclaimSettling(consumed.element, videoId, startSeconds, consumed.paused);
      if (consumed.paused) armReclaimPause(consumed.element, playerElement, videoId);
    } catch {
      // Fail open: leave native-playback control with YouTube.
    }
  }

  // Remember the intended native position/paused while YouTube reloads the element after a reclaim,
  // so a fast re-hijack of the same video inherits it rather than the mid-reload transient. One-shot:
  // cleared when the element settles (loadeddata) or after a bounded timeout.
  function armReclaimSettling(
    element: HTMLMediaElement,
    videoId: string,
    currentTime: number,
    paused: boolean
  ): void {
    clearSettling();
    const onSettled = () => clearSettling();
    const timer = window.setTimeout(onSettled, VIDEO_WAIT_MS);
    const dispose = () => {
      element.removeEventListener('loadeddata', onSettled);
      window.clearTimeout(timer);
    };
    settlingReclaim = { videoId, currentTime, paused, dispose };
    element.addEventListener('loadeddata', onSettled, { once: true });
  }

  // Arm the paused reclaim's pause once the freshly loaded media has actually attached. Single
  // winner: arming for a newer reclaim disposes the previous arm, so two terminal statuses for one
  // release can never pause twice. Still guarded by videoId (a mid-wait SPA navigation is never
  // paused) and by an active hijack (a fast re-toggle-on that re-hijacks the same element is not
  // paused by this stale call). Fail-open and one-shot: if nothing loads within VIDEO_WAIT_MS,
  // YouTube's autoplay stays in control rather than pausing a still-loading element.
  function armReclaimPause(
    element: HTMLMediaElement,
    playerElement: YouTubePlayerElement,
    videoId: string
  ): void {
    clearReclaimPause();
    reclaimPauseArm = armOneShotPause(element, {
      isCurrent: () => getVideoId() === videoId && player.getMediaElement() === null,
      pause: () => {
        try {
          playerElement.pauseVideo?.();
        } catch {
          // Fail open: leave native-playback control with YouTube.
        }
      },
      timeoutMs: VIDEO_WAIT_MS,
    });
  }

  const startPlaybackOperation = (): PlaybackOperation => {
    const videoId = getVideoId();
    return { videoId, generation: player.navigate() };
  };

  const applySettings = (next: PageSettings) => {
    settings = next;
    visibilityCleanup();
    visibilityCleanup =
      settings.enabled && settings.backgroundPlayEnabled ? enableBackgroundPlay() : () => undefined;
    idleNagCleanup();
    idleNagCleanup =
      settings.enabled && settings.backgroundPlayEnabled && settings.idleNagDefeatEnabled
        ? enableIdleNagDefeat()
        : () => undefined;
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
    const operation = startPlaybackOperation();
    restartSegmentSkipping();
    qualityOfLifeCleanup();
    qualityOfLifeCleanup = applyQualityOfLife(settings);
    audioGraphCleanup();
    audioGraphCleanup = () => undefined;
    if (!settings.enabled) {
      emitStatus('disabled', operation);
      return;
    }
    if (settings.audioOnlyEnabled || settings.loudnessNormalization || settings.equalizerEnabled) {
      void activateEnhancements(operation);
    } else {
      emitStatus('disabled', operation);
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

  // Thin adapter over the pure, unit-tested walk in src/shared/innertube.ts (SPEC-014,
  // ADR-0012). This function owns only the page-world specifics: the endpoint, the credentialless
  // POST, the ytcfg visitorData, and the bench-aware URL allowlist.
  function fetchPlayerResponse(
    videoId: string,
    apiKey: string,
    requireDirectAudio: boolean,
    isStale: () => boolean
  ): Promise<MediaClientWalkOutcome> {
    const endpoint = `/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`;
    const benchOrigin = __BENCH__ ? location.origin : undefined;
    return walkMediaClients({
      requireDirectAudio,
      isStale,
      pageVisitorData: getConfigString('VISITOR_DATA') ?? null,
      fetchPlayer: (client, visitorData) =>
        fetch(endpoint, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPlayerRequest(client, videoId, visitorData ?? undefined)),
        }),
      isAllowedUrl: (url) => isAllowedAudioUrl(url, benchOrigin),
    });
  }

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
      log('download.result', {
        ok: payload.ok === true,
        ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
      });
      document.dispatchEvent(
        new CustomEvent(DOWNLOAD_RESPONSE_EVENT, {
          detail: JSON.stringify({ nonce: bridgeNonce, requestId, ...payload }),
        })
      );
    };
    // Maps a walk failure onto the bounded download-reason vocabulary: the download log schema
    // accepts only these tokens (plus http-NNN), so anything else collapses to `unplayable`.
    const downloadReason = (reason: string): string =>
      reason === 'no-direct-audio' ||
      reason === 'request-failed' ||
      reason === 'live' ||
      reason === 'unplayable' ||
      /^http-\d{3}$/.test(reason)
        ? reason
        : 'unplayable';
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
      const outcome = await fetchPlayerResponse(videoId, apiKey, true, () => false);
      if (outcome.kind === 'live') {
        // A live-edge audio url is not a finite downloadable file.
        respond({ ok: false, reason: 'live' });
        return;
      }
      if (outcome.kind !== 'ok') {
        respond({
          ok: false,
          reason: downloadReason(outcome.kind === 'failed' ? outcome.reason : 'request-failed'),
        });
        return;
      }
      const playerResponse = outcome.response;
      const format = pickBestAudioFormat(playerResponse, true);
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
    log('spa.rearm');
    const operation = startPlaybackOperation();
    restartSegmentSkipping();
    qualityOfLifeCleanup();
    qualityOfLifeCleanup = applyQualityOfLife(settings);
    if (
      settings.enabled &&
      (settings.audioOnlyEnabled || settings.loudnessNormalization || settings.equalizerEnabled)
    ) {
      void activateEnhancements(operation);
    } else {
      emitStatus('disabled', operation);
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
        log('segment.armed', { count: segments.length });
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

  // Poll (bounded, generation-guarded) for the InnerTube API key to hydrate on window.ytcfg. Mobile
  // YouTube populates it after the content script's document_start injection and gives no DOM or
  // navigation event to signal it, so a short poll is the only reliable readiness signal there.
  function waitForConfigReady(operationGeneration: number): Promise<string | null> {
    return new Promise((resolve) => {
      let elapsed = 0;
      const step = 250;
      const tick = () => {
        if (operationGeneration !== player.generation) {
          resolve(null);
          return;
        }
        const key = getConfigString('INNERTUBE_API_KEY');
        if (key) {
          resolve(key);
          return;
        }
        elapsed += step;
        if (elapsed >= VIDEO_WAIT_MS) {
          resolve(null);
          return;
        }
        window.setTimeout(tick, step);
      };
      window.setTimeout(tick, step);
    });
  }

  async function activateEnhancements(operation: PlaybackOperation): Promise<void> {
    const { generation: operationGeneration, videoId } = operation;
    try {
      let apiKey = getConfigString('INNERTUBE_API_KEY');
      // Mobile YouTube (ytm-app) hydrates window.ytcfg AFTER the content script's document_start
      // injection and fires no navigation/DOM event when it does, so on a cold load the first
      // activation would otherwise bail to not-a-watch-page and never retry (no SPA signal follows).
      // Wait, bounded and generation-guarded, for the API key to appear before giving up.
      if (videoId && !apiKey) {
        apiKey = await waitForConfigReady(operationGeneration);
        if (operationGeneration !== player.generation) return;
      }
      if (!videoId || !apiKey) {
        emitStatus('fallback', operation, 'not-a-watch-page');
        return;
      }

      emitStatus('fetching', operation);
      const outcome = await fetchPlayerResponse(
        videoId,
        apiKey,
        settings.audioOnlyEnabled,
        () => operationGeneration !== player.generation
      );
      if (outcome.kind === 'stale') return;
      const usableResponse = outcome.kind === 'failed' ? outcome.lastPlayable : outcome.response;
      if (!usableResponse) {
        // Every parsed response was unplayable: the most diagnostically interesting failure, so
        // log the last parsed response's bounded shape before falling back.
        const lastParsed = outcome.kind === 'failed' ? outcome.lastParsed : null;
        if (lastParsed) {
          log('player.props', describePlayer(lastParsed, getPlayability(lastParsed).isPlayable));
        }
        emitStatus('fallback', operation, outcome.reason);
        return;
      }
      log(
        'player.props',
        describePlayer(usableResponse, getPlayability(usableResponse).isPlayable)
      );
      if (outcome.kind === 'failed') {
        // Preserve the pre-rotation behavior: with a playable response in hand but no usable
        // direct audio, arm loudness/EQ on the native fallback before emitting `fallback`.
        const fallbackElement = await waitForVideo(operationGeneration);
        if (fallbackElement && operationGeneration === player.generation) {
          armAudioGraph(
            fallbackElement,
            (usableResponse as PlayerResponse).playerConfig?.audioConfig?.loudnessDb
          );
        }
        // A superseded operation (settings echo or SPA navigation during the wait) must not emit a
        // stale fallback: the newer operation owns the status now.
        if (operationGeneration === player.generation) {
          emitStatus('fallback', operation, outcome.reason);
        }
        return;
      }
      log('media.client', { client: outcome.clientId, attempt: outcome.attempt });
      const playerResponse: unknown = usableResponse;

      const mediaElement = await waitForVideo(operationGeneration);
      if (!mediaElement || operationGeneration !== player.generation) return;
      const responseData = playerResponse as PlayerResponse;
      armAudioGraph(mediaElement, responseData.playerConfig?.audioConfig?.loudnessDb);

      if (!settings.audioOnlyEnabled) {
        emitStatus('disabled', operation);
        return;
      }
      // Live/DVR broadcasts return OK + an audio url, but that url is a live-edge segment that
      // stalls when hijacked as a progressive <video>.src. Leave YouTube's native player in control
      // (the audio graph armed above still applies loudness/EQ to normal playback).
      if (outcome.kind === 'live') {
        emitStatus('fallback', operation, 'live');
        return;
      }
      const audioUrl = pickBestAudioUrl(playerResponse);
      if (!audioUrl || !isAllowedAudioUrl(audioUrl, __BENCH__ ? location.origin : undefined)) {
        emitStatus('fallback', operation, 'no-direct-audio');
        return;
      }
      // If a toggle-off reclaim of THIS video is still settling, resume the hijacked audio at the
      // real pre-toggle-off position/paused rather than the native element's mid-reload transient.
      // A plain player-element replacement (mobile: the native player swaps the <video> mid-playback)
      // arms no settling reclaim, so fall back to the release record's live position for the same
      // video; otherwise the re-hijack would restart at the fresh element's zero/stale clock.
      const releasedRecord = reclaims.match(videoId, operationGeneration);
      const releasedPosition = releasedRecord
        ? { currentTime: releasedRecord.currentTime, paused: releasedRecord.paused }
        : undefined;
      const intent =
        settlingReclaim && settlingReclaim.videoId === videoId
          ? { currentTime: settlingReclaim.currentTime, paused: settlingReclaim.paused }
          : releasedPosition;
      if (player.attach(mediaElement, audioUrl, operationGeneration, intent)) {
        // The released position is one-shot: once a same-video re-hijack has consumed it, drop it so a
        // later same-video attach (a replay or re-navigation) cannot resume at a stale position. This
        // only clears when releasedPosition was actually used, never another video's pending record.
        if (releasedPosition && intent === releasedPosition) {
          reclaims.take(videoId, operationGeneration);
        }
        clearSettling();
        clearReclaimPause();
        currentHijackVideoId = videoId;
        if (settings.audioArtworkEnabled) {
          const overlayEpoch = artworkEpoch;
          artworkCleanup = showArtworkOverlay(mediaElement, {
            artworkUrl: pickArtworkUrl(responseData),
            generation: operationGeneration,
            isCurrent: () =>
              operationGeneration === player.generation &&
              overlayEpoch === artworkEpoch &&
              player.getMediaElement() === mediaElement,
            bench: __BENCH__,
          });
        }
        emitStatus('active', operation);
      } else {
        emitStatus('fallback', operation, 'media-attach-failed');
      }
    } catch (error) {
      log('error', { where: 'page.activate', ...errorFields(error) });
      if (operationGeneration === player.generation) {
        emitStatus('fallback', operation, 'request-failed');
      }
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
    log('audio.graph', {
      loudness: settings.loudnessNormalization,
      eq: settings.equalizerEnabled,
    });
    if (__BENCH__) {
      document.documentElement.dataset.ytaAudioGraph = JSON.stringify({
        gain,
        eqGains: graph.getEqualizerGains(),
      });
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

function applyQualityOfLife(settings: PageSettings): () => void {
  if (!settings.enabled) return () => undefined;
  const qualityLabel = getQualityLabel(settings.forceQualityMax);
  const timers: number[] = [];
  let observedPlayer: YouTubePlayerElement | null = null;
  let autoplayObserver: MutationObserver | null = null;
  let autoplayTimeout = 0;
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
  const stopAutoplayObserver = () => {
    if (autoplayObserver) {
      autoplayObserver.disconnect();
      autoplayObserver = null;
    }
    if (autoplayTimeout) {
      window.clearTimeout(autoplayTimeout);
      autoplayTimeout = 0;
    }
  };
  // Returns true once the native autonav toggle has been switched off, or there is nothing to do, so
  // the DOM watcher can stop. Returns false while the toggle is absent or not yet "on", so the watcher
  // keeps waiting. (Fixed timers alone missed the click when the button rendered past the last 3s
  // retry on a slow load, so a bounded MutationObserver below covers a late-appearing / late-toggled
  // button, mirroring what `reassertQuality` already gets from the player's quality-change event.)
  const disableAutoplay = (): boolean => {
    if (!settings.disableAutoplayNext) return true;
    try {
      const toggle = document.querySelector<HTMLElement>('.ytp-autonav-toggle-button');
      if (!toggle) return false;
      if (toggle.getAttribute('aria-checked') === 'true') {
        toggle.click();
        return true;
      }
      return false;
    } catch {
      // A missing or changing native control leaves YouTube's current state untouched.
      return false;
    }
  };
  const armAutoplayObserver = () => {
    if (autoplayObserver || !settings.disableAutoplayNext) return;
    autoplayObserver = new MutationObserver(() => {
      if (disableAutoplay()) stopAutoplayObserver();
    });
    autoplayObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked'],
    });
    // Hard cap so the watcher can never outlive the navigation or spin indefinitely (fail-open).
    autoplayTimeout = window.setTimeout(stopAutoplayObserver, 10_000);
  };
  const apply = () => {
    reassertQuality();
    if (disableAutoplay()) stopAutoplayObserver();
    else armAutoplayObserver();
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
    stopAutoplayObserver();
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
        if (target > currentTime) {
          video.currentTime = target;
          document.dispatchEvent(
            new CustomEvent(SEGMENT_SKIPPED_EVENT, { detail: segment.category })
          );
        }
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

/**
 * Whether this page is YouTube Music. The bench-only `ytm=1` query parameter lets the hermetic
 * fixture exercise the Music branch; production builds compile that branch out (`__BENCH__`).
 */
function isMusicPage(): boolean {
  if (location.hostname === 'music.youtube.com') return true;
  return __BENCH__ && new URLSearchParams(location.search).has('ytm');
}

/**
 * Behavior-determining video properties for reproduction, derived defensively and containing no
 * identity (no video/playlist/channel id, no url). Probing never throws into the caller.
 */
function describePlayer(
  response: unknown,
  playable: boolean
): {
  live: boolean;
  music: boolean;
  hasAudio: boolean;
  loudness: boolean;
  playable: boolean;
  duration: string;
} {
  const props = {
    live: false,
    music: isMusicPage(),
    hasAudio: false,
    loudness: false,
    playable,
    duration: 'unknown',
  };
  try {
    props.live = isLiveStream(response);
    props.hasAudio = Boolean(pickBestAudioFormat(response));
    const loudnessDb = (response as PlayerResponse).playerConfig?.audioConfig?.loudnessDb;
    props.loudness = typeof loudnessDb === 'number' && Number.isFinite(loudnessDb);
    const seconds = Number((response as PlayerResponse).videoDetails?.lengthSeconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      props.duration =
        seconds < 60 ? 'lt1m' : seconds < 600 ? 'lt10m' : seconds < 3600 ? 'lt1h' : 'gte1h';
    }
  } catch {
    // Property probing must never throw; return whatever was computed with safe defaults.
  }
  return props;
}

// Watch pages, embedded players (/embed/<id>), and legacy embeds (/v/<id>) all resolve here through
// the shared classifier, so the page world and the popup agree on one URL model (SPEC-015).
function getVideoId(): string | null {
  return parseVideoId(location.href);
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
    typeof candidate.audioArtworkEnabled !== 'boolean' ||
    typeof candidate.backgroundPlayEnabled !== 'boolean' ||
    typeof candidate.idleNagDefeatEnabled !== 'boolean' ||
    typeof candidate.fallbackQualityCapEnabled !== 'boolean' ||
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
    typeof candidate.downloadEnabled !== 'boolean'
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    audioOnlyEnabled: candidate.audioOnlyEnabled,
    audioArtworkEnabled: candidate.audioArtworkEnabled,
    backgroundPlayEnabled: candidate.backgroundPlayEnabled,
    idleNagDefeatEnabled: candidate.idleNagDefeatEnabled,
    fallbackQualityCapEnabled: candidate.fallbackQualityCapEnabled,
    adBlockEnabled: candidate.adBlockEnabled,
    segmentSkipEnabled: candidate.segmentSkipEnabled,
    segmentSkipCategories: candidate.segmentSkipCategories,
    forceQualityMax: candidate.forceQualityMax,
    disableAutoplayNext: candidate.disableAutoplayNext,
    loudnessNormalization: candidate.loudnessNormalization,
    equalizerEnabled: candidate.equalizerEnabled,
    equalizerBands: candidate.equalizerBands,
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

interface IdleNagPlayerElement extends HTMLElement {
  updateLastActiveTime?(): void;
  youthereDataChanged_?(...args: unknown[]): void;
}

type SetActionHandler = (
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) => void;

/**
 * Idle-nag defeat (SPEC-016). Layered and individually reversible: a low-frequency keepalive
 * refreshes the page's own activity signals, the player's you-there state transition is no-op'ed
 * while armed, confirm/you-there dialogs are auto-confirmed, and YouTube's mediaSession pause
 * handler is neutralised in favour of a direct pause so a user pause still pauses. Every layer is
 * existence-checked and fail-open; the returned cleanup restores all of them.
 */
function enableIdleNagDefeat(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailingCheck: ReturnType<typeof setTimeout> | null = null;
  let lastDialogCheck = 0;
  let observer: MutationObserver | null = null;
  let lastHandledRenderer: Element | null = null;
  let patchedPlayer: IdleNagPlayerElement | null = null;
  let originalYouThere: IdleNagPlayerElement['youthereDataChanged_'] | undefined;

  // The event path is the primary dismissal; the observer is a bounded fallback, so a busy DOM
  // never turns into a query-per-mutation-batch hot loop (at most one check per window, plus one
  // trailing check so a dialog inserted inside a burst is still seen).
  const DIALOG_CHECK_INTERVAL_MS = 500;

  const mediaElement = (): HTMLMediaElement | null => document.querySelector('video, audio');

  const pauseDirectly = () => {
    const media = mediaElement();
    if (!(media instanceof HTMLMediaElement) || media.paused) return;
    try {
      HTMLMediaElement.prototype.pause.call(media);
    } catch {
      // Fail open: the page keeps whatever state it already had.
    }
  };

  const resumeIfPaused = () => {
    const media = mediaElement();
    if (!(media instanceof HTMLMediaElement) || media.ended || !media.paused) return;
    try {
      void media.play().catch(() => undefined);
    } catch {
      // Fail open: a refused resume leaves the page exactly as YouTube left it.
    }
  };

  // One dismissal per dialog instance: the same renderer is never clicked twice, and a new dialog
  // (a new element) is handled afresh. A failed click does not latch, so it can retry.
  const attemptDismiss = () => {
    const renderer = findIdleNagRenderer(document);
    if (renderer && renderer === lastHandledRenderer) return;
    if (!dismissIdleNag(document)) return;
    lastHandledRenderer = renderer;
    resumeIfPaused();
  };

  const runKeepalive = () => {
    try {
      const scope = window as unknown as { _lact?: unknown };
      if (typeof scope._lact === 'number') scope._lact = Date.now();
    } catch {
      // A throwing or frozen scope is skipped; the other layers stay armed.
    }
    try {
      const playerElement = document.querySelector<IdleNagPlayerElement>(
        '#movie_player, .html5-video-player'
      );
      if (playerElement && typeof playerElement.updateLastActiveTime === 'function') {
        playerElement.updateLastActiveTime();
      }
    } catch {
      // Same fail-open rule for the player call.
    }
  };

  let primed = false;
  const scheduleKeepalive = () => {
    const delay = primed ? nextIdleNagDelayMs() : IDLE_NAG_PRIME_MS;
    primed = true;
    timer = setTimeout(() => {
      if (stopped) return;
      runKeepalive();
      scheduleKeepalive();
    }, delay);
  };

  const patchYouThere = () => {
    if (patchedPlayer) return;
    const candidate = document.querySelector<IdleNagPlayerElement>(
      '#movie_player, .html5-video-player'
    );
    if (!candidate || typeof candidate.youthereDataChanged_ !== 'function') return;
    originalYouThere = candidate.youthereDataChanged_;
    try {
      candidate.youthereDataChanged_ = () => undefined;
      patchedPlayer = candidate;
    } catch {
      // A frozen or accessor-only property: skip the layer, keep the rest armed.
    }
  };

  const checkDialogs = () => {
    lastDialogCheck = Date.now();
    patchYouThere();
    if (findIdleNagRenderer(document)) attemptDismiss();
  };

  const onMutations = () => {
    if (stopped) return;
    const elapsed = Date.now() - lastDialogCheck;
    if (elapsed >= DIALOG_CHECK_INTERVAL_MS) {
      checkDialogs();
      return;
    }
    if (trailingCheck !== null) return;
    trailingCheck = setTimeout(() => {
      trailingCheck = null;
      if (stopped) return;
      checkDialogs();
    }, DIALOG_CHECK_INTERVAL_MS - elapsed);
  };

  const pauseHandler = () => pauseDirectly();

  const mediaSession = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
  let mediaSessionPatched = false;
  let hadOwnSetActionHandler = false;
  let originalSetActionHandler: MediaSession['setActionHandler'] | null = null;
  let boundSetActionHandler: SetActionHandler | null = null;
  let blockedPauseHandler: MediaSessionActionHandler | null = null;

  if (mediaSession && typeof mediaSession.setActionHandler === 'function') {
    originalSetActionHandler = mediaSession.setActionHandler;
    boundSetActionHandler = originalSetActionHandler.bind(mediaSession) as SetActionHandler;
    hadOwnSetActionHandler = Object.prototype.hasOwnProperty.call(mediaSession, 'setActionHandler');
    try {
      mediaSession.setActionHandler = (action, handler) => {
        if (action !== 'pause') {
          boundSetActionHandler?.(action, handler);
          return;
        }
        // Neutralise YouTube's own pause handler, then register a direct pause so a user pause
        // (media key, headset, notification) still pauses immediately. A null clears as usual.
        blockedPauseHandler = handler;
        boundSetActionHandler?.(action, handler === null ? null : pauseHandler);
      };
      mediaSessionPatched = true;
    } catch {
      mediaSessionPatched = false;
    }
  }

  runKeepalive();
  scheduleKeepalive();
  patchYouThere();

  const handlePopupOpened = (event: Event) => {
    const detail = (event as CustomEvent<{ nodeName?: unknown } | null>).detail;
    if (!isIdleNagNodeName(detail?.nodeName)) return;
    attemptDismiss();
  };
  document.addEventListener('yt-popup-opened', handlePopupOpened, true);
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (trailingCheck !== null) clearTimeout(trailingCheck);
    trailingCheck = null;
    if (observer) observer.disconnect();
    observer = null;
    document.removeEventListener('yt-popup-opened', handlePopupOpened, true);
    if (patchedPlayer && originalYouThere) {
      try {
        patchedPlayer.youthereDataChanged_ = originalYouThere;
      } catch {
        // A frozen player keeps the no-op; teardown stays best effort.
      }
    }
    if (mediaSessionPatched && mediaSession && originalSetActionHandler) {
      try {
        if (hadOwnSetActionHandler) mediaSession.setActionHandler = originalSetActionHandler;
        else delete (mediaSession as unknown as Record<string, unknown>).setActionHandler;
        if (blockedPauseHandler) boundSetActionHandler?.('pause', blockedPauseHandler);
      } catch {
        // Restoring is best effort; the page keeps working either way.
      }
    }
  };
}
