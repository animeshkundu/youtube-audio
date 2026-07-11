const AD_KEYS = new Set(['adPlacements', 'playerAds', 'adSlots', 'adPlacementRenderer']);

/**
 * Removes known YouTube ad descriptors while preserving every other player-response field.
 * Malformed or unsupported input is returned byte-for-byte unchanged.
 */
export function pruneAdsFromPlayerResponse(json: string): string {
  try {
    const value: unknown = JSON.parse(json);
    const changed = pruneValue(value);
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
