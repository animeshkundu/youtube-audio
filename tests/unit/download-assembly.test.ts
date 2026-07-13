import { describe, expect, it, vi } from 'vitest';

import { assembleAudioMedia, parseContentRange, type AudioFetch } from '../../src/shared/download';

function response(body: Uint8Array, status: number, headers: Record<string, string>): Response {
  const responseBody = new Uint8Array(body.byteLength);
  responseBody.set(body);
  return new Response(responseBody, { status, headers });
}

describe('audio media assembly', () => {
  it('parses a valid Content-Range total and rejects malformed or unknown totals', () => {
    expect(parseContentRange('bytes 0-3/10')).toEqual({ start: 0, end: 3, total: 10 });
    expect(parseContentRange('bytes 4-9/*')).toBeNull();
    expect(parseContentRange('items 0-3/10')).toBeNull();
    expect(parseContentRange('bytes 3-1/10')).toBeNull();
    expect(parseContentRange('bytes 0-10/10')).toBeNull();
  });

  it('fetches sequential byte ranges and concatenates exactly one complete stream', async () => {
    const source = Uint8Array.from({ length: 11 }, (_, index) => index);
    const fetcher = vi.fn<AudioFetch>(async (_url, init) => {
      const range = new Headers(init?.headers).get('Range');
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
      if (!match) throw new Error('missing range');
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), source.byteLength - 1);
      return response(source.slice(start, end + 1), 206, {
        'Content-Range': `bytes ${start}-${end}/${source.byteLength}`,
        'Content-Type': 'audio/webm',
      });
    });

    const result = await assembleAudioMedia('https://r.googlevideo.com/videoplayback', fetcher, {
      chunkSize: 4,
    });

    expect(Array.from(result.bytes)).toEqual(Array.from(source));
    expect(result.mimeType).toBe('audio/webm');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map((call) => new Headers(call[1]?.headers).get('Range'))).toEqual([
      'bytes=0-3',
      'bytes=4-7',
      'bytes=8-10',
    ]);
    for (const call of fetcher.mock.calls) expect(call[1]?.credentials).toBe('omit');
  });

  it('uses one complete response when the server ignores Range', async () => {
    const source = Uint8Array.from([9, 8, 7, 6]);
    const fetcher = vi.fn<AudioFetch>(async () =>
      response(source, 200, {
        'Content-Length': String(source.byteLength),
        'Content-Type': 'audio/mp4; codecs="mp4a.40.2"',
      })
    );

    const result = await assembleAudioMedia('https://r.googlevideo.com/videoplayback', fetcher, {
      chunkSize: 2,
    });

    expect(Array.from(result.bytes)).toEqual(Array.from(source));
    expect(result.mimeType).toBe('audio/mp4');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries without Range when partial delivery omits Content-Range', async () => {
    const source = Uint8Array.from([5, 4, 3]);
    const fetcher = vi
      .fn<AudioFetch>()
      .mockResolvedValueOnce(response(Uint8Array.from([5]), 206, {}))
      .mockResolvedValueOnce(
        response(source, 200, {
          'Content-Length': String(source.byteLength),
          'Content-Type': 'audio/webm',
        })
      );

    const result = await assembleAudioMedia('https://r.googlevideo.com/videoplayback', fetcher);

    expect(Array.from(result.bytes)).toEqual(Array.from(source));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const fallbackInit = fetcher.mock.calls.at(1)?.[1];
    expect(new Headers(fallbackInit?.headers).has('Range')).toBe(false);
    expect(fallbackInit?.credentials).toBe('omit');
  });

  it('rejects failed, inconsistent, partial, and oversized responses', async () => {
    await expect(
      assembleAudioMedia('https://r.googlevideo.com/videoplayback', async () =>
        response(new Uint8Array(), 403, {})
      )
    ).rejects.toThrow('status 403');

    await expect(
      assembleAudioMedia(
        'https://r.googlevideo.com/videoplayback',
        async () => response(Uint8Array.from([1, 2]), 206, { 'Content-Range': 'bytes 1-2/4' }),
        { chunkSize: 2 }
      )
    ).rejects.toThrow('unexpected byte range');

    await expect(
      assembleAudioMedia(
        'https://r.googlevideo.com/videoplayback',
        async () => response(Uint8Array.from([1]), 206, { 'Content-Range': 'bytes 0-1/4' }),
        { chunkSize: 2 }
      )
    ).rejects.toThrow('body length');

    await expect(
      assembleAudioMedia(
        'https://r.googlevideo.com/videoplayback',
        async () => response(Uint8Array.from([1, 2]), 206, { 'Content-Range': 'bytes 0-1/9' }),
        { chunkSize: 2, maxBytes: 8 }
      )
    ).rejects.toThrow('exceeds');
  });
});
