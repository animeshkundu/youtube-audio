import { describe, expect, it } from 'vitest';

import {
  ANDROID_VR_CLIENT,
  buildAndroidVrPlayerRequest,
  getPlayability,
  isLiveStream,
  pickBestAudioFormat,
  pickBestAudioUrl,
  pickDownloadAudioFormat,
} from '../../src/shared/innertube';

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

describe('player response helpers', () => {
  it('reports playable and fallback statuses without throwing on malformed values', () => {
    expect(getPlayability({ playabilityStatus: { status: 'OK' } })).toEqual({
      status: 'OK',
      reason: null,
      isPlayable: true,
    });
    expect(
      getPlayability({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } })
    ).toEqual({
      status: 'LOGIN_REQUIRED',
      reason: 'Sign in',
      isPlayable: false,
    });
    expect(getPlayability(null)).toEqual({ status: null, reason: null, isPlayable: false });
  });

  it('prefers Opus itag 251, then AAC itag 140, then bitrate', () => {
    const response = {
      streamingData: {
        adaptiveFormats: [
          { itag: 140, mimeType: 'audio/mp4', bitrate: 128000, url: 'https://media/140' },
          { itag: 251, mimeType: 'audio/webm', bitrate: 120000, url: 'https://media/251' },
          { itag: 999, mimeType: 'audio/webm', bitrate: 999000, url: 'https://media/999' },
        ],
      },
    };
    expect(pickBestAudioUrl(response)).toBe('https://media/251');
    // preferCompatible (used for downloads) flips the top preference to AAC/.m4a (itag 140).
    expect(pickBestAudioFormat(response, true)?.itag).toBe(140);
    expect(pickBestAudioFormat(response)?.itag).toBe(251);
    expect(
      pickBestAudioUrl({
        streamingData: { adaptiveFormats: response.streamingData.adaptiveFormats.slice(0, 1) },
      })
    ).toBe('https://media/140');
    expect(
      pickBestAudioUrl({
        streamingData: {
          adaptiveFormats: [
            { itag: 998, mimeType: 'audio/webm', bitrate: 1000, url: 'https://media/low' },
            { itag: 999, mimeType: 'audio/webm', bitrate: 2000, url: 'https://media/high' },
          ],
        },
      })
    ).toBe('https://media/high');
  });

  it('selects bounded download codecs and bitrate tiers while preserving the default', () => {
    const response = {
      streamingData: {
        adaptiveFormats: [
          { itag: 139, mimeType: 'audio/mp4', bitrate: 48000, url: 'https://media/139' },
          { itag: 140, mimeType: 'audio/mp4', bitrate: 128000, url: 'https://media/140' },
          { itag: 141, mimeType: 'audio/mp4', bitrate: 256000, url: 'https://media/141' },
          { itag: 249, mimeType: 'audio/webm', bitrate: 50000, url: 'https://media/249' },
          { itag: 250, mimeType: 'audio/webm', bitrate: 70000, url: 'https://media/250' },
          { itag: 251, mimeType: 'audio/webm', bitrate: 160000, url: 'https://media/251' },
        ],
      },
    };

    expect(pickDownloadAudioFormat(response, 'auto', 'auto')?.itag).toBe(140);
    expect(pickDownloadAudioFormat(response, 'm4a', 'high')?.itag).toBe(141);
    expect(pickDownloadAudioFormat(response, 'm4a', 'low')?.itag).toBe(139);
    expect(pickDownloadAudioFormat(response, 'opus', 'auto')?.itag).toBe(251);
    expect(pickDownloadAudioFormat(response, 'opus', 'medium')?.itag).toBe(250);
    expect(pickDownloadAudioFormat(response, 'opus', 'low')?.itag).toBe(249);
  });

  it('falls back to compatible direct audio when the requested codec is unavailable', () => {
    const response = {
      streamingData: {
        adaptiveFormats: [
          { itag: 140, mimeType: 'audio/mp4', bitrate: 128000, url: 'https://media/140' },
        ],
      },
    };

    expect(pickDownloadAudioFormat(response, 'opus', 'low')?.itag).toBe(140);
    expect(pickDownloadAudioFormat(null, 'auto', 'auto')).toBeNull();
  });

  it('does not treat a missing bitrate as the lowest source quality', () => {
    const response = {
      streamingData: {
        adaptiveFormats: [
          { itag: 249, mimeType: 'audio/webm', url: 'https://media/unknown' },
          { itag: 250, mimeType: 'audio/webm', bitrate: 70000, url: 'https://media/250' },
        ],
      },
    };

    expect(pickDownloadAudioFormat(response, 'opus', 'low')?.itag).toBe(250);
  });

  it('ignores video, cipher-only, and malformed formats', () => {
    expect(
      pickBestAudioUrl({
        streamingData: {
          adaptiveFormats: [
            { itag: 22, mimeType: 'video/mp4', url: 'https://media/video' },
            { itag: 251, mimeType: 'audio/webm', url: '' },
            { itag: 250, mimeType: 'audio/webm', signatureCipher: 'private' },
            { itag: 249, url: 'https://media/missing-mime' },
          ],
        },
      })
    ).toBeNull();
    expect(pickBestAudioUrl({})).toBeNull();
    expect(pickBestAudioUrl({ streamingData: { adaptiveFormats: {} } })).toBeNull();
    expect(pickBestAudioUrl(undefined)).toBeNull();
  });
});

describe('isLiveStream', () => {
  const withAudio = (extra: Record<string, unknown>) => ({
    streamingData: {
      adaptiveFormats: [{ itag: 251, mimeType: 'audio/webm', url: 'https://media/a', ...extra }],
    },
  });

  it('flags a currently-live broadcast via videoDetails.isLive (even if a length is present)', () => {
    expect(
      isLiveStream({ videoDetails: { isLive: true }, ...withAudio({ contentLength: '1000' }) })
    ).toBe(true);
  });

  it('flags a live-edge stream whose best audio format has no usable contentLength', () => {
    expect(isLiveStream(withAudio({}))).toBe(true); // unbounded live-edge: no contentLength
    expect(isLiveStream(withAudio({ contentLength: '0' }))).toBe(true); // zero length is not finite
  });

  it('does NOT flag a finished-stream VOD replay (finite audio file, isLiveContent-era)', () => {
    expect(
      isLiveStream({ videoDetails: { isLive: false }, ...withAudio({ contentLength: '5242880' }) })
    ).toBe(false);
  });

  it('does NOT flag a normal on-demand video (finite audio file)', () => {
    expect(isLiveStream(withAudio({ contentLength: '4300000' }))).toBe(false);
  });

  it('does NOT flag when there is no audio format to hijack, and tolerates junk input', () => {
    expect(
      isLiveStream({
        streamingData: {
          adaptiveFormats: [{ itag: 137, mimeType: 'video/mp4', url: 'https://v' }],
        },
      })
    ).toBe(false);
    expect(isLiveStream({})).toBe(false);
    expect(isLiveStream(null)).toBe(false);
    expect(isLiveStream(undefined)).toBe(false);
  });
});
