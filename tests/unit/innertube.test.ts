import { describe, expect, it } from 'vitest';

import { ANDROID_VR_CLIENT, buildAndroidVrPlayerRequest } from '../../src/shared/innertube';

describe('buildAndroidVrPlayerRequest', () => {
  it('builds the exact credentialless Phase 0 request body', () => {
    expect(buildAndroidVrPlayerRequest('dQw4w9WgXcQ')).toEqual({
      context: {
        client: {
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
        },
      },
      videoId: 'dQw4w9WgXcQ',
      contentCheckOk: true,
      racyCheckOk: true,
    });
  });

  it('includes visitor data when the page supplies it', () => {
    const request = buildAndroidVrPlayerRequest('jNQXAC9IVRw', 'visitor-token');

    expect(request.context.client.visitorData).toBe('visitor-token');
  });

  it('returns a fresh client without mutating the pinned persona', () => {
    const first = buildAndroidVrPlayerRequest('first');
    const second = buildAndroidVrPlayerRequest('second');

    expect(first.context.client).not.toBe(second.context.client);
    expect(ANDROID_VR_CLIENT).not.toHaveProperty('visitorData');
  });
});
