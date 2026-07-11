export const SPONSOR_CATEGORIES = ['sponsor', 'music_offtopic'] as const;

export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number];

export interface SponsorSegment {
  segment: readonly [start: number, end: number];
  category: SponsorCategory;
  actionType: 'skip';
}

interface BucketVideo {
  videoID?: unknown;
  segments?: unknown;
}

interface BucketSegment {
  segment?: unknown;
  category?: unknown;
  actionType?: unknown;
}

export async function hashVideoIdPrefix(videoId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 4);
}

export function selectSegments(
  apiResponse: unknown,
  videoId: string,
  categories: readonly SponsorCategory[]
): readonly SponsorSegment[] {
  if (!Array.isArray(apiResponse) || !videoId) return [];
  const enabledCategories = new Set(categories);
  const segments: SponsorSegment[] = [];

  for (const item of apiResponse) {
    if (!isRecord(item)) continue;
    const bucketVideo: BucketVideo = item;
    if (bucketVideo.videoID !== videoId || !Array.isArray(bucketVideo.segments)) continue;

    for (const itemSegment of bucketVideo.segments) {
      const segment = parseSegment(itemSegment, enabledCategories);
      if (segment) segments.push(segment);
    }
  }

  segments.sort(
    (left, right) => left.segment[0] - right.segment[0] || left.segment[1] - right.segment[1]
  );
  const merged: SponsorSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && segment.segment[0] <= previous.segment[1]) {
      merged[merged.length - 1] = {
        segment: [previous.segment[0], Math.max(previous.segment[1], segment.segment[1])],
        category: previous.category,
        actionType: 'skip',
      };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function parseSegment(
  value: unknown,
  enabledCategories: ReadonlySet<SponsorCategory>
): SponsorSegment | null {
  if (!isRecord(value)) return null;
  const candidate: BucketSegment = value;
  if (!isSponsorCategory(candidate.category) || !enabledCategories.has(candidate.category))
    return null;
  if (candidate.actionType !== undefined && candidate.actionType !== 'skip') return null;
  if (!Array.isArray(candidate.segment) || candidate.segment.length !== 2) return null;
  const [start, end] = candidate.segment;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  ) {
    return null;
  }
  return { segment: [start, end], category: candidate.category, actionType: 'skip' };
}

export function isSponsorCategory(value: unknown): value is SponsorCategory {
  return typeof value === 'string' && SPONSOR_CATEGORIES.some((category) => category === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
