/**
 * Bounded, PII-free structured diagnostic-logging primitives.
 *
 * Everything here is pure and framework-free so it can be unit-tested in isolation. The
 * browser-API glue that wires these across the background, content, and page contexts lives
 * in `diagnostics.ts`. The security guarantee is by construction: an event's data may only
 * hold values that a per-code schema validates into a fixed enum, a bounded integer, or a
 * boolean. No free-text field is ever accepted (the sole exception is the deliberately captured
 * error stack, which is scrubbed by `redactText` and length-bounded here), so no PII can be stored.
 */

import { redactText } from './redact';

export type LogContext = 'bg' | 'content' | 'page';

export const LOG_CONTEXTS: readonly LogContext[] = ['bg', 'content', 'page'];

export const LOG_CODES = [
  'playback.status',
  'player.props',
  'audio.graph',
  'segment.armed',
  'download.result',
  'spa.rearm',
  'sponsor.result',
  'download.assembled',
  'adblock.pruned',
  'error',
] as const;

export type LogCode = (typeof LOG_CODES)[number];

export type LogValue = string | number | boolean;
export type LogData = Record<string, LogValue>;

export interface LogEvent {
  code: LogCode;
  data: LogData;
}

export interface StoredEvent {
  seq: number;
  ts: number;
  ctx: LogContext;
  code: LogCode;
  data: LogData;
  /** Times this event repeated consecutively (present only when it coalesced more than once). */
  n?: number;
}

type Validator = (value: unknown) => { value: LogValue } | null;

/** Accepts only listed strings; coerces anything else to 'other' so forged input is neutralized. */
const enumOf =
  (allowed: readonly string[]): Validator =>
  (value) => ({ value: typeof value === 'string' && allowed.includes(value) ? value : 'other' });

/** Like {@link enumOf} but also accepts a bounded `http-NNN` status token. */
const enumOrHttp =
  (allowed: readonly string[]): Validator =>
  (value) => {
    if (typeof value === 'string' && (allowed.includes(value) || /^http-\d{3}$/.test(value))) {
      return { value };
    }
    return { value: 'other' };
  };

/** Requires a finite number; clamps into range. A wrong-typed value drops the whole event. */
const boundedInt =
  (min: number, max: number): Validator =>
  (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return { value: Math.min(max, Math.max(min, Math.trunc(value))) };
  };

/** Requires a boolean. A wrong-typed value drops the whole event. */
const bool: Validator = (value) => (typeof value === 'boolean' ? { value } : null);

/**
 * The only free-text field: a captured error stack. It is scrubbed by `redactText` (URLs, ids,
 * emails, IPs, extension UUIDs) and clamped, so no PII and no unbounded string can be stored.
 */
const sanitizedText =
  (maxLength: number): Validator =>
  (value) => {
    if (typeof value !== 'string') return null;
    return { value: redactText(value).slice(0, maxLength) };
  };

const PLAYBACK_STATUS = ['active', 'fallback', 'fetching', 'disabled', 'idle'] as const;
const PLAYBACK_REASONS = [
  'not-a-watch-page',
  'no-direct-audio',
  'live',
  'media-attach-failed',
  'request-failed',
  'unplayable',
  'disabled',
  'OK',
  'ERROR',
  'UNPLAYABLE',
  'LOGIN_REQUIRED',
  'LIVE_STREAM_OFFLINE',
  'AGE_CHECK_REQUIRED',
  'CONTENT_CHECK_REQUIRED',
] as const;
const DOWNLOAD_REASONS = [
  'disabled',
  'not-a-watch-page',
  'unplayable',
  'live',
  'no-direct-audio',
  'request-failed',
] as const;
const ERROR_WHERE = [
  'page.activate',
  'page.download',
  'content.init',
  'content.uncaught',
  'bg.init',
  'bg.adblock',
  'bg.sponsor',
  'bg.download',
  'bg.uncaught',
] as const;
const ERROR_NAMES = [
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'DOMException',
  'AbortError',
  'NotAllowedError',
  'TimeoutError',
  'NetworkError',
  'unknown',
] as const;
const DURATION_BUCKETS = ['lt1m', 'lt10m', 'lt1h', 'gte1h', 'unknown'] as const;

/** The fixed, closed schema. A code's data may only carry the listed keys and value shapes. */
const LOG_SCHEMA: Record<LogCode, Record<string, Validator>> = {
  'playback.status': { status: enumOf(PLAYBACK_STATUS), reason: enumOrHttp(PLAYBACK_REASONS) },
  'player.props': {
    // Behavior-determining video properties for reproduction, never the video identity.
    live: bool,
    music: bool,
    hasAudio: bool,
    loudness: bool,
    playable: bool,
    duration: enumOf(DURATION_BUCKETS),
  },
  'audio.graph': { loudness: bool, eq: bool },
  'segment.armed': { count: boundedInt(0, 1000) },
  'download.result': { ok: bool, reason: enumOrHttp(DOWNLOAD_REASONS) },
  'spa.rearm': {},
  'sponsor.result': { ok: bool, count: boundedInt(0, 1000) },
  'download.assembled': { ok: bool },
  'adblock.pruned': { changed: bool },
  error: { where: enumOf(ERROR_WHERE), name: enumOf(ERROR_NAMES), stack: sanitizedText(300) },
};

