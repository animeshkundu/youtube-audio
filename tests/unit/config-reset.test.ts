import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  getSettings,
  initializeSettings,
  resetSettings,
  setEnabled,
  setEqualizerBand,
  setForceQualityMax,
  setSegmentSkipCategory,
} from '../../src/shared/config';

function stubBrowser(set: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('browser', {
    storage: {
      local: { get: vi.fn(async () => ({})), set },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resetSettings', () => {
  it('restores every setting to a cloned default snapshot in one storage write', async () => {
    const set = vi.fn(async (_value: unknown) => undefined);
    stubBrowser(set);
    await setEnabled(false);
    await setForceQualityMax('720p');
    await setEqualizerBand(2, 8);
    await setSegmentSkipCategory('sponsor', false);
    set.mockClear();

    await resetSettings();

    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ settings: DEFAULT_SETTINGS });
    const written = set.mock.calls[0]?.[0] as { settings: typeof DEFAULT_SETTINGS };
    expect(written.settings).not.toBe(DEFAULT_SETTINGS);
    expect(written.settings.equalizerBands).not.toBe(DEFAULT_SETTINGS.equalizerBands);
    expect(written.settings.segmentSkipCategories).not.toBe(DEFAULT_SETTINGS.segmentSkipCategories);
  });

  it('rolls back the exact previous snapshot when the storage write fails', async () => {
    const set = vi.fn(async (_value: unknown) => undefined);
    stubBrowser(set);
    await setEnabled(false);
    await setForceQualityMax('480p');
    await setEqualizerBand(0, -7);
    await setSegmentSkipCategory('music_offtopic', false);
    const previous = getSettings();
    const failure = new Error('storage unavailable');
    set.mockRejectedValueOnce(failure);

    await expect(resetSettings()).rejects.toBe(failure);

    expect(getSettings()).toEqual(previous);
    expect(getSettings()).not.toEqual(DEFAULT_SETTINGS);
    expect(set).toHaveBeenLastCalledWith({ settings: DEFAULT_SETTINGS });

    await resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SponsorBlock opt-in migration', () => {
  it('defaults segment skipping off for new installs', async () => {
    stubBrowser(vi.fn(async () => undefined));

    await initializeSettings();

    expect(getSettings().segmentSkipEnabled).toBe(false);
  });

  it('preserves an existing stored segment-skipping choice', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(async () => ({ settings: { segmentSkipEnabled: true } })),
          set: vi.fn(async () => undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    await initializeSettings();

    expect(getSettings().segmentSkipEnabled).toBe(true);
  });
});
