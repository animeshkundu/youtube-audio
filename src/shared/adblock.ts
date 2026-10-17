export const AD_KEYS = new Set(['adPlacements', 'playerAds', 'adSlots', 'adPlacementRenderer']);

/**
 * Removes known YouTube ad descriptors from a parsed value in place.
 * Returns whether any descriptor was removed and never throws into the caller.
 */
export function pruneAdsFromParsedPlayerResponse(value: unknown): boolean {
  try {
    return pruneValue(value);
  } catch {
    return false;
  }
}

/**
 * Removes known YouTube ad descriptors while preserving every other player-response field.
 * Malformed or unsupported input is returned byte-for-byte unchanged.
 */
export function pruneAdsFromPlayerResponse(json: string): string {
  try {
    const value: unknown = JSON.parse(json);
    const changed = pruneAdsFromParsedPlayerResponse(value);
    return changed ? JSON.stringify(value) : json;
  } catch {
    return json;
  }
}

function pruneValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.reduce<boolean>((changed, item) => pruneValue(item) || changed, false);
  }
  if (typeof value !== 'object' || value === null) return false;

  let changed = false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (AD_KEYS.has(key)) {
      delete record[key];
      changed = true;
    } else if (pruneValue(record[key])) {
      changed = true;
    }
  }
  return changed;
}

/**
 * Upper bound on the response size the background filter will buffer for pruning. A body above it
 * is streamed through unparsed instead: bounding the background's memory matters more than pruning
 * a pathological response, and playback must never depend on pruning succeeding.
 */
export const MAX_PRUNABLE_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface ResponseBudget {
  /**
   * Buffers one response chunk. Returns null while the response is still within budget; once the
   * budget is crossed it returns every held chunk (in order) exactly once so the caller can flush
   * them and stop buffering, and every later call returns just its own chunk to stream through.
   */
  push(chunk: Uint8Array): Uint8Array[] | null;
  /** The chunks still held for a full-body parse, in order (empty once streaming). */
  bufferedChunks(): Uint8Array[];
  /** True once the response crossed the budget and is being streamed through unparsed. */
  readonly streaming: boolean;
  /** Total bytes received, regardless of buffering mode. */
  readonly receivedBytes: number;
}

/**
 * Bounded buffering state shared by the MV2 webRequest filter and its unit tests. A non-positive
 * budget streams from the first chunk.
 */
export function createResponseBudget(
  maxBytes: number = MAX_PRUNABLE_RESPONSE_BYTES
): ResponseBudget {
  let buffered: Uint8Array[] = [];
  let streaming = maxBytes <= 0;
  let receivedBytes = 0;
  return {
    push(chunk) {
      receivedBytes += chunk.byteLength;
      if (streaming) return [chunk];
      buffered.push(chunk);
      if (receivedBytes <= maxBytes) return null;
      streaming = true;
      const held = buffered;
      buffered = [];
      return held;
    },
    bufferedChunks() {
      return streaming ? [] : buffered.slice();
    },
    get streaming() {
      return streaming;
    },
    get receivedBytes() {
      return receivedBytes;
    },
  };
}