export function isLogCode(value: unknown): value is LogCode {
  return typeof value === 'string' && (LOG_CODES as readonly string[]).includes(value);
}

export function isLogContext(value: unknown): value is LogContext {
  return typeof value === 'string' && (LOG_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Validate an untrusted `{ code, data }` payload against the closed schema. Returns a clean
 * event or null. Unknown codes, unknown data keys, and wrong-typed integer/boolean values all
 * drop the event; out-of-set enum strings are coerced to 'other' rather than dropped so that a
 * genuine outcome is still recorded. This is the trust boundary: it runs on the background.
 */
export function validateLogEvent(raw: unknown): LogEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { code?: unknown; data?: unknown };
  if (!isLogCode(candidate.code)) return null;
  const schema = LOG_SCHEMA[candidate.code];
  const data: LogData = {};
  if (candidate.data !== undefined) {
    if (typeof candidate.data !== 'object' || candidate.data === null) return null;
    for (const [key, value] of Object.entries(candidate.data)) {
      const validator = schema[key];
      if (!validator) return null;
      const result = validator(value);
      if (!result) return null;
      data[key] = result.value;
    }
  }
  return { code: candidate.code, data };
}

function serializedSize(event: StoredEvent): number | null {
  try {
    return JSON.stringify(event).length;
  } catch {
    return null;
  }
}

function sameData(a: LogData, b: LogData): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export interface RingBufferOptions {
  maxEvents?: number;
  maxBytes?: number;
  maxPerCode?: number;
  maxEventBytes?: number;
}

/**
 * A diagnostic event buffer bounded by event count, total serialized bytes, and a per-code
 * cap, with FIFO eviction and consecutive-duplicate coalescing. `push` never throws and drops
 * (rather than stores) any single event that is oversized or unserializable, so a logging
 * failure can never break a caller and the buffer can never exceed its byte cap.
 */
export class RingBuffer {
  private events: StoredEvent[] = [];
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly maxPerCode: number;
  private readonly maxEventBytes: number;

  constructor(options: RingBufferOptions = {}) {
    this.maxEvents = options.maxEvents ?? 200;
    this.maxBytes = options.maxBytes ?? 32_768;
    this.maxPerCode = options.maxPerCode ?? 40;
    this.maxEventBytes = options.maxEventBytes ?? 1_024;
  }

  push(event: StoredEvent): boolean {
    try {
      const size = serializedSize(event);
      if (size === null || size > this.maxEventBytes) return false;
      const last = this.events.at(-1);
      if (
        last &&
        last.ctx === event.ctx &&
        last.code === event.code &&
        sameData(last.data, event.data)
      ) {
        // Coalesce a consecutive duplicate into a repeat count so a re-arm/error loop stays
        // visible (as xN) without letting it flood the buffer.
        last.n = Math.min((last.n ?? 1) + 1, 9_999);
        return true;
      }
      const perCode = this.events.filter((existing) => existing.code === event.code).length;
      if (perCode >= this.maxPerCode) {
        const oldest = this.events.findIndex((existing) => existing.code === event.code);
        if (oldest >= 0) this.events.splice(oldest, 1);
      }
      this.events.push(event);
      while (this.events.length > this.maxEvents) this.events.shift();
      while (this.events.length > 1 && this.totalBytes() > this.maxBytes) this.events.shift();
      return true;
    } catch {
      return false;
    }
  }

  snapshot(): StoredEvent[] {
    return this.events.map((event) => ({ ...event, data: { ...event.data } }));
  }

  clear(): void {
    this.events = [];
  }

  get size(): number {
    return this.events.length;
  }

  private totalBytes(): number {
    let total = 0;
    for (const event of this.events) total += serializedSize(event) ?? 0;
    return total;
  }
}

/**
 * A token-bucket rate limiter. The content script uses it to bound how many page-origin log
 * events it forwards, so a script inside a YouTube page cannot cheaply flood the buffer.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now()
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  tryRemove(): boolean {
    const current = this.now();
    const elapsed = Math.max(0, (current - this.last) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.last = current;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export interface PersisterTimers {
  set: (fn: () => void, ms: number) => number;
  clear: (handle: number) => void;
}

const defaultTimers: PersisterTimers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (handle) => clearTimeout(handle),
};

/**
 * Serializes persistence writes on a single promise chain so two `storage.set` calls never
 * overlap, and coalesces bursts behind a debounce timer. The state to write is read at the
 * moment each queued write runs (not when it is scheduled), so once the buffer is cleared no
 * queued or in-flight write can resurrect old data.
 */
export class Persister {
  private chain: Promise<void> = Promise.resolve();
  private timer: number | null = null;

  constructor(
    private readonly write: (value: unknown) => Promise<void>,
    private readonly debounceMs = 1_000,
    private readonly timers: PersisterTimers = defaultTimers
  ) {}

  schedule(getState: () => unknown): void {
    if (this.timer !== null) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.enqueue(getState);
    }, this.debounceMs);
  }

  flushNow(getState: () => unknown): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    return this.enqueue(getState);
  }

  private enqueue(getState: () => unknown): Promise<void> {
    this.chain = this.chain.then(async () => {
      try {
        await this.write(getState());
      } catch {
        // Persistence is best-effort; a storage failure must never surface.
      }
    });
    return this.chain;
  }
}
