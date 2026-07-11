import { AD_KEYS, pruneAdsFromParsedPlayerResponse } from './adblock';

export type ScriptletOperation =
  | Readonly<{ id: 'prune-inline-player-response'; args: Readonly<Record<string, never>> }>
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
