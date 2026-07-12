import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const fakeMediaSrcDescriptor = Object.getOwnPropertyDescriptor(FakeMedia.prototype, 'src')!;

beforeEach(() => {
  Object.defineProperty(FakeMedia.prototype, 'src', fakeMediaSrcDescriptor);
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=video1'));
});

afterEach(() => {
  Object.defineProperty(FakeMedia.prototype, 'src', fakeMediaSrcDescriptor);
  vi.restoreAllMocks();
});

describe('PlayerHandle', () => {
  it('rejects a stale navigation generation without touching media', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    handle.navigate();
    const media = new FakeMedia();

    expect(
      handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation)
    ).toBe(false);
    expect(media.src).toBe('blob:native');
  });

  it('preserves playback state while attaching audio', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();

    expect(
      handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation)
    ).toBe(true);
    expect(media.src).toBe('https://media.example/audio');
    expect(media.currentTime).toBe(12);
    expect(media.playbackRate).toBe(1.25);
    expect(media.volume).toBe(0.7);
    expect(media.play).toHaveBeenCalledOnce();
  });

  it('does not restore the snapshot src before applying the page src when the circuit opens', () => {
    const srcSetter = vi.spyOn(FakeMedia.prototype, 'src', 'set');
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype, maxReassertions: 2 });
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    media.src = 'blob:first';
    media.src = 'blob:second';
    expect(media.src).toBe('https://media.example/audio');
    srcSetter.mockClear();
    media.src = 'blob:third';

    expect(srcSetter).toHaveBeenCalledOnce();
    expect(srcSetter).toHaveBeenCalledWith('blob:third');
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
