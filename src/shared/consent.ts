import type { ExtensionSettings } from './config';

const CONSENT_STORAGE_KEY = 'dataTransmissionConsent';
const CONSENT_VERSION = 1;

export interface DataConsentState {
  granted: boolean;
  sponsorBlockAllowed: boolean;
  source: 'firefox' | 'custom';
}

export const DENIED_DATA_CONSENT: DataConsentState = {
  granted: false,
  sponsorBlockAllowed: false,
  source: 'firefox',
};

interface StoredConsent {
  version: number;
  decision: 'granted' | 'revoked';
  sponsorBlockAllowed: boolean;
}

type PermissionsWithDataCollection = browser.permissions.Permissions & {
  data_collection?: unknown;
};

const REQUIRED_DATA_CATEGORY = 'websiteContent';
const BUILT_IN_DESKTOP_MIN_VERSION = 140;
const BUILT_IN_ANDROID_MIN_VERSION = 142;
export const GET_DATA_CONSENT_MESSAGE = 'yta:get-data-consent';
export const DATA_CONSENT_CHANGED_MESSAGE = 'yta:data-consent-changed';

/** Returns whether this Firefox platform/version supports built-in data consent. */
export async function supportsBuiltInDataConsent(): Promise<boolean> {
  try {
    const [browserInfo, platformInfo] = await Promise.all([
      browser.runtime.getBrowserInfo(),
      browser.runtime.getPlatformInfo(),
    ]);
    const majorVersion = Number.parseInt(browserInfo.version, 10);
    const minimumVersion =
      platformInfo.os === 'android' ? BUILT_IN_ANDROID_MIN_VERSION : BUILT_IN_DESKTOP_MIN_VERSION;
    // Unknown versions take the built-in path. This can temporarily strand an old runtime, but it
    // cannot let a stored custom grant override a pending or declined browser consent prompt.
    return !Number.isFinite(majorVersion) || majorVersion >= minimumVersion;
  } catch {
    // Detector failure must not reopen the custom-consent bypass on a supported Firefox version.
    return true;
  }
}

/** Resolves consent fail-closed. Missing, malformed, and unreadable custom consent is denied. */
export async function resolveDataConsent(): Promise<DataConsentState> {
  try {
    const [permissions, stored, builtInSupported] = await Promise.all([
      browser.permissions.getAll(),
      browser.storage.local.get(CONSENT_STORAGE_KEY),
      supportsBuiltInDataConsent(),
    ]);
    const record = parseStoredConsent(stored[CONSENT_STORAGE_KEY]);
    if (record?.decision === 'revoked') {
      return {
        granted: false,
        sponsorBlockAllowed: false,
        source: builtInSupported ? 'firefox' : 'custom',
      };
    }
    if (builtInSupported) {
      // Firefox's required data categories cannot be opted out of: accepting them is a precondition
      // of installation. Still require the declared category to appear in getAll() so an unexpected
      // empty or malformed built-in result fails closed rather than treating key presence as a grant.
      const categories = (permissions as PermissionsWithDataCollection).data_collection;
      const requiredCategoryGranted =
        Array.isArray(categories) && categories.includes(REQUIRED_DATA_CATEGORY);
      return {
        granted: requiredCategoryGranted,
        sponsorBlockAllowed: requiredCategoryGranted && record?.sponsorBlockAllowed === true,
        source: 'firefox',
      };
    }
    return {
      granted: record?.decision === 'granted',
      sponsorBlockAllowed: record?.decision === 'granted' && record.sponsorBlockAllowed,
      source: 'custom',
    };
  } catch {
    return { granted: false, sponsorBlockAllowed: false, source: 'firefox' };
  }
}

/** Persists an explicit custom acceptance and its independent SponsorBlock choice. */
export async function grantDataConsent(sponsorBlockAllowed: boolean): Promise<void> {
  await persistConsent('granted', sponsorBlockAllowed);
}

/** Updates the separate SponsorBlock choice without creating required consent implicitly. */
export async function setSponsorBlockConsent(allowed: boolean): Promise<void> {
  const consent = await resolveDataConsent();
  if (!consent.granted) throw new Error('Required data consent is not granted');
  await persistConsent('granted', allowed);
}

/** Persists revocation before callers update their UI. */
export async function revokeDataConsent(): Promise<void> {
  await persistConsent('revoked', false);
}

