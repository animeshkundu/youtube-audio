import { describe, expect, it } from 'vitest';

import { pruneAdsFromPlayerResponse } from '../../src/shared/adblock';

describe('pruneAdsFromPlayerResponse', () => {
  it('strips every known top-level ad descriptor and preserves playback data', () => {
    const input = JSON.stringify({
      responseContext: { visitorData: 'visitor' },
      playabilityStatus: { status: 'OK' },
      streamingData: {
        expiresInSeconds: '21540',
        adaptiveFormats: [{ itag: 251, mimeType: 'audio/webm', url: 'https://media.example/audio' }],
      },
      videoDetails: { videoId: 'abc123', title: 'Keep me' },
      adPlacements: [{ id: 'pre-roll' }],
      playerAds: [{ id: 'overlay' }],
      adSlots: [{ id: 'slot' }],
      adPlacementRenderer: { id: 'renderer' },
      unknownFutureField: { nested: true },
    });

    expect(JSON.parse(pruneAdsFromPlayerResponse(input))).toEqual({
      responseContext: { visitorData: 'visitor' },
      playabilityStatus: { status: 'OK' },
      streamingData: {
        expiresInSeconds: '21540',
        adaptiveFormats: [{ itag: 251, mimeType: 'audio/webm', url: 'https://media.example/audio' }],
      },
      videoDetails: { videoId: 'abc123', title: 'Keep me' },
      unknownFutureField: { nested: true },
    });
  });

  it('strips matching keys recursively through objects and arrays', () => {
    const input = JSON.stringify({
      playerResponse: {
        adPlacements: [{ adPlacementRenderer: { kind: 'start' } }],
        nested: [{ playerAds: ['ad'], content: { adSlots: [1], title: 'keep' } }],
      },
      contents: [{ renderer: { adPlacementRenderer: { id: 1 }, value: 'keep' } }],
    });

    expect(JSON.parse(pruneAdsFromPlayerResponse(input))).toEqual({
      playerResponse: { nested: [{ content: { title: 'keep' } }] },
      contents: [{ renderer: { value: 'keep' } }],
    });
  });

  it.each(['not json', '{"adPlacements":', '', '[1,'])('returns malformed input unchanged: %s', (input) => {
    expect(pruneAdsFromPlayerResponse(input)).toBe(input);
  });

  it.each(['null', 'true', '42', '"playerAds"', '[1,"adSlots",null]'])(
    'preserves valid JSON without matching object keys: %s',
    (input) => {
      expect(pruneAdsFromPlayerResponse(input)).toBe(input);
    }
  );

  it('preserves the original string when no ad field is present', () => {
    const input = '{\n  "streamingData": { "formats": [] },\n  "videoDetails": { "title": "unchanged" }\n}';
    expect(pruneAdsFromPlayerResponse(input)).toBe(input);
  });
});
