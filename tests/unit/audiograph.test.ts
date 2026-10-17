import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyGraphSettings,
  createAudioGraph,
  EQ_FREQUENCIES,
  getEqualizerParameters,
  loudnessDbToGain,
} from '../../src/shared/audiograph';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

function installAudioContextMock(
  options: { throwOnSource?: boolean; throwOnFilter?: boolean; throwOnCompressor?: boolean } = {}
) {
  const filters: Array<{ gain: { value: number }; connect(node: unknown): unknown }> = [];
  const gain = { gain: { value: 1 }, connect: (node: unknown) => node };
  const compressor = {
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 1 },
    attack: { value: 0 },
    release: { value: 0 },
    connect: (node: unknown) => node,
  };
  let sourceDisconnects = 0;
  const source = {
    connect: (node: unknown) => node,
    disconnect: () => {
      sourceDisconnects += 1;
    },
  };
  let contextsCreated = 0;
  const context = {
    destination: {},
    createMediaElementSource: () => {
      if (options.throwOnSource) throw new Error('source failed');
      return source;
    },
    createBiquadFilter: () => {
      if (options.throwOnFilter) throw new Error('filter failed');
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
    createDynamicsCompressor: () => {
      if (options.throwOnCompressor) throw new Error('compressor failed');
      return compressor;
    },
    resume: () => Promise.resolve(),
  };
  class AudioContextMock {
    constructor() {
      contextsCreated += 1;
      return context;
    }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: AudioContextMock },
  });
  return {
    context,
    filters,
    gain,
    compressor,
    sourceDisconnectCount: () => sourceDisconnects,
    contextsCreated: () => contextsCreated,
  };
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