/** Produces the only settings snapshot safe to send to MAIN world before consent is granted. */
export function applyConsentToSettings(
  settings: ExtensionSettings,
  consent: DataConsentState
): ExtensionSettings {
  if (!consent.granted) {
    return {
      ...settings,
      enabled: false,
      audioOnlyEnabled: false,
      audioArtworkEnabled: false,
      backgroundPlayEnabled: false,
      segmentSkipEnabled: false,
      loudnessNormalization: false,
      equalizerEnabled: false,
      downloadEnabled: false,
    };
  }
  if (!consent.sponsorBlockAllowed) return { ...settings, segmentSkipEnabled: false };
  return settings;
}

export function consentStorageKey(): string {
  return CONSENT_STORAGE_KEY;
}

/** Returns true only when a storage change adds a well-formed explicit grant. */
export function consentStorageChangeGrants(value: unknown): boolean {
  return parseStoredConsent(value)?.decision === 'granted';
}

/** Parses the fixed background-to-content consent payload; malformed values deny consent. */
export function parseDataConsentMessage(value: unknown): DataConsentState | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<DataConsentState>;
  if (
    typeof candidate.granted !== 'boolean' ||
    typeof candidate.sponsorBlockAllowed !== 'boolean' ||
    (candidate.source !== 'firefox' && candidate.source !== 'custom') ||
    (!candidate.granted && candidate.sponsorBlockAllowed)
  ) {
    return null;
  }
  return {
    granted: candidate.granted,
    sponsorBlockAllowed: candidate.sponsorBlockAllowed,
    source: candidate.source,
  };
}

export interface ContentConsentState {
  current(): DataConsentState;
  applyPush(value: unknown): DataConsentState;
  applyInitial(value: unknown): DataConsentState;
}

/** Keeps an authoritative push from being overwritten by an older in-flight startup reply. */
export function createContentConsentState(
  publish: (consent: DataConsentState) => void
): ContentConsentState {
  let consent = DENIED_DATA_CONSENT;
  let generation = 0;
  const startupGeneration = generation;

  return {
    current: () => consent,
    applyPush: (value) => {
      generation += 1;
      consent = parseDataConsentMessage(value) ?? DENIED_DATA_CONSENT;
      publish(consent);
      return consent;
    },
    applyInitial: (value) => {
      if (generation !== startupGeneration) return consent;
      consent = parseDataConsentMessage(value) ?? DENIED_DATA_CONSENT;
      publish(consent);
      return consent;
    },
  };
}

export interface ConsentStateController {
  current(): DataConsentState;
  resolve(): Promise<DataConsentState>;
  denyThenResolve(): Promise<DataConsentState>;
}

/** Orders asynchronous consent lookups so an older result cannot overwrite a newer event. */
export function createConsentStateController(
  resolve: () => Promise<DataConsentState>,
  publish: (consent: DataConsentState) => void,
  initial: DataConsentState = DENIED_DATA_CONSENT
): ConsentStateController {
  let consent = initial;
  let generation = 0;

  const resolveCurrent = async (): Promise<DataConsentState> => {
    const ownGeneration = ++generation;
    const resolved = await resolve();
    if (ownGeneration !== generation) return consent;
    consent = resolved;
    publish(consent);
    return consent;
  };

  return {
    current: () => consent,
    resolve: resolveCurrent,
    denyThenResolve: async () => {
      generation += 1;
      consent = { granted: false, sponsorBlockAllowed: false, source: consent.source };
      publish(consent);
      return resolveCurrent();
    },
  };
}

async function persistConsent(
  decision: StoredConsent['decision'],
  sponsorBlockAllowed: boolean
): Promise<void> {
  const record: StoredConsent = {
    version: CONSENT_VERSION,
    decision,
    sponsorBlockAllowed: decision === 'granted' && sponsorBlockAllowed,
  };
  await browser.storage.local.set({ [CONSENT_STORAGE_KEY]: record });
}

function parseStoredConsent(value: unknown): StoredConsent | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<StoredConsent>;
  if (
    candidate.version !== CONSENT_VERSION ||
    (candidate.decision !== 'granted' && candidate.decision !== 'revoked') ||
    typeof candidate.sponsorBlockAllowed !== 'boolean'
  ) {
    return null;
  }
  return {
    version: CONSENT_VERSION,
    decision: candidate.decision,
    sponsorBlockAllowed: candidate.sponsorBlockAllowed,
  };
}
