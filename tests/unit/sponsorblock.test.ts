import { describe, expect, it } from 'vitest';

import {
  hashVideoIdPrefix,
  resolveSegmentSkipTarget,
  selectSegments,
} from '../../src/shared/sponsorblock';

describe('hashVideoIdPrefix', () => {
  it('returns the first four hex characters of a known SHA-256 vector', async () => {
    await expect(hashVideoIdPrefix('dQw4w9WgXcQ')).resolves.toBe('5f6b');
  });
});

describe('selectSegments', () => {
  it('filters the anonymity bucket by exact video and enabled category', () => {
    const response = [
      {
        videoID: 'wanted',
        segments: [
          { segment: [20, 30], category: 'sponsor', actionType: 'skip' },
          { segment: [5, 10], category: 'music_offtopic', actionType: 'skip' },
          { segment: [1, 2], category: 'intro', actionType: 'skip' },
        ],
      },
      {
        videoID: 'other',
        segments: [{ segment: [0, 100], category: 'sponsor', actionType: 'skip' }],
      },
    ];

    expect(selectSegments(response, 'wanted', ['sponsor'])).toEqual([
      { segment: [20, 30], category: 'sponsor', actionType: 'skip' },
    ]);
    expect(selectSegments(response, 'wanted', ['sponsor', 'music_offtopic'])).toEqual([
      { segment: [5, 10], category: 'music_offtopic', actionType: 'skip' },
      { segment: [20, 30], category: 'sponsor', actionType: 'skip' },
    ]);
  });

  it('sorts and merges overlapping or touching skip ranges', () => {
    const response = [
      {
        videoID: 'wanted',
        segments: [
          { segment: [8, 12], category: 'music_offtopic', actionType: 'skip' },
          { segment: [2, 6], category: 'sponsor', actionType: 'skip' },
          { segment: [5, 9], category: 'sponsor', actionType: 'skip' },
          { segment: [15, 16], category: 'sponsor' },
          { segment: [12, 14], category: 'sponsor', actionType: 'skip' },
        ],
      },
    ];

    expect(selectSegments(response, 'wanted', ['sponsor', 'music_offtopic'])).toEqual([
      { segment: [2, 14], category: 'sponsor', actionType: 'skip' },
      { segment: [15, 16], category: 'sponsor', actionType: 'skip' },
    ]);
  });

  it('returns no segments for malformed responses and rejects malformed ranges', () => {
    expect(selectSegments(null, 'wanted', ['sponsor'])).toEqual([]);
    expect(selectSegments({}, 'wanted', ['sponsor'])).toEqual([]);
    expect(selectSegments([{ videoID: 'wanted', segments: {} }], 'wanted', ['sponsor'])).toEqual(
      []
    );
    expect(
      selectSegments(
        [
          {
            videoID: 'wanted',
            segments: [
              null,
              { segment: [-1, 2], category: 'sponsor', actionType: 'skip' },
              { segment: [2, 2], category: 'sponsor', actionType: 'skip' },
              { segment: [3, Number.POSITIVE_INFINITY], category: 'sponsor', actionType: 'skip' },
              { segment: ['3', 4], category: 'sponsor', actionType: 'skip' },
              { segment: [3, 4, 5], category: 'sponsor', actionType: 'skip' },
              { segment: [3, 4], category: 'sponsor', actionType: 'mute' },
            ],
          },
        ],
        'wanted',
        ['sponsor']
      )
    ).toEqual([]);
  });
});

describe('resolveSegmentSkipTarget', () => {
  const segment = {
    segment: [10, 20] as readonly [number, number],
    category: 'sponsor' as const,
    actionType: 'skip' as const,
  };

  it('returns the segment end while the playhead is inside the segment', () => {
    expect(resolveSegmentSkipTarget({ segment, currentTime: 10, duration: 100 })).toBe(20);
    expect(resolveSegmentSkipTarget({ segment, currentTime: 19.5, duration: 100 })).toBe(20);
  });

  it('does not seek before the segment start', () => {
    expect(resolveSegmentSkipTarget({ segment, currentTime: 9.9, duration: 100 })).toBeNull();
  });

  it('never re-seeks once the playhead is at or past the segment end (double-seek guard)', () => {
    // Covers another skipper's seek, a manual seek, and one of our own completed skips.
    expect(resolveSegmentSkipTarget({ segment, currentTime: 20, duration: 100 })).toBeNull();
    expect(resolveSegmentSkipTarget({ segment, currentTime: 21, duration: 100 })).toBeNull();
  });

  it('clamps the target to a finite duration and falls back to the raw end otherwise', () => {
    expect(resolveSegmentSkipTarget({ segment, currentTime: 19, duration: 19.5 })).toBe(19.5);
    expect(resolveSegmentSkipTarget({ segment, currentTime: 19, duration: Number.NaN })).toBe(20);
    expect(resolveSegmentSkipTarget({ segment, currentTime: 19, duration: 0 })).toBe(20);
  });

  it('returns null when the clamped end is not ahead of the playhead', () => {
    // Playhead already at the clamped end: the media is past the segment either way.
    expect(resolveSegmentSkipTarget({ segment, currentTime: 19.5, duration: 19.5 })).toBeNull();
  });
});
