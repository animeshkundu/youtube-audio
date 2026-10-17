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
  /** The effective per-band biquad gains currently applied (for bench verification). */
  getEqualizerGains(): number[];
  dispose(): void;
}

interface GraphRecord {
  context: AudioContext;
  gain: GainNode | null;
  filters: readonly BiquadFilterNode[];
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
  graph: Pick<AudioGraphHandle, 'setGain' | 'setEqualizer'>,
  settings: {
    loudnessNormalization: boolean;
    equalizerEnabled: boolean;
    equalizerBands: EqualizerBands;
  },
  loudnessDb: number | undefined
): number {
  const gain = settings.loudnessNormalization ? loudnessDbToGain(loudnessDb ?? Number.NaN) : 1;
  graph.setGain(gain);
  graph.setEqualizer(settings.equalizerEnabled, settings.equalizerBands);
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
    for (let index = 0; index < filters.length - 1; index += 1) {
      filters[index]?.connect(filters[index + 1]!);
    }
    filters.at(-1)?.connect(createdGain);
    createdGain.connect(context.destination);
    source.connect(filters[0]!);
    source.disconnect(context.destination);
  } catch {
    // Degrade to the dry pass-through: whatever half-built chain exists is dropped so the element
    // stays audible at unity and no orphaned nodes keep feeding the destination.
    filters = [];
    gain = null;
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
    },
  };
  graphs.set(media, { context, gain, filters, handle });
  void context.resume().catch(() => undefined);
  return handle;
}
