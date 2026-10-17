// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  armOneShotPause,
  createReclaimTracker,
  RECLAIM_MAX_GENERATION_SKEW,
  RECLAIM_TTL_MS,
  type ReclaimRecord,
} from '../../src/shared/reclaim';

function makeRecord(overrides: Partial<ReclaimRecord> = {}): ReclaimRecord {
  return {
    element: document.createElement('video'),
    ownedUrl: 'blob:fixture',
    currentTime: 42,
    paused: true,
    ...overrides,
  };
}

describe('createReclaimTracker', () => {
  it('hands the pending record to exactly one consumer (atomic take)', () => {
    const tracker = createReclaimTracker();
    tracker.set(makeRecord(), 'video-1', 7);
    const matched = tracker.match('video-1', 7);
    expect(matched).toMatchObject({
      videoId: 'video-1',
      generation: 7,
      currentTime: 42,
      paused: true,
    });
    const taken = tracker.take('video-1', 7);
    expect(taken?.currentTime).toBe(42);
    expect(tracker.take('video-1', 7)).toBeNull();
    expect(tracker.match('video-1', 7)).toBeNull();
  });

  it('drops an untracked release and never matches it to another video', () => {
    const tracker = createReclaimTracker();
    tracker.set(makeRecord(), null, 3);
    expect(tracker.match('video-1', 3)).toBeNull();
    // The reclaim path can still see it (any-video match) so it can clear it explicitly.
    expect(tracker.match(undefined, 3)?.videoId).toBeNull();
    expect(tracker.take('video-1', 3)).toBeNull();
    expect(tracker.take(undefined, 3)).not.toBeNull();
  });

  it('expires a stale reclaim by TTL and by generation skew', () => {
    let now = 1_000;
    const tracker = createReclaimTracker({ now: () => now });
    tracker.set(makeRecord(), 'video-1', 4);
    now += RECLAIM_TTL_MS;
    expect(tracker.match(undefined, 4)).not.toBeNull(); // exactly at the TTL is still live
    now += 1;
    expect(tracker.match(undefined, 4)).toBeNull(); // expired, even for the same generation

    now = 1_000;
    tracker.set(makeRecord(), 'video-1', 4);
    expect(tracker.match(undefined, 4 + RECLAIM_MAX_GENERATION_SKEW)).not.toBeNull();
    expect(tracker.match(undefined, 6 + RECLAIM_MAX_GENERATION_SKEW)).toBeNull();
  });

  it('keeps a videoId mismatch distinguishable from an expiry', () => {
    const tracker = createReclaimTracker();
    tracker.set(makeRecord(), 'video-1', 4);
    // A mismatch does not clear the record: it may still be consumed by its own video.
    expect(tracker.match('video-2', 5)).toBeNull();
    expect(tracker.match('video-1', 5)).not.toBeNull();
  });

  it('replaces the previous record and clears on demand', () => {
    const tracker = createReclaimTracker();
    tracker.set(makeRecord({ currentTime: 1 }), 'video-1', 1);
    tracker.set(makeRecord({ currentTime: 2 }), 'video-2', 2);
    expect(tracker.match(undefined, 2)?.videoId).toBe('video-2');
    expect(tracker.match(undefined, 2)?.currentTime).toBe(2);
    tracker.clear();
    expect(tracker.match(undefined, 2)).toBeNull();
  });
});

describe('armOneShotPause', () => {
  it('pauses immediately when real media is already attached', () => {
    const element = document.createElement('video');
    Object.defineProperty(element, 'readyState', { configurable: true, value: 2 });
    let pauses = 0;
    const dispose = armOneShotPause(element, {
      isCurrent: () => true,
      pause: () => {
        pauses += 1;
      },
      timeoutMs: 1_000,
    });
    dispose();
    expect(pauses).toBe(1);
  });

  it('fires once on loadeddata and only while the arm is still current', () => {
    const element = document.createElement('video');
    let current = false;
    let pauses = 0;
    const dispose = armOneShotPause(element, {
      isCurrent: () => current,
      pause: () => {
        pauses += 1;
      },
      timeoutMs: 1_000,
    });
    element.dispatchEvent(new Event('loadeddata'));
    // The arm consumed itself even though it did not pause; a second event cannot fire one.
    current = true;
    element.dispatchEvent(new Event('loadeddata'));
    dispose();
    expect(pauses).toBe(0);
  });

  it('pauses exactly once on the first loadeddata', () => {
    const element = document.createElement('video');
    let pauses = 0;
    armOneShotPause(element, {
      isCurrent: () => true,
      pause: () => {
        pauses += 1;
      },
      timeoutMs: 1_000,
    });
    element.dispatchEvent(new Event('loadeddata'));
    element.dispatchEvent(new Event('loadeddata'));
    expect(pauses).toBe(1);
  });

  it('never double-pauses when a newer arm supersedes a pending one', () => {
    const element = document.createElement('video');
    let pauses = 0;
    const pause = () => {
      pauses += 1;
    };
    const first = armOneShotPause(element, { isCurrent: () => true, pause, timeoutMs: 1_000 });
    first(); // the coordinator disposes the previous arm before re-arming (single-winner pattern)
    const second = armOneShotPause(element, { isCurrent: () => true, pause, timeoutMs: 1_000 });
    element.dispatchEvent(new Event('loadeddata'));
    second();
    expect(pauses).toBe(1);
  });

  it('stops listening after the timeout or disposal', async () => {
    const element = document.createElement('video');
    let pauses = 0;
    const pause = () => {
      pauses += 1;
    };
    const disposed = armOneShotPause(element, { isCurrent: () => true, pause, timeoutMs: 20 });
    disposed();
    armOneShotPause(element, { isCurrent: () => true, pause, timeoutMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 45));
    element.dispatchEvent(new Event('loadeddata'));
    expect(pauses).toBe(0);
  });
});
