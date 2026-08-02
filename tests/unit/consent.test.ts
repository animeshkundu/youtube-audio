import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyConsentToSettings,
  consentStorageChangeGrants,
  consentStorageKey,
  createConsentStateController,
  createContentConsentState,
  grantDataConsent,
  parseDataConsentMessage,
  resolveDataConsent,
  revokeDataConsent,
  setSponsorBlockConsent,
  supportsBuiltInDataConsent,
} from '../../src/shared/consent';
import { DEFAULT_SETTINGS } from '../../src/shared/config';

function stubBrowser(
  options: {
    permissions?: object;
    stored?: unknown;
    reject?: boolean;
    runtimeReject?: boolean;
    version?: string;
    os?: browser.runtime.PlatformOs;
  } = {}
) {
  const set = vi.fn(async (_value: unknown) => undefined);
  vi.stubGlobal('browser', {
    permissions: {
      getAll: options.reject
        ? vi.fn(async () => Promise.reject(new Error('unavailable')))
        : vi.fn(async () => options.permissions ?? {}),
    },
    runtime: {
      getBrowserInfo: options.runtimeReject
        ? vi.fn(async () => Promise.reject(new Error('runtime unavailable')))
        : vi.fn(async () => ({
            name: 'Firefox',
            vendor: 'Mozilla',
            version: options.version ?? '139.0',
            buildID: 'test',
          })),
      getPlatformInfo: vi.fn(async () => ({
        os: options.os ?? 'linux',
        arch: 'x86-64',
        nacl_arch: 'x86-64',
      })),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ [consentStorageKey()]: options.stored })),
        set,
      },
    },
  });
  return set;
}

