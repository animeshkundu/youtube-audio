// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fallbackQualityEngaged,
  findSongModeSwitch,
  selectLowestQualityLabel,
  switchToSongMode,
} from '../../src/shared/fallback-quality';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('selectLowestQualityLabel', () => {
  it('picks the lowest tier from the real observed Music list, ignoring auto', () => {
    expect(
      selectLowestQualityLabel([
        'hd2160',
        'hd1440',
        'hd1080',
        'hd720',
        'large',
        'medium',
        'small',
        'tiny',
        'auto',
      ])
    ).toBe('tiny');
  });

  it('picks the lowest present tier when tiny is absent', () => {
    expect(selectLowestQualityLabel(['hd1080', 'hd720', 'large', 'medium', 'small'])).toBe('small');
    expect(selectLowestQualityLabel(['hd1080', 'large'])).toBe('large');
  });

  it('ignores unknown values and non-strings in any order', () => {
    expect(selectLowestQualityLabel(['auto', 'medium'])).toBe('medium');
    expect(selectLowestQualityLabel(['bogus', 'hd720', 'large'])).toBe('large');
    expect(selectLowestQualityLabel([42, 'tiny', null, {}])).toBe('tiny');
  });

  it('defaults to the tiny floor when the list is unusable', () => {
    expect(selectLowestQualityLabel(undefined)).toBe('tiny');
    expect(selectLowestQualityLabel(null)).toBe('tiny');
    expect(selectLowestQualityLabel([])).toBe('tiny');
    expect(selectLowestQualityLabel(['auto'])).toBe('tiny');
    expect(selectLowestQualityLabel('tiny')).toBe('tiny');
  });

  it('ranks highres above the hd tiers', () => {
    expect(selectLowestQualityLabel(['highres', 'hd2160'])).toBe('hd2160');
    expect(selectLowestQualityLabel(['highres'])).toBe('highres');
  });
});

describe('fallbackQualityEngaged', () => {
  const base = {
    enabled: true,
    fallbackQualityCapEnabled: true,
    forceQualityMax: 'off' as const,
  };

  it('engages only with the extension on, the feature on, and no user quality cap', () => {
    expect(fallbackQualityEngaged(base)).toBe(true);
    expect(fallbackQualityEngaged({ ...base, enabled: false })).toBe(false);
    expect(fallbackQualityEngaged({ ...base, fallbackQualityCapEnabled: false })).toBe(false);
    expect(fallbackQualityEngaged({ ...base, forceQualityMax: '720p' })).toBe(false);
    expect(fallbackQualityEngaged({ ...base, forceQualityMax: '144p' })).toBe(false);
  });
});

function mountSongToggle({ selected = 'false', withButton = true } = {}): HTMLButtonElement | null {
  document.body.innerHTML = `
    <ytmusic-av-toggle is-audio-playback-mode-selected="${selected}" playback-mode="OMV_PREFERRED">
      ${withButton ? '<button class="song-button" aria-pressed="false">Song</button>' : ''}
      <button class="video-button" aria-pressed="true">Video</button>
    </ytmusic-av-toggle>`;
  return document.querySelector<HTMLButtonElement>('button.song-button');
}

describe('song-mode switch', () => {
  it('finds and clicks the song control once', () => {
    const button = mountSongToggle();
    expect(button).not.toBeNull();
    const clicked = vi.fn();
    button?.addEventListener('click', clicked);

    expect(findSongModeSwitch(document)).toBe(button);
    expect(switchToSongMode(document)).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('is a no-op when song mode is already selected', () => {
    const button = mountSongToggle({ selected: 'true' });
    const clicked = vi.fn();
    button?.addEventListener('click', clicked);

    expect(findSongModeSwitch(document)).toBeNull();
    expect(switchToSongMode(document)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('is a no-op without the toggle or without the song button', () => {
    document.body.innerHTML = '<div class="unrelated"></div>';
    expect(findSongModeSwitch(document)).toBeNull();
    expect(switchToSongMode(document)).toBe(false);

    mountSongToggle({ withButton: false });
    expect(findSongModeSwitch(document)).toBeNull();
    expect(switchToSongMode(document)).toBe(false);
  });

  it('scopes the search to the given root', () => {
    mountSongToggle();
    const detached = document.createElement('div');
    expect(findSongModeSwitch(detached)).toBeNull();
    expect(switchToSongMode(detached)).toBe(false);
    expect(findSongModeSwitch(document)).not.toBeNull();
  });
});
