# Specification: M1 Core Playback

## Overview

M1 adds credentialless audio-only playback, background playback, instant settings, and an in-player control while preserving native YouTube playback on every unsupported or failed path.

## Goals

- Fetch the ANDROID_VR player response with `credentials: "omit"` on normal watch pages.
- Select a direct audio format and hijack the existing `<video>` element so native controls remain usable.
- Fall open when playability, response shape, DOM state, or media attachment is unsuitable.
- Apply audio-only and background-play settings instantly across popup, content, and MAIN-world contexts.
- Handle YouTube SPA navigation without stale async work affecting the next video.

## Non-Goals

- Authenticated playback, live/kids/age-restricted bypasses, separate audio-element fallback, EQ, ads, downloads, or telemetry filtering.
- Sending signed media URLs or complete player responses across world boundaries.

## Technical Design

### State and bridge

`config.ts` stores `enabled`, `audioOnlyEnabled`, and `backgroundPlayEnabled` as one validated settings object in extension local storage. Signals update optimistically and storage events synchronize extension contexts. The isolated content script sends only boolean settings to MAIN world in a namespaced same-origin `postMessage`; MAIN world sends only a bounded status code and optional reason back.

### Audio-only flow

On each watch navigation, MAIN world increments a generation, extracts the video id and API key, issues the pinned ANDROID_VR request with omitted credentials, verifies `playabilityStatus.status === "OK"`, selects a direct audio URL (itag 251, then 140, then highest-bitrate audio), waits for the page video, and asks `PlayerHandle` to attach it. Stale generations abort without modifying media.

**Live-stream exclusion.** A currently-live (or DVR) broadcast returns `status: "OK"` and carries audio `adaptiveFormats` with urls, but those urls are live-edge segments that stall at `currentTime 0` when set as a progressive `<video>.src`. Before hijacking, MAIN world calls `isLiveStream(playerResponse)` (true when `videoDetails.isLive`, or `isLiveContent` alongside an `hlsManifestUrl`/`dashManifestUrl`) and, if live, emits `fallback`/`live` and leaves YouTube's native DASH/HLS player in control. The audio graph (loudness/EQ) still arms on the normal element. The audio-download path applies the same exclusion (a live edge is not a finite file).

`PlayerHandle` is the extension's sole `<video>.src` writer. It snapshots playback state, changes the source once, restores time/rate/volume/mute and playing state after metadata, and installs a dormant prototype setter guard. The guard only intervenes if the page assigns a non-audio source to the active element. After three interventions it opens the circuit and restores native playback. Operations never throw into page code.

### Background playback

When enabled, MAIN world overrides `document.hidden` and `document.visibilityState` on the document instance and stops `visibilitychange` in capture phase. Disabling restores the original descriptors/listener behavior. Native `mediaSession` is untouched.

### SPA engine

One observer emits on initial load, `yt-navigate-finish`, URL changes discovered by a mutation observer, and player attachment changes. Callers debounce work by generation.

## Error Handling

All feature boundaries catch failures, emit a narrow status, and leave or restore normal YouTube playback. There are no automatic network retry loops and no credentialed fallback.

## Testing Strategy

- Unit tests cover playability/audio selection and PlayerHandle stale-generation/circuit behavior.
- Hermetic bench tests cover enabled/disabled fetch-to-hijack, live-stream fallback (no hijack), and visibility suppression.
- A non-gating live probe checks that the real page video becomes audio-only and its clock advances.
- Release gates: typecheck, lint, unit coverage, integration bench, and Firefox MV2 build.

## Security Considerations

- The InnerTube request always uses `credentials: "omit"`.
- Bridge payloads are fixed booleans and bounded status strings. Signed URLs and player responses never cross the bridge.
- MAIN world accepts no URL or fetch command from the page.

## Rollout and Rollback

Audio-only and background playback default on but are independently instant-disableable. Any unsupported video or runtime failure automatically uses normal YouTube playback.
