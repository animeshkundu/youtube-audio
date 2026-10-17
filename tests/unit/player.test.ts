import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PlayerHandle,
  type PlayerReleaseReason,
  type PlayerReleaseRecord,
} from '../../src/shared/player';

class FakeMedia {
  private source = 'blob:native';
  currentSrc = 'blob:native';
  currentTime = 12;
  playbackRate = 1.25;
  volume = 0.7;
  muted = false;
  paused = false;
  readyState = 1;
  loop = false;
  play = vi.fn(() => Promise.resolve());
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

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

  it('prefers the caller intent over the transient live element on a fast re-attach', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia(); // live element reports currentTime 12, paused false

    expect(
      handle.attach(
        media as unknown as HTMLMediaElement,
        'https://media.example/audio',
        generation,
        {
          currentTime: 45,
          paused: true,
        }
      )
    ).toBe(true);
    // Uses the intent (real pre-toggle-off state), not the element's mid-reload transient.
    expect(media.currentTime).toBe(45);
    expect(media.play).not.toHaveBeenCalled();
  });

  it('preserves the native loop flag across a src swap', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();
    media.loop = true;

    expect(
      handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation)
    ).toBe(true);
    // The snapshot captured loop=true and restorePlaybackState re-applied it after the swap.
    expect(media.loop).toBe(true);
  });

  it('setLoop updates the live element and the snapshot so the next attach keeps the choice', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    handle.setLoop(true);
    expect(media.loop).toBe(true);

    // A same-video re-attach (SPA/settings push) must inherit the updated snapshot, not the value
    // captured at the original attach.
    handle.attach(
      media as unknown as HTMLMediaElement,
      'https://media.example/audio',
      handle.navigate()
    );
    expect(media.loop).toBe(true);

    handle.setLoop(false);
    expect(media.loop).toBe(false);
  });

  it('setLoop is a fail-open no-op when no element is attached', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    expect(() => handle.setLoop(true)).not.toThrow();
  });

  it('adopts a later user speed change on the next attach instead of the attach-time rate', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    // Deliver the registered ratechange listener as Firefox would after a user speed change.
    const rateHandler = (media.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      ([type]) => type === 'ratechange'
    )?.[1] as (() => void) | undefined;
    media.playbackRate = 1.75;
    rateHandler?.();

    handle.attach(
      media as unknown as HTMLMediaElement,
      'https://media.example/audio',
      handle.navigate()
    );
    expect(media.playbackRate).toBe(1.75);
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

  it('releases without rewriting src and reports the live release record when disabled', () => {
    const released: Array<{ record: PlayerReleaseRecord; reason: PlayerReleaseReason }> = [];
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    handle.onRelease((record, reason) => released.push({ record, reason }));
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    handle.disable();

    // restore() must NOT reassign the stale native blob (that silently stalls the element at
    // readyState 0); it leaves our audio url in place for the reclaim coordinator to replace via the
    // player API, and hands over the live release record.
    expect(media.src).toBe('https://media.example/audio');
    expect(handle.getMediaElement()).toBeNull();
    expect(released).toHaveLength(1);
    const [entry] = released;
    if (!entry) throw new Error('expected a release record');
    expect(entry.reason).toBe('disable');
    expect(entry.record.ownedUrl).toBe('https://media.example/audio');
    expect(entry.record.element).toBe(media as unknown as HTMLMediaElement);
    expect(entry.record.currentTime).toBe(12);
    expect(entry.record.paused).toBe(false);
  });

  it('fires the release handler on navigate only when a hijack was active', () => {
    const reasons: PlayerReleaseReason[] = [];
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    handle.onRelease((_record, reason) => reasons.push(reason));
    const generation = handle.navigate(); // no active hijack yet -> no release fired
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);
    handle.navigate(); // tears down the active hijack -> release('navigate')

    expect(reasons).toEqual(['navigate']);
  });

  it('leaves a foreign src accessor that patched over ours in place when disabled', () => {
    const handle = new PlayerHandle({ mediaPrototype: FakeMedia.prototype });
    const generation = handle.navigate();
    const media = new FakeMedia();
    handle.attach(media as unknown as HTMLMediaElement, 'https://media.example/audio', generation);

    const foreignGetter = () => 'blob:foreign';
    Object.defineProperty(FakeMedia.prototype, 'src', {
      configurable: true,
      get: foreignGetter,
      set: () => undefined,
    });

    handle.disable();

    // Revert only what we installed (ADR-0015): the later foreign wrapper owns the property now.
    expect(Object.getOwnPropertyDescriptor(FakeMedia.prototype, 'src')?.get).toBe(foreignGetter);
    expect(handle.getMediaElement()).toBeNull();
  });
});
