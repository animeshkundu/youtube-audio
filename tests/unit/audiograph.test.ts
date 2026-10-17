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
  options: { throwOnSource?: boolean; throwOnFilter?: boolean } = {}
) {
  const filters: Array<{ gain: { value: number }; connect(node: unknown): unknown }> = [];
  const gain = { gain: { value: 1 }, connect: (node: unknown) => node };
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
    };

    const gain = applyGraphSettings(
      graph,
      { loudnessNormalization: true, equalizerEnabled: true, equalizerBands: [1, 2, 3, 4, 5] },
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
    };

    applyGraphSettings(
      graph,
      { loudnessNormalization: false, equalizerEnabled: true, equalizerBands: [0, 0, 0, 0, 0] },
      -6
    );
    applyGraphSettings(
      graph,
      { loudnessNormalization: true, equalizerEnabled: false, equalizerBands: [] },
      undefined
    );

    expect(gains).toEqual([1, 1]);
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
