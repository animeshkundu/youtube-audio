/**
 * Best-effort teardown (SPEC-021). When the extension is disabled or updated, its background
 * contexts are unloaded while any already-running page keeps everything the extension installed
 * there: the page-world patches (visibility override, idle-nag layers, scriptlet wrappers, player
 * hints), the content-side DOM (distraction stylesheet, in-player controls), and possibly an active
 * audio-only hijack. `runtime.onSuspend` is the last moment the extension still runs, so it asks
 * every tab to take those down through this bounded control message.
 *
 * The message carries no data in either direction: the content script answers by dropping its own
 * DOM and posting a master-disabled snapshot over the ordinary settings bridge, which drives the
 * page world's existing disable path instead of a second cleanup protocol. A `true` result is not
 * awaited and never returned; if the browser tears the background down first, or a tab cannot be
 * reached, the page keeps the installed state until it reloads (the documented residual).
 */

/** Runtime message type sent to every tab when the extension is about to unload (disable/update). */
export const TEARDOWN_MESSAGE = 'yta:teardown';

/** True for exactly the teardown control message. Malformed values are not teardown requests. */
export function isTeardownMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  return (message as { type?: unknown }).type === TEARDOWN_MESSAGE;
}

/**
 * The snapshot a teardown posts over the bridge: the last delivered snapshot, master-disabled. Only
 * `enabled` is edited. Every subsystem the page world owns is gated on it, so the ordinary settings
 * path runs the full disable teardown (visibility, idle-nag, scriptlets, quality of life, segments,
 * the audio graph, and the media release + native reclaim), while the remaining fields keep the
 * snapshot otherwise identical to the one the page was running with.
 */
export function buildTeardownSnapshot<T extends { enabled: boolean }>(settings: T): T {
  return { ...settings, enabled: false };
}
