import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/shared/config';
import {
  pageSubsystemReArm,
  settingsEqual,
  settingsFieldChanged,
  type PageSettingsSnapshot,
} from '../../src/shared/settings-diff';

function snapshot(overrides: Partial<PageSettingsSnapshot> = {}): PageSettingsSnapshot {
  return {
    enabled: true,
    audioOnlyEnabled: true,
    audioArtworkEnabled: true,
    backgroundPlayEnabled: true,
    idleNagDefeatEnabled: true,
    fallbackQualityCapEnabled: true,
    adBlockEnabled: true,
    segmentSkipEnabled: false,
    segmentSkipCategories: ['sponsor'],
    forceQualityMax: 'off',
    disableAutoplayNext: false,
    loudnessNormalization: true,
    equalizerEnabled: false,
    equalizerBands: [0, 0, 0, 0, 0],
    downloadEnabled: false,
    ...overrides,
  };
}

const NO_GROUPS = {
  visibility: false,
  idleNag: false,
  scriptlets: false,
  qualityOfLife: false,
  segments: false,
  fallbackQuality: false,
  media: false,
  graph: false,
};

describe('pageSubsystemReArm', () => {
  it('marks every group on the first application', () => {
    expect(pageSubsystemReArm(null, snapshot())).toEqual({
      visibility: true,
      idleNag: true,
      scriptlets: true,
      qualityOfLife: true,
      segments: true,
      fallbackQuality: true,
      media: true,
      graph: true,
    });
  });

  it('marks nothing for an identical push carrying fresh array references', () => {
    const previous = snapshot();
    const next = snapshot({
      segmentSkipCategories: ['sponsor'],
      equalizerBands: [0, 0, 0, 0, 0],
    });

    expect(pageSubsystemReArm(previous, next)).toEqual(NO_GROUPS);
  });

  it('maps each changed field to exactly the subsystems that own it', () => {
    const base = snapshot();
    expect(pageSubsystemReArm(base, snapshot({ backgroundPlayEnabled: false }))).toEqual({
      ...NO_GROUPS,
      visibility: true,
      idleNag: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ idleNagDefeatEnabled: false }))).toEqual({
      ...NO_GROUPS,
      idleNag: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ adBlockEnabled: false }))).toEqual({
      ...NO_GROUPS,
      scriptlets: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ forceQualityMax: '144p' }))).toEqual({
      ...NO_GROUPS,
      qualityOfLife: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ disableAutoplayNext: true }))).toEqual({
      ...NO_GROUPS,
      qualityOfLife: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ segmentSkipEnabled: true }))).toEqual({
      ...NO_GROUPS,
      segments: true,
    });
    expect(
      pageSubsystemReArm(base, snapshot({ segmentSkipCategories: ['sponsor', 'music_offtopic'] }))
    ).toEqual({ ...NO_GROUPS, segments: true });
    expect(pageSubsystemReArm(base, snapshot({ fallbackQualityCapEnabled: false }))).toEqual({
      ...NO_GROUPS,
      fallbackQuality: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ audioOnlyEnabled: false }))).toEqual({
      ...NO_GROUPS,
      media: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ audioArtworkEnabled: false }))).toEqual({
      ...NO_GROUPS,
      media: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ loudnessNormalization: false }))).toEqual({
      ...NO_GROUPS,
      graph: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ equalizerEnabled: true }))).toEqual({
      ...NO_GROUPS,
      graph: true,
    });
    expect(pageSubsystemReArm(base, snapshot({ equalizerBands: [1, 0, 0, 0, 0] }))).toEqual({
      ...NO_GROUPS,
      graph: true,
    });
  });

  it('re-arms every gated subsystem when the master switch flips', () => {
    expect(pageSubsystemReArm(snapshot(), snapshot({ enabled: false }))).toEqual({
      ...NO_GROUPS,
      visibility: true,
      idleNag: true,
      scriptlets: true,
      qualityOfLife: true,
      segments: true,
      fallbackQuality: true,
      media: true,
    });
  });

  it('leaves request-time settings out of every group', () => {
    // downloadEnabled is read when a download is requested; nothing re-arms for it.
    expect(pageSubsystemReArm(snapshot(), snapshot({ downloadEnabled: true }))).toEqual(NO_GROUPS);
  });
});

describe('settingsFieldChanged', () => {
  it('compares array fields by content and everything else by identity', () => {
    const previous = { flag: true, bands: [1, 2] };
    expect(settingsFieldChanged(previous, { flag: true, bands: [1, 2] }, ['bands'])).toBe(false);
    expect(settingsFieldChanged(previous, { flag: true, bands: [1, 3] }, ['bands'])).toBe(true);
    expect(settingsFieldChanged(previous, { flag: true, bands: [1, 2, 3] }, ['bands'])).toBe(true);
    expect(settingsFieldChanged(previous, { flag: false, bands: [1, 2] }, ['flag'])).toBe(true);
    expect(settingsFieldChanged(null, { flag: true, bands: [] }, ['flag'])).toBe(true);
  });
});

describe('settingsEqual', () => {
  it('accepts identical snapshots with fresh array references', () => {
    expect(settingsEqual({ ...DEFAULT_SETTINGS }, { ...DEFAULT_SETTINGS })).toBe(true);
    expect(
      settingsEqual(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        segmentSkipCategories: [...DEFAULT_SETTINGS.segmentSkipCategories],
        equalizerBands: [...DEFAULT_SETTINGS.equalizerBands],
      })
    ).toBe(true);
  });

  it('flags scalar and array-content differences', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, enabled: false })).toBe(false);
    expect(
      settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, equalizerBands: [1, 0, 0, 0, 0] })
    ).toBe(false);
    expect(
      settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, segmentSkipCategories: [] })
    ).toBe(false);
  });
});
