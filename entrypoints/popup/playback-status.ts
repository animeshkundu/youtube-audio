/**
 * Popup status channel: wires the popup to the background per-tab playback status.
 *
 * On open it asks the background for the active tab's resolved state (`yta:get-status`) and
 * subscribes to live pushes (`yta:status-changed`), exposing the result as a signal the popup UI
 * renders from. The signal starts at `connecting` — never a stored toggle — so the popup shows an
 * honest "checking this tab" state until the background answers, and it can never claim audio-only
 * is active before the content script has actually reported it.
 *
 * Fail-open and bounded: any messaging failure, or a slow answer, leaves the popup in its honest
 * `connecting` state rather than hanging or throwing. The rendered popup does not consume this
 * signal yet — that is a follow-up UI stack; this module only establishes and exposes the data.
 */

import { signal } from '@preact/signals';

import {
  GET_STATUS_MESSAGE,
  isPlaybackUiState,
  STATUS_CHANGED_MESSAGE,
  type PlaybackUiState,
} from '../../src/shared/status';

const GET_STATUS_TIMEOUT_MS = 1_500;

/** The popup's honest, per-tab playback state. Defaults to `connecting` (never a stored setting). */
export const playbackStatusSignal = signal<PlaybackUiState>({ kind: 'connecting' });

function isStatusChanged(message: unknown): message is { type: string; state: PlaybackUiState } {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === STATUS_CHANGED_MESSAGE &&
    isPlaybackUiState((message as { state?: unknown }).state)
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('status-timeout')), ms);
    }),
  ]);
}

async function fetchInitialStatus(): Promise<void> {
  try {
    const state = await withTimeout(
      browser.runtime.sendMessage({ type: GET_STATUS_MESSAGE }) as Promise<unknown>,
      GET_STATUS_TIMEOUT_MS
    );
    if (isPlaybackUiState(state)) playbackStatusSignal.value = state;
  } catch {
    // Leave the honest `connecting` default in place.
  }
}

/**
 * Start the channel: register the push listener and fetch the initial state. Returns an unsubscribe
 * cleanup. Safe to call once on popup open; every browser interaction is guarded so an unavailable
 * runtime never throws into the popup boot path.
 */
export function startPlaybackStatusChannel(): () => void {
  const onMessage = (message: unknown): void => {
    if (isStatusChanged(message)) playbackStatusSignal.value = message.state;
  };
  try {
    browser.runtime.onMessage.addListener(onMessage);
  } catch {
    return () => undefined;
  }
  void fetchInitialStatus();
  return () => {
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Nothing to clean up if the runtime is already gone.
    }
  };
}
