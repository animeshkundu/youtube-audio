/**
 * Reclaim state machine primitives for the MAIN-world native-reclaim coordinator (SPEC-002).
 *
 * A released hijack records one pending reclaim that a later terminal status or re-attach may
 * consume. The tracker keeps that record bounded (TTL plus a one-generation skew bound) so a stale
 * record can never pause or reload the wrong video, and `take` is the single atomic consumption
 * point so a status-driven reclaim and a same-video re-attach can never both win it.
 */

export interface ReclaimRecord {
  element: HTMLMediaElement;
  ownedUrl: string;
  currentTime: number;
  paused: boolean;
}

export interface TrackedReclaim extends ReclaimRecord {
  videoId: string | null;
  generation: number;
  recordedAt: number;
}

/** A pending reclaim older than this is expired: the user has moved on, so fail open to native. */
export const RECLAIM_TTL_MS = 30_000;

/**
 * A pending reclaim survives at most one generation boundary: a toggle-off release records it
 * during generation N and the settings-driven re-arm attaches during N+1. Anything older belongs
 * to an earlier navigation and must never fire.
 */
export const RECLAIM_MAX_GENERATION_SKEW = 1;

export interface ReclaimTrackerOptions {
  ttlMs?: number;
  maxGenerationSkew?: number;
  now?: () => number;
}

export interface ReclaimTracker {
  set(record: ReclaimRecord, videoId: string | null, generation: number): void;
  /**
   * Returns the live pending record without consuming it, or null when none matches. An expired or
   * too-old record is dropped; a videoId mismatch returns null without clearing (the record may
   * still be consumed by the video it belongs to). `videoId === undefined` matches any video.
   */
  match(videoId: string | null | undefined, generation: number): TrackedReclaim | null;
  /** Atomically consumes the matching record: at most one caller can ever take it. */
  take(videoId: string | null | undefined, generation: number): TrackedReclaim | null;
  /** Drops the pending record (a re-hijack owns the element now, or the record is unusable). */
  clear(): void;
}

export function createReclaimTracker(options: ReclaimTrackerOptions = {}): ReclaimTracker {
  const ttlMs = options.ttlMs ?? RECLAIM_TTL_MS;
  const maxGenerationSkew = options.maxGenerationSkew ?? RECLAIM_MAX_GENERATION_SKEW;
  const now = options.now ?? Date.now;
  let pending: TrackedReclaim | null = null;

  const match = (videoId: string | null | undefined, generation: number): TrackedReclaim | null => {
    if (!pending) return null;
    if (now() - pending.recordedAt > ttlMs || generation - pending.generation > maxGenerationSkew) {
      pending = null;
      return null;
    }
    if (videoId !== undefined && pending.videoId !== videoId) return null;
    return pending;
  };

  return {
    set(record, videoId, generation) {
      pending = { ...record, videoId, generation, recordedAt: now() };
    },
    match,
    take(videoId, generation) {
      const record = match(videoId, generation);
      if (record) pending = null;
      return record;
    },
    clear() {
      pending = null;
    },
  };
}

export interface OneShotPauseOptions {
  /** Re-checked at fire time: a re-hijack or SPA navigation must suppress the pause. */
  isCurrent: () => boolean;
  pause: () => void;
  timeoutMs: number;
}

/**
 * Runs `pause()` once the element has attached real media (`readyState >= 2`, or the first
 * `loadeddata`), bounded by `timeoutMs`. Returns a disposer that cancels a still-pending arm; the
 * caller keeps exactly one arm at a time and disposes it before re-arming, so at most one pause
 * can ever fire per reclaim. Fail-open: if nothing loads in time, YouTube keeps control.
 */
export function armOneShotPause(
  element: HTMLMediaElement,
  options: OneShotPauseOptions
): () => void {
  const { isCurrent, pause, timeoutMs } = options;
  const tryPause = () => {
    if (isCurrent()) pause();
  };
  if (element.readyState >= 2) {
    tryPause();
    return () => undefined;
  }
  let disposed = false;
  const onLoadedData = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timer);
    element.removeEventListener('loadeddata', onLoadedData);
    tryPause();
  };
  const timer = window.setTimeout(() => {
    if (disposed) return;
    disposed = true;
    element.removeEventListener('loadeddata', onLoadedData);
  }, timeoutMs);
  element.addEventListener('loadeddata', onLoadedData, { once: true });
  return () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timer);
    element.removeEventListener('loadeddata', onLoadedData);
  };
}
