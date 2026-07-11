import { afterEach, describe, expect, it } from 'vitest';

import {
  createAudioGraph,
  EQ_FREQUENCIES,
  getEqualizerParameters,
  loudnessDbToGain,
} from '../../src/shared/audiograph';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

function installAudioContextMock(options: { throwOnSource?: boolean } = {}) {
  const filters: Array<{ gain: { value: number }; connect(node: unknown): unknown }> = [];
  const gain = { gain: { value: 1 }, connect: (node: unknown) => node };
  const source = { connect: (node: unknown) => node, disconnect: (_node: unknown) => undefined };
  const context = {
    destination: {},
    createMediaElementSource: () => {
      if (options.throwOnSource) throw new Error('source failed');
      return source;
    },
    createBiquadFilter: () => {
      const filter = {
        type: 'peaking',
        frequency: { value: 0 },
        Q: { value: 0 },
        gain: { value: 0 },
        connect: (node: unknown) => node,
      };
      filters.push(filter);
      return filter;
    },
    createGain: () => gain,
    resume: () => Promise.resolve(),
  };
  class AudioContextMock {
    constructor() {
      return context;
    }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: AudioContextMock },
  });
  return { context, filters, gain };
}

describe('loudnessDbToGain', () => {
  it('converts YouTube loudness offsets into linear gain', () => {
    expect(loudnessDbToGain(-6.0206)).toBeCloseTo(2, 4);
    expect(loudnessDbToGain(6.0206)).toBeCloseTo(0.5, 4);
    expect(loudnessDbToGain(0)).toBe(1);
  });

  it('clamps extreme and invalid values', () => {
    expect(loudnessDbToGain(-30)).toBe(2);
    expect(loudnessDbToGain(30)).toBe(0.5);
    expect(loudnessDbToGain(Number.NaN)).toBe(1);
  });
});

describe('getEqualizerParameters', () => {
  it('maps five gains to serial peaking-filter parameters', () => {
    const parameters = getEqualizerParameters([-12, -3, 0, 4.5, 12]);
    expect(parameters.map(({ frequency }) => frequency)).toEqual(EQ_FREQUENCIES);
    expect(parameters.map(({ gain }) => gain)).toEqual([-12, -3, 0, 4.5, 12]);
    expect(parameters.every(({ type, q }) => type === 'peaking' && q === 1)).toBe(true);
  });

  it('uses flat, clamped gains for malformed input', () => {
    expect(getEqualizerParameters([99, Number.NaN]).map(({ gain }) => gain)).toEqual([
      12, 0, 0, 0, 0,
    ]);
  });
});

describe('createAudioGraph', () => {
  it('creates and reuses one graph per element while applying settings', () => {
    const { filters, gain } = installAudioContextMock();
    const media = { crossOrigin: null } as unknown as HTMLMediaElement;
    const graph = createAudioGraph(media);
    expect(graph).not.toBeNull();
    expect(media.crossOrigin).toBe('anonymous');
    expect(filters).toHaveLength(5);
    expect(createAudioGraph(media)).toBe(graph);

    graph?.setGain(1.5);
    graph?.setEqualizer(true, [-20, -3, 0, 4, 20]);
    expect(gain.gain.value).toBe(1.5);
    expect(filters.map((filter) => filter.gain.value)).toEqual([-12, -3, 0, 4, 12]);

    graph?.setGain(Number.NaN);
    graph?.setEqualizer(false, [1, 2, 3, 4, 5]);
    expect(gain.gain.value).toBe(1.5);
    expect(filters.every((filter) => filter.gain.value === 0)).toBe(true);

    graph?.dispose();
    expect(gain.gain.value).toBe(1);
  });

  it('fails open when Web Audio is unavailable', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    expect(createAudioGraph({} as HTMLMediaElement)).toBeNull();
  });
});
