/**
 * Browser-API glue for the diagnostics feature: the message-type constants, the background
 * aggregator hub, and the page/content/options helpers. This module depends on `browser.*` and
 * on the DOM, so it is exercised by the hermetic bench rather than by unit tests, matching the
 * convention used for the entrypoints and `config.ts`. All security-critical logic (schema
 * validation, bounds, redaction, report assembly) lives in the pure `logger`/`redact`/`report`
 * modules and is unit-tested there.
 */

import {
  isLogContext,
  Persister,
  RateLimiter,
  RingBuffer,
  validateLogEvent,
  type LogCode,
  type LogContext,
  type LogData,
  type StoredEvent,
} from './logger';
import { assembleReport, type ReportBundle } from './report';

export const DIAGNOSTICS_LOG_EVENT = 'yta:log';
export const DIAGNOSTICS_LOG_MESSAGE = 'yta:log';
export const DIAGNOSTICS_REPORT_MESSAGE = 'yta:diagnostics-report';
export const DIAGNOSTICS_CLEAR_MESSAGE = 'yta:diagnostics-clear';
export const DIAGNOSTICS_STORAGE_KEY = 'diagnostics';

const MAX_LOG_DETAIL_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.trunc(value), 1_000_000);
}

/** Run a logging side effect without ever letting a sync throw or async rejection escape. */
export function safeLog(fn: () => unknown): void {
  try {
    const result = fn();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, () => undefined);
    }
  } catch {
    // A logging failure must never affect the caller.
  }
}

export type PageLogger = (code: LogCode, data?: LogData) => void;

/**
 * Build the page-world logger. It dispatches a nonce-tagged `yta:log` CustomEvent that the
 * content script validates and relays. Fail-open: a null nonce or any error is swallowed.
 */
export function createPageLogger(bridgeNonce: string | null): PageLogger {
  return (code, data) => {
    if (!bridgeNonce) return;
    safeLog(() => {
      document.dispatchEvent(
        new CustomEvent(DIAGNOSTICS_LOG_EVENT, {
          detail: JSON.stringify({ nonce: bridgeNonce, event: { code, data: data ?? {} } }),
        })
      );
    });
  };
}

/**
 * Install the content-script relay: it validates and rate-limits page-origin log events before
 * forwarding them to the background, so a script inside a YouTube page cannot flood the buffer.
 */
export function installDiagnosticsRelay(bridgeNonce: string): void {
  const limiter = new RateLimiter(20, 2);
  document.addEventListener(DIAGNOSTICS_LOG_EVENT, (event) => {
    safeLog(() => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string' || detail.length > MAX_LOG_DETAIL_LENGTH) return;
      // Rate-limit before the JSON.parse + schema validation so a flooding page cannot burn CPU.
      if (!limiter.tryRemove()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(detail);
      } catch {
        return;
      }
      if (!isRecord(parsed) || parsed.nonce !== bridgeNonce) return;
      const validated = validateLogEvent(parsed.event);
      if (!validated) return;
      void browser.runtime
        .sendMessage({ type: DIAGNOSTICS_LOG_MESSAGE, ctx: 'page', event: validated })
        .catch(() => undefined);
    });
  });
}

/** Log an event that originates in the content script. */
export function logFromContent(code: LogCode, data?: LogData): void {
  safeLog(() =>
    browser.runtime
      .sendMessage({
        type: DIAGNOSTICS_LOG_MESSAGE,
        ctx: 'content',
        event: { code, data: data ?? {} },
      })
      .catch(() => undefined)
  );
}

/** The error's class name if it is one; schema validation coerces unknown names to 'other'. */
export function errorName(error: unknown): string {
  return error instanceof Error && typeof error.name === 'string' ? error.name : 'unknown';
}

/**
 * Extract an error's class name and a short raw stack. The stack is redacted and length-bounded
 * by the schema's `sanitizedText` validator at the trust boundary, so it never carries PII.
 */
export function errorFields(error: unknown): { name: string; stack: string } {
  let stack = '';
  if (error instanceof Error && typeof error.stack === 'string') stack = error.stack;
  else if (typeof error === 'string') stack = error;
  return { name: errorName(error), stack: stack.split('\n').slice(0, 4).join('\n').slice(0, 600) };
}

/**
 * Install global uncaught-error and unhandled-rejection capture for an extension context. Errors
 * are rate-limited (so a page or loop cannot flood) and logged with a sanitized stack.
 */
export function installGlobalErrorCapture(
  where: string,
  log: (code: LogCode, data: LogData) => void
): void {
  const limiter = new RateLimiter(5, 0.5);
  const capture = (error: unknown) => {
    safeLog(() => {
      if (!limiter.tryRemove()) return;
      log('error', { where, ...errorFields(error) });
    });
  };
  self.addEventListener('error', (event) => capture((event as ErrorEvent).error ?? event));
  self.addEventListener('unhandledrejection', (event) =>
    capture((event as PromiseRejectionEvent).reason)
  );
}

/** Ask the background for the freshly assembled report. Returns null on any failure. */
export async function requestDiagnosticsReport(): Promise<ReportBundle | null> {
  try {
    const response: unknown = await browser.runtime.sendMessage({
      type: DIAGNOSTICS_REPORT_MESSAGE,
    });
    return isRecord(response) && typeof response.markdown === 'string'
      ? (response as unknown as ReportBundle)
      : null;
  } catch {
    return null;
  }
}

