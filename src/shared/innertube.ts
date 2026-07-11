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
  streamingData?: {
    adaptiveFormats?: Array<{
      itag?: number;
      mimeType?: string;
      bitrate?: number;
      url?: string;
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

export function pickBestAudioUrl(playerResponse: unknown): string | null {
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
  audio.sort((left, right) => {
    const preference = (itag: number | undefined) => (itag === 251 ? 2 : itag === 140 ? 1 : 0);
    return preference(right.itag) - preference(left.itag) || (right.bitrate ?? 0) - (left.bitrate ?? 0);
  });
  return audio[0]?.url ?? null;
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
