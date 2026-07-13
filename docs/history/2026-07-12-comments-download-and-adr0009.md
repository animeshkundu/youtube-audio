# Handoff: Comments-preserving recommendations, compatible downloads, and ADR-0009 caveat

## Date

2026-07-12

## Summary

A real-YouTube-driven correctness batch on branch `rebuild` (PR #65). It narrows the "Hide
recommendations" selector so it can no longer collapse comments, upgrades the hermetic bench
fixture to model the real comments and recommendations DOM nesting so the bug is now reproducible,
switches the audio download to the widely compatible AAC `.m4a` (itag 140) format, and records a
live-classification caveat on ADR-0009's deferred Path A. No hard invariant changed: logged-out
only, credentialless `ANDROID_VR`, `PlayerHandle` as the sole `<video>.src` writer, fail-open to
native playback, and the page-world trust boundary all hold.

## Key changes

### Hide-recommendations no longer collapses comments (task #76)

- `hideRecommendations` previously hid the whole `ytd-watch-flexy #secondary` container. On the wide
  two-column layout that could collapse comments even when `hideComments` was off. The selector is
  now scoped to the recommendations renderer, `ytd-watch-flexy #secondary
ytd-watch-next-secondary-results-renderer` (plus the existing `#related` and mobile anchors), so
  it never touches a comments node.
- Verified on real YouTube (music video `dQw4w9WgXcQ`, headful Firefox, logged out) at 1400 / 1000 /
  700 px. The visible comments block (`ytd-comments#comments`) always lives in `#primary`, never in
  `#secondary`. However a comments-bearing engagement panel
  (`ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` with a
  nested `ytd-comments`) is reparented into `#secondary-inner` at the wide layout and moves back to
  `#primary` at narrow widths. So the broad `#secondary { display: none }` genuinely could hide a
  comments node; the narrowed selector cannot.
- Files: `src/shared/quality-of-life.ts` (`buildDistractionStyles`),
  `tests/unit/quality-of-life.test.ts`.

### Bench fixture models the real comments and recommendations nesting (task #76)

- The hermetic fixture (`tests/e2e/bench/fixture-server.mjs`) previously modeled `ytd-comments` as a
  sibling of `ytd-watch-flexy`, so it never reproduced the bug. It now mirrors the real nesting:
  `#primary > #primary-inner > #below > ytd-comments#fixture-comments` for the visible comments, and
  `#secondary > #secondary-inner` holding both a `#panels > engagement-panel >
ytd-comments#fixture-secondary-comments` (the reparented mirror) and `#related >
ytd-watch-next-secondary-results-renderer#fixture-recs` for recommendations.
- The bench (`tests/e2e/bench/run-bench.mjs`) now measures `recsHidden` via `#fixture-recs` (not the
  `#secondary` container) and adds a `secondaryPanelCommentsHidden` measurement, plus a new named
  scenario `m3b:hide-recs-preserves-comments` (Hide-recommendations ON with Hide-comments OFF asserts
  recommendations hidden while both comments nodes stay visible). The settings-permutation matrix
  (`run-matrix.mjs`) already exercises both directions of `hideRecommendations` and picks this up
  automatically. Full bench is 47/47 PASS.

### Compatible audio download (.m4a / AAC itag 140) (task #74)

- Downloads now ship AAC itag 140 (`.m4a`, plays almost everywhere, zero transcoding) instead of Opus
  itag 251 (`.webm`). This is driven by `pickBestAudioFormat(playerResponse, true)` in
  `src/shared/innertube.ts` (the `preferCompatible` argument), called from the download path in
  `entrypoints/main-world.ts`. In-page playback still prefers Opus itag 251 for quality.
- A live real-YouTube repro (audio-only OFF, our in-player download button, music video) confirmed the
  button performs exactly one `browser.downloads.download()` call and lands exactly one `.m4a` file,
  identical whether audio-only is ON or OFF (checked via `browser.downloads.search`). The
  user-reported "whole host of `.webm` files" is not produced by our code: the extension has a single
  download call site in `entrypoints/background.ts`. It is attributable either to pre-itag-140
  behavior or to YouTube's own in-memory adaptive-streaming range requests, which never reach the OS
  Downloads folder.
- MP3 and MP4 were considered and rejected: they need heavy in-browser transcoding (wasm / ffmpeg),
  whereas `.m4a` and `.webm` are zero-transcode remuxes of the already-fetched stream. The bench
  scenario `m5:download-enabled-initiates-selected-audio` now asserts the `.m4a` / itag-140 outcome.

### ADR-0009 Path A live-classification caveat (task #75)

- ADR-0009 (deferred ad-free video mode) gained a caveat: a future Path A (itag-18 progressive
  hijack) cannot simply reuse the existing live gates. `isLiveStream` (`src/shared/innertube.ts`) keys
  on the best adaptive audio format lacking `contentLength`, so a progressive itag-18-only live
  response without `videoDetails.isLive` could be misclassified as VOD. A progressive-video path needs
  its own live/finite check. The caveat is already in the ADR (commit `026f639`); this batch only
  keeps the spec cross-references consistent.

## Docs updated

- `docs/specs/SPEC-008-m5-audio-download.md`: recorded the `.m4a` / AAC itag-140 download-format
  preference (playback still prefers Opus itag 251) and the single-file guarantee.
- `docs/specs/SPEC-006-m3b-quality-of-life.md`: recorded the narrowed recommendations selector and
  why it spares comments, plus the new bench scenario.
- `docs/adrs/0009-ad-free-video-mode-android-vr.md`: already carries the Path A live/finite caveat
  (commit `026f639`); no further edit needed.

## Verification

Covered by the existing gate (`npm run validate`: typecheck, lint, format:check, unit + coverage,
build MV2, `web-ext lint`, build MV3) plus the hermetic bench (47/47 PASS) and the manual
real-YouTube checks noted above. The relevant coverage for this batch:

- `tests/unit/quality-of-life.test.ts`: `buildDistractionStyles` emits the narrowed recommendations
  selector and never a bare `#secondary` rule.
- `tests/e2e/bench/run-bench.mjs`: `m3b:hide-recs-preserves-comments` (recommendations hidden, both
  comments nodes visible) and `m5:download-enabled-initiates-selected-audio` (`.m4a` / itag-140).

## Follow-ups still open

- **Adblock parser gap (task #69):** the page-world `fetch` + `Response.json()` download path still
  parses the player response without the ad-field pruning that `background.ts:filterPlayerResponse`
  applies to the buffered player response. Reconcile the two.
- **Options UI polish (task #72):** raise equalizer-band control contrast and fix the diagnostics
  panel scrollbars.
- **Ad-free video mode (ADR-0009):** remains deferred. If Path A is ever pursued, it needs the
  progressive-specific live/finite check recorded in the ADR.
