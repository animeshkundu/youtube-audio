export interface PlayerHandleOptions {
  maxReassertions?: number;
  mediaPrototype?: object;
}

interface PlaybackSnapshot {
  src: string;
  currentTime: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  paused: boolean;
}

export class PlayerHandle {
  private currentGeneration = 0;
  private mediaElement: HTMLMediaElement | null = null;
  private audioUrl: string | null = null;
  private snapshot: PlaybackSnapshot | null = null;
  private reassertions = 0;
  private readonly maxReassertions: number;
  private readonly mediaPrototype: object;
  private originalDescriptor: PropertyDescriptor | undefined;

  constructor(options: PlayerHandleOptions = {}) {
    this.maxReassertions = options.maxReassertions ?? 3;
    this.mediaPrototype = options.mediaPrototype ?? HTMLMediaElement.prototype;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  navigate(): number {
    this.restore();
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  getMediaElement(): HTMLMediaElement | null {
    return this.mediaElement;
  }

  attach(mediaElement: HTMLMediaElement, audioUrl: string, generation: number): boolean {
    if (generation !== this.currentGeneration || !isSafeMediaUrl(audioUrl)) return false;

    try {
      this.restore();
      this.mediaElement = mediaElement;
      this.audioUrl = audioUrl;
      this.reassertions = 0;
      this.snapshot = {
        src: mediaElement.currentSrc || mediaElement.src,
        currentTime: finiteOr(mediaElement.currentTime, 0),
        playbackRate: finiteOr(mediaElement.playbackRate, 1),
        volume: finiteOr(mediaElement.volume, 1),
        muted: mediaElement.muted,
        paused: mediaElement.paused,
      };
      this.installDormantGuard();
      this.writeSource(mediaElement, audioUrl);
      this.restorePlaybackState(mediaElement, this.snapshot, generation);
      return true;
    } catch {
      this.restore();
      return false;
    }
  }

  disable(): void {
    this.restore();
  }

  private installDormantGuard(): void {
    if (this.originalDescriptor) return;
    const descriptor = Object.getOwnPropertyDescriptor(this.mediaPrototype, 'src');
    if (!descriptor?.get || !descriptor.set || descriptor.configurable === false) return;

    this.originalDescriptor = descriptor;
    const getActiveAudioUrl = (mediaElement: HTMLMediaElement) =>
      mediaElement === this.mediaElement ? this.audioUrl : null;
    const recordReassertion = () => {
      this.reassertions += 1;
      return this.reassertions > this.maxReassertions;
    };
    const openCircuit = () => this.openCircuit();
    Object.defineProperty(this.mediaPrototype, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      get(this: HTMLMediaElement) {
        return descriptor.get!.call(this) as string;
      },
      set(this: HTMLMediaElement, value: string) {
        const activeAudioUrl = getActiveAudioUrl(this);
        if (activeAudioUrl && typeof value === 'string' && value !== activeAudioUrl) {
          if (recordReassertion()) {
            openCircuit();
            descriptor.set!.call(this, value);
            return;
          }
          descriptor.set!.call(this, activeAudioUrl);
          return;
        }
        descriptor.set!.call(this, value);
      },
    });
  }

  private restorePlaybackState(
    mediaElement: HTMLMediaElement,
    snapshot: PlaybackSnapshot,
    generation: number
  ): void {
    const apply = () => {
      if (generation !== this.currentGeneration || mediaElement !== this.mediaElement) return;
      try {
        if (Number.isFinite(snapshot.currentTime)) mediaElement.currentTime = snapshot.currentTime;
        mediaElement.playbackRate = snapshot.playbackRate;
        mediaElement.volume = snapshot.volume;
        mediaElement.muted = snapshot.muted;
        if (!snapshot.paused) void mediaElement.play().catch(() => undefined);
      } catch {
        this.openCircuit();
      }
    };
    if (mediaElement.readyState > 0) apply();
    else mediaElement.addEventListener('loadedmetadata', apply, { once: true });
  }

  private writeSource(mediaElement: HTMLMediaElement, source: string): void {
    const setter = this.originalDescriptor?.set;
    if (setter) setter.call(mediaElement, source);
    else mediaElement.src = source;
  }

  private openCircuit(): void {
    this.restore();
  }

  private restore(): void {
    const mediaElement = this.mediaElement;
    const snapshot = this.snapshot;
    this.mediaElement = null;
    this.audioUrl = null;
    this.snapshot = null;
    this.reassertions = 0;

    try {
      if (this.originalDescriptor) {
        Object.defineProperty(this.mediaPrototype, 'src', this.originalDescriptor);
        this.originalDescriptor = undefined;
      }
      if (mediaElement && snapshot) {
        mediaElement.src = snapshot.src;
        mediaElement.currentTime = snapshot.currentTime;
        mediaElement.playbackRate = snapshot.playbackRate;
        mediaElement.volume = snapshot.volume;
        mediaElement.muted = snapshot.muted;
        if (!snapshot.paused) void mediaElement.play().catch(() => undefined);
      }
    } catch {
      // Fail open: page playback remains in control.
    }
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function isSafeMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url, location.href);
    return (
      parsed.protocol === 'https:' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost'
    );
  } catch {
    return false;
  }
}
