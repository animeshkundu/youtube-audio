/**
 * Playback-status channel: the shared, dependency-light "brain" that turns the per-video
 * `PlaybackStatus` the page-world emits into an honest UI state for the popup.
 *
 * The extension already computes the real per-video outcome in `entrypoints/main-world.ts`
 * (`emitStatus`) and dispatches it as a `yta:status` DOM event. This module is the vocabulary and
 * the pure logic shared by the three runtime contexts that now carry that value to the popup:
 *
 *   page-world (main-world.ts)  --yta:status DOM event-->  content.ts
 *   content.ts                  --yta:status-update msg-->  background.ts  (per-tab map)
 *   popup                       --yta:get-status msg---->   background.ts  --> resolved UiState
 *   background.ts               --yta:status-changed msg->  popup          (live re-render)
 *
 * Everything here is a pure function or a plain type so it can be unit-tested without a browser and
 * imported by any context (page-world, content, background, popup) without pulling in Preact,
 * config, or DOM. The messaging wiring lives in the entrypoints; the decisions live here.
 */

/** The per-video playback outcome computed by the page world (`main-world.ts:emitStatus`). */
export type PlaybackStatus = 'idle' | 'fetching' | 'active' | 'fallback' | 'disabled';

/** Runtime message-type discriminators for the status channel. */
export const STATUS_UPDATE_MESSAGE = 'yta:status-update';
export const GET_STATUS_MESSAGE = 'yta:get-status';
export const STATUS_CHANGED_MESSAGE = 'yta:status-changed';

/** A content-script report of the page world's latest status for the current top-level document. */
export interface StatusUpdate {
  status: PlaybackStatus;
  reason?: string;
  videoId?: string;
  /**
   * The content script's lifetime start time (ms). A full page load starts a fresh content script
   * with a strictly-later `runStart`, which lets the background prefer the newer document's report
   * even though `generation` resets per lifetime.
   */
  runStart: number;
  /**
   * Monotonic within a single content-script lifetime, bumped on each SPA navigation. Orders
   * updates within one lifetime so the background can drop an out-of-order straggler from a
   * superseded SPA navigation.
   */
  generation: number;
}

/** What the background stores per tab (the update plus receipt bookkeeping). */
export interface TabStatusEntry {
  status: PlaybackStatus;
  reason?: string;
  videoId?: string;
  runStart: number;
  generation: number;
  /** Wall-clock receipt time (ms). */
  ts: number;
  /** Set when a tab navigation invalidated this entry before a fresh report arrived. */
  stale?: boolean;
}

/** The host family of a URL, from the extension's four YouTube match patterns. */
export type HostClass = 'youtube' | 'music' | 'not-youtube';

/** The honest, popup-facing state resolved from the active tab's URL and its stored status. */
export type PlaybackUiState =
  | { kind: 'active' }
  | { kind: 'connecting' }
  | { kind: 'fallback'; reason: string | null }
  | { kind: 'disabled' }
  | { kind: 'not-a-watch-page' }
  | { kind: 'not-youtube' };

const PLAYBACK_STATUSES: readonly PlaybackStatus[] = [
  'idle',
  'fetching',
  'active',
  'fallback',
  'disabled',
];

const UI_KINDS: readonly PlaybackUiState['kind'][] = [
  'active',
  'connecting',
  'fallback',
  'disabled',
  'not-a-watch-page',
  'not-youtube',
];

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
const MAX_REASON_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hostnameOf(url: string | undefined): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isYouTubeFamilyHost(host: string): boolean {
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com')
  );
}

/** Narrow an arbitrary value to a `PlaybackStatus`. */
export function isPlaybackStatus(value: unknown): value is PlaybackStatus {
  return typeof value === 'string' && PLAYBACK_STATUSES.includes(value as PlaybackStatus);
}

/** Narrow an arbitrary value to a resolved `PlaybackUiState` (used when reading a message payload). */
export function isPlaybackUiState(value: unknown): value is PlaybackUiState {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    UI_KINDS.includes(value.kind as PlaybackUiState['kind'])
  );
}

/**
 * Classify a URL's host into the extension's YouTube families. A domain that merely contains
 * "youtube" (e.g. `evil-youtube.com`) is rejected: only the real registrable hosts match.
 */
export function classifyHost(url: string | undefined): HostClass {
  const host = hostnameOf(url);
  if (!host || !isYouTubeFamilyHost(host)) return 'not-youtube';
  return host === 'music.youtube.com' ? 'music' : 'youtube';
}

