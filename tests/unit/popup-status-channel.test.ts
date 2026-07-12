import { afterEach, describe, expect, it, vi } from 'vitest';

import { STATUS_CHANGED_MESSAGE, GET_STATUS_MESSAGE } from '../../src/shared/status';
import {
  playbackStatusSignal,
  startPlaybackStatusChannel,
} from '../../entrypoints/popup/playback-status';

/**
 * The popup status channel is the only popup-side glue in Phase 0: it fetches the active tab's
 * resolved state on open and subscribes to background pushes, exposing both through a signal. These
 * tests stub `browser.runtime` (per settings-signals.test.ts) and assert the honest defaults, the
 * initial fetch, the live push, and fail-open behavior.
 */

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  playbackStatusSignal.value = { kind: 'connecting' };
});

describe('startPlaybackStatusChannel', () => {
  it('defaults to the honest connecting state (never a stored toggle)', () => {
    expect(playbackStatusSignal.value).toEqual({ kind: 'connecting' });
  });

  it('fetches yta:get-status on open and adopts the resolved state', async () => {
    const sendMessage = vi.fn(async () => ({ kind: 'active' }));
    const addListener = vi.fn();
    vi.stubGlobal('browser', {
      runtime: { sendMessage, onMessage: { addListener, removeListener: vi.fn() } },
    });

    const stop = startPlaybackStatusChannel();
    await flush();

    expect(sendMessage).toHaveBeenCalledWith({ type: GET_STATUS_MESSAGE });
    expect(addListener).toHaveBeenCalledOnce();
    expect(playbackStatusSignal.value).toEqual({ kind: 'active' });
    stop();
  });

  it('re-renders from a yta:status-changed push and unsubscribes on cleanup', async () => {
    let pushed: ((message: unknown) => void) | undefined;
    const addListener = vi.fn((fn: (message: unknown) => void) => {
      pushed = fn;
    });
    const removeListener = vi.fn();
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: vi.fn(async () => ({ kind: 'connecting' })),
        onMessage: { addListener, removeListener },
      },
    });

    const stop = startPlaybackStatusChannel();
    await flush();

    pushed?.({ type: STATUS_CHANGED_MESSAGE, state: { kind: 'fallback', reason: 'live' } });
    expect(playbackStatusSignal.value).toEqual({ kind: 'fallback', reason: 'live' });

    // A malformed push is ignored (defensive against a hostile runtime message).
    pushed?.({ type: STATUS_CHANGED_MESSAGE, state: { kind: 'garbage' } });
    expect(playbackStatusSignal.value).toEqual({ kind: 'fallback', reason: 'live' });

    stop();
    expect(removeListener).toHaveBeenCalledWith(pushed);
  });

  it('fails open: a rejected get-status leaves the connecting default', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('no receiver');
        }),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    const stop = startPlaybackStatusChannel();
    await flush();

    expect(playbackStatusSignal.value).toEqual({ kind: 'connecting' });
    stop();
  });

  it('fails open: an unavailable runtime does not throw into popup boot', () => {
    vi.stubGlobal('browser', {
      runtime: {
        onMessage: {
          addListener: () => {
            throw new Error('runtime gone');
          },
          removeListener: vi.fn(),
        },
      },
    });

    expect(() => startPlaybackStatusChannel()()).not.toThrow();
  });
});
