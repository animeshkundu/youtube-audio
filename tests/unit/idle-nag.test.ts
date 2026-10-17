// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IDLE_NAG_JITTER_MS,
  IDLE_NAG_KEEPALIVE_MS,
  IDLE_NAG_PRIME_MS,
  dismissIdleNag,
  findIdleNagConfirmTarget,
  findIdleNagPopupContainer,
  findIdleNagRenderer,
  isIdleNagNodeName,
  nextIdleNagDelayMs,
} from '../../src/shared/idle-nag';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isIdleNagNodeName', () => {
  it('accepts exactly the confirm and you-there renderer names', () => {
    expect(isIdleNagNodeName('YT-CONFIRM-DIALOG-RENDERER')).toBe(true);
    expect(isIdleNagNodeName('YTMUSIC-YOU-THERE-RENDERER')).toBe(true);
  });

  it('rejects near misses and non-strings', () => {
    expect(isIdleNagNodeName('YT-CONFIRM-DIALOG-RENDERER ')).toBe(false);
    expect(isIdleNagNodeName('yt-confirm-dialog-renderer')).toBe(false);
    expect(isIdleNagNodeName('YT-CONFIRM-DIALOG')).toBe(false);
    expect(isIdleNagNodeName('YTMUSIC-YOU-THERE')).toBe(false);
    expect(isIdleNagNodeName(null)).toBe(false);
    expect(isIdleNagNodeName(undefined)).toBe(false);
    expect(isIdleNagNodeName(42)).toBe(false);
    expect(isIdleNagNodeName({ nodeName: 'YT-CONFIRM-DIALOG-RENDERER' })).toBe(false);
  });
});

describe('nextIdleNagDelayMs', () => {
  it('brackets the base cadence with symmetric jitter at the boundaries', () => {
    expect(nextIdleNagDelayMs(() => 0)).toBe(IDLE_NAG_KEEPALIVE_MS - IDLE_NAG_JITTER_MS);
    expect(nextIdleNagDelayMs(() => 1)).toBe(IDLE_NAG_KEEPALIVE_MS + IDLE_NAG_JITTER_MS);
    expect(nextIdleNagDelayMs(() => 0.5)).toBe(IDLE_NAG_KEEPALIVE_MS);
  });

  it('clamps out-of-range samples and degrades unusable ones to the base cadence', () => {
    expect(nextIdleNagDelayMs(() => -5)).toBe(IDLE_NAG_KEEPALIVE_MS - IDLE_NAG_JITTER_MS);
    expect(nextIdleNagDelayMs(() => 9)).toBe(IDLE_NAG_KEEPALIVE_MS + IDLE_NAG_JITTER_MS);
    expect(nextIdleNagDelayMs(() => Number.NaN)).toBe(IDLE_NAG_KEEPALIVE_MS);
    expect(nextIdleNagDelayMs(() => Number.POSITIVE_INFINITY)).toBe(IDLE_NAG_KEEPALIVE_MS);
  });

  it('stays a positive integer inside the jitter band for every sample', () => {
    for (let step = 0; step <= 1; step += 0.05) {
      const delay = nextIdleNagDelayMs(() => step);
      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(IDLE_NAG_KEEPALIVE_MS - IDLE_NAG_JITTER_MS);
      expect(delay).toBeLessThanOrEqual(IDLE_NAG_KEEPALIVE_MS + IDLE_NAG_JITTER_MS);
    }
  });

  it('primes once far below the steady cadence', () => {
    expect(Number.isInteger(IDLE_NAG_PRIME_MS)).toBe(true);
    expect(IDLE_NAG_PRIME_MS).toBeGreaterThan(0);
    expect(IDLE_NAG_PRIME_MS).toBeLessThan(IDLE_NAG_KEEPALIVE_MS - IDLE_NAG_JITTER_MS);
  });
});

describe('idle-nag dialog locators', () => {
  it('finds the confirm and you-there renderers, else nothing', () => {
    document.body.innerHTML =
      '<div><yt-confirm-dialog-renderer></yt-confirm-dialog-renderer></div>';
    expect(findIdleNagRenderer(document)?.tagName.toLowerCase()).toBe('yt-confirm-dialog-renderer');

    document.body.innerHTML = '<ytmusic-you-there-renderer></ytmusic-you-there-renderer>';
    expect(findIdleNagRenderer(document)?.tagName.toLowerCase()).toBe('ytmusic-you-there-renderer');

    document.body.innerHTML = '<div class="unrelated"></div>';
    expect(findIdleNagRenderer(document)).toBeNull();
  });

  it('prefers the dialog confirm control and falls back to the popup container', () => {
    document.body.innerHTML =
      '<yt-confirm-dialog-renderer><button id="confirm-button">Yes</button></yt-confirm-dialog-renderer>';
    expect(findIdleNagConfirmTarget(document)?.id).toBe('confirm-button');

    document.body.innerHTML = '<div id="confirm-button"></div>';
    expect(findIdleNagConfirmTarget(document)?.id).toBe('confirm-button');

    document.body.innerHTML = '<ytd-popup-container></ytd-popup-container>';
    expect(findIdleNagConfirmTarget(document)).toBeNull();
    expect(findIdleNagPopupContainer(document)?.tagName.toLowerCase()).toBe('ytd-popup-container');

    document.body.innerHTML = '<ytmusic-popup-container></ytmusic-popup-container>';
    expect(findIdleNagPopupContainer(document)?.tagName.toLowerCase()).toBe(
      'ytmusic-popup-container'
    );

    document.body.innerHTML = '';
    expect(findIdleNagConfirmTarget(document)).toBeNull();
    expect(findIdleNagPopupContainer(document)).toBeNull();
  });
});

describe('dismissIdleNag', () => {
  it('clicks the confirm control and reports the dismissal', () => {
    document.body.innerHTML =
      '<yt-confirm-dialog-renderer><button id="confirm-button">Yes</button></yt-confirm-dialog-renderer>';
    const button = document.getElementById('confirm-button') as HTMLButtonElement;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);

    expect(dismissIdleNag(document)).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('falls back to clicking the popup container when no confirm control exists', () => {
    document.body.innerHTML = '<ytd-popup-container></ytd-popup-container>';
    const container = document.querySelector('ytd-popup-container') as HTMLElement;
    const clicked = vi.fn();
    container.addEventListener('click', clicked);

    expect(dismissIdleNag(document)).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('is a false no-op on an empty dialog-free root', () => {
    document.body.innerHTML = '<div class="unrelated">text</div>';
    expect(dismissIdleNag(document)).toBe(false);

    document.body.innerHTML = '';
    expect(dismissIdleNag(document)).toBe(false);
  });
});
