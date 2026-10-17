# Specification: M9 Embedded Player Frames

## Overview

M9 extends the extension from the top-level watch page to embedded YouTube players running in
subframes (`youtube.com/embed/<id>`, `youtube-nocookie.com/embed/<id>`, and `youtube.com/v/<id>`
iframes on any page), with an explicit frame ownership model covering which frame hijacks, which
frame the controls target, how the popup resolves a tab, and what each frame reports.

## Goals

- Inject the content script into every matching frame (`all_frames` on the existing four YouTube
  match patterns) and inject the page world into each matching frame's document.
- Recognize embedded player URLs (`/embed/<id>` and `/v/<id>`) in the page world and in the shared
  URL classifier, in addition to `?v=` watch pages.
- Define a frame ownership model:
  - Hijack frame: every frame whose own document is a supported player page and owns a `<video>`
    runs its own acquisition generation and its own `PlayerHandle`. Frames never coordinate; each
    fails open independently.
  - Toggle target: settings stay global and are applied per frame; embedded players follow the
    global toggle. The per-tab override (SPEC-012 §5) reaches frames through the same settings push,
    so it also governs embeds in that tab.
  - Popup resolution: the per-tab status brain stays top-frame authoritative. Only the top frame
    reports status; subframe reports are never sent and (defense in depth) never accepted. A
    third-party page hosting an embed keeps resolving to `not-youtube`; embedded players are
    deliberately invisible to the popup because its controls are tab-scoped.
  - Per-frame status: each frame still computes its own status locally (for the diagnostics log),
    but only a top-frame report feeds the background map.
- Guard frames without media: a frame with no supported video id performs no fetch, and a frame
  whose player page has no `<video>` fails open through the existing bounded wait.
- No UI in subframes: the in-player toggle, download button, coach, tooltip, segment toast, and the
  distraction stylesheet stay top-frame only. Loudness/EQ, ad pruning, telemetry blocking,
  background-play visibility override, and segment skipping remain per document, because they act
  on that document's media.
- Disclose frame processing: the AMO submission notes and the consent copy state that player pages,
  including embedded players loaded inside iframes on other sites, are processed under the same
  websiteContent disclosure.

## Non-Goals

- Cross-frame coordination, frame-to-frame messaging, or hijacking media that belongs to another
  frame's document.
- Shorts URL parsing (`/shorts/<id>`); unchanged from today.
- UI in subframes, popup controls for embedded players, or per-frame tab overrides.
- Accepting reports from or targeting subframes in the background, and any new match pattern or
  fetch origin (the four YouTube patterns stay the only content-script matches).

## Technical Design

### Injection and frame identity

`entrypoints/content.ts` runs in every matching frame. Each instance injects its own page world
(`/main-world.js`) into its own document and owns a per-frame bridge nonce for the existing
same-origin `postMessage` settings/status channels. A frame is a player frame when its own URL
resolves a supported video id; it is the top frame when `window.top === window.self` (the
comparison is safe cross-origin because it reads no properties).

### URL model

The page world's `getVideoId` and the shared classifier (`src/shared/status.ts`
`parseVideoId`/`isWatchPage`) accept the same three forms on the four host patterns:
`/watch?...v=<id>`, `/embed/<id>`, and `/v/<id>`. The id validates against the existing
`[A-Za-z0-9_-]{6,20}` pattern. All other paths resolve `null`, so a frame that is not a player page
takes the existing not-a-watch-page path without fetching.

### Frame ownership

- The hijack frame is the frame whose document contains the media element being hijacked. Each
  player frame runs the existing per-document pipeline independently: generation, credentialless
  media-client walk, playability gate, `PlayerHandle` attach, loudness/EQ, and segment skipping.
  The background response filter and telemetry/ad blocking are URL-scoped and already
  frame-agnostic.
- All quick controls act on the tab (SPEC-012 §5; ADR-0014): the popup hero, the in-player toggle,
  and `Alt+Shift+A` set the tab's in-memory override, while the options page remains the global
  editor. Every frame applies the effective value instantly through the settings push, so an
  override keys on the top frame's tab and governs every frame of that tab.
- Popup resolution is unchanged at the tab level: `resolveUiState` classifies the tab URL and the
  authoritative top-frame report. With embed URL support, a top-level `/embed/<id>` page resolves
  like a watch page (its status was previously `not-a-watch-page`), which is the one intentional
  popup behavior change.
- Per-frame status: the content script sends `yta:status-update` only when `window.top ===
window.self`; the background additionally accepts only `sender.frameId === 0` (the existing
  gate, kept as defense in depth). A subframe's page-world status events stay local to that frame.

### UI scoping

Top-frame only: the in-player control, download button, coach, tooltip, segment toast, and the
distraction stylesheet. Each mount path lives in the content script behind a single `isTopFrame`
check, so a subframe never injects visible UI into an embed.
Per-document (all frames): media acquisition, loudness/EQ, segment skipping, the background-play
visibility override, and the ad/telemetry paths.

## Error Handling

Every frame fails open independently: no video id means no fetches; no media element means no
writes; any fetch, parse, attach, or media failure falls back to native playback inside that frame.
A subframe can never affect the top frame's playback or the reported tab status.

## Testing Strategy

- Unit tests cover the shared URL classifier's new forms (`/embed/<id>`, `/v/<id>`, and rejections
  for malformed ids and unrelated paths) and the top-frame-only report rule (a pure helper used by
  the background gate).
- The hermetic bench serves an iframe host page embedding a player frame (`/embed/<id>`): the case
  asserts the embed frame hijacks (its own `<video>` carries a `/videoplayback` source and reaches
  `active`), the embed frame contains no injected extension UI, and the top-level status/popup
  classification is unaffected.
- Existing benches (watch-page flow, media-client rotation, element swap, settings matrix) stay
  green; enabling `all_frames` must not change top-frame behavior.
- Release gates: strict typecheck, zero-warning lint, real-source unit coverage, packaged Firefox
  bench, and the MV2 build.

## Security Considerations

- The four match patterns and the credentialless fetch-origin permissions are unchanged; no new
  origins are added.
- Bridge payloads stay bounded booleans and status codes per frame; no signed URLs or player
  responses cross any frame boundary or the bridge.
- Subframes cannot influence tab-level popup state (top-frame authoritative, enforced at both send
  and accept).

## Rollout and Rollback

Embedded player support rides the existing global toggle and can be disabled instantly; frames
without support fall back to native playback as today. Rolling back is shipping the previous build;
no persisted state needs migration.
