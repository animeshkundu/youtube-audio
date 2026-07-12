import { AD_KEYS, pruneAdsFromParsedPlayerResponse } from './adblock';

export type ScriptletOperation =
  | Readonly<{ id: 'prune-inline-player-response'; args: Readonly<Record<string, never>> }>
  | Readonly<{ id: 'prune-fetched-player-response'; args: Readonly<Record<string, never>> }>
  | Readonly<{ id: 'set-inline-playback-no-ad'; args: Readonly<Record<string, never>> }>
  | Readonly<{
      id: 'neutralize-exposed-abnormality-callback';
      args: Readonly<Record<string, never>>;
    }>;

export interface ScriptletResult {
  applied: number;
  skippedForCoexistence: boolean;
  cleanup: () => void;
}

/**
 * Applies only bundled operation IDs. Unknown or incompatible page state is always a no-op.
 */
export function applyScriptletOperations(
  operations: readonly ScriptletOperation[]
): ScriptletResult {
  if (hasExistingBlockerHooks()) {
    return { applied: 0, skippedForCoexistence: true, cleanup: () => undefined };
  }

  const cleanups: Array<() => void> = [];
  for (const operation of operations) {
    try {
      const cleanup = applyOperation(operation);
      if (cleanup) cleanups.push(cleanup);
    } catch {
      // A scriptlet must never interrupt page code or later operations.
    }
  }

  return {
    applied: cleanups.length,
    skippedForCoexistence: false,
    cleanup: () => {
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch {
          // Cleanup is best effort and must remain fail-soft.
        }
      }
    },
  };
}

/**
 * Best-effort coexistence heuristic. Page-world wrappers are intentionally difficult to
 * attribute, so this may miss transparent proxies or skip for unrelated wrappers.
 */
export function hasExistingBlockerHooks(): boolean {
  try {
    return !isNativeFunction(JSON.parse) || !isNativeFunction(JSON.stringify);
  } catch {
    return true;
  }
}

function isNativeFunction(value: (...args: never[]) => unknown): boolean {
  return Function.prototype.toString.call(value).includes('[native code]');
}

function applyOperation(operation: ScriptletOperation): (() => void) | null {
  switch (operation.id) {
    case 'prune-inline-player-response':
      return installInlinePlayerResponsePruning();
    case 'prune-fetched-player-response':
      return wrapFetchedPlayerResponse();
    case 'set-inline-playback-no-ad':
      return wrapJsonStringify();
    case 'neutralize-exposed-abnormality-callback':
      return neutralizeExposedAbnormalityCallback();
  }
}

function installInlinePlayerResponsePruning(): () => void {
  const page = globalThis as typeof globalThis & { ytInitialPlayerResponse?: unknown };
  const originalDescriptor = Object.getOwnPropertyDescriptor(page, 'ytInitialPlayerResponse');
  let currentValue: unknown;
  try {
    currentValue = page.ytInitialPlayerResponse;
    prunePlayerResponseCandidate(currentValue);
  } catch {
    currentValue = undefined;
  }

  const getCurrentValue = () => currentValue;
  const setCurrentValue = (value: unknown) => {
    currentValue = value;
    prunePlayerResponseCandidate(value);
  };
  let ownsAccessor = false;
  try {
    if (!originalDescriptor || originalDescriptor.configurable) {
      Object.defineProperty(page, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: originalDescriptor?.enumerable ?? true,
        get: getCurrentValue,
        set: setCurrentValue,
      });
      ownsAccessor = true;
    }
  } catch {
    // A non-configurable or exotic page global must keep native behavior.
  }

  const originalParse = JSON.parse;
  const wrappedParse: typeof JSON.parse = new Proxy(originalParse, {
    apply(target, thisArg, argumentsList) {
      const value = Reflect.apply(target, thisArg, argumentsList);
      try {
        prunePlayerResponseCandidate(value);
      } catch {
        // Parsing already succeeded, so inspection must not alter the result or throw.
      }
      return value;
    },
  });
  let ownsParse = false;
  try {
    JSON.parse = wrappedParse;
    ownsParse = JSON.parse === wrappedParse;
  } catch {
    // Keep the accessor even if the page prevents replacing JSON.parse.
  }

  return () => {
    if (ownsParse && JSON.parse === wrappedParse) JSON.parse = originalParse;
    if (!ownsAccessor) return;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(page, 'ytInitialPlayerResponse');
      if (descriptor?.get !== getCurrentValue || descriptor.set !== setCurrentValue) return;
      if (originalDescriptor) {
        Object.defineProperty(page, 'ytInitialPlayerResponse', originalDescriptor);
      } else {
        delete page.ytInitialPlayerResponse;
        if (currentValue !== undefined) page.ytInitialPlayerResponse = currentValue;
      }
    } catch {
      // Cleanup is best effort and must not interrupt page code.
    }
  };
}

