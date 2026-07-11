export interface AudioGraphHandle {
  setGain(value: number): void;
  dispose(): void;
}

export function createAudioGraph(_media: HTMLMediaElement): AudioGraphHandle | null {
  // TODO(M4): Own one cross-origin-safe MediaElementSource graph per media element.
  return null;
}
