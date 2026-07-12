import { describe, expect, it, vi } from 'vitest';

import {
  isLogCode,
  isLogContext,
  Persister,
  RateLimiter,
  RingBuffer,
  validateLogEvent,
  type StoredEvent,
} from '../../src/shared/logger';

function stored(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    seq: 1,
    ts: 1_000,
    ctx: 'bg',
    code: 'error',
    data: { where: 'bg.init', name: 'Error' },
    ...overrides,
  };
}

function flushMicrotasks(): Promise<void> {
  return (async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  })();
}

describe('validateLogEvent', () => {
  it('validates player.props and coerces an unknown duration bucket', () => {
    expect(
      validateLogEvent({
        code: 'player.props',
        data: {
          live: false,
          music: true,
          hasAudio: true,
          loudness: true,
          playable: true,
          duration: 'lt10m',
        },
      })
    ).toEqual({
      code: 'player.props',
      data: {
        live: false,
        music: true,
        hasAudio: true,
        loudness: true,
        playable: true,
        duration: 'lt10m',
      },
    });
    expect(validateLogEvent({ code: 'player.props', data: { duration: 'forever' } })).toEqual({
      code: 'player.props',
      data: { duration: 'other' },
    });
  });

  it('redacts PII from a captured error stack and drops a non-string stack', () => {
    const result = validateLogEvent({
      code: 'error',
      data: {
        where: 'bg.init',
        name: 'TypeError',
        stack:
          'at fetch https://x.googlevideo.com/videoplayback?id=dQw4w9WgXcQ (moz-extension://11111111-2222-4333-8444-555555555555/bg.js:4:2)',
      },
    });
    const stack = result?.data.stack as string;
    expect(stack).not.toContain('dQw4w9WgXcQ');
    expect(stack).not.toContain('videoplayback');
    expect(stack).toContain('bg.js:4:2');
    expect(validateLogEvent({ code: 'error', data: { where: 'bg.init', stack: 123 } })).toBeNull();
  });

  it('accepts a valid event and preserves allowed enum, int, and bool values', () => {
    expect(
      validateLogEvent({ code: 'playback.status', data: { status: 'fallback', reason: 'live' } })
    ).toEqual({ code: 'playback.status', data: { status: 'fallback', reason: 'live' } });
    expect(validateLogEvent({ code: 'segment.armed', data: { count: 3 } })).toEqual({
      code: 'segment.armed',
      data: { count: 3 },
    });
    expect(validateLogEvent({ code: 'audio.graph', data: { loudness: true, eq: false } })).toEqual({
      code: 'audio.graph',
      data: { loudness: true, eq: false },
    });
    expect(validateLogEvent({ code: 'spa.rearm' })).toEqual({ code: 'spa.rearm', data: {} });
  });

  it('accepts a bounded http-NNN reason token', () => {
    expect(
      validateLogEvent({
        code: 'playback.status',
        data: { status: 'fallback', reason: 'http-403' },
      })
    ).toEqual({ code: 'playback.status', data: { status: 'fallback', reason: 'http-403' } });
  });

  it('coerces out-of-set enum strings (including forged secrets) to other', () => {
    expect(
      validateLogEvent({
        code: 'playback.status',
        data: { status: 'totally-made-up', reason: 'my-search-query dQw4w9WgXcQ' },
      })
    ).toEqual({ code: 'playback.status', data: { status: 'other', reason: 'other' } });
  });

  it('clamps bounded integers and drops wrong-typed int and bool values', () => {
    expect(validateLogEvent({ code: 'segment.armed', data: { count: 99_999 } })).toEqual({
      code: 'segment.armed',
      data: { count: 1000 },
    });
    expect(validateLogEvent({ code: 'segment.armed', data: { count: 'lots' } })).toBeNull();
    expect(
      validateLogEvent({ code: 'audio.graph', data: { loudness: 'yes', eq: false } })
    ).toBeNull();
  });

  it('drops unknown codes, unknown data keys, and non-object payloads', () => {
    expect(validateLogEvent({ code: 'not-a-code', data: {} })).toBeNull();
    expect(
      validateLogEvent({ code: 'audio.graph', data: { loudness: true, secret: 'x' } })
    ).toBeNull();
    expect(validateLogEvent({ code: 'audio.graph', data: 'nope' })).toBeNull();
    expect(validateLogEvent(null)).toBeNull();
    expect(validateLogEvent(42)).toBeNull();
  });
});

