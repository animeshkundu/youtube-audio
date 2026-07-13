// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Options, type OptionsActions } from '../../../entrypoints/options/App';
import {
  adBlockEnabledSignal,
  aggressiveTelemetrySignal,
  audioOnlyEnabledSignal,
  equalizerEnabledSignal,
  segmentSkipEnabledSignal,
} from '../../../src/shared/settings-signals';

function actions(): OptionsActions {
  return {
    setEnabled: vi.fn(async () => undefined),
    setAudioOnlyEnabled: vi.fn(async () => undefined),
    setBackgroundPlayEnabled: vi.fn(async () => undefined),
    setAdBlockEnabled: vi.fn(async () => undefined),
    setGhostEnabled: vi.fn(async () => undefined),
    setSegmentSkipEnabled: vi.fn(async () => undefined),
    setSegmentSkipCategory: vi.fn(async () => undefined),
    setQualityOfLifeSetting: vi.fn(async () => undefined),
    setMusicSetting: vi.fn(async () => undefined),
    setEqualizerBand: vi.fn(async () => undefined),
    setForceQualityMax: vi.fn(async () => undefined),
    setDownloadEnabled: vi.fn(async () => undefined),
    setAggressiveTelemetry: vi.fn(async () => undefined),
    resetSettings: vi.fn(async () => undefined),
    markOnboardingSeen: vi.fn(async () => undefined),
    openYouTube: vi.fn(),
  };
}

function mount(component: ComponentChild): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  render(component, container);
  return container;
}

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('Expected a clickable element');
  act(() => element.click());
}

