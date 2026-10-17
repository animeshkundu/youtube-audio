/**
 * Fallback-quality policy (SPEC-017): what to do when the extension has to hand a video back
 * to YouTube's native player instead of playing it as audio-only.
 *
 * Everything here is pure or DOM-local so the page-world wiring in `entrypoints/main-world.ts`
 * stays a thin caller and the decisions are unit-tested directly. The feature makes exactly one
 * request per fallback (never a re-assert loop) and never fights an explicit user quality cap.
 */

import type { QualityCap } from './quality-of-life';

/**
 * Player quality labels from lowest to highest, as `getAvailableQualityLevels()` reports them.
 * `auto` is YouTube's adaptive mode, not a tier, so it is deliberately absent and ignored.
 */
const QUALITY_LABEL_ORDER = [
  'tiny',
  'small',
  'medium',
  'large',
  'hd720',
  'hd1080',
  'hd1440',
  'hd2160',
  'highres',
] as const;

export type PlayerQualityLabel = (typeof QUALITY_LABEL_ORDER)[number];

/**
 * The lowest quality tier present in `available`, or `tiny` (YouTube's documented floor) when the
 * list is missing, empty, or entirely unrecognized. The player clamps a floor it does not have, so
 * the default is safe; the caller requests one tier and never asserts the outcome.
 */
export function selectLowestQualityLabel(available: unknown): PlayerQualityLabel {
  if (!Array.isArray(available)) return 'tiny';
  let lowest: PlayerQualityLabel | null = null;
  let lowestRank = QUALITY_LABEL_ORDER.length as number;
  for (const entry of available) {
    if (typeof entry !== 'string') continue;
    const rank = QUALITY_LABEL_ORDER.indexOf(entry as PlayerQualityLabel);
    if (rank >= 0 && rank < lowestRank) {
      lowestRank = rank;
      lowest = QUALITY_LABEL_ORDER[rank] ?? null;
    }
  }
  return lowest ?? 'tiny';
}

export interface FallbackQualitySettings {
  enabled: boolean;
  fallbackQualityCapEnabled: boolean;
  forceQualityMax: QualityCap;
}

/**
 * Whether the fallback quality cap itself may run: the extension must be on, the feature enabled,
 * and the user's own maximum-quality choice (when set) untouched. `forceQualityMax` stays the only
 * quality writer in that case. The Music song preference is not a quality choice and is gated by
 * the feature toggle alone, so it deliberately does not consult this predicate.
 */
export function fallbackQualityEngaged(settings: FallbackQualitySettings): boolean {
  return (
    settings.enabled && settings.fallbackQualityCapEnabled && settings.forceQualityMax === 'off'
  );
}

/**
 * The YouTube Music song-mode control, or `null` when it is absent or song playback is already
 * selected. The element shape (verified against the live site 2026-10-16) is
 * `<ytmusic-av-toggle is-audio-playback-mode-selected="false">` containing
 * `<button class="song-button">`; when the item has no song counterpart the toggle is absent, so
 * absence is the availability check.
 */
export function findSongModeSwitch(root: ParentNode): Element | null {
  try {
    const toggle = root.querySelector('ytmusic-av-toggle');
    if (!toggle) return null;
    if (toggle.getAttribute('is-audio-playback-mode-selected') === 'true') return null;
    return toggle.querySelector('button.song-button');
  } catch {
    return null;
  }
}

/**
 * Prefer YouTube Music's native song playback by clicking the site's own toggle once. Returns
 * whether the click was dispatched; the page handles the rest (playback continues in place).
 */
export function switchToSongMode(root: ParentNode): boolean {
  const button = findSongModeSwitch(root);
  if (!button) return false;
  try {
    (button as HTMLElement).click();
    return true;
  } catch {
    return false;
  }
}
