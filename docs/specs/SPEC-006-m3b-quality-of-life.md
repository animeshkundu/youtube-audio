# Specification: M3b Quality-of-Life Controls

## Overview

M3b adds a curated set of instant, independently toggleable YouTube controls: a video-quality cap, autoplay-next suppression, and cosmetic hiding for Shorts, recommendations, comments, thumbnails, and avatars. Every unsupported or failed path preserves native YouTube behavior.

## Goals

- Offer a selectable maximum quality from 144p through 1080p, with off as the default.
- Apply the quality ceiling through the MAIN-world player API and reassert it for a bounded period when YouTube's adaptive bitrate logic changes quality.
- Disable the native autoplay-next control when requested.
- Hide Shorts shelves, recommendations, comments, video thumbnails, and channel avatars with one extension-managed stylesheet and resilient desktop/mobile selectors.
- Apply all settings immediately without reload.
- Avoid persistent page-visible setting attributes or globals.

## Non-Goals

- No unlimited retry loop, player prototype override, DOM deletion, remote configuration, or claim that undocumented player APIs always exist.
- No interception of manual playback, playlists, channel trailers, or feed thumbnail previews.
- No structural rewriting of YouTube data responses for cosmetic features.
- No network-level blocking or rewriting of thumbnail/avatar images (`i.ytimg.com` and friends); the thumbnail and avatar controls are CSS hiding only.

## Technical Design

### Settings

The shared settings object adds `forceQualityMax`, `disableAutoplayNext`, `hideShorts`, `hideRecommendations`, `hideComments`, `hideThumbnails`, and `hideAvatars`. Quality defaults to `off`; all boolean controls default to `false`. Storage normalization accepts only the enumerated quality values and booleans, preserving safe defaults for old or malformed state.

### MAIN-world controls

The MAIN-world entrypoint feature-detects `#movie_player` or `.html5-video-player`. When a quality ceiling is active it calls `setPlaybackQualityRange(label, label)` and `setPlaybackQuality(label)`, where the user-facing resolution maps to YouTube's internal quality label. It listens for the player's playback-quality-change event when available and performs only a bounded sequence of delayed reassertions. Missing or throwing APIs are no-ops.

Autoplay suppression inspects `.ytp-autonav-toggle-button`. It clicks only when the control reports `aria-checked="true"`, using YouTube's native state transition. Initial load, SPA navigation, and a bounded delayed retry cover late player controls. On a slow load where the button renders past the last fixed retry, a bounded `MutationObserver` fallback (scoped to `childList` + `subtree` with an `aria-checked` `attributeFilter`) still switches a late-appearing or late-toggled control off, then disconnects on success or at a 10s hard cap, mirroring the event-driven reassertion the quality path gets from the player's quality-change event. Disabling the extension does not turn autoplay on or otherwise change native state.

### Cosmetic controls

The isolated content script owns one `<style>` element. A pure stylesheet builder emits only the rules selected by effective settings. Rules target semantic `ytd-*`, `ytm-*`, and stable watch-page anchors. Updating settings replaces the style text; disabling a toggle removes its rules. No persistent settings attributes are written to the page.

Recommendation hiding is scoped to the related-results renderer (`ytd-watch-flexy #secondary ytd-watch-next-secondary-results-renderer`, plus `#related` and the mobile anchors), never the whole `#secondary` container. On the wide two-column layout YouTube reparents a comments-bearing engagement panel into `#secondary`, so hiding the container could collapse comments even when `hideComments` was off. The visible comments block always lives in `#primary`; scoping to the renderer keeps both comments nodes safe.

Thumbnail hiding targets the semantic tile containers `ytd-thumbnail` and `ytd-playlist-thumbnail` on desktop and, on mobile, the media-item thumbnail containers m.youtube.com actually ships (`ytm-large-media-item .large-media-item-thumbnail-container`, plus the `video-thumbnail-container-large` / `video-thumbnail-container-compact` classes). Avatar hiding targets comment rows (`ytd-comments #author-thumbnail`, the ImprovedTube-vetted selector recorded in `docs/research/10-quality-of-life-ux.md`), the watch-page owner row (`ytd-video-owner-renderer #avatar`), home-feed tiles (`ytd-rich-grid-media #avatar`), and the channel header (`#channel-header-container yt-img-shadow#avatar`). Both rules are `display: none` only: no image request is ever blocked, rewritten, or downgraded, so player posters, channel art, and the download flow are untouched, and no mobile avatar selector is claimed beyond the verified desktop set.

## Error Handling

All DOM queries, player calls, event registration, timer work, and style installation are guarded. Failures stop only the relevant enhancement and never throw into page code or interrupt playback.

## Testing Strategy

- Unit tests import the real stylesheet builder and quality-label selector, covering every setting independently, combined settings, disabled settings, valid quality mappings, and malformed/off values.
- The packaged-extension bench exposes a player API stub plus Shorts, recommendation, comments, thumbnail, and avatar fixtures. It verifies quality API arguments, autoplay state, computed cosmetic visibility, and untouched behavior when controls are off. The `m3b:hide-recs-preserves-comments` scenario asserts that hiding recommendations leaves both the primary and the reparented-panel comments nodes visible. The `m3b:disable-autoplay-late-button` scenario inserts the autonav button at 3.5s (past the last fixed retry) and asserts the `MutationObserver` fallback still switches it off. The settings-permutation matrix carries `hideThumbnails` and `hideAvatars` through its per-toggle and pairwise coverage, and the fixture places both probe nodes outside every conditionally hidden container so a combined combo cannot pass on an inherited `display: none`.
- Release gates: strict typecheck, zero-warning lint, gate-weakener scan, real-source coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

Settings cross from isolated content to MAIN world through the existing nonce-authenticated structured-clone message. Cosmetic state is represented only by CSS rules in an extension-managed style element rather than page attributes. No new permissions, network calls, page globals, or remote inputs are introduced.

## Performance Considerations

Cosmetic filtering is CSS-only and uses one style node. Player reassertion is bounded and cleaned up on settings changes. No perpetual observer or interval is introduced for these controls.

## Rollout and Rollback

Every control is independently instant-disableable and defaults off. Global disable removes cosmetic rules and stops future player actions. Existing player state is otherwise left untouched, which is the fail-open rollback behavior.
