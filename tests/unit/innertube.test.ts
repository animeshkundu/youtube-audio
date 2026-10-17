import { describe, expect, it } from 'vitest';

import {
  ANDROID_CLIENT,
  ANDROID_VR_CLIENT,
  buildAndroidVrPlayerRequest,
  buildPlayerRequest,
  extractVisitorData,
  getPlayability,
  IOS_CLIENT,
  isLiveStream,
  MEDIA_CLIENTS,
  MWEB_CLIENT,
  pickBestAudioFormat,
  pickBestAudioUrl,
  retryVisitorData,
  VISIONOS_CLIENT,
  walkMediaClients,
  type MediaClientFetchResult,
  type MediaClientWalkOutcome,
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

describe('media-client table (SPEC-014, ADR-0012)', () => {
  it('orders VISIONOS first, ANDROID_VR second, then IOS, ANDROID, MWEB', () => {
    expect(MEDIA_CLIENTS.map((entry) => entry.id)).toEqual([
      'visionos',
      'android-vr',
      'ios',
      'android',
      'mweb',
    ]);
    expect(MEDIA_CLIENTS.map((entry) => entry.client)).toEqual([
      VISIONOS_CLIENT,
      ANDROID_VR_CLIENT,
      IOS_CLIENT,
      ANDROID_CLIENT,
      MWEB_CLIENT,
    ]);
  });

  it('pins the VISIONOS persona to the yt-dlp definition', () => {
    expect(VISIONOS_CLIENT).toEqual({
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
  });

  it('builds a VISIONOS body with the user agent inside the client context', () => {
    const request = buildPlayerRequest(VISIONOS_CLIENT, 'abc', 'visitor-token');

    expect(request.context.client).toMatchObject({
      clientName: 'VISIONOS',
      visitorData: 'visitor-token',
    });
    expect(request.context.client.userAgent).toContain('Safari/605.1.15');
    expect(VISIONOS_CLIENT).not.toHaveProperty('visitorData');
  });

  it('pins the IOS persona to the yt-dlp definition', () => {
    expect(IOS_CLIENT).toEqual({
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
  });

  it('builds an IOS body with the user agent inside the client context', () => {
    const request = buildPlayerRequest(IOS_CLIENT, 'abc', 'visitor-token');

    expect(request.context.client).toMatchObject({
      clientName: 'IOS',
      visitorData: 'visitor-token',
    });
    expect(request.context.client.userAgent).toContain('com.google.ios.youtube');
    expect(IOS_CLIENT).not.toHaveProperty('visitorData');
  });

  it('pins the ANDROID persona to the yt-dlp definition', () => {
    expect(ANDROID_CLIENT).toEqual({
      clientName: 'ANDROID',
      clientVersion: '21.26.364',
      osName: 'Android',
      osVersion: '11',
      androidSdkVersion: 30,
      userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
      hl: 'en',
      gl: 'US',
    });
  });

  it('builds an ANDROID body with the user agent inside the client context', () => {
    const request = buildPlayerRequest(ANDROID_CLIENT, 'abc', 'visitor-token');

    expect(request.context.client).toMatchObject({
      clientName: 'ANDROID',
      visitorData: 'visitor-token',
    });
    expect(request.context.client.userAgent).toContain('com.google.android.youtube');
    expect(ANDROID_CLIENT).not.toHaveProperty('visitorData');
  });

  it('pins the MWEB persona to the yt-dlp definition', () => {
    expect(MWEB_CLIENT).toEqual({
      clientName: 'MWEB',
      clientVersion: '2.20260708.05.00',
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
      hl: 'en',
      gl: 'US',
    });
  });

  it('builds an MWEB body with the user agent inside the client context', () => {
    const request = buildPlayerRequest(MWEB_CLIENT, 'abc', 'visitor-token');

    expect(request.context.client).toMatchObject({
      clientName: 'MWEB',
      visitorData: 'visitor-token',
    });
    expect(request.context.client.userAgent).toContain('Safari/604.1');
    expect(MWEB_CLIENT).not.toHaveProperty('visitorData');
  });

  it('keeps the ANDROID_VR compatibility wrapper equivalent to the generic builder', () => {
    expect(buildAndroidVrPlayerRequest('dQw4w9WgXcQ', 'visitor')).toEqual(
      buildPlayerRequest(ANDROID_VR_CLIENT, 'dQw4w9WgXcQ', 'visitor')
    );
  });
});

describe('fresh-visitorData retry signal', () => {
  it('extracts responseContext.visitorData and tolerates junk', () => {
    expect(extractVisitorData({ responseContext: { visitorData: 'fresh' } })).toBe('fresh');
    expect(extractVisitorData({ responseContext: { visitorData: '' } })).toBeNull();
    expect(extractVisitorData({ responseContext: {} })).toBeNull();
    expect(extractVisitorData({})).toBeNull();
    expect(extractVisitorData(null)).toBeNull();
    expect(extractVisitorData('nope')).toBeNull();
  });

  it('retries only with a present and different value', () => {
    expect(retryVisitorData({ responseContext: { visitorData: 'fresh' } }, 'used')).toBe('fresh');
    expect(retryVisitorData({ responseContext: { visitorData: 'used' } }, 'used')).toBeNull();
    expect(retryVisitorData({ responseContext: { visitorData: 'fresh' } }, null)).toBe('fresh');
    expect(retryVisitorData({}, 'used')).toBeNull();
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

describe('walkMediaClients (SPEC-014, ADR-0012)', () => {
  const audioFormat = (url: string) => ({
    itag: 251,
    mimeType: 'audio/webm',
    bitrate: 130000,
    contentLength: '3400000',
    url,
  });
  const playable = (url = 'https://rr1---sn-x.googlevideo.com/videoplayback?x=1') => ({
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [audioFormat(url)] },
  });
  const loginRequired = (visitorData?: string) => ({
    playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
    ...(visitorData ? { responseContext: { visitorData } } : {}),
  });
  const reply = (body: unknown, status = 200): MediaClientFetchResult => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  interface FetchCall {
    clientName: string;
    visitorData: string | null;
  }

  /**
   * Runs the walk against a scripted reply list. The fake transport throws when the walk asks for
   * a reply beyond the script, so an extra request (an unbounded retry) is visible both in `calls`
   * and as a `request-failed` outcome.
   */
  function runWalk(
    script: Array<MediaClientFetchResult | Error>,
    options: {
      requireDirectAudio?: boolean;
      allow?: (url: string) => boolean;
      isStale?: () => boolean;
      pageVisitorData?: string | null;
    } = {}
  ): { outcome: Promise<MediaClientWalkOutcome>; calls: FetchCall[] } {
    const calls: FetchCall[] = [];
    let index = 0;
    const outcome = walkMediaClients({
      requireDirectAudio: options.requireDirectAudio ?? true,
      isStale: options.isStale ?? (() => false),
      pageVisitorData: options.pageVisitorData ?? null,
      fetchPlayer: async (client, visitorData) => {
        calls.push({ clientName: client.clientName, visitorData });
        const next = script[index];
        index += 1;
        if (next instanceof Error) throw next;
        if (!next) throw new Error('walk requested an unscripted reply');
        return next;
      },
      isAllowedUrl: options.allow ?? (() => true),
    });
    return { outcome, calls };
  }

  it('accepts the primary client on its first attempt', async () => {
    const { outcome, calls } = runWalk([reply(playable())]);

    await expect(outcome).resolves.toMatchObject({ kind: 'ok', clientId: 'visionos', attempt: 1 });
    expect(calls).toEqual([{ clientName: 'VISIONOS', visitorData: null }]);
  });

  it('retries one time with the fresh visitorData token and accepts that retry', async () => {
    const { outcome, calls } = runWalk([reply(loginRequired('v2')), reply(playable())]);

    await expect(outcome).resolves.toMatchObject({ kind: 'ok', clientId: 'visionos', attempt: 2 });
    expect(calls).toEqual([
      { clientName: 'VISIONOS', visitorData: null },
      { clientName: 'VISIONOS', visitorData: 'v2' },
    ]);
  });

  it('caps each client at two attempts, then falls through in table order', async () => {
    const { outcome, calls } = runWalk([
      reply(loginRequired('t1')),
      reply(loginRequired('t2')),
      reply(loginRequired('t3')),
      reply(loginRequired('t4')),
      reply(loginRequired('t5')),
      reply(loginRequired('t6')),
      reply(loginRequired('t7')),
      reply(loginRequired('t8')),
      reply(loginRequired('t9')),
      reply(loginRequired('t10')),
    ]);

    await expect(outcome).resolves.toMatchObject({ kind: 'failed', reason: 'LOGIN_REQUIRED' });
    // Ten attempts total (two per client) and no eleventh: a broken cap would ask for an unscripted reply.
    expect(calls).toEqual([
      { clientName: 'VISIONOS', visitorData: null },
      { clientName: 'VISIONOS', visitorData: 't1' },
      { clientName: 'ANDROID_VR', visitorData: null },
      { clientName: 'ANDROID_VR', visitorData: 't3' },
      { clientName: 'IOS', visitorData: null },
      { clientName: 'IOS', visitorData: 't5' },
      { clientName: 'ANDROID', visitorData: null },
      { clientName: 'ANDROID', visitorData: 't7' },
      { clientName: 'MWEB', visitorData: null },
      { clientName: 'MWEB', visitorData: 't9' },
    ]);
  });

  it('does not retry with a token that was already used', async () => {
    const { outcome, calls } = runWalk([
      reply(loginRequired('same')),
      reply(loginRequired('same')),
      reply(loginRequired()),
      reply(loginRequired()),
      reply(loginRequired()),
      reply(loginRequired()),
    ]);

    await expect(outcome).resolves.toMatchObject({ kind: 'failed' });
    expect(calls).toEqual([
      { clientName: 'VISIONOS', visitorData: null },
      { clientName: 'VISIONOS', visitorData: 'same' },
      { clientName: 'ANDROID_VR', visitorData: null },
      { clientName: 'IOS', visitorData: null },
      { clientName: 'ANDROID', visitorData: null },
      { clientName: 'MWEB', visitorData: null },
    ]);
  });

  it('treats a live response as terminal for the whole table', async () => {
    const live = {
      playabilityStatus: { status: 'OK' },
      videoDetails: { isLive: true },
      streamingData: {
        adaptiveFormats: [{ ...audioFormat('https://media/live'), contentLength: undefined }],
      },
    };
    const { outcome, calls } = runWalk([reply(live)]);

    await expect(outcome).resolves.toMatchObject({ kind: 'live', clientId: 'visionos' });
    expect(calls).toHaveLength(1);
  });

  it('rejects a playable response whose URL is not allowlisted and continues the walk', async () => {
    const { outcome, calls } = runWalk(
      [reply(playable('https://not-allowed.example/videoplayback')), reply(playable())],
      { allow: (url) => url.startsWith('https://rr1---sn-x.googlevideo.com/') }
    );

    await expect(outcome).resolves.toMatchObject({
      kind: 'ok',
      clientId: 'android-vr',
      attempt: 2,
    });
    expect(calls).toEqual([
      { clientName: 'VISIONOS', visitorData: null },
      { clientName: 'ANDROID_VR', visitorData: null },
    ]);
  });

  it('survives a transport failure and still accepts the next client', async () => {
    const { outcome, calls } = runWalk([new Error('network down'), reply(playable())]);

    await expect(outcome).resolves.toMatchObject({ kind: 'ok', clientId: 'android-vr' });
    expect(calls.map((call) => call.clientName)).toEqual(['VISIONOS', 'ANDROID_VR']);
  });

  it('records a non-OK status as http-NNN without burning a retry token', async () => {
    const { outcome, calls } = runWalk([reply(null, 403), reply(playable())]);

    await expect(outcome).resolves.toMatchObject({ kind: 'ok', clientId: 'android-vr' });
    expect(calls).toEqual([
      { clientName: 'VISIONOS', visitorData: null },
      { clientName: 'ANDROID_VR', visitorData: null },
    ]);
  });

  it('keeps the last playable response when every client refuses a direct URL', async () => {
    const first = playable('https://not-allowed.example/one');
    const second = playable('https://not-allowed.example/two');
    const third = playable('https://not-allowed.example/three');
    const fourth = playable('https://not-allowed.example/four');
    const fifth = playable('https://not-allowed.example/five');
    const { outcome } = runWalk(
      [reply(first), reply(second), reply(third), reply(fourth), reply(fifth)],
      { allow: () => false }
    );

    const result = await outcome;
    expect(result).toMatchObject({
      kind: 'failed',
      reason: 'no-direct-audio',
      lastPlayable: fifth,
    });
    if (result.kind === 'failed') expect(result.lastParsed).toBe(fifth);
  });

  it('aborts as stale when the operation is superseded mid-walk', async () => {
    let stale = false;
    let calls = 0;
    const outcome = walkMediaClients({
      requireDirectAudio: true,
      isStale: () => stale,
      pageVisitorData: null,
      fetchPlayer: async () => {
        calls += 1;
        stale = true; // superseded by the time the response comes back
        return reply(playable());
      },
      isAllowedUrl: () => true,
    });

    await expect(outcome).resolves.toEqual({ kind: 'stale' });
    expect(calls).toBe(1);
  });

  it('skips the URL requirement when audio-only is off', async () => {
    const { outcome, calls } = runWalk([reply(playable('https://anything.example/audio'))], {
      requireDirectAudio: false,
      allow: () => false,
    });

    await expect(outcome).resolves.toMatchObject({ kind: 'ok', clientId: 'visionos' });
    expect(calls).toHaveLength(1);
  });
});
