// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerOnboardingInstallHandler,
  shouldOpenOnboarding,
} from '../../../entrypoints/background';
import { Options, type OptionsActions } from '../../../entrypoints/options/App';

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
  act(() => render(component, container));
  return container;
}

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('Expected a clickable element');
  act(() => element.click());
}

function pressKey(key: string, shiftKey = false): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });
}

afterEach(() => {
  act(() => render(null, document.body));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('onboarding install trigger', () => {
  function registeredListener(openOptionsPage: ReturnType<typeof vi.fn>) {
    const addListener = vi.fn();
    vi.stubGlobal('browser', { runtime: { openOptionsPage, onInstalled: { addListener } } });

    registerOnboardingInstallHandler();

    expect(addListener).toHaveBeenCalledOnce();
    const listener = addListener.mock.calls[0]?.[0] as
      | ((details: { reason: 'install' | 'update' }) => void)
      | undefined;
    if (!listener) throw new Error('Expected an onboarding install listener');
    return listener;
  }

  it('opens the options welcome exactly once for a fresh install', () => {
    const openOptionsPage = vi.fn(async () => undefined);
    const listener = registeredListener(openOptionsPage);
    const details = { reason: 'install' as const };

    expect(shouldOpenOnboarding(details)).toBe(true);
    listener(details);

    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it('does not open the options welcome for an update', () => {
    const openOptionsPage = vi.fn(async () => undefined);
    const listener = registeredListener(openOptionsPage);
    const details = { reason: 'update' as const };

    expect(shouldOpenOnboarding(details)).toBe(false);
    listener(details);

    expect(openOptionsPage).not.toHaveBeenCalled();
  });
});

describe('opaque options onboarding', () => {
  it('renders as the only options surface, persists dismissal, and stays dismissed on rerender', () => {
    let seenOnboarding = false;
    const optionsActions = actions();
    optionsActions.markOnboardingSeen = vi.fn(async () => {
      seenOnboarding = true;
    });
    const container = mount(<Options actions={optionsActions} showOnboardingInitially />);
    const dialog = container.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(
      container.querySelector('.options-app-onboarding > .onboarding-backdrop')
    ).not.toBeNull();
    expect(container.querySelector('.options-header')).toBeNull();
    expect(container.querySelector('.settings-content')).toBeNull();
    expect(container.textContent).not.toContain('Quick Controls');
    expect(container.textContent).toContain('Nothing to set up.');
    expect(container.textContent).toContain(
      'While a video plays, tap ♪ in the player to switch between audio and video.'
    );
    expect(container.textContent).toContain(
      'Runs without your account, and sends nothing about you anywhere.'
    );

    click(container.querySelector('.text-action'));

    expect(optionsActions.markOnboardingSeen).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.settings-content')).not.toBeNull();
    expect(container.textContent).toContain('Quick Controls');

    expect(seenOnboarding).toBe(true);
    act(() => render(null, container));
    act(() =>
      render(
        <Options actions={optionsActions} showOnboardingInitially={!seenOnboarding} />,
        container
      )
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.settings-content')).not.toBeNull();
    expect(optionsActions.markOnboardingSeen).toHaveBeenCalledOnce();
  });

  it('sets initial focus, traps Tab in the welcome, and dismisses once with Escape', () => {
    const optionsActions = actions();
    const container = mount(<Options actions={optionsActions} showOnboardingInitially />);
    const primary = container.querySelector('.primary-action');
    const secondary = container.querySelector('.text-action');
    if (!(primary instanceof HTMLButtonElement) || !(secondary instanceof HTMLButtonElement)) {
      throw new Error('Expected onboarding actions');
    }

    expect(document.activeElement).toBe(primary);

    secondary.focus();
    pressKey('Tab');
    expect(document.activeElement).toBe(primary);

    pressKey('Tab', true);
    expect(document.activeElement).toBe(secondary);

    pressKey('Escape');
    pressKey('Escape');

    expect(optionsActions.markOnboardingSeen).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.settings-content')).not.toBeNull();
  });
});
