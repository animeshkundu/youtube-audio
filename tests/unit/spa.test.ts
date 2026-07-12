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
    const observer = observeYouTubeSpa(onNavigate);
    await Promise.resolve();
    onNavigate.mockClear();

    window.history.replaceState({}, '', '/watch?v=CCCCCCCCCCC');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await Promise.resolve();

    expect(requestFrame).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith({
      url: expect.stringContaining('/watch?v=CCCCCCCCCCC'),
      reason: 'navigation',
    });

    observer.stop();
  });
});
