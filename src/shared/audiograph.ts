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
  dispose(): void;
}

interface GraphRecord {
  context: AudioContext;
  gain: GainNode;
  filters: readonly BiquadFilterNode[];
  handle: AudioGraphHandle;
}

const graphs = new WeakMap<HTMLMediaElement, GraphRecord>();
let sharedContext: AudioContext | null = null;

export function loudnessDbToGain(loudnessDb: number): number {
  if (!Number.isFinite(loudnessDb)) return 1;
  return Math.min(2, Math.max(0.5, 10 ** (-loudnessDb / 20)));
}

export function getEqualizerParameters(bands: EqualizerBands): readonly EqualizerParameters[] {
  return EQ_FREQUENCIES.map((frequency, index) => {
    const candidate = bands[index];
    const gain = typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(12, Math.max(-12, candidate))
      : 0;
    return { type: 'peaking', frequency, q: 1, gain };
  });
}

export function createAudioGraph(media: HTMLMediaElement): AudioGraphHandle | null {
  const existing = graphs.get(media);
  if (existing) return existing.handle;

  try {
    media.crossOrigin = 'anonymous';
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return null;
    const context = sharedContext ?? new AudioContextConstructor();
    sharedContext = context;
    const source = context.createMediaElementSource(media);
    // A MediaElementAudioSourceNode takes over native output immediately. Install a dry
    // fail-open route before creating optional nodes so a later Web Audio failure cannot
    // silence the page element.
    source.connect(context.destination);
    const filters = getEqualizerParameters(FLAT_EQUALIZER).map((parameters) => {
      const filter = context.createBiquadFilter();
      filter.type = parameters.type;
      filter.frequency.value = parameters.frequency;
      filter.Q.value = parameters.q;
      filter.gain.value = parameters.gain;
      return filter;
    });
    const gain = context.createGain();
    for (let index = 0; index < filters.length - 1; index += 1) {
      filters[index]?.connect(filters[index + 1]!);
    }
    filters.at(-1)?.connect(gain);
    gain.connect(context.destination);
    source.connect(filters[0]!);
    source.disconnect(context.destination);

    const handle: AudioGraphHandle = {
      setGain(value) {
        if (Number.isFinite(value)) gain.gain.value = Math.min(2, Math.max(0.5, value));
      },
      setEqualizer(enabled, bands) {
        const parameters = getEqualizerParameters(bands);
        filters.forEach((filter, index) => {
          filter.gain.value = enabled ? (parameters[index]?.gain ?? 0) : 0;
        });
      },
      dispose() {
        // MediaElementAudioSourceNode ownership is permanent for this element. Keep the
        // pass-through graph connected so disposal can never silence native playback.
        gain.gain.value = 1;
        filters.forEach((filter) => {
          filter.gain.value = 0;
        });
      },
    };
    graphs.set(media, { context, gain, filters, handle });
    void context.resume().catch(() => undefined);
    return handle;
  } catch {
    return null;
  }
}
