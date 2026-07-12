// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Popup, type PopupActions } from '../../../entrypoints/popup/App';
import { playbackStatusSignal } from '../../../entrypoints/popup/playback-status';
import {
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  enabledSignal,
} from '../../../src/shared/settings-signals';

function actions(): PopupActions {
  return {
    setEnabled: vi.fn(async () => undefined),
    setAudioOnlyEnabled: vi.fn(async () => undefined),
    setBackgroundPlayEnabled: vi.fn(async () => undefined),
    openOptions: vi.fn(),
    openYouTube: vi.fn(),
  };
}

const mountedContainers = new Set<HTMLElement>();

function mount(component: ComponentChild): HTMLElement {
  const container = document.createElement('div');
  mountedContainers.add(container);
  document.body.append(container);
  render(component, container);
  return container;
}

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('Expected a clickable element');
  act(() => element.click());
}

afterEach(() => {
  act(() => {
    for (const container of mountedContainers) render(null, container);
  });
  mountedContainers.clear();
  document.body.replaceChildren();
  playbackStatusSignal.value = { kind: 'connecting' };
  enabledSignal.value = true;
  audioOnlyEnabledSignal.value = true;
  backgroundPlayEnabledSignal.value = true;
});

describe('Popup', () => {
  it('active renders the audio-only on hero with a pulse', () => {
    audioOnlyEnabledSignal.value = false;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');
    const audioOnlySwitch = container.querySelector('[role="switch"][aria-label="Audio-only"]');

    expect(hero?.textContent).toContain('Audio-only on. Video muted, battery saved.');
    expect(hero?.classList.contains('is-active')).toBe(true);
    expect(hero?.querySelector('.now-playing')).not.toBeNull();
    expect(audioOnlySwitch?.getAttribute('aria-checked')).toBe('false');
    expect(
      Array.from(container.querySelectorAll('[role="switch"]'), (control) =>
        control.getAttribute('aria-label')
      )
    ).toEqual(['Audio-only', 'Background play']);
    expect(container.textContent).not.toContain('Current page');
    expect(container.textContent).not.toContain('Ready');
    expect(container.textContent).not.toContain('Segment skipping');
  });

  it('updates the hero live when playback status changes', () => {
    playbackStatusSignal.value = { kind: 'connecting' };
    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain('Checking this tab...');
    expect(hero?.querySelector('.now-playing')).toBeNull();

    act(() => {
      playbackStatusSignal.value = { kind: 'active' };
    });

    expect(hero?.textContent).toContain('Audio-only on. Video muted, battery saved.');
    expect(hero?.querySelector('.now-playing')).not.toBeNull();
  });

  it('live fallback renders playing normally without Active or a pulse', () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'fallback', reason: 'live' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain('Live stream, playing normally.');
    expect(hero?.textContent).not.toContain('Active');
    expect(hero?.classList.contains('is-active')).toBe(false);
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it("unplayable fallback renders the isn't available message", () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'fallback', reason: 'unplayable' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain(
      "Audio-only isn't available on this video. Playing normally."
    );
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it('connecting renders the checking state without an optimistic label', () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'connecting' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain('Checking this tab...');
    expect(hero?.textContent).not.toContain('Audio-only on');
    expect(hero?.textContent).not.toContain('Active');
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it('not-youtube renders the empty state action without toggles', () => {
    playbackStatusSignal.value = { kind: 'not-youtube' };
    const popupActions = actions();

    const container = mount(<Popup actions={popupActions} />);
    const openYouTube = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Open YouTube'
    );

    expect(container.textContent).toContain('Open YouTube to start');
    expect(openYouTube).toBeDefined();
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(container.querySelector('.popup-hero')).toBeNull();
    expect(container.querySelector('.popup-secondary-card')).toBeNull();

    click(openYouTube ?? null);
    expect(popupActions.openYouTube).toHaveBeenCalledOnce();
  });

  it('disabled renders the audio-only off copy', () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'disabled' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain('Audio-only off. Video plays normally.');
    expect(hero?.textContent).not.toContain('Audio-only on');
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it('instant-applies popup controls and opens full settings', () => {
    playbackStatusSignal.value = { kind: 'active' };
    const popupActions = actions();
    const container = mount(<Popup actions={popupActions} />);

    click(container.querySelector('[aria-label="Audio-only"]'));
    click(container.querySelector('[aria-label="Background play"]'));
    click(container.querySelector('.popup-pause-action'));
    click(container.querySelector('[aria-label="Open settings"]'));

    expect(popupActions.setAudioOnlyEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.setBackgroundPlayEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.setEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.openOptions).toHaveBeenCalledOnce();
  });
});
