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
