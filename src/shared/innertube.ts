/**
 * The credentialless media-client table (ADR-0012). VISIONOS is the primary persona: yt-dlp
 * removed ANDROID_VR 1.65.10 from its defaults because, since 2026-08-17, every format it requests
 * is 403'd (yt-dlp commit dae52d838, issue #17456), and VISIONOS is the surviving JS-player-less
 * client. ANDROID_VR stays as the ordered fallback and probe comparison, not as a trusted primary.
 *
 * Personas are pinned to yt-dlp's client definitions (2026-10-15), including each client's
 * `userAgent`, which lives INSIDE the InnerTube client context. Amending the table requires
 * re-checking those definitions (ADR-0012).
 */
export const VISIONOS_CLIENT = Object.freeze({
  clientName: 'VISIONOS',
  clientVersion: '1.02',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  osName: 'visionOS',
  osVersion: '26.5.23O471',
  hl: 'en',
  gl: 'US',
});

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

export const IOS_CLIENT = Object.freeze({
  clientName: 'IOS',
  clientVersion: '21.26.4',
  deviceMake: 'Apple',
  deviceModel: 'iPhone16,2',
  osName: 'iPhone',
  osVersion: '18.3.2.22D82',
  userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  hl: 'en',
  gl: 'US',
});

export const ANDROID_CLIENT = Object.freeze({
  clientName: 'ANDROID',
  clientVersion: '21.26.364',
  osName: 'Android',
  osVersion: '11',
  androidSdkVersion: 30,
  userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
  hl: 'en',
  gl: 'US',
});

export const MWEB_CLIENT = Object.freeze({
  clientName: 'MWEB',
  clientVersion: '2.20260708.05.00',
  userAgent:
    'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
  hl: 'en',
  gl: 'US',
});

/**
 * Last-resort client (SPEC-030, Phase B). The embedded TV client can serve age-restricted videos
 * without a login, but returns `signatureCipher` strings rather than ready `url`s, so it is only
 * usable with the `base.js` cipher decoder (`src/shared/cipher.ts`) and a `signatureTimestamp` in
 * the request. It sits LAST in the table: it costs an extra `base.js` fetch, so it is reached only
 * when every unciphered client failed (where we would otherwise fail open anyway).
 */
export const TVHTML5_CLIENT = Object.freeze({
  clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
  clientVersion: '2.0',
  hl: 'en',
  gl: 'US',
});

export interface MediaClientPersona {
  clientName: string;
  clientVersion: string;
  deviceMake?: string;
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  androidSdkVersion?: number;
  userAgent?: string;
  hl: string;
  gl: string;
}

export type MediaClientId = 'visionos' | 'android-vr' | 'ios' | 'android' | 'mweb' | 'tvhtml5';

export interface MediaClientDescriptor {
  readonly id: MediaClientId;
  readonly client: MediaClientPersona;
}

/** Ordered attempt table. The order is the feature: primary first, fallbacks after. */
export const MEDIA_CLIENTS: readonly MediaClientDescriptor[] = Object.freeze([
  { id: 'visionos', client: VISIONOS_CLIENT },
  { id: 'android-vr', client: ANDROID_VR_CLIENT },
  { id: 'ios', client: IOS_CLIENT },
  { id: 'android', client: ANDROID_CLIENT },
  { id: 'mweb', client: MWEB_CLIENT },
  { id: 'tvhtml5', client: TVHTML5_CLIENT },
]);

export type PlayerClient = MediaClientPersona & {
  visitorData?: string;
};

export interface PlayerRequestBody {
  context: {
    client: PlayerClient;
    thirdParty?: { embedUrl: string };
  };
  videoId: string;
  contentCheckOk: true;
  racyCheckOk: true;
  playbackContext?: {
    contentPlaybackContext: { signatureTimestamp: number };
  };
}