/** Ask the background to clear the log buffer and its persisted copy. */
export async function clearDiagnostics(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: DIAGNOSTICS_CLEAR_MESSAGE });
  } catch {
    // Clearing is best-effort.
  }
}

export interface DiagnosticsHub {
  handleMessage(message: unknown): Promise<unknown> | undefined;
  logLocal(code: LogCode, data?: LogData): void;
  noteTelemetryBlocked(): void;
  noteAdPruned(): void;
}

async function buildEnvironment(): Promise<Record<string, unknown>> {
  let browserName = '';
  let browserVersion = '';
  try {
    const info = await browser.runtime.getBrowserInfo();
    browserName = info.name;
    browserVersion = info.version;
  } catch {
    // getBrowserInfo is Firefox-only; other engines fall back to the closed-schema default.
  }
  let os = '';
  try {
    os = (await browser.runtime.getPlatformInfo()).os;
  } catch {
    // Platform info is optional.
  }
  const manifest = browser.runtime.getManifest();
  return {
    extensionVersion: manifest.version,
    browser: browserName,
    browserVersion,
    os,
    manifestVersion: manifest.manifest_version,
  };
}

/**
 * The background aggregator. It owns the single bounded buffer, the saturating counters, and the
 * single-flight persister. Hydration is gated by a shared `ready` promise so a log arriving
 * during startup is applied after the stored state is installed rather than overwriting it.
 */
export function createDiagnosticsHub(getSettings: () => unknown): DiagnosticsHub {
  const buffer = new RingBuffer();
  const stats = { telemetryBlocked: 0, adPruned: 0 };
  let seq = 0;

  const write = (value: unknown): Promise<void> =>
    browser.storage.local.set({ [DIAGNOSTICS_STORAGE_KEY]: value }).then(() => undefined);
  const persister = new Persister(write);
  const getState = () => ({ events: buffer.snapshot(), stats: { ...stats }, seq });

  const ready = hydrate();

  async function hydrate(): Promise<void> {
    try {
      const stored = await browser.storage.local.get(DIAGNOSTICS_STORAGE_KEY);
      const state = stored[DIAGNOSTICS_STORAGE_KEY];
      if (!isRecord(state)) return;
      if (typeof state.seq === 'number' && Number.isFinite(state.seq)) {
        seq = Math.max(0, Math.trunc(state.seq));
      }
      const savedStats = isRecord(state.stats) ? state.stats : {};
      stats.telemetryBlocked = toCount(savedStats.telemetryBlocked);
      stats.adPruned = toCount(savedStats.adPruned);
      const events = Array.isArray(state.events) ? state.events : [];
      for (const item of events) {
        if (!isRecord(item) || !isLogContext(item.ctx)) continue;
        const validated = validateLogEvent({ code: item.code, data: item.data });
        if (!validated) continue;
        const ts = typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now();
        const eventSeq =
          typeof item.seq === 'number' && Number.isFinite(item.seq) ? item.seq : (seq += 1);
        buffer.push({
          seq: eventSeq,
          ts,
          ctx: item.ctx,
          code: validated.code,
          data: validated.data,
        });
      }
    } catch {
      // Best-effort hydration; a corrupt or absent record simply starts an empty buffer.
    }
  }

  function append(ctx: LogContext, rawEvent: unknown): void {
    // Capture the timestamp synchronously so events queued during startup keep their real spacing
    // rather than all collapsing to the moment `ready` resolves.
    const ts = Date.now();
    safeLog(async () => {
      await ready;
      const validated = validateLogEvent(rawEvent);
      if (!validated) return;
      seq += 1;
      const event: StoredEvent = {
        seq,
        ts,
        ctx,
        code: validated.code,
        data: validated.data,
      };
      if (buffer.push(event)) persister.schedule(getState);
    });
  }

  async function buildReport(): Promise<ReportBundle> {
    await ready;
    const environment = await buildEnvironment();
    return assembleReport({
      environment,
      settings: getSettings(),
      stats: { ...stats },
      events: buffer.snapshot(),
    });
  }

  async function clearAll(): Promise<{ ok: true }> {
    await ready;
    buffer.clear();
    stats.telemetryBlocked = 0;
    stats.adPruned = 0;
    await persister.flushNow(getState);
    return { ok: true };
  }

  return {
    handleMessage(message) {
      if (!isRecord(message)) return undefined;
      if (message.type === DIAGNOSTICS_LOG_MESSAGE) {
        const ctx = message.ctx;
        append(ctx === 'page' || ctx === 'content' ? ctx : 'content', message.event);
        return undefined;
      }
      if (message.type === DIAGNOSTICS_REPORT_MESSAGE) return buildReport();
      if (message.type === DIAGNOSTICS_CLEAR_MESSAGE) return clearAll();
      return undefined;
    },
    logLocal(code, data) {
      append('bg', { code, data: data ?? {} });
    },
    noteTelemetryBlocked() {
      if (stats.telemetryBlocked < 1_000_000) stats.telemetryBlocked += 1;
    },
    noteAdPruned() {
      if (stats.adPruned < 1_000_000) stats.adPruned += 1;
    },
  };
}