function prunePlayerResponseCandidate(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (!('streamingData' in record) && !('playabilityStatus' in record)) return;
  if (!Object.keys(record).some((key) => AD_KEYS.has(key))) return;
  pruneAdsFromParsedPlayerResponse(value);
}

const PLAYER_RESPONSE_PATHS = ['/youtubei/v1/player', '/youtubei/v1/next'];

function isPlayerResponseUrl(url: string): boolean {
  return PLAYER_RESPONSE_PATHS.some((path) => url.includes(path));
}

function readRequestUrl(input: unknown): string {
  try {
    if (typeof input === 'string') return input;
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    const href = (input as { href?: unknown } | null)?.href;
    if (typeof href === 'string') return href;
  } catch {
    // A non-standard input must not throw here.
  }
  return '';
}

/**
 * Prune ads from InnerTube player responses read via `fetch(...).then(r => r.json())`. YouTube's own
 * player code reads its response with `Response.json()`, whose native parser does NOT route through
 * the `JSON.parse` wrap in `installInlinePlayerResponsePruning`, so that pruner alone misses it (the
 * background `filterResponseData` covers POST `/player`/`/next`, but this closes the client-side
 * parser gap for any player-shaped response the page parses itself). Wraps `window.fetch` and, for a
 * player/next response, wraps that response's `.json()` to prune before the player sees it. Fail-open:
 * never throws into page code, and non-player responses are untouched.
 */
function wrapFetchedPlayerResponse(): (() => void) | null {
  const page = globalThis as typeof globalThis & { fetch?: typeof fetch };
  const originalFetch = page.fetch;
  if (typeof originalFetch !== 'function') return null;
  const wrapped = new Proxy(originalFetch, {
    apply(target, thisArg, argumentsList) {
      const result = Reflect.apply(target, thisArg, argumentsList) as Promise<Response>;
      if (!isPlayerResponseUrl(readRequestUrl(argumentsList[0]))) return result;
      return result.then((response) => wrapResponseJson(response));
    },
  });
  try {
    page.fetch = wrapped;
    if (page.fetch !== wrapped) return null;
  } catch {
    return null;
  }
  return () => {
    if (page.fetch === wrapped) page.fetch = originalFetch;
  };
}

function wrapResponseJson(response: Response): Response {
  try {
    const originalJson = response.json.bind(response);
    Object.defineProperty(response, 'json', {
      configurable: true,
      writable: true,
      value: () =>
        originalJson().then((value: unknown) => {
          try {
            prunePlayerResponseCandidate(value);
          } catch {
            // Parsing already succeeded, so pruning must not alter the result or throw.
          }
          return value;
        }),
    });
  } catch {
    // A non-configurable `.json` keeps native behavior.
  }
  return response;
}

function wrapJsonStringify(): () => void {
  const original = JSON.stringify;
  const wrapped = new Proxy(original, {
    apply(target, thisArg, argumentsList) {
      try {
        setInlinePlaybackNoAd(argumentsList[0]);
      } catch {
        // Serialize the original value normally if its shape cannot be inspected.
      }
      return Reflect.apply(target, thisArg, argumentsList);
    },
  });
  JSON.stringify = wrapped;
  return () => {
    if (JSON.stringify === wrapped) JSON.stringify = original;
  };
}

function setInlinePlaybackNoAd(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const playbackContext = (value as Record<string, unknown>).playbackContext;
  if (typeof playbackContext !== 'object' || playbackContext === null) return;
  const contentPlaybackContext = (playbackContext as Record<string, unknown>)
    .contentPlaybackContext;
  if (typeof contentPlaybackContext !== 'object' || contentPlaybackContext === null) return;
  (contentPlaybackContext as Record<string, unknown>).isInlinePlaybackNoAd = true;
}

function neutralizeExposedAbnormalityCallback(): (() => void) | null {
  const page = globalThis as typeof globalThis & { onAbnormalityDetected?: unknown };
  const original = page.onAbnormalityDetected;
  if (typeof original !== 'function') return null;
  const replacement = () => undefined;
  page.onAbnormalityDetected = replacement;
  return () => {
    if (page.onAbnormalityDetected === replacement) page.onAbnormalityDetected = original;
  };
}
