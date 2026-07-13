export const ANDROID_VR_CLIENT = Object.freeze({
  clientName: 'ANDROID_VR',
  clientVersion: '1.65.10',
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  osName: 'Android',
  osVersion: '12L',
  androidSdkVersion: 32,
  userAgent:
    'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  hl: 'en',
  gl: 'US',
});

export type AndroidVrClient = typeof ANDROID_VR_CLIENT & {
  visitorData?: string;
};

export interface AndroidVrPlayerRequest {
  context: {
    client: AndroidVrClient;
  };
  videoId: string;
  contentCheckOk: true;
  racyCheckOk: true;
}

/**
 * Builds the credentialless ANDROID_VR player body proven by the Phase 0 probes.
 * The caller must send this with `credentials: "omit"`.
 */
export interface PlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
  playerConfig?: {
    audioConfig?: {
      loudnessDb?: number;
    };
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    isLive?: boolean;
    thumbnail?: {
      thumbnails?: Array<{
        url?: string;
        width?: number;
        height?: number;
      }>;
    };
  };
  streamingData?: {
    adaptiveFormats?: Array<{
      itag?: number;
      mimeType?: string;
      bitrate?: number;
      url?: string;
      contentLength?: string;
    }>;
  };
}

export interface Playability {
  status: string | null;
  reason: string | null;
  isPlayable: boolean;
}

export function getPlayability(playerResponse: unknown): Playability {
  if (typeof playerResponse !== 'object' || playerResponse === null) {
    return { status: null, reason: null, isPlayable: false };
  }
  const response = playerResponse as PlayerResponse;
  const status = response.playabilityStatus?.status ?? null;
  const reason = response.playabilityStatus?.reason ?? null;
  return { status, reason, isPlayable: status === 'OK' };
}

/**
 * True when the player response is a currently-live (or DVR) broadcast whose best audio rendition
 * is a live-edge stream. The ANDROID_VR response for a live stream is `status: "OK"` and carries an
 * audio adaptiveFormat WITH a url, but that url is a live-edge segment that stalls at `currentTime 0`
 * when set as a progressive `<video>.src` (and is not a finite downloadable file). Such videos MUST
 * fall back to YouTube's normal (DASH/HLS) player rather than be hijacked.
 *
 * Two independent signals, either sufficient:
 *  - `videoDetails.isLive === true` — the explicit "currently broadcasting" flag (NOT `isLiveContent`,
 *    which stays true for finished-stream VOD replays that audio-only handles fine).
 *  - the best audio format has no `contentLength` — a live/DVR edge stream is unbounded, so its
 *    format omits `contentLength`, whereas every finite VOD file (including an ex-live replay)
 *    carries one. This is the direct "not a hijackable finite progressive file" signal; its failure
 *    mode is fail-safe (fall back to normal playback), and it also covers a live stream whose
 *    `isLive` flag is unexpectedly absent. Empirically (2026-07-11 signal audit, n=38): 11/11 live
 *    formats lacked `contentLength`; 27/27 VOD formats (4 of them ex-live replays) had it.
 */
export function isLiveStream(playerResponse: unknown): boolean {
  if (typeof playerResponse !== 'object' || playerResponse === null) return false;
  if ((playerResponse as PlayerResponse).videoDetails?.isLive === true) return true;
  const best = pickBestAudioFormat(playerResponse);
  return best !== null && !hasContentLength(best);
}

function hasContentLength(format: AudioFormat): boolean {
  return typeof format.contentLength === 'string' && Number(format.contentLength) > 0;
}

export type AudioFormat = NonNullable<
  NonNullable<PlayerResponse['streamingData']>['adaptiveFormats']
>[number];

/**
 * Pick the best audio adaptive format. `preferCompatible` (used for downloads) prefers AAC (itag 140,
 * a `.m4a` playable almost everywhere with no transcoding); otherwise it prefers Opus (itag 251,
 * higher quality) for in-page playback.
 */
export function pickBestAudioFormat(
  playerResponse: unknown,
  preferCompatible = false
): AudioFormat | null {
  if (typeof playerResponse !== 'object' || playerResponse === null) return null;
  const formats = (playerResponse as PlayerResponse).streamingData?.adaptiveFormats;
  if (!Array.isArray(formats)) return null;

  const audio = formats.filter(
    (format) =>
      typeof format.url === 'string' &&
      format.url.length > 0 &&
      typeof format.mimeType === 'string' &&
      format.mimeType.startsWith('audio/')
  );
  const preference = preferCompatible
    ? (itag: number | undefined) => (itag === 140 ? 2 : itag === 251 ? 1 : 0)
    : (itag: number | undefined) => (itag === 251 ? 2 : itag === 140 ? 1 : 0);
  audio.sort(
    (left, right) =>
      preference(right.itag) - preference(left.itag) || (right.bitrate ?? 0) - (left.bitrate ?? 0)
  );
  return audio[0] ?? null;
}

export function pickBestAudioUrl(playerResponse: unknown): string | null {
  return pickBestAudioFormat(playerResponse)?.url ?? null;
}

export function buildAndroidVrPlayerRequest(
  videoId: string,
  visitorData?: string
): AndroidVrPlayerRequest {
  const client: AndroidVrClient = visitorData
    ? { ...ANDROID_VR_CLIENT, visitorData }
    : { ...ANDROID_VR_CLIENT };

  return {
    context: { client },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
}
