// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultActions, Popup, type PopupActions } from '../../../entrypoints/popup/App';
import { consentSignal } from '../../../entrypoints/popup/consent-state';
import { playbackStatusSignal } from '../../../entrypoints/popup/playback-status';
import { tabAudioOnlyOverrideSignal } from '../../../entrypoints/popup/tab-scope';
import {
  adBlockEnabledSignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  enabledSignal,
  fallbackQualityCapEnabledSignal,
  forceQualityMaxSignal,
  ghostEnabledSignal,
  loudnessNormalizationSignal,
} from '../../../src/shared/settings-signals';

function actions(): PopupActions {
  return {
    setEnabled: vi.fn(async () => undefined),
    setBackgroundPlayEnabled: vi.fn(async () => undefined),
    openOptions: vi.fn(),
    openYouTube: vi.fn(),
    openConsentSettings: vi.fn(),
    setTabAudioOnly: vi.fn(async () => undefined),
    openBlockingSettings: vi.fn(),
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

beforeEach(() => {
  // Most cases exercise a granted install; the consent-specific cases override this.
  consentSignal.value = {
    granted: true,
    sponsorBlockAllowed: false,
    source: 'firefox',
    pending: false,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    for (const container of mountedContainers) render(null, container);
  });
  mountedContainers.clear();
  document.body.replaceChildren();
  playbackStatusSignal.value = { kind: 'connecting' };
  enabledSignal.value = true;
  audioOnlyEnabledSignal.value = true;
  backgroundPlayEnabledSignal.value = true;
  loudnessNormalizationSignal.value = true;
  fallbackQualityCapEnabledSignal.value = true;
  forceQualityMaxSignal.value = 'off';
  adBlockEnabledSignal.value = false;
  ghostEnabledSignal.value = true;
  tabAudioOnlyOverrideSignal.value = null;
});

describe('Popup', () => {
  it('active renders the audio-only on hero with a pulse', () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');
    const audioOnlySwitch = container.querySelector('[role="switch"][aria-label="Audio-only"]');

    expect(hero?.textContent).toContain('Audio-only on. No video loaded, data saved.');
    expect(hero?.classList.contains('is-active')).toBe(true);
    expect(hero?.querySelector('.now-playing')).not.toBeNull();
    expect(audioOnlySwitch?.getAttribute('aria-checked')).toBe('true');
    expect(
      Array.from(container.querySelectorAll('[role="switch"]'), (control) =>
        control.getAttribute('aria-label')
      )
    ).toEqual(['Audio-only', 'Background play']);
    expect(container.textContent).not.toContain('Current page');
    expect(container.textContent).not.toContain('Ready');
    expect(container.textContent).not.toContain('Segment skipping');
  });

  it('audio-only off with loudness normalization on does not render the on copy or pulse', () => {
    audioOnlyEnabledSignal.value = false;
    loudnessNormalizationSignal.value = true;
    // Defend against a stale enhancement result that still reports the old incorrect status.
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');
    const audioOnlySwitch = container.querySelector('[role="switch"][aria-label="Audio-only"]');

    expect(audioOnlySwitch?.getAttribute('aria-checked')).toBe('false');
    expect(hero?.textContent).toContain('Audio-only off. Video plays normally.');
    expect(hero?.textContent).not.toContain('Audio-only on. No video loaded, data saved.');
    expect(hero?.classList.contains('is-active')).toBe(false);
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it('paused extension does not render the audio-only on hero even while the toggle is on', () => {
    // Global Pause flips enabledSignal immediately; the page-world `disabled` status has not yet
    // round-tripped. Until it does, the hero must not keep claiming audio-only is active.
    enabledSignal.value = false;
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain('Audio-only off. Video plays normally.');
    expect(hero?.textContent).not.toContain('Audio-only on. No video loaded, data saved.');
    expect(hero?.classList.contains('is-active')).toBe(false);
    expect(hero?.querySelector('.now-playing')).toBeNull();
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

    expect(hero?.textContent).toContain('Audio-only on. No video loaded, data saved.');
    expect(hero?.querySelector('.now-playing')).not.toBeNull();
  });

  it('live fallback names the low-quality save when the fallback cap is engaged', () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'fallback', reason: 'live', host: 'youtube' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain('Live stream, playing at low quality to save data.');
    expect(hero?.textContent).not.toContain('Active');
    expect(hero?.classList.contains('is-active')).toBe(false);
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it("unplayable fallback renders the isn't available message with the cap note", () => {
    audioOnlyEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'fallback', reason: 'unplayable', host: 'youtube' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');

    expect(hero?.textContent).toContain(
      "Audio-only isn't available on this video. Playing at low quality to save data."
    );
    expect(hero?.querySelector('.now-playing')).toBeNull();
  });

  it('fallback copy stays normal when the cap setting is off', () => {
    fallbackQualityCapEnabledSignal.value = false;
    playbackStatusSignal.value = { kind: 'fallback', reason: 'live', host: 'youtube' };

    const container = mount(<Popup actions={actions()} />);

    expect(container.querySelector('.popup-hero')?.textContent).toContain(
      'Live stream, playing normally.'
    );
  });

  it('fallback copy stays normal while a user maximum quality is set', () => {
    forceQualityMaxSignal.value = '720p';
    playbackStatusSignal.value = { kind: 'fallback', reason: 'unplayable', host: 'youtube' };

    const container = mount(<Popup actions={actions()} />);

    expect(container.querySelector('.popup-hero')?.textContent).toContain(
      "Audio-only isn't available on this video. Playing normally."
    );
  });

  it('Music fallback prefers the song wording when the cap is engaged', () => {
    playbackStatusSignal.value = { kind: 'fallback', reason: 'unplayable', host: 'music' };

    const container = mount(<Popup actions={actions()} />);

    expect(container.querySelector('.popup-hero')?.textContent).toContain(
      "Audio-only isn't available on this video. Playing the song to save data."
    );
  });

  it('Music live fallback still names low quality (a live stream has no song counterpart)', () => {
    playbackStatusSignal.value = { kind: 'fallback', reason: 'live', host: 'music' };

    const container = mount(<Popup actions={actions()} />);

    expect(container.querySelector('.popup-hero')?.textContent).toContain(
      'Live stream, playing at low quality to save data.'
    );
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

  it('renders the per-tab override over the global preference', () => {
    audioOnlyEnabledSignal.value = true;
    tabAudioOnlyOverrideSignal.value = false;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');
    const audioOnlySwitch = container.querySelector('[role="switch"][aria-label="Audio-only"]');

    expect(audioOnlySwitch?.getAttribute('aria-checked')).toBe('false');
    expect(hero?.textContent).toContain('Audio-only off. Video plays normally.');
    expect(hero?.textContent).not.toContain('Audio-only on. No video loaded, data saved.');
    expect(hero?.textContent).toContain('This tab');
  });

  it('an explicit tab override turns the hero on while the global preference is off', () => {
    audioOnlyEnabledSignal.value = false;
    tabAudioOnlyOverrideSignal.value = true;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const hero = container.querySelector('.popup-hero');
    const audioOnlySwitch = container.querySelector('[role="switch"][aria-label="Audio-only"]');

    expect(audioOnlySwitch?.getAttribute('aria-checked')).toBe('true');
    expect(hero?.classList.contains('is-active')).toBe(true);
    expect(hero?.textContent).toContain('Audio-only on. No video loaded, data saved.');
  });

  it('instant-applies popup controls (audio-only to the tab) and opens full settings', () => {
    playbackStatusSignal.value = { kind: 'active' };
    const popupActions = actions();
    const container = mount(<Popup actions={popupActions} />);

    click(container.querySelector('[aria-label="Audio-only"]'));
    click(container.querySelector('[aria-label="Background play"]'));
    click(container.querySelector('.popup-pause-action'));
    click(container.querySelector('[aria-label="Open settings"]'));

    expect(popupActions.setTabAudioOnly).toHaveBeenCalledWith(false);
    expect(popupActions.setBackgroundPlayEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.setEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.openOptions).toHaveBeenCalledOnce();
  });

  it.each([[true], [false]])(
    'denied consent (pending=%s) replaces every playback control with the consent card',
    (pending: boolean) => {
      consentSignal.value = {
        granted: false,
        sponsorBlockAllowed: false,
        source: 'custom',
        pending,
      };
      playbackStatusSignal.value = { kind: 'active' };
      const popupActions = actions();

      const container = mount(<Popup actions={popupActions} />);

      expect(container.textContent).toContain('Almost there');
      expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
      expect(container.querySelector('.popup-hero')).toBeNull();
      expect(container.querySelector('.popup-pause-action')).toBeNull();
      expect(container.querySelector('.now-playing')).toBeNull();

      click(container.querySelector('.popup-consent-state .primary-action'));
      expect(popupActions.openConsentSettings).toHaveBeenCalledOnce();
    }
  );

  it('unresolved consent renders only the header, never a dead control', () => {
    consentSignal.value = null;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);

    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(container.querySelector('.popup-hero')).toBeNull();
    expect(container.textContent).not.toContain('Almost there');
  });

  it('the default consent action deep-links to the options Data & consent section', () => {
    const create = vi.fn();
    vi.stubGlobal('browser', {
      tabs: { create },
      runtime: { getURL: (path: string) => `moz-extension://test/${path.replace(/^\//, '')}` },
    });

    defaultActions.openConsentSettings();

    expect(create).toHaveBeenCalledWith({
      url: 'moz-extension://test/options.html#data-consent',
    });
  });

  it('routes the protection line to Privacy & Blocking when ad blocking is not active', () => {
    // jsdom has no browser.permissions, so the grant check resolves false: setting-only state
    // can never over-claim here.
    adBlockEnabledSignal.value = false;
    ghostEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'active' };
    const popupActions = actions();

    const container = mount(<Popup actions={popupActions} />);
    const line = container.querySelector('.popup-protection-line');

    expect(line?.textContent).toContain('Ads play normally. Turn on ad blocking.');
    expect(line?.textContent).toContain('Ghost needs access.');
    click(line);
    expect(popupActions.openBlockingSettings).toHaveBeenCalledOnce();
    expect(popupActions.openOptions).not.toHaveBeenCalled();
  });

  it('claims Ghost only when the network grant backs it', () => {
    adBlockEnabledSignal.value = true;
    ghostEnabledSignal.value = true;
    playbackStatusSignal.value = { kind: 'active' };

    const container = mount(<Popup actions={actions()} />);
    const line = container.querySelector('.popup-protection-line');

    // No browser.permissions in jsdom: nothing may claim to block.
    expect(line?.textContent).toContain('Ads play normally. Turn on ad blocking.');
    expect(line?.textContent).toContain('Ghost needs access.');
    expect(line?.textContent).not.toContain('Ghost on.');
  });
});
