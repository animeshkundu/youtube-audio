// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireWithin, withTimeout } from '../../src/shared/timers';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves the value and releases the timer when the promise settles first', async () => {
    vi.useFakeTimers();

    const result = withTimeout(Promise.resolve('value'), 1_000, 'fallback');

    await expect(result).resolves.toBe('value');
    // The regression SPEC-018 exists to prevent: the losing timer must not stay armed.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves the fallback when the timeout fires, and a late settle is ignored', async () => {
    vi.useFakeTimers();
    let settleLate: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      settleLate = resolve;
    });

    const result = withTimeout(pending, 1_000, 'fallback');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1_000);
    await expect(result).resolves.toBe('fallback');
    expect(vi.getTimerCount()).toBe(0);

    settleLate('late'); // settle-once: a post-timeout settlement cannot change the outcome
    await expect(result).resolves.toBe('fallback');
  });

  it('forwards a rejection immediately and releases the timer', async () => {
    vi.useFakeTimers();

    const result = withTimeout(Promise.reject(new Error('boom')), 1_000, 'fallback');

    await expect(result).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('requireWithin', () => {
  it('resolves the value and releases the timer when the promise settles first', async () => {
    vi.useFakeTimers();

    const result = requireWithin(Promise.resolve(42), 1_000, 'slow');

    await expect(result).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the exact message after the timeout and releases the timer', async () => {
    vi.useFakeTimers();
    const pending = new Promise<number>(() => undefined);

    const result = requireWithin(pending, 1_000, 'slow');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1_000);
    await expect(result).rejects.toThrow('slow');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards a rejection immediately and releases the timer', async () => {
    vi.useFakeTimers();

    const result = requireWithin(Promise.reject(new Error('unavailable')), 1_000, 'slow');

    await expect(result).rejects.toThrow('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});
