export const QUALITY_CAPS = ['off', '144p', '240p', '360p', '480p', '720p', '1080p'] as const;

export type QualityCap = (typeof QUALITY_CAPS)[number];

export interface DistractionSettings {
  enabled: boolean;
  hideShorts: boolean;
  hideRecommendations: boolean;
  hideComments: boolean;
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
    rules.push(`
ytd-watch-flexy #secondary,
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
  return rules.join('\n');
}
