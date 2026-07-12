// @vitest-environment jsdom

import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Popup, type PopupActions } from '../../../entrypoints/popup/App';
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
  enabledSignal.value = true;
  audioOnlyEnabledSignal.value = true;
  backgroundPlayEnabledSignal.value = true;
});

describe('Popup', () => {
  it('renders the focused quick controls and accessible switch state', () => {
    const container = mount(<Popup actions={actions()} />);
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));

    expect(container.textContent).toContain('YouTube Audio');
    expect(container.textContent).toContain('Audio-only');
    expect(container.textContent).toContain('Background play');
    expect(container.textContent).toContain('Segment skipping');
    expect(container.textContent).toContain('Ads and tracking');
    expect(switches).toHaveLength(3);
    expect(switches.map((control) => control.getAttribute('aria-label'))).toEqual([
      'YouTube Audio',
      'Audio-only',
      'Background play',
    ]);
    expect(switches.every((control) => control.getAttribute('aria-checked') === 'true')).toBe(true);
  });

  it('instant-applies toggles and opens full settings', () => {
    const popupActions = actions();
    const container = mount(<Popup actions={popupActions} />);

    click(container.querySelector('[aria-label="Audio-only"]'));
    click(container.querySelector('[aria-label="Background play"]'));
    click(container.querySelector('[aria-label="Open settings"]'));

    expect(popupActions.setAudioOnlyEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.setBackgroundPlayEnabled).toHaveBeenCalledWith(false);
    expect(popupActions.openOptions).toHaveBeenCalledOnce();
  });
});
