import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GET_TAB_SCOPE_MESSAGE,
  SET_TAB_SCOPE_MESSAGE,
  TAB_SCOPE_CHANGED_MESSAGE,
} from '../../src/shared/tab-scope';
import {
  setActiveTabAudioOnly,
  startTabScopeChannel,
  tabAudioOnlyOverrideSignal,
} from '../../entrypoints/popup/tab-scope';

/**
 * The popup tab-scope channel is the popup-side glue for the per-tab override (SPEC-012 §5;
 * ADR-0014): it fetches the active tab's scope on open, subscribes to background pushes, and
 * exposes the hero's setter. These tests stub `browser.runtime` (per popup-status-channel.test.ts)
 * and assert the honest default, the fetch, the live push, and fail-open behavior.
 */

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  tabAudioOnlyOverrideSignal.value = null;
});

describe('startTabScopeChannel', () => {
  it('defaults to following the global preference (never a stored per-tab claim)', () => {
    expect(tabAudioOnlyOverrideSignal.value).toBeNull();
  });

  it('fetches yta:get-tab-scope on open and adopts the override', async () => {
    const sendMessage = vi.fn(async () => ({ audioOnly: false }));
    const addListener = vi.fn();
    vi.stubGlobal('browser', {
      runtime: { sendMessage, onMessage: { addListener, removeListener: vi.fn() } },
    });

    const stop = startTabScopeChannel();
    await flush();

    expect(sendMessage).toHaveBeenCalledWith({ type: GET_TAB_SCOPE_MESSAGE });
    expect(addListener).toHaveBeenCalledOnce();
    expect(tabAudioOnlyOverrideSignal.value).toBe(false);
    stop();
  });

  it('adopts a yta:tab-scope-changed push, ignores other messages, and unsubscribes', async () => {
    let pushed: ((message: unknown) => void) | undefined;
    const addListener = vi.fn((fn: (message: unknown) => void) => {
      pushed = fn;
    });
    const removeListener = vi.fn();
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: vi.fn(async () => ({ audioOnly: null })),
        onMessage: { addListener, removeListener },
      },
    });

    const stop = startTabScopeChannel();
    await flush();

    pushed?.({ type: TAB_SCOPE_CHANGED_MESSAGE, audioOnly: true });
    expect(tabAudioOnlyOverrideSignal.value).toBe(true);

    // A malformed push and an unrelated message are both ignored.
    pushed?.({ type: TAB_SCOPE_CHANGED_MESSAGE, audioOnly: 'yes' });
    pushed?.({ type: 'yta:status-changed', state: { kind: 'active' } });
    expect(tabAudioOnlyOverrideSignal.value).toBe(true);

    stop();
    expect(removeListener).toHaveBeenCalledWith(pushed);
  });

  it('fails open: a rejected get leaves the follow-global default', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('no receiver');
        }),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    const stop = startTabScopeChannel();
    await flush();

    expect(tabAudioOnlyOverrideSignal.value).toBeNull();
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

    expect(() => startTabScopeChannel()()).not.toThrow();
  });
});

describe('setActiveTabAudioOnly', () => {
  it('sends the set message and adopts the reply', async () => {
    const sendMessage = vi.fn(async () => ({ audioOnly: true }));
    vi.stubGlobal('browser', { runtime: { sendMessage } });

    await setActiveTabAudioOnly(true);

    expect(sendMessage).toHaveBeenCalledWith({ type: SET_TAB_SCOPE_MESSAGE, audioOnly: true });
    expect(tabAudioOnlyOverrideSignal.value).toBe(true);
  });

  it('adopts a follow-global reply (a refused or non-YouTube target) as null', async () => {
    tabAudioOnlyOverrideSignal.value = false;
    vi.stubGlobal('browser', {
      runtime: { sendMessage: vi.fn(async () => ({ audioOnly: null })) },
    });

    await setActiveTabAudioOnly(true);

    expect(tabAudioOnlyOverrideSignal.value).toBeNull();
  });

  it('propagates a messaging rejection without claiming a change', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error('no receiver');
        }),
      },
    });

    await expect(setActiveTabAudioOnly(true)).rejects.toThrow('no receiver');
    expect(tabAudioOnlyOverrideSignal.value).toBeNull();
  });
});
