import { signal } from '@preact/signals';

import { isQualityCap, type QualityCap } from './quality-of-life';
import {
  isSponsorCategory,
  SPONSOR_CATEGORIES,
  type SponsorCategory,
} from './sponsorblock';

export interface ExtensionSettings {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  backgroundPlayEnabled: boolean;
  ghostEnabled: boolean;
  aggressiveTelemetry: boolean;
  adBlockEnabled: boolean;
  segmentSkipEnabled: boolean;
  segmentSkipCategories: readonly SponsorCategory[];
  forceQualityMax: QualityCap;
  disableAutoplayNext: boolean;
  hideShorts: boolean;
  hideRecommendations: boolean;
  hideComments: boolean;
}

export type PlaybackSetting = 'audioOnlyEnabled' | 'backgroundPlayEnabled';
export type TelemetrySetting = 'ghostEnabled' | 'aggressiveTelemetry';
export type QualityOfLifeSetting =
  | 'disableAutoplayNext'
  | 'hideShorts'
  | 'hideRecommendations'
  | 'hideComments';

const STORAGE_KEY = 'settings';
export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  audioOnlyEnabled: true,
  backgroundPlayEnabled: true,
  ghostEnabled: true,
  aggressiveTelemetry: false,
  adBlockEnabled: true,
  segmentSkipEnabled: true,
  segmentSkipCategories: SPONSOR_CATEGORIES,
  forceQualityMax: 'off',
  disableAutoplayNext: false,
  hideShorts: false,
  hideRecommendations: false,
  hideComments: false,
};

export const enabledSignal = signal(DEFAULT_SETTINGS.enabled);
export const audioOnlyEnabledSignal = signal(DEFAULT_SETTINGS.audioOnlyEnabled);
export const backgroundPlayEnabledSignal = signal(DEFAULT_SETTINGS.backgroundPlayEnabled);
export const ghostEnabledSignal = signal(DEFAULT_SETTINGS.ghostEnabled);
export const aggressiveTelemetrySignal = signal(DEFAULT_SETTINGS.aggressiveTelemetry);
export const adBlockEnabledSignal = signal(DEFAULT_SETTINGS.adBlockEnabled);
export const segmentSkipEnabledSignal = signal(DEFAULT_SETTINGS.segmentSkipEnabled);
export const segmentSkipCategoriesSignal = signal<readonly SponsorCategory[]>(
  DEFAULT_SETTINGS.segmentSkipCategories
);
export const forceQualityMaxSignal = signal<QualityCap>(DEFAULT_SETTINGS.forceQualityMax);
export const disableAutoplayNextSignal = signal(DEFAULT_SETTINGS.disableAutoplayNext);
export const hideShortsSignal = signal(DEFAULT_SETTINGS.hideShorts);
export const hideRecommendationsSignal = signal(DEFAULT_SETTINGS.hideRecommendations);
export const hideCommentsSignal = signal(DEFAULT_SETTINGS.hideComments);

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

export async function setSegmentSkipEnabled(enabled: boolean): Promise<void> {
  await persistSettings({ ...currentSettings, segmentSkipEnabled: enabled });
}

export async function setForceQualityMax(forceQualityMax: QualityCap): Promise<void> {
  await persistSettings({ ...currentSettings, forceQualityMax });
}

export async function setQualityOfLifeSetting(
  setting: QualityOfLifeSetting,
  enabled: boolean
): Promise<void> {
  await persistSettings({ ...currentSettings, [setting]: enabled });
}

export async function setSegmentSkipCategory(
  category: SponsorCategory,
  enabled: boolean
): Promise<void> {
  const categories = new Set(currentSettings.segmentSkipCategories);
  if (enabled) categories.add(category);
  else categories.delete(category);
  await persistSettings({
    ...currentSettings,
    segmentSkipCategories: SPONSOR_CATEGORIES.filter((item) => categories.has(item)),
  });
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
  segmentSkipEnabledSignal.value = settings.segmentSkipEnabled;
  segmentSkipCategoriesSignal.value = settings.segmentSkipCategories;
  forceQualityMaxSignal.value = settings.forceQualityMax;
  disableAutoplayNextSignal.value = settings.disableAutoplayNext;
  hideShortsSignal.value = settings.hideShorts;
  hideRecommendationsSignal.value = settings.hideRecommendations;
  hideCommentsSignal.value = settings.hideComments;
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
    segmentSkipEnabled:
      typeof candidate.segmentSkipEnabled === 'boolean'
        ? candidate.segmentSkipEnabled
        : DEFAULT_SETTINGS.segmentSkipEnabled,
    segmentSkipCategories: normalizeSponsorCategories(candidate.segmentSkipCategories),
    forceQualityMax: isQualityCap(candidate.forceQualityMax)
      ? candidate.forceQualityMax
      : DEFAULT_SETTINGS.forceQualityMax,
    disableAutoplayNext:
      typeof candidate.disableAutoplayNext === 'boolean'
        ? candidate.disableAutoplayNext
        : DEFAULT_SETTINGS.disableAutoplayNext,
    hideShorts:
      typeof candidate.hideShorts === 'boolean' ? candidate.hideShorts : DEFAULT_SETTINGS.hideShorts,
    hideRecommendations:
      typeof candidate.hideRecommendations === 'boolean'
        ? candidate.hideRecommendations
        : DEFAULT_SETTINGS.hideRecommendations,
    hideComments:
      typeof candidate.hideComments === 'boolean'
        ? candidate.hideComments
        : DEFAULT_SETTINGS.hideComments,
  };
}

function normalizeSponsorCategories(value: unknown): readonly SponsorCategory[] {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.segmentSkipCategories;
  const categories = new Set(value.filter(isSponsorCategory));
  return SPONSOR_CATEGORIES.filter((category) => categories.has(category));
}
