// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Options, type OptionsActions } from '../../../entrypoints/options/App';
import {
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

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
  audioOnlyEnabledSignal.value = true;
  segmentSkipEnabledSignal.value = true;
  equalizerEnabledSignal.value = false;
});

describe('Options', () => {
  it('renders every settings group with accessible switches', () => {
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
      'Protection & Ghost',
      'Enhancers',
      'Music',
      'Advanced',
      'Help & feedback',
    ]);
    expect(switches).toHaveLength(17);
    expect(switches.every((control) => control.hasAttribute('aria-label'))).toBe(true);
    expect(switches.every((control) => control.hasAttribute('aria-checked'))).toBe(true);
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

  it('hides SponsorBlock category rows when segment skipping is disabled', () => {
    segmentSkipEnabledSignal.value = false;
    const container = mount(<Options actions={actions()} />);

    expect(container.querySelector('#option-skip [role="switch"]')).not.toBeNull();
    expect(container.querySelector('#option-sponsor')).toBeNull();
    expect(container.querySelector('#option-music_offtopic')).toBeNull();
    expect(container.textContent).not.toContain('Sponsored segments');
    expect(container.textContent).not.toContain('Non-music segments');
  });

  it('shows SponsorBlock category rows when segment skipping is enabled', () => {
    segmentSkipEnabledSignal.value = true;
    const container = mount(<Options actions={actions()} />);

    const categoryRows = container.querySelectorAll(
      '#option-sponsor.nested-row, #option-music_offtopic.nested-row'
    );
    expect(categoryRows).toHaveLength(2);
    expect(container.querySelector('#option-sponsor [role="switch"]')).not.toBeNull();
    expect(container.querySelector('#option-music_offtopic [role="switch"]')).not.toBeNull();
    expect(container.textContent).toContain('Sponsored segments');
    expect(container.textContent).toContain('Non-music segments');
  });

  it('hides equalizer band controls when the equalizer is disabled', () => {
    equalizerEnabledSignal.value = false;
    const container = mount(<Options actions={actions()} />);

    expect(container.querySelector('#option-equalizer [role="switch"]')).not.toBeNull();
    expect(container.querySelector('.range-grid')).toBeNull();
    expect(container.querySelector('[aria-label="60 Hz gain"]')).toBeNull();
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);
  });

  it('shows equalizer band controls when the equalizer is enabled', () => {
    equalizerEnabledSignal.value = true;
    const container = mount(<Options actions={actions()} />);

    const bandControls = Array.from(container.querySelectorAll('input[type="range"]'));
    expect(container.querySelector('#option-equalizer [role="switch"]')).not.toBeNull();
    expect(container.querySelector('.range-grid')).not.toBeNull();
    expect(bandControls).toHaveLength(5);
    expect(bandControls.map((control) => control.getAttribute('aria-label'))).toEqual([
      '60 Hz gain',
      '250 Hz gain',
      '1000 Hz gain',
      '4000 Hz gain',
      '12000 Hz gain',
    ]);
  });

  it('filters settings across sections from the persistent search field', () => {
    const container = mount(<Options actions={actions()} />);
    const search = container.querySelector('input[type="search"]');
    if (!(search instanceof HTMLInputElement)) throw new Error('Expected settings search');

    act(() => {
      search.value = 'lyrics';
      search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('Synced lyrics');
    expect(container.textContent).not.toContain('Hide Shorts');
    expect(container.textContent).not.toContain('Maximum video quality');
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
