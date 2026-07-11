import { describe, expect, it } from 'vitest';

import {
  buildDistractionStyles,
  getQualityLabel,
  isQualityCap,
} from '../../src/shared/quality-of-life';

const visibleSettings = {
  enabled: true,
  hideShorts: false,
  hideRecommendations: false,
  hideComments: false,
};

describe('quality cap selection', () => {
  it.each([
    ['144p', 'tiny'],
    ['240p', 'small'],
    ['360p', 'medium'],
    ['480p', 'large'],
    ['720p', 'hd720'],
    ['1080p', 'hd1080'],
    ['off', null],
  ] as const)('maps %s to the player label', (cap, label) => {
    expect(getQualityLabel(cap)).toBe(label);
  });

  it('accepts only supported stored values', () => {
    expect(isQualityCap('480p')).toBe(true);
    expect(isQualityCap('auto')).toBe(false);
    expect(isQualityCap(480)).toBe(false);
  });
});

describe('distraction stylesheet', () => {
  it('is empty when protection is disabled', () => {
    expect(
      buildDistractionStyles({
        enabled: false,
        hideShorts: true,
        hideRecommendations: true,
        hideComments: true,
      })
    ).toBe('');
  });

  it('emits only the Shorts selectors when requested', () => {
    const css = buildDistractionStyles({ ...visibleSettings, hideShorts: true });
    expect(css).toContain('ytd-reel-shelf-renderer');
    expect(css).toContain('ytm-reel-shelf-renderer');
    expect(css).not.toContain('#secondary');
    expect(css).not.toContain('ytd-comments');
  });

  it('emits only recommendation selectors when requested', () => {
    const css = buildDistractionStyles({ ...visibleSettings, hideRecommendations: true });
    expect(css).toContain('ytd-watch-flexy #secondary');
    expect(css).toContain('ytm-related-chip-cloud-renderer');
    expect(css).not.toContain('ytd-reel-shelf-renderer');
    expect(css).not.toContain('ytd-comments');
  });

  it('emits desktop and mobile comment selectors when requested', () => {
    const css = buildDistractionStyles({ ...visibleSettings, hideComments: true });
    expect(css).toContain('ytd-comments');
    expect(css).toContain('ytm-comment-section-renderer');
    expect(css).not.toContain('#secondary');
  });

  it('combines all enabled rules into one stylesheet', () => {
    const css = buildDistractionStyles({
      enabled: true,
      hideShorts: true,
      hideRecommendations: true,
      hideComments: true,
    });
    expect(css).toContain('ytd-reel-shelf-renderer');
    expect(css).toContain('ytd-watch-flexy #secondary');
    expect(css).toContain('ytd-comments');
  });
});
