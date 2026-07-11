import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerHandle } from '../../src/shared/player';

class FakeMedia {
  private source = 'blob:native';
  currentSrc = 'blob:native';
  currentTime = 12;
  playbackRate = 1.25;
  volume = 0.7;
  muted = false;
  paused = false;
  readyState = 1;
  play = vi.fn(() => Promise.resolve());
  addEventListener = vi.fn();

  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.currentSrc = value;
  }
}

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=video1'));
});

describe('PlayerHandle', () => {
  it('rejects a stale navigation generation without touching media', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    handle.navigate();
    const media = new FakeMedia();

    expect(handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation)).toBe(false);
    expect(media.src).toBe('blob:native');
  });

  it('preserves playback state while attaching audio', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();

    expect(handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation)).toBe(true);
    expect(media.src).toBe('https://media.example/audio');
    expect(media.currentTime).toBe(12);
    expect(media.playbackRate).toBe(1.25);
    expect(media.volume).toBe(0.7);
    expect(media.play).toHaveBeenCalledOnce();
  });

  it('opens its circuit after repeated page reassertions and restores native playback', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype, maxReassertions: 2 });
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    media.src = 'blob:first';
    media.src = 'blob:second';
    expect(media.src).toBe('https://media.example/audio');
    media.src = 'blob:third';

    expect(handle.getMediaElement()).toBeNull();
    expect(media.src).toBe('blob:third');
  });

  it('restores the native source when audio-only is disabled', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    handle.disable();

    expect(media.src).toBe('blob:native');
  });
});
