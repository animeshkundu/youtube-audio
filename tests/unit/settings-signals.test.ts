import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  setDownloadFormat,
  setEnabled,
  setForceQualityMax,
} from '../../src/shared/config';
import * as signals from '../../src/shared/settings-signals';

/**
 * The settings store (`config.ts`) is deliberately Preact-free; `settings-signals.ts` is the sole
 * bridge that mirrors it into signals for the UI. These tests guard that bridge directly, because
 * the popup/options tests set signals themselves and would not notice if the bridge stopped mapping
 * a field. A new setting added to the store without a matching signal (or a typo in the mirror) must
 * fail here.
 */
const asSignals = signals as unknown as Record<string, { value: unknown } | undefined>;

describe('settings-signals bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mirrors every settings field into a matching signal at import time', () => {
    // Importing the module registers the store subscriber, which fires immediately with the current
    // settings (defaults here), so every signal must already equal its store field.
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const sig = asSignals[`${key}Signal`];
      expect(sig, `settings-signals is missing a signal mirror for setting "${key}"`).toBeDefined();
      expect(sig?.value).toEqual(value);
    }
  });

  it('propagates store changes to the signals through subscribeSettings', async () => {
    // persistSettings applies optimistically (notifying subscribers) before writing storage, so a
    // resolving stub keeps the change committed (no rollback).
    vi.stubGlobal('browser', {
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    const initialEnabled = signals.enabledSignal.value;
    await setEnabled(!initialEnabled);
    expect(signals.enabledSignal.value).toBe(!initialEnabled);

    // A non-boolean field, to catch a bridge that only copies booleans.
    await setForceQualityMax('720p');
    expect(signals.forceQualityMaxSignal.value).toBe('720p');
    await setDownloadFormat('opus');
    expect(signals.downloadFormatSignal.value).toBe('opus');

    // Restore so the import-time mirror test stays order-independent.
    await setEnabled(initialEnabled);
    await setForceQualityMax(DEFAULT_SETTINGS.forceQualityMax);
    await setDownloadFormat(DEFAULT_SETTINGS.downloadFormat);
  });
});