const grantedRecord = {
  version: 1,
  decision: 'granted',
  sponsorBlockAllowed: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hybrid data consent', () => {
  it('detects built-in support at the desktop and Android version thresholds', async () => {
    stubBrowser({ version: '139.0.4', os: 'linux' });
    await expect(supportsBuiltInDataConsent()).resolves.toBe(false);

    stubBrowser({ version: '140.0', os: 'linux' });
    await expect(supportsBuiltInDataConsent()).resolves.toBe(true);

    stubBrowser({ version: '141.0', os: 'android' });
    await expect(supportsBuiltInDataConsent()).resolves.toBe(false);

    stubBrowser({ version: '142.0.1', os: 'android' });
    await expect(supportsBuiltInDataConsent()).resolves.toBe(true);
  });

  it('fails safely to built-in support when runtime detection is unavailable or invalid', async () => {
    stubBrowser({ version: 'invalid', os: 'linux' });
    await expect(supportsBuiltInDataConsent()).resolves.toBe(true);

    stubBrowser({ runtimeReject: true });
    await expect(supportsBuiltInDataConsent()).resolves.toBe(true);
  });

  it('ignores an echoed built-in key below the supported version', async () => {
    stubBrowser({
      permissions: { data_collection: ['websiteContent'] },
      stored: undefined,
      version: '139.0',
    });

    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'custom',
    });
  });

  it('does not let a stored custom grant bypass built-in consent on Firefox 141', async () => {
    stubBrowser({
      permissions: {},
      stored: grantedRecord,
      version: '141.0',
    });

    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });
  });

  it('uses Firefox consent when the required category is granted', async () => {
    stubBrowser({ permissions: { data_collection: ['websiteContent'] }, version: '140.0' });

    await expect(resolveDataConsent()).resolves.toEqual({
      granted: true,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });
  });

  it('fails closed when the built-in key omits the required category', async () => {
    stubBrowser({ permissions: { data_collection: [] }, version: '140.0' });

    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });
  });

  it('uses explicit stored acceptance only on unsupported Firefox', async () => {
    stubBrowser({ stored: grantedRecord, version: '133.0' });

    await expect(resolveDataConsent()).resolves.toEqual({
      granted: true,
      sponsorBlockAllowed: true,
      source: 'custom',
    });

    stubBrowser({ version: '133.0' });
    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'custom',
    });
  });

  it('uses the platform-specific Android threshold', async () => {
    stubBrowser({ stored: grantedRecord, version: '141.0', os: 'android' });
    await expect(resolveDataConsent()).resolves.toMatchObject({
      granted: true,
      source: 'custom',
    });

    stubBrowser({ stored: grantedRecord, version: '142.0', os: 'android' });
    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });
  });

  it('fails closed for absent, malformed, revoked, or unreadable state', async () => {
    stubBrowser();
    await expect(resolveDataConsent()).resolves.toMatchObject({ granted: false });

    stubBrowser({ stored: { ...grantedRecord, version: 99 } });
    await expect(resolveDataConsent()).resolves.toMatchObject({ granted: false });

    stubBrowser({
      permissions: { data_collection: ['websiteContent'] },
      stored: { version: 1, decision: 'revoked', sponsorBlockAllowed: true },
      version: '140.0',
    });
    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });

    stubBrowser({
      stored: { version: 1, decision: 'revoked', sponsorBlockAllowed: true },
      version: '133.0',
    });
    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'custom',
    });

    stubBrowser({ runtimeReject: true, stored: grantedRecord });
    await expect(resolveDataConsent()).resolves.toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });

    stubBrowser({ reject: true });
    await expect(resolveDataConsent()).resolves.toMatchObject({ granted: false });
  });

  it('persists acceptance and revocation as explicit versioned decisions', async () => {
    const set = stubBrowser();

    await grantDataConsent(true);
    await revokeDataConsent();

    expect(set).toHaveBeenNthCalledWith(1, {
      [consentStorageKey()]: {
        version: 1,
        decision: 'granted',
        sponsorBlockAllowed: true,
      },
    });
    expect(set).toHaveBeenNthCalledWith(2, {
      [consentStorageKey()]: {
        version: 1,
        decision: 'revoked',
        sponsorBlockAllowed: false,
      },
    });
  });

  it('persists a separate SponsorBlock opt-in only after required consent', async () => {
    const set = stubBrowser({
      permissions: { data_collection: ['websiteContent'] },
      version: '140.0',
    });

    await setSponsorBlockConsent(true);

    expect(set).toHaveBeenCalledWith({
      [consentStorageKey()]: {
        version: 1,
        decision: 'granted',
        sponsorBlockAllowed: true,
      },
    });

    stubBrowser();
    await expect(setSponsorBlockConsent(true)).rejects.toThrow(
      'Required data consent is not granted'
    );
  });

  it('classifies only a well-formed stored grant as additive', () => {
    expect(consentStorageChangeGrants(grantedRecord)).toBe(true);
    expect(
      consentStorageChangeGrants({
        version: 1,
        decision: 'revoked',
        sponsorBlockAllowed: false,
      })
    ).toBe(false);
    expect(consentStorageChangeGrants({ ...grantedRecord, version: 99 })).toBe(false);
    expect(consentStorageChangeGrants(undefined)).toBe(false);
  });

  it('accepts only well-formed background consent replies', () => {
    expect(
      parseDataConsentMessage({
        granted: true,
        sponsorBlockAllowed: false,
        source: 'firefox',
      })
    ).toEqual({ granted: true, sponsorBlockAllowed: false, source: 'firefox' });
    expect(parseDataConsentMessage(null)).toBeNull();
    expect(parseDataConsentMessage({ granted: true, source: 'firefox' })).toBeNull();
    expect(
      parseDataConsentMessage({
        granted: false,
        sponsorBlockAllowed: true,
        source: 'custom',
      })
    ).toBeNull();
    expect(
      parseDataConsentMessage({
        granted: true,
        sponsorBlockAllowed: false,
        source: 'page',
      })
    ).toBeNull();
  });

  it('applies a broadcast and discards an older startup reply', () => {
    const publish = vi.fn();
    const state = createContentConsentState(publish);
    const revoked = { granted: false, sponsorBlockAllowed: false, source: 'firefox' } as const;
    const granted = { granted: true, sponsorBlockAllowed: false, source: 'firefox' } as const;

    state.applyPush(revoked);
    state.applyInitial(granted);

    expect(state.current()).toEqual(revoked);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(revoked);
  });

  it('fails closed when a broadcast payload is malformed', () => {
    const publish = vi.fn();
    const state = createContentConsentState(publish);

    state.applyPush({ granted: true });

    expect(state.current()).toEqual({
      granted: false,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });
  });

  it('discards a stale resolution after a newer restrictive event', async () => {
    let finishFirst!: (consent: Awaited<ReturnType<typeof resolveDataConsent>>) => void;
    const first = new Promise<Awaited<ReturnType<typeof resolveDataConsent>>>((resolve) => {
      finishFirst = resolve;
    });
    const revoked = { granted: false, sponsorBlockAllowed: false, source: 'firefox' } as const;
    const granted = { granted: true, sponsorBlockAllowed: false, source: 'firefox' } as const;
    const resolve = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(revoked);
    const publish = vi.fn();
    const controller = createConsentStateController(resolve, publish);

    const staleResolution = controller.resolve();
    const currentResolution = controller.denyThenResolve();
    await expect(currentResolution).resolves.toEqual(revoked);
    finishFirst(granted);
    await expect(staleResolution).resolves.toEqual(revoked);

    expect(controller.current()).toEqual(revoked);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalledWith(granted);
  });

  it('re-resolves an addition without publishing a transient denial', async () => {
    const granted = { granted: true, sponsorBlockAllowed: false, source: 'firefox' } as const;
    const publish = vi.fn();
    const controller = createConsentStateController(async () => granted, publish, granted);

    await controller.resolve();

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(granted);
  });

  it('publishes denial before re-resolving a removal', async () => {
    const granted = { granted: true, sponsorBlockAllowed: false, source: 'firefox' } as const;
    const revoked = { granted: false, sponsorBlockAllowed: false, source: 'firefox' } as const;
    const publish = vi.fn();
    const controller = createConsentStateController(async () => revoked, publish, granted);

    await controller.denyThenResolve();

    expect(publish.mock.calls).toEqual([[revoked], [revoked]]);
  });

  it('disables every extension transmission path until consent is granted', () => {
    const effective = applyConsentToSettings(DEFAULT_SETTINGS, {
      granted: false,
      sponsorBlockAllowed: false,
      source: 'custom',
    });

    expect(effective).toMatchObject({
      enabled: false,
      audioOnlyEnabled: false,
      audioArtworkEnabled: false,
      backgroundPlayEnabled: false,
      segmentSkipEnabled: false,
      loudnessNormalization: false,
      equalizerEnabled: false,
      downloadEnabled: false,
    });
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
  });

  it('independently suppresses SponsorBlock when required consent is granted', () => {
    const effective = applyConsentToSettings(DEFAULT_SETTINGS, {
      granted: true,
      sponsorBlockAllowed: false,
      source: 'firefox',
    });

    expect(effective.enabled).toBe(true);
    expect(effective.audioOnlyEnabled).toBe(true);
    expect(effective.segmentSkipEnabled).toBe(false);
  });
});
