# Handoff: embedded player frames (CP3 item 1.1)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP3 item 1.1 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`, specified
as SPEC-015: embedded player frames. Per-tab scope, idle-nag defeat, fallback quality, and the
consent UX items of CP3 remain open.

## Changes

### Frame model

- `wxt.config.ts`: the four YouTube match patterns stay exactly as they were; `all_frames: true` is
  added in the same manifest hook. Every matching frame gets the content script, and in the shipping
  MV2 build WXT inlines the fetched page-world text into each frame's document, so no
  `web_accessible_resources` change is needed on the shipping path.
- `src/shared/status.ts`: `parseVideoId` accepts the watch-page `?v=` query and the embedded-player
  path forms `/embed/<id>` and `/v/<id>`, so `isWatchPage` and the popup's `resolveUiState` classify
  a top-level embed like a watch page. New pure `acceptsFrameReport(frameId)` encodes the
  top-frame-only report rule for the background gate.
- `entrypoints/main-world.ts`: `getVideoId` delegates to the shared `parseVideoId` instead of its
  private `?v=` parser, so the page world and the popup share one URL model.
- `entrypoints/content.ts`: a module-level `isTopFrame()` (`window.top === window.self`, safe
  cross-origin) gates UI mounting (`installPlayerControls`), the visible settings application
  (`updateToggle`, `updateDownloadButton`, `updateDistractionStyle`), and the `yta:status-update`
  push to the background. Settings still reach every frame through the existing push, and the local
  status marker still updates per frame for diagnostics and the bench.
- `entrypoints/background.ts`: the status-update handler keeps its top-frame gate, now through
  `acceptsFrameReport(sender.frameId)` as defense in depth.

### Disclosure

- Consent screen (`entrypoints/consent/App.tsx`): the `www.youtube.com` flow now names the current
  client rotation (VisionOS first, Android VR fallback; ADR-0012) instead of the stale "Android VR"
  text, and states that an embedded player sends the same request for the video it frames.
- `docs/amo-resubmission-notes.md`: a "what changed" bullet and the player-POST trigger cell cover
  embedded frames.
- `website/src/pages/privacy.astro`: the audio-lookup row mentions embedded players.

## Safety

- No new match patterns, origins, or permissions. Frames without a supported video id take the
  existing not-a-watch-page path without fetching, and every frame fails open independently.
- Subframes can neither mount UI nor feed the tab status map: the send gate is in the content
  script and the accept gate stays in the background.
- Bridge payloads stay bounded settings booleans and status codes per frame; no media URLs or
  player responses cross any frame boundary.

## Testing

- `npm run validate` green (typecheck, lint, format, 318 unit tests, MV2 build, web-ext lint, MV3
  build); the built MV2 and MV3 manifests carry `all_frames: true` with the same four matches.
- New unit coverage: `/embed/<id>` and `/v/<id>` parsing (including malformed ids, trailing paths,
  and the host-classification split), embed watch-page classification, and the `acceptsFrameReport`
  rule.
- New hermetic bench case `m9:embedded-frame-hijacks-audio-only-without-ui`: the fixture serves an
  `/embed/<id>` player page and a `/frame-host` page that frames it; the case asserts the frame
  hijacks with a `/videoplayback` source and reaches `active`, carries no toggle, download button,
  tooltip, segment toast, or distraction stylesheet, and that the top document neither hijacks nor
  inherits the frame's status.
- The local hermetic bench cannot launch Firefox inside the agent sandbox (Selenium startup
  timeout), so the CI run on push is the first execution of the new case; the existing watch-page,
  rotation, element-swap, and settings-matrix cases run on the same push.

## Follow-up fix: top-document status (first CI execution, 2026-10-16)

The first CI run of `m9:embedded-frame-hijacks-audio-only-without-ui` failed on every Firefox
version because the case expected the framing top document to report no status at all. The honest
behavior is that the top document runs the extension like any non-watch page and reports its own
`fallback` / `not-a-watch-page` outcome; the case now asserts exactly that, alongside the unchanged
frame-hijack and no-subframe-UI assertions. The frame's `active` status and the top document's
fallback stay distinct, which is the ownership property the case exists to pin.

## Follow-ups

- CP3 items 1.2 (per-tab scope, ADR-0014), 1.3 (idle-nag defeat), 1.4 (fallback quality), and 1.5
  (consent UX + optional permissions) are next, then CP4 plus hygiene.
- The MV3 capability artifact still has no `web_accessible_resources` for `main-world.js`, so its
  page-world injection path (`script.src`) would need that entry if MV3 ever becomes a runtime
  target; MV2 ships the inline-text path and is unaffected. Candidate for the CP4 hygiene bucket,
  together with a real-MV3 runtime smoke check.
- Re-run the residential canary before the 1.1.0 release and refresh its evidence.