function searchFor(container: HTMLElement, query: string): void {
  const search = container.querySelector('input[type="search"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('Expected settings search');
  act(() => {
    search.value = query;
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
  adBlockEnabledSignal.value = true;
  aggressiveTelemetrySignal.value = false;
  audioOnlyEnabledSignal.value = true;
  segmentSkipEnabledSignal.value = true;
  equalizerEnabledSignal.value = false;
});

describe('Options', () => {
  it('renders every intent-named settings group with accessible switches', () => {
    segmentSkipEnabledSignal.value = true;
    equalizerEnabledSignal.value = false;
    const container = mount(<Options actions={actions()} />);
    const headings = Array.from(container.querySelectorAll('h2')).map(
      (heading) => heading.textContent
    );
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));

    expect(headings).toEqual([
      'Quick Controls',
      'Playback',
      'Privacy & Blocking',
      'Skipping',
      'Cleaner YouTube',
      'Music',
      'Downloads',
      'Advanced/About',
      'Help & feedback',
    ]);
    expect(switches).toHaveLength(16);
    expect(switches.every((control) => control.hasAttribute('aria-label'))).toBe(true);
    expect(switches.every((control) => control.hasAttribute('aria-checked'))).toBe(true);
    expect(container.querySelectorAll('.setting-description')).toHaveLength(15);
    expect(container.querySelector('.settings-nav a[aria-current="true"]')?.textContent).toContain(
      'Quick Controls'
    );
  });

  it('keeps Audio-only and Background play only in Quick Controls', () => {
    const container = mount(<Options actions={actions()} />);
    const quickControls = container.querySelector('#quick-controls');
    const playback = container.querySelector('#playback');

    expect(quickControls).not.toBeNull();
    expect(playback).not.toBeNull();
    expect(quickControls?.querySelector('#audio-only-page [role="switch"]')).not.toBeNull();
    expect(quickControls?.querySelector('#background-play-page [role="switch"]')).not.toBeNull();
    expect(playback?.querySelector('#option-audio-only')).toBeNull();
    expect(playback?.querySelector('#option-background')).toBeNull();
    expect(playback?.querySelector('[role="switch"][aria-label="Audio-only"]')).toBeNull();
    expect(
      playback?.querySelector('[role="switch"][aria-label="Background & lock-screen play"]')
    ).toBeNull();
    expect(container.querySelectorAll('[role="switch"][aria-label="Audio-only"]')).toHaveLength(1);
    expect(
      container.querySelectorAll('[role="switch"][aria-label="Background play"]')
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[role="switch"][aria-label="Background & lock-screen play"]')
    ).toHaveLength(0);
  });

  it('marks Block ads and Aggressive telemetry as high impact with text chips', () => {
    aggressiveTelemetrySignal.value = true;
    const container = mount(<Options actions={actions()} />);
    const highImpactRows = container.querySelectorAll('.setting-row.is-high-impact');
    const chips = Array.from(container.querySelectorAll('.high-impact-badge'));

    expect(highImpactRows).toHaveLength(2);
    expect(container.querySelector('#option-ads.is-high-impact')).not.toBeNull();
    expect(container.querySelector('#option-aggressive.is-high-impact')).not.toBeNull();
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.textContent)).toEqual(['High impact', 'High impact']);
    expect(container.querySelector('#option-ads .setting-consequence')?.textContent).toBe(
      'May rarely affect playback.'
    );
    expect(container.querySelector('#option-aggressive .setting-consequence')?.textContent).toBe(
      'Your history and resume-where-you-left-off may stop working.'
    );
  });

  it('keeps SponsorBlock category rows absent until segment skipping is enabled', () => {
    segmentSkipEnabledSignal.value = false;
    const container = mount(<Options actions={actions()} />);

    expect(container.querySelector('#option-skip [role="switch"]')).not.toBeNull();
    expect(container.querySelector('#option-sponsor')).toBeNull();
    expect(container.querySelector('#option-music_offtopic')).toBeNull();
    expect(container.querySelector('#skipping .dependent-reveal')).toBeNull();

    act(() => {
      segmentSkipEnabledSignal.value = true;
    });

    const categoryRows = container.querySelectorAll(
      '#option-sponsor.nested-row, #option-music_offtopic.nested-row'
    );
    expect(categoryRows).toHaveLength(2);
    expect(container.querySelector('#skipping .dependent-reveal')).not.toBeNull();
    expect(container.querySelector('#option-sponsor [role="switch"]')).not.toBeNull();
    expect(container.querySelector('#option-music_offtopic [role="switch"]')).not.toBeNull();

    act(() => {
      segmentSkipEnabledSignal.value = false;
    });
    expect(container.querySelector('#option-sponsor')).toBeNull();
    expect(container.querySelector('#option-music_offtopic')).toBeNull();
  });

  it('keeps equalizer bands absent until the equalizer is enabled', () => {
    equalizerEnabledSignal.value = false;
    const container = mount(<Options actions={actions()} />);

    expect(container.querySelector('#option-equalizer [role="switch"]')).not.toBeNull();
    expect(container.querySelector('.range-grid')).toBeNull();
    expect(container.querySelector('[aria-label="60 Hz gain"]')).toBeNull();
    expect(container.querySelector('#music .dependent-reveal')).toBeNull();

    act(() => {
      equalizerEnabledSignal.value = true;
    });

    const bandControls = Array.from(container.querySelectorAll('input[type="range"]'));
    expect(container.querySelector('#music .dependent-reveal')).not.toBeNull();
    expect(container.querySelector('.range-grid')).not.toBeNull();
    expect(bandControls).toHaveLength(5);
    expect(bandControls.map((control) => control.getAttribute('aria-label'))).toEqual([
      '60 Hz gain',
      '250 Hz gain',
      '1000 Hz gain',
      '4000 Hz gain',
      '12000 Hz gain',
    ]);

    act(() => {
      equalizerEnabledSignal.value = false;
    });
    expect(container.querySelector('.range-grid')).toBeNull();
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);
  });

  it('filters settings across sections from row labels and descriptions', () => {
    const container = mount(<Options actions={actions()} />);

    searchFor(container, 'equalizer adjustments');

    expect(container.textContent).toContain('Equalizer');
    expect(container.querySelector('#music')).not.toBeNull();
    expect(container.querySelector('#cleaner-youtube')).toBeNull();
    expect(container.querySelector('#playback')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.settings-nav a')).map((link) => link.textContent)
    ).toEqual(['●Music']);
  });

  it('keeps synced lyrics hidden from settings and search', () => {
    const container = mount(<Options actions={actions()} />);

    expect(container.querySelector('#option-lyrics')).toBeNull();
    expect(container.textContent).not.toContain('Synced lyrics');

    searchFor(container, 'lyrics');

    expect(container.querySelector('#music')).toBeNull();
    expect(container.querySelector('.empty-search[role="status"]')).not.toBeNull();
  });

  it('does not render an empty Playback card for removed Audio-only or Background terms', () => {
    const container = mount(<Options actions={actions()} />);

    searchFor(container, 'audio-only');
    expect(container.querySelector('#audio-only-page')).not.toBeNull();
    expect(container.querySelector('#playback')).toBeNull();
    expect(container.querySelector('a[href="#playback"]')).toBeNull();

    searchFor(container, 'background');
    expect(container.querySelector('#background-play-page')).not.toBeNull();
    expect(container.querySelector('#playback')).toBeNull();
    expect(container.querySelector('a[href="#playback"]')).toBeNull();
  });

  it('renders the empty-search status and hides all nav links when nothing matches', () => {
    const container = mount(<Options actions={actions()} />);

    searchFor(container, 'no-setting-has-this-value');

    const empty = container.querySelector('.empty-search[role="status"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No settings match “no-setting-has-this-value”.');
    expect(empty?.textContent).toContain('Clear search');
    expect(container.querySelectorAll('.settings-section')).toHaveLength(0);
    expect(container.querySelectorAll('.settings-nav a')).toHaveLength(0);
  });

  it('shows a rejected setter as an inline alert next to its row', async () => {
    const optionsActions = actions();
    optionsActions.setAdBlockEnabled = vi.fn(async (checked) => {
      adBlockEnabledSignal.value = checked;
      await Promise.resolve();
      adBlockEnabledSignal.value = !checked;
      throw new Error('storage failed');
    });
    const container = mount(<Options actions={optionsActions} />);

    click(container.querySelector('#option-ads [role="switch"]'));
    await flushPromises();

    expect(optionsActions.setAdBlockEnabled).toHaveBeenCalledWith(false);
    const alert = container.querySelector('#option-ads [role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toBe("Couldn't apply that change. Try again.");
    const adSwitch = container.querySelector('#option-ads [role="switch"]');
    expect(adSwitch?.getAttribute('aria-checked')).toBe('true');
    expect(adSwitch?.getAttribute('aria-describedby')).toContain('option-ads-error');
  });

  it('instant-applies options controls', () => {
    const optionsActions = actions();
    const container = mount(<Options actions={optionsActions} />);

    click(container.querySelector('#audio-only-page [role="switch"]'));
    click(container.querySelector('#option-ads [role="switch"]'));
    click(container.querySelector('#option-download [role="switch"]'));

    expect(optionsActions.setAudioOnlyEnabled).toHaveBeenCalledWith(false);
    expect(optionsActions.setAdBlockEnabled).toHaveBeenCalledWith(false);
    expect(optionsActions.setDownloadEnabled).toHaveBeenCalledWith(true);
  });

  it('resets only after confirmation and shows a success toast', async () => {
    const optionsActions = actions();
    const container = mount(<Options actions={optionsActions} />);

    click(container.querySelector('.action-row .secondary-action'));
    expect(optionsActions.resetSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Confirm reset"]')).not.toBeNull();

    click(container.querySelector('.reset-confirmation .secondary-action.is-danger'));
    await flushPromises();

    expect(optionsActions.resetSettings).toHaveBeenCalledOnce();
    expect(container.querySelector('.options-toast[role="status"]')?.textContent).toBe(
      'Settings reset to defaults.'
    );
  });

  it('shows onboarding once and persists dismissal', async () => {
    const optionsActions = actions();
    const container = mount(<Options actions={optionsActions} showOnboardingInitially />);

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    click(container.querySelector('.text-action'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(optionsActions.markOnboardingSeen).toHaveBeenCalledOnce();

    render(<Options actions={optionsActions} showOnboardingInitially={false} />, container);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
