export const EQ_FREQUENCIES = [60, 250, 1_000, 4_000, 12_000] as const;
export const FLAT_EQUALIZER = [0, 0, 0, 0, 0] as const;
export type EqualizerBands = readonly number[];

export interface EqualizerParameters {
  type: BiquadFilterType;
  frequency: number;
  q: number;
  gain: number;
}

export interface AudioGraphHandle {
  setGain(value: number): void;
  setEqualizer(enabled: boolean, bands: EqualizerBands): void;
  /** Apply a volume boost (1.0 = unity, up to 3.0). When disabled, gain is unity. */
  setBoost(enabled: boolean, amount: number): void;
  /** The effective per-band biquad gains currently applied (for bench verification). */
  getEqualizerGains(): number[];
  dispose(): void;
}

interface GraphRecord {
  context: AudioContext;
  gain: GainNode | null;
  filters: readonly BiquadFilterNode[];
  compressor: DynamicsCompressorNode | null;
  handle: AudioGraphHandle;
}

const graphs = new WeakMap<HTMLMediaElement, GraphRecord>();
let sharedContext: AudioContext | null = null;

export function loudnessDbToGain(loudnessDb: number): number {
  if (!Number.isFinite(loudnessDb)) return 1;
  return Math.min(2, Math.max(0.5, 10 ** (-loudnessDb / 20)));
}

/**
 * Apply the loudness/EQ settings to a graph (SPEC-020): the single arming/update path. `armAudioGraph`
 * calls it when a graph is created, and a settings push calls it again on the live handle so a
 * loudness or equalizer change is absorbed in place (no stream refetch, no media reload). Returns
 * the applied loudness gain so callers can publish it.
 */
export function applyGraphSettings(
  graph: Pick<AudioGraphHandle, 'setGain' | 'setEqualizer' | 'setBoost'>,
  settings: {
    loudnessNormalization: boolean;
    equalizerEnabled: boolean;
    equalizerBands: EqualizerBands;
    volumeBoostEnabled: boolean;
    volumeBoostAmount: number;
  },
  loudnessDb: number | undefined
): number {
  const loudnessGain = settings.loudnessNormalization
    ? loudnessDbToGain(loudnessDb ?? Number.NaN)
    : 1;
  const boostMultiplier = settings.volumeBoostEnabled
    ? Math.min(3, Math.max(1, settings.volumeBoostAmount))
    : 1;
  const gain = Math.min(2, Math.max(0.5, loudnessGain * boostMultiplier));
  graph.setGain(gain);
  graph.setEqualizer(settings.equalizerEnabled, settings.equalizerBands);
  graph.setBoost(settings.volumeBoostEnabled, settings.volumeBoostAmount);
  return gain;
}

export function getEqualizerParameters(bands: EqualizerBands): readonly EqualizerParameters[] {
  return EQ_FREQUENCIES.map((frequency, index) => {
    const candidate = bands[index];
    const gain =
      typeof candidate === 'number' && Number.isFinite(candidate)
        ? Math.min(12, Math.max(-12, candidate))
        : 0;
    return { type: 'peaking', frequency, q: 1, gain };
  });
}

export function createAudioGraph(media: HTMLMediaElement): AudioGraphHandle | null {
  const existing = graphs.get(media);
  if (existing) return existing.handle;

  let context: AudioContext;
  let source: MediaElementAudioSourceNode;
  try {
    media.crossOrigin = 'anonymous';
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return null;
    context = sharedContext ?? new AudioContextConstructor();
    sharedContext = context;
    source = context.createMediaElementSource(media);
  } catch {
    return null;
  }

  // Capture is permanent from here on, so a handle must always be registered once this point is
  // reached: an unregistered captured element would be unrecoverable, because a second
  // createMediaElementSource for the same element throws. Install the dry fail-open route before
  // creating optional nodes so a later Web Audio failure cannot silence the page element.
  source.connect(context.destination);
  let filters: BiquadFilterNode[] = [];
  let gain: GainNode | null = null;
  let compressor: DynamicsCompressorNode | null = null;
  try {
    filters = getEqualizerParameters(FLAT_EQUALIZER).map((parameters) => {
      const filter = context.createBiquadFilter();
      filter.type = parameters.type;
      filter.frequency.value = parameters.frequency;
      filter.Q.value = parameters.q;
      filter.gain.value = parameters.gain;
      return filter;
    });
    const createdGain = context.createGain();
    gain = createdGain;
    // Compressor acts as a limiter for volume boost: always present in the chain but
    // only active (threshold/ratio applied) when boost is enabled. When disabled, the
    // compressor is bypassed (threshold 0, ratio 1) so it's effectively a passthrough.
    // Fail-open: if the compressor cannot be created, the graph degrades to gain -> destination.
    let createdCompressor: DynamicsCompressorNode | null = null;
    try {
      createdCompressor = context.createDynamicsCompressor();
      createdCompressor.threshold.value = 0;
      createdCompressor.knee.value = 0;
      createdCompressor.ratio.value = 1;
      createdCompressor.attack.value = 0.003;
      createdCompressor.release.value = 0.25;
    } catch {
      createdCompressor = null;
    }
    compressor = createdCompressor;
    for (let index = 0; index < filters.length - 1; index += 1) {
      filters[index]?.connect(filters[index + 1]!);
    }
    filters.at(-1)?.connect(createdGain);
    if (createdCompressor) {
      createdGain.connect(createdCompressor);
      createdCompressor.connect(context.destination);
    } else {
      createdGain.connect(context.destination);
    }
    source.connect(filters[0]!);
    source.disconnect(context.destination);
  } catch {
    // Degrade to the dry pass-through: whatever half-built chain exists is dropped so the element
    // stays audible at unity and no orphaned nodes keep feeding the destination.
    filters = [];
    gain = null;
    compressor = null;
    try {
      source.disconnect();
    } catch {
      // Nothing was connected.
    }
    source.connect(context.destination);
  }

  const handle: AudioGraphHandle = {
    setGain(value) {
      if (gain && Number.isFinite(value)) gain.gain.value = Math.min(2, Math.max(0.5, value));
    },
    setEqualizer(enabled, bands) {
      const parameters = getEqualizerParameters(bands);
      filters.forEach((filter, index) => {
        filter.gain.value = enabled ? (parameters[index]?.gain ?? 0) : 0;
      });
    },
    setBoost(enabled, amount) {
      if (!compressor) return;
      if (enabled && Number.isFinite(amount) && amount > 1) {
        compressor.threshold.value = -24;
        compressor.knee.value = 0;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
      } else {
        compressor.threshold.value = 0;
        compressor.knee.value = 0;
        compressor.ratio.value = 1;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
      }
    },
    getEqualizerGains() {
      return filters.map((filter) => filter.gain.value);
    },
    dispose() {
      // MediaElementAudioSourceNode ownership is permanent for this element. Keep the
      // pass-through graph connected so disposal can never silence native playback.
      if (gain) gain.gain.value = 1;
      filters.forEach((filter) => {
        filter.gain.value = 0;
      });
      if (compressor) {
        compressor.threshold.value = 0;
        compressor.knee.value = 0;
        compressor.ratio.value = 1;
      }
    },
  };
  graphs.set(media, { context, gain, filters, compressor, handle });
  void context.resume().catch(() => undefined);
  return handle;
}
