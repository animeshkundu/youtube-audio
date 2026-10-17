/**
 * Popup tab-scope channel: wires the popup hero to the background's per-tab audio-only override
 * (SPEC-012 §5; ADR-0014).
 *
 * On open it asks the background for the active tab's override and subscribes to live pushes, and
 * it exposes a setter the hero uses. The signal starts at `null` (follow the global preference), so
 * a slow or unavailable background leaves the hero rendering the global value rather than a stale
 * per-tab claim.
 */

import { signal } from '@preact/signals';

import {
  GET_TAB_SCOPE_MESSAGE,
  parseTabScopePush,
  parseTabScopeReply,
  SET_TAB_SCOPE_MESSAGE,
  type TabAudioOnlyOverride,
} from '../../src/shared/tab-scope';

const TAB_SCOPE_TIMEOUT_MS = 1_500;

/** The active tab's audio-only override; `null` means "follow the global preference". */
export const tabAudioOnlyOverrideSignal = signal<TabAudioOnlyOverride>(null);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('tab-scope-timeout')), ms);
    }),
  ]);
}

async function fetchInitialTabScope(): Promise<void> {
  try {
    const reply = await withTimeout(
      browser.runtime.sendMessage({ type: GET_TAB_SCOPE_MESSAGE }) as Promise<unknown>,
      TAB_SCOPE_TIMEOUT_MS
    );
    const parsed = parseTabScopeReply(reply);
    if (parsed) tabAudioOnlyOverrideSignal.value = parsed.audioOnly;
  } catch {
    // Leave the honest "follow the global" default in place.
  }
}

/**
 * Start the channel: register the push listener and fetch the initial override. Returns an
 * unsubscribe cleanup. Safe to call once on popup open; every browser interaction is guarded so an
 * unavailable runtime never throws into the popup boot path.
 */
export function startTabScopeChannel(): () => void {
  const onMessage = (message: unknown): void => {
    const push = parseTabScopePush(message);
    if (push) tabAudioOnlyOverrideSignal.value = push.audioOnly;
  };
  try {
    browser.runtime.onMessage.addListener(onMessage);
  } catch {
    return () => undefined;
  }
  void fetchInitialTabScope();
  return () => {
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Nothing to clean up if the runtime is already gone.
    }
  };
}

/**
 * Ask the background to set the active tab's override. The reply updates the signal immediately;
 * the background's broadcast also covers changes made from the shortcut while the popup is open.
 * A rejected or refused set leaves the signal unchanged and rejects for the caller's error path.
 */
export async function setActiveTabAudioOnly(audioOnly: boolean): Promise<void> {
  const reply = await browser.runtime.sendMessage({
    type: SET_TAB_SCOPE_MESSAGE,
    audioOnly,
  });
  const parsed = parseTabScopeReply(reply);
  if (parsed) tabAudioOnlyOverrideSignal.value = parsed.audioOnly;
}
