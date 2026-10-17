import { describe, expect, it } from 'vitest';

import {
  createResponseBudget,
  MAX_PRUNABLE_RESPONSE_BYTES,
  pruneAdsFromParsedPlayerResponse,
  pruneAdsFromPlayerResponse,
} from '../../src/shared/adblock';

describe('pruneAdsFromParsedPlayerResponse', () => {
  it('prunes a parsed player response in place and reports whether it changed', () => {
    const player = {
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [] },
      adPlacements: [{ id: 'pre-roll' }],
      nested: { playerAds: [{ id: 'mid-roll' }], keep: true },
    };

    expect(pruneAdsFromParsedPlayerResponse(player)).toBe(true);
    expect(player).toEqual({
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [] },
      nested: { keep: true },
    });
    expect(pruneAdsFromParsedPlayerResponse(player)).toBe(false);
  });
});

describe('pruneAdsFromPlayerResponse', () => {
  it('strips every known top-level ad descriptor and preserves playback data', () => {
    const input = JSON.stringify({
      responseContext: { visitorData: 'visitor' },
      playabilityStatus: { status: 'OK' },
      streamingData: {
        expiresInSeconds: '21540',
        adaptiveFormats: [
          { itag: 251, mimeType: 'audio/webm', url: 'https://media.example/audio' },
        ],
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
        adaptiveFormats: [
          { itag: 251, mimeType: 'audio/webm', url: 'https://media.example/audio' },
        ],
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

  it.each(['not json', '{"adPlacements":', '', '[1,'])(
    'returns malformed input unchanged: %s',
    (input) => {
      expect(pruneAdsFromPlayerResponse(input)).toBe(input);
    }
  );

  it.each(['null', 'true', '42', '"playerAds"', '[1,"adSlots",null]'])(
    'preserves valid JSON without matching object keys: %s',
    (input) => {
      expect(pruneAdsFromPlayerResponse(input)).toBe(input);
    }
  );

  it('preserves the original string when no ad field is present', () => {
    const input =
      '{\n  "streamingData": { "formats": [] },\n  "videoDetails": { "title": "unchanged" }\n}';
    expect(pruneAdsFromPlayerResponse(input)).toBe(input);
  });
});

describe('createResponseBudget', () => {
  it('buffers below the budget and hands the held chunks back intact', () => {
    const budget = createResponseBudget(10);
    expect(budget.push(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(budget.push(new Uint8Array([4, 5]))).toBeNull();
    expect(budget.streaming).toBe(false);
    expect(budget.receivedBytes).toBe(5);
    const held = budget.bufferedChunks();
    expect(held.map((chunk) => Array.from(chunk))).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    // The held chunks are a copy of the buffer list, not live state.
    held.length = 0;
    expect(budget.bufferedChunks()).toHaveLength(2);
  });

  it('flushes everything held exactly once when the budget is crossed, then streams', () => {
    const budget = createResponseBudget(10);
    expect(budget.push(new Uint8Array(6))).toBeNull();
    const flush = budget.push(new Uint8Array(6));
    expect(flush?.map((chunk) => chunk.byteLength)).toEqual([6, 6]);
    expect(budget.streaming).toBe(true);
    expect(budget.bufferedChunks()).toEqual([]);
    expect(budget.push(new Uint8Array([9]))?.map((chunk) => Array.from(chunk))).toEqual([[9]]);
    expect(budget.receivedBytes).toBe(13);
  });

  it('stays within budget exactly at the boundary', () => {
    const budget = createResponseBudget(4);
    expect(budget.push(new Uint8Array(4))).toBeNull();
    expect(budget.streaming).toBe(false);
    expect(budget.push(new Uint8Array(1))?.map((chunk) => chunk.byteLength)).toEqual([4, 1]);
  });

  it('streams from the first chunk when the budget is non-positive', () => {
    const budget = createResponseBudget(0);
    expect(budget.push(new Uint8Array([7]))?.map((chunk) => Array.from(chunk))).toEqual([[7]]);
    expect(budget.streaming).toBe(true);
    expect(budget.bufferedChunks()).toEqual([]);
  });

  it('pins the shipping budget at 8 MiB', () => {
    expect(MAX_PRUNABLE_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
  });
});
