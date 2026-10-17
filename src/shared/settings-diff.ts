import { type EqualizerBands } from './audiograph';
import { type ExtensionSettings } from './config';
import { type QualityCap } from './quality-of-life';
import { type SponsorCategory } from './sponsorblock';

/**
 * The parsed settings subset the page world consumes (SPEC-020). Its fields mirror exactly what
 * `parseSettings` validates off the SETTINGS_EVENT payload; content-only settings (distraction
 * styles, telemetry opt-ins) stay out of it, so pushing them re-arms nothing.
 */
export interface PageSettingsSnapshot {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  audioArtworkEnabled: boolean;
  backgroundPlayEnabled: boolean;
  idleNagDefeatEnabled: boolean;
  fallbackQualityCapEnabled: boolean;
  adBlockEnabled: boolean;
  segmentSkipEnabled: boolean;
  segmentSkipCategories: readonly SponsorCategory[];
  forceQualityMax: QualityCap;
  disableAutoplayNext: boolean;
  loudnessNormalization: boolean;
  equalizerEnabled: boolean;
  equalizerBands: EqualizerBands;
  downloadEnabled: boolean;
}

/**
 * Which page-world subsystems one settings push must re-arm (SPEC-020). Array fields are compared
 * element-wise because every push carries freshly cloned arrays.
 */
export interface PageSubsystemReArm {
  /** Background-play visibility override. */
  visibility: boolean;
  /** Idle-nag defeat layers. */
  idleNag: boolean;
  /** Bundled scriptlet operations (ad pruning). */
  scriptlets: boolean;
  /** Managed player hints (quality cap, autoplay toggle). */
  qualityOfLife: boolean;
  /** Sponsor-segment arming (its own key diff still guards the request). */
  segments: boolean;
  /** Immediate fallback-quality cap application. */
  fallbackQuality: boolean;
  /** Media (re-)acquisition: release, re-fetch, re-attach, artwork, status. */
  media: boolean;
  /** Live audio-graph inputs, absorbable in place when a graph is armed. */
  graph: boolean;
}

function fieldChanged(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length !== right.length || left.some((value, index) => value !== right[index]);
  }
  return left !== right;
}

/**
 * True when any of `keys` differs between the snapshots. A missing previous snapshot (first
 * application) counts as changed so every subsystem arms.
 */
export function settingsFieldChanged<T extends object>(
  previous: T | null,
  next: T,
  keys: readonly (keyof T)[]
): boolean {
  if (!previous) return true;
  return keys.some((key) => fieldChanged(previous[key], next[key]));
}

export function pageSubsystemReArm(
  previous: PageSettingsSnapshot | null,
  next: PageSettingsSnapshot
): PageSubsystemReArm {
  return {
    visibility: settingsFieldChanged(previous, next, ['enabled', 'backgroundPlayEnabled']),
    idleNag: settingsFieldChanged(previous, next, [
      'enabled',
      'backgroundPlayEnabled',
      'idleNagDefeatEnabled',
    ]),
    scriptlets: settingsFieldChanged(previous, next, ['enabled', 'adBlockEnabled']),
    qualityOfLife: settingsFieldChanged(previous, next, [
      'enabled',
      'forceQualityMax',
      'disableAutoplayNext',
    ]),
    segments: settingsFieldChanged(previous, next, [
      'enabled',
      'segmentSkipEnabled',
      'segmentSkipCategories',
    ]),
    fallbackQuality: settingsFieldChanged(previous, next, ['enabled', 'fallbackQualityCapEnabled']),
    media: settingsFieldChanged(previous, next, [
      'enabled',
      'audioOnlyEnabled',
      'audioArtworkEnabled',
    ]),
    graph: settingsFieldChanged(previous, next, [
      'loudnessNormalization',
      'equalizerEnabled',
      'equalizerBands',
    ]),
  };
}

/** Whole-snapshot equality over the full settings model; duplicates are dropped at the source. */
export function settingsEqual(left: ExtensionSettings, right: ExtensionSettings): boolean {
  const keys = Object.keys(left) as (keyof ExtensionSettings)[];
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => !fieldChanged(left[key], right[key]));
}