/** Extract a valid YouTube video id from a URL's `?v=` parameter, or `null`. Mirrors the page world. */
export function parseVideoId(url: string | undefined): string | null {
  if (typeof url !== 'string') return null;
  try {
    const id = new URL(url).searchParams.get('v');
    return id && VIDEO_ID_PATTERN.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A YouTube-family watch page: a supported host carrying a valid `?v=` video id. */
export function isWatchPage(url: string | undefined): boolean {
  return classifyHost(url) !== 'not-youtube' && parseVideoId(url) !== null;
}

/** Validate and normalize a hostile `yta:status-update` message payload into a `StatusUpdate`. */
export function parseStatusUpdate(message: unknown): StatusUpdate | null {
  if (!isRecord(message) || message.type !== STATUS_UPDATE_MESSAGE) return null;
  if (!isPlaybackStatus(message.status)) return null;
  const reason =
    typeof message.reason === 'string' && message.reason.length <= MAX_REASON_LENGTH
      ? message.reason
      : undefined;
  const videoId =
    typeof message.videoId === 'string' && VIDEO_ID_PATTERN.test(message.videoId)
      ? message.videoId
      : undefined;
  return {
    status: message.status,
    ...(reason !== undefined ? { reason } : {}),
    ...(videoId !== undefined ? { videoId } : {}),
    runStart: nonNegativeInt(message.runStart),
    generation: nonNegativeInt(message.generation),
  };
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Whether `update` should replace `current`: a later lifetime wins; within one, a later epoch. */
function supersedes(update: StatusUpdate, current: TabStatusEntry): boolean {
  if (update.runStart !== current.runStart) return update.runStart > current.runStart;
  // A stale entry (marked on a navigation/reload) may be revived only by a STRICTLY newer epoch: an
  // equal-`(runStart, generation)` straggler from the now-unloaded old document must not clear the
  // stale flag and restore its status. A live entry still accepts an equal epoch so a same-operation
  // `fetching`→`active` transition (which reuses the operation's generation) lands.
  return current.stale === true
    ? update.generation > current.generation
    : update.generation >= current.generation;
}

/**
 * Fold a status update into the tab's existing entry.
 *
 * Returns the *same* `current` reference (an identity the caller uses to skip a redundant
 * broadcast) only when the update is a superseded straggler. Ordering is lexicographic on
 * `(runStart, generation)`: a report from a newer content-script lifetime (`runStart`) always wins
 * — even at a lower `generation`, since generation resets per lifetime — so a full reload or a
 * late message from an unloading old document can never freeze the tab's state. Within one
 * lifetime, a strictly-older `generation` (a superseded SPA navigation) is dropped. An absent entry
 * accepts the first report; a stale entry still requires a superseding report before it is revived.
 */
export function reduceStatusUpdate(
  current: TabStatusEntry | undefined,
  update: StatusUpdate,
  now: number
): TabStatusEntry {
  if (current !== undefined && !supersedes(update, current)) {
    return current;
  }
  return {
    status: update.status,
    ...(update.reason !== undefined ? { reason: update.reason } : {}),
    ...(update.videoId !== undefined ? { videoId: update.videoId } : {}),
    runStart: update.runStart,
    generation: update.generation,
    ts: now,
  };
}

/** Mark an entry stale (its document was navigated away before a fresh report arrived). */
export function markEntryStale(entry: TabStatusEntry): TabStatusEntry {
  return { ...entry, stale: true };
}

/**
 * Whether a `tabs.onUpdated` event should mark the tab's status entry stale. A document reload
 * ('loading', which fires even when the url is unchanged) always does. A bare URL change only does
 * when it navigates to a DIFFERENT video: YouTube rewrites the watch URL with `&t=`/`list` params
 * during playback (same video), and on an SPA nav the content script may already have reported the
 * new video before `onUpdated` fires. Marking those spuriously stale would reject the same
 * operation's own `active` report and strand the popup on `connecting`.
 */
export function shouldMarkStale(
  entry: TabStatusEntry,
  changeInfo: { url?: string | undefined; status?: string | undefined }
): boolean {
  if (changeInfo.status === 'loading') return true;
  if (typeof changeInfo.url !== 'string') return false;
  const nextVideoId = parseVideoId(changeInfo.url);
  // Keep the entry live only when the URL still points at the exact video the entry already describes.
  return !(nextVideoId !== null && entry.videoId != null && entry.videoId === nextVideoId);
}

/**
 * Resolve the honest popup state from the active tab's URL and its stored status entry.
 *
 * Rules (per the approved status-channel design):
 *  - non-YouTube host                                     -> not-youtube
 *  - YouTube host, non-watch page                         -> not-a-watch-page
 *  - watch page, no/stale entry (or a different video's)  -> connecting (a report has not landed yet)
 *  - watch page with a report                             -> that report's status
 *
 * A rejected or absent status resolves to `connecting`, never to a stored toggle, so the popup can
 * never claim audio-only is active before the content script has actually said so.
 */
export function resolveUiState(
  url: string | undefined,
  entry: TabStatusEntry | undefined
): PlaybackUiState {
  if (classifyHost(url) === 'not-youtube') return { kind: 'not-youtube' };
  if (!isWatchPage(url)) return { kind: 'not-a-watch-page' };
  if (entry === undefined || entry.stale === true) return { kind: 'connecting' };

  // Cross-check the report against the URL in front of the user: an entry describing a different
  // video means a navigation outran its status report, so keep showing "connecting" until it lands.
  const urlVideoId = parseVideoId(url);
  if (entry.videoId == null || urlVideoId == null || entry.videoId !== urlVideoId) {
    return { kind: 'connecting' };
  }

  switch (entry.status) {
    case 'active':
      return { kind: 'active' };
    case 'fallback':
      return { kind: 'fallback', reason: entry.reason ?? null };
    case 'disabled':
      return { kind: 'disabled' };
    case 'fetching':
    case 'idle':
    default:
      return { kind: 'connecting' };
  }
}
