// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeYouTubeSpa } from '../../src/shared/spa';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('observeYouTubeSpa', () => {
  it('coalesces many mutation batches into one player lookup per animation frame', async () => {
    let mutationCallback: MutationCallback = () => undefined;
    const disconnect = vi.fn();
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }

      observe(): void {}
      disconnect(): void {
        disconnect();
      }
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((handle: number) => frames.delete(handle))
    );
    const querySelector = vi.spyOn(document, 'querySelector');
    document.body.innerHTML = '<video></video>';

    const observer = observeYouTubeSpa(vi.fn());
    await Promise.resolve();
    mutationCallback([], {} as MutationObserver);
    mutationCallback([], {} as MutationObserver);
    mutationCallback([], {} as MutationObserver);

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(querySelector.mock.calls.filter(([selector]) => selector === 'video')).toHaveLength(1);

    frames.get(1)?.(16);
    expect(querySelector.mock.calls.filter(([selector]) => selector === 'video')).toHaveLength(2);

    observer.stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('handles yt-navigate-finish immediately without waiting for animation frames', async () => {
    class FakeMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe(): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onNavigate = vi.fn();
    // Set the URL BEFORE observing so the history hook does not fire; this isolates the
    // yt-navigate-finish path (which emits 'navigation' unconditionally).
    window.history.replaceState({}, '', '/watch?v=CCCCCCCCCCC');
    const observer = observeYouTubeSpa(onNavigate);
    await Promise.resolve();
    onNavigate.mockClear();

    document.dispatchEvent(new Event('yt-navigate-finish'));
    await Promise.resolve();

    expect(requestFrame).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith({
      url: expect.stringContaining('/watch?v=CCCCCCCCCCC'),
      reason: 'navigation',
    });

    observer.stop();
  });

  it('detects a history.pushState song change immediately (YouTube Music, no yt-navigate-finish)', async () => {
    class FakeMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe(): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onNavigate = vi.fn();
    const observer = observeYouTubeSpa(onNavigate);
    await Promise.resolve();
    onNavigate.mockClear();

    // YouTube Music switches songs via pushState and does NOT fire yt-navigate-finish, so this must
    // still re-arm (immediately, without an animation frame) so per-song features refresh.
    window.history.pushState({}, '', '/watch?v=SONGB000000');
    await Promise.resolve();

    expect(requestFrame).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith({
      url: expect.stringContaining('/watch?v=SONGB000000'),
      reason: 'url-change',
    });

    observer.stop();
  });

  it('restores the patched history methods on stop', () => {
    class FakeMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe(): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;

    const observer = observeYouTubeSpa(vi.fn());
    expect(window.history.pushState).not.toBe(originalPush);
    expect(window.history.replaceState).not.toBe(originalReplace);

    observer.stop();
    expect(window.history.pushState).toBe(originalPush);
    expect(window.history.replaceState).toBe(originalReplace);
  });
});
