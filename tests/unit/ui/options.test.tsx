// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Options, type OptionsActions } from '../../../entrypoints/options/App';
import { audioOnlyEnabledSignal } from '../../../src/shared/config';

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
});

describe('Options', () => {
  it('renders every settings group with accessible switches', () => {
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
    expect(switches.length).toBeGreaterThan(12);
    expect(switches.every((control) => control.hasAttribute('aria-label'))).toBe(true);
    expect(switches.every((control) => control.hasAttribute('aria-checked'))).toBe(true);
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

    click(container.querySelector('#option-audio-only [role="switch"]'));
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
