// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileInPlayerControls } from '../../entrypoints/content';

function createDesktopPlayer(): {
  player: HTMLElement;
  rightControls: HTMLElement;
  gear: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <div id="movie_player">
      <div class="ytp-left-controls"><button class="ytp-play-button">Play</button></div>
      <div class="ytp-right-controls">
        <button class="ytp-settings-button">Settings</button>
        <button class="ytp-fullscreen-button">Fullscreen</button>
      </div>
    </div>
  `;
  return {
    player: document.querySelector<HTMLElement>('#movie_player')!,
    rightControls: document.querySelector<HTMLElement>('.ytp-right-controls')!,
    gear: document.querySelector<HTMLButtonElement>('.ytp-settings-button')!,
  };
}

describe('reconcileInPlayerControls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('mounts the interactive audio toggle in the right cluster immediately before settings', () => {
    const { player, rightControls, gear } = createDesktopPlayer();

    const result = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: false,
      mobile: false,
    });

    expect(result).not.toBeNull();
    expect(result?.audioOnlyButton.parentElement).toBe(rightControls);
    expect(result?.audioOnlyButton.nextElementSibling).toBe(gear);
    expect(result?.audioOnlyButton.getAttribute('aria-pressed')).toBe('true');
    expect(result?.audioOnlyButton.getAttribute('aria-label')).toBe('Toggle audio-only playback');
    expect(result?.audioOnlyButton.disabled).toBe(false);
    expect(result?.audioOnlyButton.querySelector('svg[viewBox="0 0 24 24"]')).not.toBeNull();
    expect(document.querySelector('.ytp-left-controls #yta-audio-only-toggle')).toBeNull();
  });

  it('updates pressed state and reconciles repeatedly without duplicates', () => {
    const { player } = createDesktopPlayer();
    const first = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: false,
      mobile: false,
    });
    first?.audioOnlyButton.focus();

    const second = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: false,
      downloadVisible: true,
      mobile: false,
    });

    expect(second?.audioOnlyButton).toBe(first?.audioOnlyButton);
    expect(document.querySelectorAll('#yta-audio-only-toggle')).toHaveLength(1);
    expect(document.querySelectorAll('#yta-download-audio')).toHaveLength(1);
    expect(second?.audioOnlyButton.getAttribute('aria-pressed')).toBe('false');
    expect(second?.downloadButton.hidden).toBe(false);
    expect(document.activeElement).toBe(second?.audioOnlyButton);
  });

  it('removes the dead segment status pill and leaves extension controls interactive', () => {
    const { player } = createDesktopPlayer();
    const deadPill = document.createElement('button');
    deadPill.id = 'yta-segment-status';
    deadPill.disabled = true;
    player.append(deadPill);

    const result = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: true,
      mobile: false,
    });

    expect(document.getElementById('yta-segment-status')).toBeNull();
    expect(result?.audioOnlyButton.disabled).toBe(false);
    expect(result?.downloadButton.disabled).toBe(false);
    expect(result?.statusRegion.getAttribute('role')).toBe('status');
  });
});
