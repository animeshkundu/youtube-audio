export type PlayerEvent =
  | { type: 'media-attached'; generation: number }
  | { type: 'navigation'; generation: number }
  | { type: 'playback-fallback'; generation: number; reason: string };

export interface PlayerHandle {
  readonly generation: number;
  getMediaElement(): HTMLMediaElement | null;
}

export type PlayerEventListener = (event: PlayerEvent) => void;

export function createPlayerEventBus() {
  const listeners = new Set<PlayerEventListener>();
  return {
    emit(event: PlayerEvent): void {
      listeners.forEach((listener) => listener(event));
    },
    subscribe(listener: PlayerEventListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// TODO(M1): Implement the S2-winning <video>.src hijack behind PlayerHandle.
