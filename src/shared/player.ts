// Compile-time bench flag injected by the build (`vite` define). `false` in production, so the
// bench-only localhost media allowance in `isSafeMediaUrl` is dead-code-eliminated from real builds.
declare const __BENCH__: boolean;

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

/** Why an active hijack was torn down, so the reclaim coordinator can pick the right recovery. */
export type PlayerReleaseReason = 'navigate' | 'attach' | 'circuit' | 'disable';

/**
 * The live state of the `<video>` at the instant we released it, captured BEFORE internal state is
 * cleared. The coordinator needs `ownedUrl` to prove the element still holds our audio URL (rather
 * than one YouTube has already reasserted) and `currentTime`/`paused` to resume native playback in
 * place.
 */
export interface PlayerReleaseRecord {
  element: HTMLMediaElement;
  ownedUrl: string;
  currentTime: number;
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
  private readonly restoreListeners = new Set<() => void>();
  private releaseHandler:
    | ((record: PlayerReleaseRecord, reason: PlayerReleaseReason) => void)
    | undefined;

  constructor(options: PlayerHandleOptions = {}) {
    this.maxReassertions = options.maxReassertions ?? 3;
    this.mediaPrototype = options.mediaPrototype ?? HTMLMediaElement.prototype;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  /**
   * Register a listener invoked on every teardown (attach start, disable, navigate, and the
   * circuit breaker). The audio-mode artwork overlay uses this as its single teardown choke point,
   * which is why it must live in the page world: the circuit-breaker path calls restore() without
   * emitting a status event, so a status-based listener would miss it. Listeners are fail-open.
   */
  onRestore(listener: () => void): void {
    this.restoreListeners.add(listener);
  }

  /**
   * Register the single coordinator that re-establishes native playback after an ACTIVE hijack is
   * released. PlayerHandle deliberately never rewrites `<video>.src` on teardown (the captured
   * native blob URL is backed by a MediaSource YouTube has already discarded, so reassigning it
   * silently stalls the element), so returning to native video is the coordinator's job via
   * YouTube's own player API. Fired only when an owned audio URL was actually installed.
   */
  onRelease(handler: (record: PlayerReleaseRecord, reason: PlayerReleaseReason) => void): void {
    this.releaseHandler = handler;
  }

  navigate(): number {
    this.restore('navigate');
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  getMediaElement(): HTMLMediaElement | null {
    return this.mediaElement;
  }

  attach(mediaElement: HTMLMediaElement, audioUrl: string, generation: number): boolean {
    if (generation !== this.currentGeneration || !isSafeMediaUrl(audioUrl)) return false;

    try {
      this.restore('attach');
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
      this.restore('attach');
      return false;
    }
  }

  disable(): void {
    this.restore('disable');
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
            // YouTube keeps reasserting its own src: stop fighting, release, and let its value
            // stand. Its reassertion IS the native-playback recovery, so restore() writes nothing.
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
    this.restore('circuit');
  }

  private restore(reason: PlayerReleaseReason): void {
    const mediaElement = this.mediaElement;
    const audioUrl = this.audioUrl;
    const snapshot = this.snapshot;
    // Capture the live release state BEFORE clearing internal state: the coordinator needs proof of
    // what we owned (ownedUrl) and where playback actually is now (the element's live currentTime,
    // which tracks the audio we hijacked, not the stale attach-time snapshot).
    const release: PlayerReleaseRecord | null =
      mediaElement && audioUrl
        ? {
            element: mediaElement,
            ownedUrl: audioUrl,
            currentTime: finiteOr(mediaElement.currentTime, snapshot?.currentTime ?? 0),
            paused: mediaElement.paused,
          }
        : null;
    this.mediaElement = null;
    this.audioUrl = null;
    this.snapshot = null;
    this.reassertions = 0;

    try {
      if (this.originalDescriptor) {
        Object.defineProperty(this.mediaPrototype, 'src', this.originalDescriptor);
        this.originalDescriptor = undefined;
      }
      // Deliberately no `<video>.src` write here. The captured native blob URL is backed by a
      // MediaSource YouTube has already discarded, so reassigning it silently stalls the element
      // (readyState 0, no MediaError). Returning to native video is the reclaim coordinator's job.
    } catch {
      // Fail open: page playback remains in control.
    }

    // Notify restore listeners after the media is released. Each is isolated + fail-open so an
    // artwork/overlay teardown can never break native playback restoration.
    this.restoreListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore
      }
    });

    // Hand an active hijack's release to the native-reclaim coordinator (fail-open).
    if (release && this.releaseHandler) {
      try {
        this.releaseHandler(release, reason);
      } catch {
        // ignore
      }
    }
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function isSafeMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url, location.href);
    if (parsed.protocol === 'https:') return true;
    // The hermetic bench serves fixture media over http://127.0.0.1 / http://localhost. This
    // branch is compiled out of production (`__BENCH__` is `false`), so a real build only ever
    // hijacks an https media url.
    return __BENCH__ && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}