describe('applyGraphSettings', () => {
  it('applies gain first, then the equalizer, and returns the applied gain', () => {
    const calls: string[] = [];
    const graph = {
      setGain(value: number) {
        calls.push(`gain:${value}`);
      },
      setEqualizer(enabled: boolean, bands: readonly number[]) {
        calls.push(`eq:${enabled}:${bands.join(',')}`);
      },
      setBoost(_enabled: boolean, _amount: number) {
        // Not under test here.
      },
    };

    const gain = applyGraphSettings(
      graph,
      {
        loudnessNormalization: true,
        equalizerEnabled: true,
        equalizerBands: [1, 2, 3, 4, 5],
        volumeBoostEnabled: false,
        volumeBoostAmount: 1,
      },
      -6.0206
    );

    expect(gain).toBeCloseTo(2, 4);
    expect(calls).toEqual([`gain:${gain}`, 'eq:true:1,2,3,4,5']);
  });

  it('uses unity gain when normalization is off or the loudness dB is missing', () => {
    const gains: number[] = [];
    const graph = {
      setGain(value: number) {
        gains.push(value);
      },
      setEqualizer() {
        // Not under test here.
      },
      setBoost() {
        // Not under test here.
      },
    };

    applyGraphSettings(
      graph,
      {
        loudnessNormalization: false,
        equalizerEnabled: true,
        equalizerBands: [0, 0, 0, 0, 0],
        volumeBoostEnabled: false,
        volumeBoostAmount: 1,
      },
      -6
    );
    applyGraphSettings(
      graph,
      {
        loudnessNormalization: true,
        equalizerEnabled: false,
        equalizerBands: [],
        volumeBoostEnabled: false,
        volumeBoostAmount: 1,
      },
      undefined
    );

    expect(gains).toEqual([1, 1]);
  });

  it('folds a clamped boost multiplier into the gain and forwards boost to the limiter', () => {
    const calls: Array<{ gain: number; boost: [boolean, number] }> = [];
    const graph = {
      lastGain: 0,
      setGain(value: number) {
        this.lastGain = value;
      },
      setEqualizer() {
        // Not under test here.
      },
      setBoost(enabled: boolean, amount: number) {
        calls.push({ gain: this.lastGain, boost: [enabled, amount] });
      },
    };

    // loudness -6.0206 -> gain 2, boost 5 -> clamped 3, product clamped back to 2.
    const boosted = applyGraphSettings(
      graph,
      {
        loudnessNormalization: true,
        equalizerEnabled: false,
        equalizerBands: [],
        volumeBoostEnabled: true,
        volumeBoostAmount: 5,
      },
      -6.0206
    );
    expect(boosted).toBe(2);
    expect(calls.at(-1)).toEqual({ gain: 2, boost: [true, 5] });

    // boost 0.5 -> clamped to 1 (no attenuation), unity loudness -> gain 1.
    const floor = applyGraphSettings(
      graph,
      {
        loudnessNormalization: false,
        equalizerEnabled: false,
        equalizerBands: [],
        volumeBoostEnabled: true,
        volumeBoostAmount: 0.5,
      },
      undefined
    );
    expect(floor).toBe(1);
    expect(calls.at(-1)).toEqual({ gain: 1, boost: [true, 0.5] });
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

  it('always builds a limiter and activates it only when boost exceeds unity', async () => {
    vi.resetModules();
    const fresh = await import('../../src/shared/audiograph');
    const { compressor } = installAudioContextMock();
    const media = { crossOrigin: null } as unknown as HTMLMediaElement;
    const graph = fresh.createAudioGraph(media);

    // Built in passthrough mode by default.
    expect(compressor.ratio.value).toBe(1);
    expect(compressor.threshold.value).toBe(0);

    graph?.setBoost(true, 2);
    expect(compressor.threshold.value).toBe(-24);
    expect(compressor.ratio.value).toBe(4);

    // Boost at or below unity is not a limiter condition: back to passthrough.
    graph?.setBoost(true, 1);
    expect(compressor.ratio.value).toBe(1);

    graph?.setBoost(true, 2);
    expect(compressor.ratio.value).toBe(4);
    graph?.dispose();
    expect(compressor.ratio.value).toBe(1);
    expect(compressor.threshold.value).toBe(0);
  });

  it('degrades to gain -> destination and no-ops setBoost when the limiter cannot be created', async () => {
    vi.resetModules();
    const fresh = await import('../../src/shared/audiograph');
    const mock = installAudioContextMock({ throwOnCompressor: true });
    const graph = fresh.createAudioGraph({ crossOrigin: null } as unknown as HTMLMediaElement);
    expect(graph).not.toBeNull();
    expect(mock.filters).toHaveLength(5);
    expect(() => graph?.setBoost(true, 3)).not.toThrow();
    expect(() => graph?.dispose()).not.toThrow();
  });

  // The module keeps one page-lifetime AudioContext, so these lifecycle tests load a fresh module
  // instance to exercise context creation independently of earlier tests in this file.
  async function importFreshAudioGraph() {
    vi.resetModules();
    return await import('../../src/shared/audiograph');
  }

  it('captures each element once and shares one AudioContext across elements', async () => {
    const fresh = await importFreshAudioGraph();
    const mock = installAudioContextMock();
    const first = fresh.createAudioGraph({ crossOrigin: null } as unknown as HTMLMediaElement);
    const second = fresh.createAudioGraph({ crossOrigin: null } as unknown as HTMLMediaElement);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(mock.contextsCreated()).toBe(1);
  });

  it('registers a dry unity handle when the optional nodes fail to build', async () => {
    const fresh = await importFreshAudioGraph();
    const mock = installAudioContextMock({ throwOnFilter: true });
    const media = { crossOrigin: null } as unknown as HTMLMediaElement;
    const graph = fresh.createAudioGraph(media);
    expect(graph).not.toBeNull();
    expect(mock.filters).toHaveLength(0);
    expect(mock.sourceDisconnectCount()).toBe(1);
    graph?.setGain(1.5);
    graph?.setEqualizer(true, [-12, 0, 0, 0, 12]);
    graph?.dispose();
    expect(graph?.getEqualizerGains()).toEqual([]);
    expect(mock.gain.gain.value).toBe(1);
    // The captured element is never re-captured: the degraded handle is reused from the registry.
    expect(fresh.createAudioGraph(media)).toBe(graph);
  });
});