/** Shapes of the fields the extension reads from a credentialless `/youtubei/v1/player` response. */
export interface PlayerResponse {
  responseContext?: {
    visitorData?: string;
  };
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
      signatureCipher?: string;
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
 * is a live-edge stream. The credentialless player response for a live stream is `status: "OK"`
 * and carries an audio adaptiveFormat WITH a url, but that url is a live-edge segment that stalls
 * at `currentTime 0` when set as a progressive `<video>.src` (and is not a finite downloadable
 * file). Such videos MUST fall back to YouTube's normal (DASH/HLS) player rather than be hijacked.
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

/**
 * Pick the best audio format that carries a `signatureCipher` instead of a ready `url` (the
 * TVHTML5 embedded client's shape). Mirrors {@link pickBestAudioFormat}'s preference order so the
 * caller can resolve the cipher with the `base.js` decoder and get the same quality choice.
 */
export function pickBestCipheredAudioFormat(
  playerResponse: unknown,
  preferCompatible = false
): AudioFormat | null {
  if (typeof playerResponse !== 'object' || playerResponse === null) return null;
  const formats = (playerResponse as PlayerResponse).streamingData?.adaptiveFormats;
  if (!Array.isArray(formats)) return null;
  const ciphered = formats.filter(
    (format) =>
      typeof format.signatureCipher === 'string' &&
      format.signatureCipher.length > 0 &&
      typeof format.mimeType === 'string' &&
      format.mimeType.startsWith('audio/')
  );
  const preference = preferCompatible
    ? (itag: number | undefined) => (itag === 140 ? 2 : itag === 251 ? 1 : 0)
    : (itag: number | undefined) => (itag === 251 ? 2 : itag === 140 ? 1 : 0);
  ciphered.sort(
    (left, right) =>
      preference(right.itag) - preference(left.itag) || (right.bitrate ?? 0) - (left.bitrate ?? 0)
  );
  return ciphered[0] ?? null;
}

/** The `signatureCipher` of the best ciphered audio format, for the walk's cipher resolver. */
export function pickBestAudioCipher(
  playerResponse: unknown,
  preferCompatible = false
): string | null {
  return pickBestCipheredAudioFormat(playerResponse, preferCompatible)?.signatureCipher ?? null;
}

/**
 * Builds a credentialless player body for one persona. The caller must send this with
 * `credentials: "omit"`. The optional `visitorData` is the only per-attempt variable. The optional
 * `signatureTimestamp`/`embedUrl` are required only by the ciphered TVHTML5 embedded client
 * (SPEC-030); omitting them leaves the body identical to every other client's.
 */
export function buildPlayerRequest(
  client: MediaClientPersona,
  videoId: string,
  visitorData?: string,
  options: { signatureTimestamp?: number; embedUrl?: string } = {}
): PlayerRequestBody {
  const persona: PlayerClient = visitorData ? { ...client, visitorData } : { ...client };
  const body: PlayerRequestBody = {
    context: {
      client: persona,
      ...(options.embedUrl ? { thirdParty: { embedUrl: options.embedUrl } } : {}),
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  if (
    typeof options.signatureTimestamp === 'number' &&
    Number.isFinite(options.signatureTimestamp)
  ) {
    body.playbackContext = {
      contentPlaybackContext: { signatureTimestamp: options.signatureTimestamp },
    };
  }
  return body;
}

/** Compatibility wrapper for the pinned ANDROID_VR persona (probes and legacy callers). */
export function buildAndroidVrPlayerRequest(
  videoId: string,
  visitorData?: string
): PlayerRequestBody {
  return buildPlayerRequest(ANDROID_VR_CLIENT, videoId, visitorData);
}

/** Reads `responseContext.visitorData` from a player response, if present and usable. */
export function extractVisitorData(playerResponse: unknown): string | null {
  if (typeof playerResponse !== 'object' || playerResponse === null) return null;
  const visitorData = (playerResponse as PlayerResponse).responseContext?.visitorData;
  return typeof visitorData === 'string' && visitorData.length > 0 ? visitorData : null;
}

/**
 * The entire retry policy for one client: a fresh `visitorData` harvested from the response just
 * received is worth exactly one more attempt, and only when it differs from the value used. A
 * `null` result ends this client's attempts (the caller moves to the next client or fails open).
 */
export function retryVisitorData(playerResponse: unknown, used: string | null): string | null {
  const fresh = extractVisitorData(playerResponse);
  return fresh && fresh !== used ? fresh : null;
}

/** Minimal response shape the walk needs; a real `Response` satisfies it structurally. */
export interface MediaClientFetchResult {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Everything the walk cannot know on its own, injected so the walk itself stays pure. */
export interface MediaClientWalkDeps {
  /** When true (audio-only on), acceptance also needs an attachable, allowlisted audio URL. */
  readonly requireDirectAudio: boolean;
  /** True when the playback operation that started this walk has been superseded. */
  readonly isStale: () => boolean;
  /** Page-level visitorData from ytcfg, the starting value for the first client. */
  readonly pageVisitorData: string | null;
  /** POSTs one credentialless player request and must throw on a network failure. */
  readonly fetchPlayer: (
    client: MediaClientPersona,
    visitorData: string | null
  ) => Promise<MediaClientFetchResult>;
  /** Allowlist check for the accepted direct audio URL. */
  readonly isAllowedUrl: (url: string) => boolean;
  /**
   * Optional resolver for a `signatureCipher` (TVHTML5 embedded client, SPEC-030). When provided
   * and a playable response has no ready audio `url` but does carry a `signatureCipher`, the walk
   * asks this to decode it into an attachable URL. It must fail open (return `null`) rather than
   * throw; a `null` result continues the walk.
   */
  readonly resolveCipheredUrl?: (cipher: string) => Promise<string | null>;
}

/** Outcome of one bounded walk over the media-client table (SPEC-014). */
export type MediaClientWalkOutcome =
  | { kind: 'stale' }
  | {
      kind: 'failed';
      reason: string;
      /** Last parsed response, playable or not, for diagnostics. */
      lastParsed: unknown | null;
      /** Last playable response, so native fallback can still be armed. */
      lastPlayable: unknown | null;
    }
  | {
      kind: 'ok' | 'live';
      response: unknown;
      clientId: MediaClientId;
      attempt: number;
      reason: string;
      /**
       * The URL the walk resolved for this response when it differed from a ready `url` (a decoded
       * `signatureCipher`). Undefined means the caller should read the URL from the response as
       * usual.
       */
      resolvedAudioUrl?: string;
    };

/**
 * The entire bounded walk over {@link MEDIA_CLIENTS} (SPEC-014, ADR-0012, SPEC-030): VISIONOS
 * first, then ANDROID_VR, IOS, ANDROID, MWEB (unciphered clients, Phase A), then the ciphered
 * TVHTML5 embedded client (Phase B) as the last resort, at most two HTTP attempts per client (the
 * initial request plus one retry carrying fresh `visitorData` harvested from the previous
 * response). A live response is terminal: liveness is a property of the broadcast, not of the
 * client, so no other client can change it. Acceptance requires a playable response whose best
 * audio URL passes the injected allowlist (a `signatureCipher` may be resolved via the optional
 * `resolveCipheredUrl`); anything else continues the walk. `lastPlayable` is retained so the caller
 * can still arm loudness/EQ before falling back.
 */
export async function walkMediaClients(deps: MediaClientWalkDeps): Promise<MediaClientWalkOutcome> {
  const {
    requireDirectAudio,
    isStale,
    pageVisitorData,
    fetchPlayer,
    isAllowedUrl,
    resolveCipheredUrl,
  } = deps;
  // The final `reason` is the last reason derived from a SERVER response (http-NNN, playability
  // status, or no-direct-audio). A later transport failure or an unusable-client pre-flight error
  // must not clobber a more informative server reason with a generic 'request-failed'.
  let lastResponseReason: string | null = null;
  let lastPlayable: unknown | null = null;
  let lastParsed: unknown | null = null;
  let attempt = 0;

  for (const mediaClient of MEDIA_CLIENTS) {
    let visitorData = pageVisitorData;
    for (let clientAttempt = 0; clientAttempt < 2; clientAttempt += 1) {
      if (isStale()) return { kind: 'stale' };
      attempt += 1;
      let response: MediaClientFetchResult;
      try {
        response = await fetchPlayer(mediaClient.client, visitorData);
      } catch {
        break;
      }
      if (isStale()) return { kind: 'stale' };
      if (!response.ok) {
        lastResponseReason = `http-${response.status}`;
        break;
      }
      let playerResponse: unknown;
      try {
        playerResponse = await response.json();
      } catch {
        break;
      }
      const playability = getPlayability(playerResponse);
      lastParsed = playerResponse;
      if (!playability.isPlayable) {
        lastResponseReason = playability.status ?? 'unplayable';
      } else {
        lastPlayable = playerResponse;
        if (isLiveStream(playerResponse)) {
          return {
            kind: 'live',
            response: playerResponse,
            clientId: mediaClient.id,
            attempt,
            reason: 'live',
          };
        }
        // Acceptance requires a URL this extension can actually attach. A playable response whose
        // best URL is absent or not allowlisted must not stop the walk: the next client may serve
        // one. A ciphered response (TVHTML5) is resolved on demand; a failed decode continues the
        // walk rather than stopping it.
        const candidateAudioUrl = pickBestAudioUrl(playerResponse);
        let effectiveUrl = candidateAudioUrl;
        if (requireDirectAudio && !effectiveUrl && resolveCipheredUrl) {
          const cipher = pickBestAudioCipher(playerResponse);
          if (cipher) {
            try {
              effectiveUrl = await resolveCipheredUrl(cipher);
            } catch {
              effectiveUrl = null;
            }
            if (isStale()) return { kind: 'stale' };
          }
        }
        const resolvedAudioUrl = candidateAudioUrl ? undefined : (effectiveUrl ?? undefined);
        if (!requireDirectAudio || (effectiveUrl && isAllowedUrl(effectiveUrl))) {
          return {
            kind: 'ok',
            response: playerResponse,
            clientId: mediaClient.id,
            attempt,
            reason: 'ok',
            ...(resolvedAudioUrl ? { resolvedAudioUrl } : {}),
          };
        }
        lastResponseReason = 'no-direct-audio';
      }
      const fresh = retryVisitorData(playerResponse, visitorData);
      if (fresh) {
        visitorData = fresh;
        continue;
      }
      break;
    }
  }
  return {
    kind: 'failed',
    reason: lastResponseReason ?? 'request-failed',
    lastParsed,
    lastPlayable,
  };
}
