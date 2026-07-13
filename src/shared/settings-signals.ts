/**
 * Preact signal mirror of the settings store, for the extension UI (popup + options) only.
 *
 * The signals live here rather than in `config.ts` so that the core settings store stays free of
 * any `@preact/signals` dependency: the background, content, and page-world entrypoints import the
 * store (`getSettings`, `subscribeSettings`, the mutators) but have no UI and never read a signal,
 * so keeping the reactive layer out of `config.ts` lets the bundler drop `@preact/signals` from
 * those bundles entirely. Importing this module (which only the UI does) registers a single store
 * subscriber that keeps every signal in lockstep with the store, so a UI reading a signal sees the
 * exact same value it would have before this split.
 */

import { signal } from '@preact/signals';

import type { EqualizerBands } from './audiograph';
import { DEFAULT_SETTINGS, subscribeSettings } from './config';
import type { QualityCap } from './quality-of-life';
import type { SponsorCategory } from './sponsorblock';

export const enabledSignal = signal(DEFAULT_SETTINGS.enabled);
export const audioOnlyEnabledSignal = signal(DEFAULT_SETTINGS.audioOnlyEnabled);
export const audioArtworkEnabledSignal = signal(DEFAULT_SETTINGS.audioArtworkEnabled);
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
export const loudnessNormalizationSignal = signal(DEFAULT_SETTINGS.loudnessNormalization);
export const equalizerEnabledSignal = signal(DEFAULT_SETTINGS.equalizerEnabled);
export const equalizerBandsSignal = signal<EqualizerBands>(DEFAULT_SETTINGS.equalizerBands);
export const lyricsEnabledSignal = signal(DEFAULT_SETTINGS.lyricsEnabled);
export const downloadEnabledSignal = signal(DEFAULT_SETTINGS.downloadEnabled);

// Mirror the store into the signals. `subscribeSettings` invokes this immediately with the current
// settings and again on every change, so the signals are correct from module load onward.
subscribeSettings((settings) => {
  enabledSignal.value = settings.enabled;
  audioOnlyEnabledSignal.value = settings.audioOnlyEnabled;
  audioArtworkEnabledSignal.value = settings.audioArtworkEnabled;
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
  loudnessNormalizationSignal.value = settings.loudnessNormalization;
  equalizerEnabledSignal.value = settings.equalizerEnabled;
  equalizerBandsSignal.value = settings.equalizerBands;
  lyricsEnabledSignal.value = settings.lyricsEnabled;
  downloadEnabledSignal.value = settings.downloadEnabled;
});
