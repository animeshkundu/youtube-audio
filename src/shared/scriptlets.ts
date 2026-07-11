export type ScriptletOperation =
  | Readonly<{ id: 'set-inline-playback-no-ad'; args: Readonly<Record<string, never>> }>
  | Readonly<{ id: 'neutralize-exposed-abnormality-callback'; args: Readonly<Record<string, never>> }>;

export interface ScriptletResult {
  applied: number;
  skippedForCoexistence: boolean;
  cleanup: () => void;
}

/**
 * Applies only bundled operation IDs. Unknown or incompatible page state is always a no-op.
 */
export function applyScriptletOperations(operations: readonly ScriptletOperation[]): ScriptletResult {
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
    case 'set-inline-playback-no-ad':
      return wrapJsonStringify();
    case 'neutralize-exposed-abnormality-callback':
      return neutralizeExposedAbnormalityCallback();
  }
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
  const contentPlaybackContext = (playbackContext as Record<string, unknown>).contentPlaybackContext;
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
