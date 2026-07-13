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

**Live-stream exclusion.** A currently-live (or DVR) broadcast returns `status: "OK"` and carries an audio `adaptiveFormat` with a url, but that url is a live-edge segment that stalls at `currentTime 0` when set as a progressive `<video>.src`. Before hijacking, MAIN world calls `isLiveStream(playerResponse)` and, if live, emits `fallback`/`live` and leaves YouTube's native DASH/HLS player in control. `isLiveStream` is true when `videoDetails.isLive === true`, or when the best audio format has no usable `contentLength` — a live/DVR edge stream is unbounded (no `contentLength`), whereas every finite VOD file (including a finished-stream ex-live replay) carries one. The `contentLength` signal is the direct "not a hijackable finite file" test; its failure mode is fail-safe (fall back to normal playback) and it also covers a live stream whose `isLive` flag is absent (empirical signal audit 2026-07-11, n=38: 11/11 live formats lacked `contentLength`, 27/27 VOD formats had it). The audio graph (loudness/EQ) still arms on the normal element. The audio-download path applies the same exclusion (a live edge is not a finite file).

`PlayerHandle` is the extension's sole `<video>.src` writer, and it writes only on attach. It snapshots playback state, changes the source once, restores time/rate/volume/mute and playing state after metadata, and installs a dormant prototype setter guard. The guard only intervenes if the page assigns a non-audio source to the active element. After three interventions it opens the circuit and stops fighting, letting YouTube's reasserted source stand. Operations never throw into page code. On teardown `PlayerHandle` never rewrites `<video>.src` (see below).

### Teardown and native reclaim

Every teardown (SPA navigate, re-attach, global disable, or the circuit breaker) routes through one `restore(reason)` path, and `restore` deliberately does not write `<video>.src`. The native source captured at attach time is a `blob:` URL backed by a MediaSource YouTube has already discarded; reassigning it silently stalls the element (`readyState 0`, no `MediaError`) and rewinds the listening position to the stale attach-time clock. Instead `restore` releases the dormant-guard prototype descriptor, clears internal state, fires the restore listeners (artwork teardown), and hands a `PlayerReleaseRecord` `{ element, ownedUrl, currentTime, paused }` plus a `PlayerReleaseReason` (`navigate` | `attach` | `circuit` | `disable`) to a single `onRelease` coordinator. `currentTime` is read live from the element before internal state is cleared, so it reflects where the hijacked audio actually is, not the attach-time snapshot. This keeps `PlayerHandle` the sole `<video>.src` writer: it simply stops writing a dead URL on teardown, so returning to native video becomes the coordinator's job.

The MAIN-world native-reclaim coordinator re-establishes native playback in place through YouTube's own player API, `#movie_player.loadVideoById({ videoId, startSeconds })`, at the live position. A released record becomes an actual reclaim only when the operation's terminal status resolves against native playback: `active` means a (re-)hijack owns the element, so the pending record is dropped; a terminal `disabled` or `fallback` triggers the reclaim; a circuit-breaker or disable release (which emits no following status) drives it via `queueMicrotask`. The reclaim is pinned to the exact `videoId` captured on the successful attach, so an SPA navigation (which changes the live videoId) never reloads the wrong video at the old position, and it is guarded by `element.src === ownedUrl` so it never fires once YouTube has reasserted its own source. It always uses `loadVideoById`, never `cueVideoById` (which only fetches a thumbnail and defers the media stream until `playVideo`/`seekTo`, re-stalling a paused release). For a paused release, `pauseVideo()` runs only after the freshly loaded media actually attaches (`readyState >= 2` or a one-shot `loadeddata`, bounded by `VIDEO_WAIT_MS`), because pausing synchronously right after `loadVideoById` is a race YouTube silently drops. The reclaim is one-shot and fail-open: no retry loops, no dual playback.

### Background playback

When enabled, MAIN world overrides `document.hidden` and `document.visibilityState` on the document instance and stops `visibilitychange` in capture phase. Disabling restores the original descriptors/listener behavior. Native `mediaSession` is untouched.

### SPA engine

One observer emits on initial load, `yt-navigate-finish`, URL changes discovered by a mutation observer, and player attachment changes. Callers debounce work by generation.

## Error Handling

All feature boundaries catch failures, emit a narrow status, and leave or restore normal YouTube playback. There are no automatic network retry loops and no credentialed fallback.

## Testing Strategy

- Unit tests cover playability/audio selection and PlayerHandle stale-generation/circuit behavior, and lock the teardown contract: `restore()` never rewrites `<video>.src` and reports the live `PlayerReleaseRecord`.
- Hermetic bench tests cover enabled/disabled fetch-to-hijack, live-stream fallback (no hijack), and visibility suppression.
- A non-gating live probe checks that the real page video becomes audio-only and its clock advances.
- Release gates: typecheck, lint, unit coverage, integration bench, and Firefox MV2 build.

## Security Considerations

- The InnerTube request always uses `credentials: "omit"`.
- Bridge payloads are fixed booleans and bounded status strings. Signed URLs and player responses never cross the bridge.
- MAIN world accepts no URL or fetch command from the page.

## Rollout and Rollback

Audio-only and background playback default on but are independently instant-disableable. Any unsupported video or runtime failure automatically uses normal YouTube playback.
