export interface SponsorSegment {
  segment: readonly [start: number, end: number];
  category: string;
  actionType: 'skip' | 'mute';
}

export async function getSponsorSegments(_videoId: string): Promise<readonly SponsorSegment[]> {
  // TODO(M3): Query only the k-anonymous prefix endpoint with credentials omitted.
  return [];
}
