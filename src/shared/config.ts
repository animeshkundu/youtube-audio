import { signal } from '@preact/signals';

export interface ExtensionSettings {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  backgroundPlayEnabled: boolean;
  ghostEnabled: boolean;
  aggressiveTelemetry: boolean;
  adBlockEnabled: boolean;
}

export type PlaybackSetting = 'audioOnlyEnabled' | 'backgroundPlayEnabled';
export type TelemetrySetting = 'ghostEnabled' | 'aggressiveTelemetry';

const STORAGE_KEY = 'settings';
export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  audioOnlyEnabled: true,
  backgroundPlayEnabled: true,
  ghostEnabled: true,
  aggressiveTelemetry: false,
  adBlockEnabled: true,
};

export const enabledSignal = signal(DEFAULT_SETTINGS.enabled);
export const audioOnlyEnabledSignal = signal(DEFAULT_SETTINGS.audioOnlyEnabled);
export const backgroundPlayEnabledSignal = signal(DEFAULT_SETTINGS.backgroundPlayEnabled);
export const ghostEnabledSignal = signal(DEFAULT_SETTINGS.ghostEnabled);
export const aggressiveTelemetrySignal = signal(DEFAULT_SETTINGS.aggressiveTelemetry);
export const adBlockEnabledSignal = signal(DEFAULT_SETTINGS.adBlockEnabled);

let currentSettings = DEFAULT_SETTINGS;
const subscribers = new Set<(settings: ExtensionSettings) => void>();

export async function initializeSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings = normalizeSettings(stored[STORAGE_KEY]);
  applySettings(settings);
  return settings;
}

export function getSettings(): ExtensionSettings {
  return { ...currentSettings };
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await persistSettings({ ...currentSettings, enabled });
}

export async function setPlaybackSetting(setting: PlaybackSetting, enabled: boolean): Promise<void> {
  await persistSettings({ ...currentSettings, [setting]: enabled });
}

export async function setAudioOnlyEnabled(enabled: boolean): Promise<void> {
  await setPlaybackSetting('audioOnlyEnabled', enabled);
}

export async function setBackgroundPlayEnabled(enabled: boolean): Promise<void> {
  await setPlaybackSetting('backgroundPlayEnabled', enabled);
}

export async function setTelemetrySetting(setting: TelemetrySetting, enabled: boolean): Promise<void> {
  await persistSettings({ ...currentSettings, [setting]: enabled });
}

export async function setGhostEnabled(enabled: boolean): Promise<void> {
  await setTelemetrySetting('ghostEnabled', enabled);
}

export async function setAggressiveTelemetry(enabled: boolean): Promise<void> {
  await setTelemetrySetting('aggressiveTelemetry', enabled);
}

export async function setAdBlockEnabled(enabled: boolean): Promise<void> {
  await persistSettings({ ...currentSettings, adBlockEnabled: enabled });
}

export function subscribeSettings(listener: (settings: ExtensionSettings) => void): () => void {
  subscribers.add(listener);
  listener(getSettings());
  return () => subscribers.delete(listener);
}

export function watchSettings(): () => void {
  const listener = (changes: Record<string, browser.storage.StorageChange>) => {
    const candidate = changes[STORAGE_KEY]?.newValue;
    if (candidate !== undefined) applySettings(normalizeSettings(candidate));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

async function persistSettings(settings: ExtensionSettings): Promise<void> {
  const previous = currentSettings;
  applySettings(settings);

  try {
    await browser.storage.local.set({ [STORAGE_KEY]: settings });
  } catch (error) {
    applySettings(previous);
    throw error;
  }
}

function applySettings(settings: ExtensionSettings): void {
  currentSettings = { ...settings };
  enabledSignal.value = settings.enabled;
  audioOnlyEnabledSignal.value = settings.audioOnlyEnabled;
  backgroundPlayEnabledSignal.value = settings.backgroundPlayEnabled;
  ghostEnabledSignal.value = settings.ghostEnabled;
  aggressiveTelemetrySignal.value = settings.aggressiveTelemetry;
  adBlockEnabledSignal.value = settings.adBlockEnabled;
  subscribers.forEach((listener) => listener(getSettings()));
}

function normalizeSettings(value: unknown): ExtensionSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const candidate = value as Partial<ExtensionSettings>;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_SETTINGS.enabled,
    audioOnlyEnabled:
      typeof candidate.audioOnlyEnabled === 'boolean'
        ? candidate.audioOnlyEnabled
        : DEFAULT_SETTINGS.audioOnlyEnabled,
    backgroundPlayEnabled:
      typeof candidate.backgroundPlayEnabled === 'boolean'
        ? candidate.backgroundPlayEnabled
        : DEFAULT_SETTINGS.backgroundPlayEnabled,
    ghostEnabled:
      typeof candidate.ghostEnabled === 'boolean'
        ? candidate.ghostEnabled
        : DEFAULT_SETTINGS.ghostEnabled,
    aggressiveTelemetry:
      typeof candidate.aggressiveTelemetry === 'boolean'
        ? candidate.aggressiveTelemetry
        : DEFAULT_SETTINGS.aggressiveTelemetry,
    adBlockEnabled:
      typeof candidate.adBlockEnabled === 'boolean'
        ? candidate.adBlockEnabled
        : DEFAULT_SETTINGS.adBlockEnabled,
  };
}
