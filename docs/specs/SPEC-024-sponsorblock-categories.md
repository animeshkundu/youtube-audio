# SPEC-024: SponsorBlock category UX

**Status:** Draft
**Date:** 2026-10-17
**Depends on:** SPEC-005 (segment skipping), SPEC-013 (consent)
**Relates to:** Issue #53 (filter by category)

## 1. Goal

Expand SponsorBlock category support from 2 to all 11 SponsorBlock categories, with a minimal UI surface: 2 top-level toggles (sponsor, music_offtopic) plus a collapsed "All categories" disclosure for the remaining 9. Categories are opt-in beyond the defaults. Privacy-preserving: only the 16-bit hash prefix + category filter leaves the device.

## 2. Non-goals

- No top-level rows for all 11 categories (would be a taxonomy wall).
- No "Show (timeline color)" mode unless timeline coloring ships.
- No new network egress (same API call, same prefix).

## 3. Design

### 3.1 Category set

`SPONSOR_CATEGORIES` = [
'sponsor', 'selfpromo', 'interaction', 'intro', 'outro',
'preview', 'music_offtopic', 'filler', 'exclusive_access',
'poi_highlight', 'hook'
]

### 3.2 Defaults

- `segmentSkipCategories`: `['sponsor', 'music_offtopic']` (unchanged default).
- New categories are opt-in (not auto-enabled for existing users).

### 3.3 Data model

- `isSponsorCategory` recognizes all 11 categories.
- `normalizeSponsorCategories` filters by `isSponsorCategory`.
- `setSegmentSkipCategory` adds/removes from the enabled set, filtered to valid categories.
- `selectSegments` filters by enabled categories (unchanged).

### 3.4 UI (minimal surface)

- 2 top-level SettingRows: "Sponsored segments" and "Non-music segments".
- Collapsed `<details>` "All categories" with 9 compact SettingRows (Auto-skip/Off only).
- Each row: label + description + switch. No color chips (unless timeline coloring ships).
- Visible only when `segmentSkipEnabled` is true.

### 3.5 Fail-open

- Unknown categories filtered by `isSponsorCategory`. No broken skipping.
- If API returns segments for categories not in our set, they are ignored.
- Seek budget: at most one skip per `timeupdate` pass (existing guard).

## 4. Test strategy

- Unit: parse/filter/merge with all 11 categories.
- Bench: matrix row with all categories enabled.
- Manual: verify collapsed disclosure renders correctly.

---

_Spec written per "no spec, no code" rule._