describe('RingBuffer', () => {
  it('stores events and returns independent snapshots', () => {
    const buffer = new RingBuffer();
    expect(buffer.push(stored({ seq: 1 }))).toBe(true);
    const snapshot = buffer.snapshot();
    snapshot[0]!.data.name = 'mutated';
    expect(buffer.snapshot()[0]!.data.name).toBe('Error');
    expect(buffer.size).toBe(1);
    buffer.clear();
    expect(buffer.size).toBe(0);
  });

  it('coalesces a consecutive duplicate into a repeat count', () => {
    const buffer = new RingBuffer();
    expect(buffer.push(stored({ seq: 1, code: 'spa.rearm', data: {} }))).toBe(true);
    expect(buffer.push(stored({ seq: 2, code: 'spa.rearm', data: {} }))).toBe(true);
    expect(buffer.push(stored({ seq: 3, code: 'spa.rearm', data: {} }))).toBe(true);
    expect(buffer.size).toBe(1);
    expect(buffer.snapshot()[0]!.n).toBe(3);
  });

  it('enforces the per-code cap by evicting the oldest of that code', () => {
    const buffer = new RingBuffer({ maxPerCode: 2 });
    buffer.push(stored({ seq: 1, code: 'sponsor.result', data: { ok: true, count: 1 } }));
    buffer.push(stored({ seq: 2, code: 'sponsor.result', data: { ok: true, count: 2 } }));
    buffer.push(stored({ seq: 3, code: 'sponsor.result', data: { ok: true, count: 3 } }));
    const seqs = buffer.snapshot().map((event) => event.seq);
    expect(seqs).toEqual([2, 3]);
  });

  it('enforces the event-count cap with FIFO eviction', () => {
    const buffer = new RingBuffer({ maxEvents: 3, maxPerCode: 100 });
    for (let index = 1; index <= 5; index += 1) {
      buffer.push(stored({ seq: index, code: 'segment.armed', data: { count: index } }));
    }
    expect(buffer.snapshot().map((event) => event.seq)).toEqual([3, 4, 5]);
  });

  it('enforces the total byte cap', () => {
    const buffer = new RingBuffer({ maxBytes: 160, maxPerCode: 100, maxEvents: 100 });
    for (let index = 1; index <= 20; index += 1) {
      buffer.push(stored({ seq: index, code: 'segment.armed', data: { count: index } }));
    }
    expect(buffer.size).toBeLessThan(20);
    expect(buffer.size).toBeGreaterThan(0);
  });

  it('drops an oversized or unserializable event without throwing', () => {
    const buffer = new RingBuffer({ maxEventBytes: 40 });
    const big = stored({
      code: 'error',
      data: { where: 'bg.init', name: 'x'.repeat(200) as 'Error' },
    });
    expect(buffer.push(big)).toBe(false);
    const circular = stored();
    (circular as unknown as { toJSON: () => unknown }).toJSON = () => {
      throw new Error('boom');
    };
    expect(buffer.push(circular)).toBe(false);
    expect(buffer.size).toBe(0);
  });
});

describe('RateLimiter', () => {
  it('drains capacity then refuses until refilled', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1, () => now);
    expect(limiter.tryRemove()).toBe(true);
    expect(limiter.tryRemove()).toBe(true);
    expect(limiter.tryRemove()).toBe(false);
    now = 1_000;
    expect(limiter.tryRemove()).toBe(true);
    expect(limiter.tryRemove()).toBe(false);
  });
});

describe('Persister', () => {
  const timers = () => {
    const scheduled: Array<() => void> = [];
    const cleared: number[] = [];
    return {
      scheduled,
      cleared,
      api: {
        set: (fn: () => void) => {
          scheduled.push(fn);
          return scheduled.length;
        },
        clear: (handle: number) => {
          cleared.push(handle);
        },
      },
    };
  };

  it('serializes writes on a single chain and never overlaps them', async () => {
    const started: string[] = [];
    const gates: Array<() => void> = [];
    const write = (value: unknown): Promise<void> => {
      started.push(value as string);
      return new Promise((resolve) => gates.push(resolve));
    };
    const persister = new Persister(write, 1_000, timers().api);
    const p1 = persister.flushNow(() => 'A');
    const p2 = persister.flushNow(() => 'B');
    await flushMicrotasks();
    expect(started).toEqual(['A']);
    gates[0]!();
    await flushMicrotasks();
    expect(started).toEqual(['A', 'B']);
    gates[1]!();
    await Promise.all([p1, p2]);
  });

  it('reads state at write time so a clear cannot resurrect old data', async () => {
    const written: unknown[] = [];
    const state = { events: ['a', 'b'] as string[] };
    const persister = new Persister(
      async (value) => {
        written.push(value);
      },
      1_000,
      timers().api
    );
    persister.flushNow(() => [...state.events]);
    state.events = [];
    await flushMicrotasks();
    expect(written).toEqual([[]]);
  });

  it('debounces schedule into a single timer and reschedules after it fires', async () => {
    const written: unknown[] = [];
    const clock = timers();
    const persister = new Persister(
      async (value) => {
        written.push(value);
      },
      1_000,
      clock.api
    );
    persister.schedule(() => 'A');
    persister.schedule(() => 'A');
    expect(clock.scheduled).toHaveLength(1);
    clock.scheduled[0]!();
    await flushMicrotasks();
    expect(written).toEqual(['A']);
    persister.schedule(() => 'B');
    expect(clock.scheduled).toHaveLength(2);
  });

  it('clears a pending timer when flushing immediately', () => {
    const clock = timers();
    const persister = new Persister(async () => undefined, 1_000, clock.api);
    persister.schedule(() => 'A');
    void persister.flushNow(() => 'B');
    expect(clock.cleared).toHaveLength(1);
  });

  it('drives its default real-timer path', async () => {
    vi.useFakeTimers();
    try {
      const written: unknown[] = [];
      const persister = new Persister(async (value) => {
        written.push(value);
      }, 5);
      persister.schedule(() => 'A');
      void persister.flushNow(() => 'B');
      persister.schedule(() => 'C');
      await vi.advanceTimersByTimeAsync(10);
      expect(written).toContain('C');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('type guards', () => {
  it('recognizes valid codes and contexts', () => {
    expect(isLogCode('playback.status')).toBe(true);
    expect(isLogCode('nope')).toBe(false);
    expect(isLogContext('page')).toBe(true);
    expect(isLogContext('elsewhere')).toBe(false);
  });
});
