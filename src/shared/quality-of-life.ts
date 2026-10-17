export const QUALITY_CAPS = ['off', '144p', '240p', '360p', '480p', '720p', '1080p'] as const;

export type QualityCap = (typeof QUALITY_CAPS)[number];

export interface DistractionSettings {
  enabled: boolean;
  hideShorts: boolean;
  hideRecommendations: boolean;
  hideComments: boolean;
  hideThumbnails: boolean;
  hideAvatars: boolean;
}

const QUALITY_LABELS: Readonly<Record<Exclude<QualityCap, 'off'>, string>> = {
  '144p': 'tiny',
  '240p': 'small',
  '360p': 'medium',
  '480p': 'large',
  '720p': 'hd720',
  '1080p': 'hd1080',
};

export function isQualityCap(value: unknown): value is QualityCap {
  return typeof value === 'string' && QUALITY_CAPS.some((quality) => quality === value);
}

export function getQualityLabel(cap: QualityCap): string | null {
  return cap === 'off' ? null : QUALITY_LABELS[cap];
}

export function buildDistractionStyles(settings: DistractionSettings): string {
  if (!settings.enabled) return '';
  const rules: string[] = [];
  if (settings.hideShorts) {
    rules.push(`
ytd-reel-shelf-renderer,
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
ytm-reel-shelf-renderer,
ytm-rich-section-renderer:has(ytm-reel-shelf-renderer) {
  display: none !important;
}`);
  }
  if (settings.hideRecommendations) {
    // Target the related-results renderer specifically, not the whole `#secondary` container:
    // at the wide two-column layout YouTube reparents a comments-bearing engagement panel into
    // `#secondary`, so hiding the container could collapse comments even when `hideComments` was off.
    // The visible comments block itself lives in `#primary`; scoping to the renderer keeps both safe.
    rules.push(`
ytd-watch-flexy #secondary ytd-watch-next-secondary-results-renderer,
ytd-watch-flexy #related,
ytm-item-section-renderer[section-identifier="related-items"],
ytm-related-chip-cloud-renderer {
  display: none !important;
}`);
  }
  if (settings.hideComments) {
    rules.push(`
ytd-comments,
ytd-comments-header-renderer,
ytm-comment-section-renderer,
ytm-comments-entry-point-header-renderer {
  display: none !important;
}`);
  }
  if (settings.hideThumbnails) {
    // Cosmetic only. Thumbnail images are hidden with CSS and `i.ytimg.com` requests are never
    // blocked at the network layer: blocking them would break channel art, the player poster, and
    // the download flow. Desktop uses the semantic tile tags; the mobile classes are the real ones
    // m.youtube.com ships inside its media items (large/compact thumbnail containers).
    rules.push(`
ytd-thumbnail,
ytd-playlist-thumbnail,
ytm-large-media-item .large-media-item-thumbnail-container,
.video-thumbnail-container-large,
.video-thumbnail-container-compact {
  display: none !important;
}`);
  }
  if (settings.hideAvatars) {
    // Channel avatars on comment rows, the watch-page owner row, home-feed tiles, and the channel
    // header. `ytd-comments #author-thumbnail` is the ImprovedTube-vetted comment-avatar target
    // (docs/research/10-quality-of-life-ux.md); the rest are semantic tags used by common filter
    // lists. Like every cosmetic rule here this hides elements only, never images at the network.
    rules.push(`
ytd-comments #author-thumbnail,
ytd-video-owner-renderer #avatar,
ytd-rich-grid-media #avatar,
#channel-header-container yt-img-shadow#avatar {
  display: none !important;
}`);
  }
  return rules.join('\n');
}
