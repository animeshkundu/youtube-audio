// @vitest-environment jsdom

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentPage, type ConsentActions } from '../../../entrypoints/consent/App';

function actions(): ConsentActions {
  return {
    grant: vi.fn(async () => undefined),
    setSponsorBlockEnabled: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    finish: vi.fn(),
  };
}

function mount(options: ConsentActions): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  act(() => render(<ConsentPage actions={options} />, container));
  return container;
}

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('Expected clickable element');
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
});

describe('custom consent page', () => {
  it('shows all data, destinations, impacts, and decisions on one page', () => {
    const container = mount(actions());
    const text = container.textContent ?? '';

    expect(text).toContain('www.youtube.com');
    expect(text).toContain('ID of the video you open');
    expect(text).toContain('VISITOR_DATA');
    expect(text).toContain('Android VR');
    expect(text).toContain('*.googlevideo.com');
    expect(text).toContain('i.ytimg.com');
    expect(text).toContain('sponsor.ajay.app');
    expect(text).toContain('first 16 bits of its SHA-256 hash');
    expect(text).toContain('no cookies, no login, no identity');
    expect(text).toContain('Diagnostics stay on your device and are never transmitted.');
    expect(text).toContain('If you allow:');
    expect(text).toContain('If you decline:');
    expect(container.querySelectorAll('button')).toHaveLength(2);
    const privacyLink = container.querySelector('.privacy-link');
    expect(privacyLink?.getAttribute('href')).toBe(
      'https://animesh.kundus.in/youtube-audio/privacy/'
    );
    expect(privacyLink?.getAttribute('target')).toBe('_blank');
    expect(privacyLink?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('defaults SponsorBlock off and persists the separate choice on acceptance', async () => {
    const consentActions = actions();
    const container = mount(consentActions);
    const checkbox = container.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('Expected SponsorBlock choice');

    expect(checkbox.checked).toBe(false);
    await click(container.querySelector('.consent-primary'));

    expect(consentActions.grant).toHaveBeenCalledWith(false);
    expect(consentActions.setSponsorBlockEnabled).toHaveBeenCalledWith(false);
    expect(consentActions.finish).toHaveBeenCalledOnce();
  });

  it('accepts SponsorBlock only after the user checks it', async () => {
    const consentActions = actions();
    const container = mount(consentActions);
    const checkbox = container.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('Expected SponsorBlock choice');
    act(() => checkbox.click());

    await click(container.querySelector('.consent-primary'));

    expect(consentActions.grant).toHaveBeenCalledWith(true);
    expect(consentActions.setSponsorBlockEnabled).toHaveBeenCalledWith(true);
  });

  it('offers a direct decline-and-uninstall action', async () => {
    const consentActions = actions();
    const container = mount(consentActions);

    await click(container.querySelector('.consent-decline'));

    expect(consentActions.uninstall).toHaveBeenCalledOnce();
    expect(consentActions.grant).not.toHaveBeenCalled();
  });

  it('reports persistence failure without finishing', async () => {
    const consentActions = actions();
    consentActions.grant = vi.fn(async () => Promise.reject(new Error('storage')));
    const container = mount(consentActions);

    await click(container.querySelector('.consent-primary'));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'No data transmission was enabled'
    );
    expect(consentActions.finish).not.toHaveBeenCalled();
  });
});
