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

**Cold-load config readiness (mobile).** On desktop `window.ytcfg` (and its `INNERTUBE_API_KEY`) is already hydrated when MAIN world first activates, so the key extraction is synchronous. Mobile YouTube (`ytm-app`) hydrates `ytcfg` _after_ the content script's `document_start` injection and fires no DOM or navigation event when it does, so a cold load would extract an empty key, bail to `fallback`/`not-a-watch-page`, and never retry (no SPA signal follows). When a watch page has a video id but no key yet, MAIN world therefore waits for the key with a bounded, generation-guarded poll (`waitForConfigReady`: 250 ms steps up to `VIDEO_WAIT_MS`) before giving up. The poll resolves early the instant the key appears, aborts to `null` if the generation is superseded (a navigation during the wait), and is a no-op on desktop and on genuine non-watch pages (no video id), so it adds no latency to any path that already has the key.

**Live-stream exclusion.** A currently-live (or DVR) broadcast returns `status: "OK"` and carries an audio `adaptiveFormat` with a url, but that url is a live-edge segment that stalls at `currentTime 0` when set as a progressive `<video>.src`. Before hijacking, MAIN world calls `isLiveStream(playerResponse)` and, if live, emits `fallback`/`live` and leaves YouTube's native DASH/HLS player in control. `isLiveStream` is true when `videoDetails.isLive === true`, or when the best audio format has no usable `contentLength` — a live/DVR edge stream is unbounded (no `contentLength`), whereas every finite VOD file (including a finished-stream ex-live replay) carries one. The `contentLength` signal is the direct "not a hijackable finite file" test; its failure mode is fail-safe (fall back to normal playback) and it also covers a live stream whose `isLive` flag is absent (empirical signal audit 2026-07-11, n=38: 11/11 live formats lacked `contentLength`, 27/27 VOD formats had it). The audio graph (loudness/EQ) still arms on the normal element. The audio-download path applies the same exclusion (a live edge is not a finite file).

`PlayerHandle` is the extension's sole `<video>.src` writer, and it writes only on attach. It snapshots playback state, changes the source once, restores time/rate/volume/mute and playing state after metadata, and installs a dormant prototype setter guard. The guard only intervenes if the page assigns a non-audio source to the active element. After three interventions it opens the circuit and stops fighting, letting YouTube's reasserted source stand. Operations never throw into page code. On teardown `PlayerHandle` never rewrites `<video>.src` (see below).

### Teardown and native reclaim

Every teardown (SPA navigate, re-attach, global disable, or the circuit breaker) routes through one `restore(reason)` path, and `restore` deliberately does not write `<video>.src`. The native source captured at attach time is a `blob:` URL backed by a MediaSource YouTube has already discarded; reassigning it silently stalls the element (`readyState 0`, no `MediaError`) and rewinds the listening position to the stale attach-time clock. Instead `restore` releases the dormant-guard prototype descriptor, clears internal state, fires the restore listeners (artwork teardown), and hands a `PlayerReleaseRecord` `{ element, ownedUrl, currentTime, paused }` plus a `PlayerReleaseReason` (`navigate` | `attach` | `circuit` | `disable`) to a single `onRelease` coordinator. `currentTime` is read live from the element before internal state is cleared, so it reflects where the hijacked audio actually is, not the attach-time snapshot. This keeps `PlayerHandle` the sole `<video>.src` writer: it simply stops writing a dead URL on teardown, so returning to native video becomes the coordinator's job.

The MAIN-world native-reclaim coordinator re-establishes native playback in place through YouTube's own player API, `#movie_player.loadVideoById({ videoId, startSeconds })`, at the live position. A released record becomes an actual reclaim only when the operation's terminal status resolves against native playback: `active` means a (re-)hijack owns the element, so the pending record is dropped; a terminal `disabled` or `fallback` triggers the reclaim; a circuit-breaker or disable release (which emits no following status) drives it via `queueMicrotask`. The reclaim is pinned to the exact `videoId` captured on the successful attach, so an SPA navigation (which changes the live videoId) never reloads the wrong video at the old position, and it is guarded by `element.src === ownedUrl` so it never fires once YouTube has reasserted its own source. It always uses `loadVideoById`, never `cueVideoById` (which only fetches a thumbnail and defers the media stream until `playVideo`/`seekTo`, re-stalling a paused release). For a paused release, `pauseVideo()` runs only after the freshly loaded media actually attaches (`readyState >= 2` or a one-shot `loadeddata`, bounded by `VIDEO_WAIT_MS`), because pausing synchronously right after `loadVideoById` is a race YouTube silently drops. The reclaim is one-shot and fail-open: no retry loops, no dual playback.

A fast re-toggle of the same video is a special case. Because the reclaim's `loadVideoById` leaves the native element transiently at `currentTime 0` and playing (`readyState 0`) while it reloads, a re-hijack that read the live element would resume the audio from that mid-reload transient (losing position and paused state). To prevent that, the reclaim arms a bounded `settlingReclaim` intent `{ videoId, currentTime, paused }` holding the pre-toggle-off values, cleared on the element's `loadeddata`, a `VIDEO_WAIT_MS` timeout, or consumption by a re-attach. While it is armed, a re-hijack of the same `videoId` passes that intent into `PlayerHandle.attach()`, so the audio inherits the real pre-toggle-off position/paused rather than the native element's transient. The intent `currentTime` is frozen at the toggle-off instant (not advanced for the elapsed reload), so a rapid re-toggle resumes anchored a couple of seconds behind, which is predictable and accepted. `pauseOnceLoaded` also bails once a hijack is active (`player.getMediaElement() !== null`) so a stale toggle-off pause callback cannot pause a freshly re-hijacked audio stream.

### Background playback

When enabled, MAIN world overrides `document.hidden` and `document.visibilityState` on the document instance and stops `visibilitychange` in capture phase. Disabling restores the original descriptors/listener behavior. Native `mediaSession` is untouched.

### SPA engine

One observer emits on initial load, `yt-navigate-finish`, URL changes discovered by a mutation observer, and player attachment changes (a change in the `<video>` element identity). Callers debounce work by generation.

**Player-element replacement (mobile).** On Firefox for Android the native audio reclaim does not re-source the hijacked `<video>` in place (which the `PlayerHandle` `.src` guard would catch); it detaches the hijacked element and installs a fresh one carrying the native source (`querySelectorAll('video')` stays at one across the swap, ~60-95 ms after our attach). The player-attachment signal above is exactly what recovers this: the new element is a different identity, so the observer emits `player-change`, the generation advances, and activation re-runs and re-hijacks the replacement through `PlayerHandle` (proven to hold with a single re-apply, no fight). The catch is scheduling: the mutation-driven check is deferred through `requestAnimationFrame`, and Fenix suspends rAF to a single frame after load (as does any hidden tab), which would strand the check and leave the native element owning playback. The mutation check therefore arms a bounded `setTimeout` fallback (`MUTATION_CHECK_MS` = 100 ms) alongside rAF; whichever fires first cancels the other, so a visible desktop tab keeps the paint-aligned fast path unchanged while a starved-rAF context (mobile, or a backgrounded tab) still detects the swap. The identity comparison means it only re-arms on a real element change, so it never loops on a stable element.

## Error Handling

All feature boundaries catch failures, emit a narrow status, and leave or restore normal YouTube playback. There are no automatic network retry loops and no credentialed fallback.

## Testing Strategy

- Unit tests cover playability/audio selection and PlayerHandle stale-generation/circuit behavior, and lock the teardown contract: `restore()` never rewrites `<video>.src` and reports the live `PlayerReleaseRecord`. A SPA-observer test locks the player-element-swap recovery: with `requestAnimationFrame` stubbed to never fire (the Fenix/hidden-tab condition), a `<video>` identity change still emits `player-change` through the timer fallback; removing the fallback deterministically fails it.
- Hermetic bench tests cover enabled/disabled fetch-to-hijack, live-stream fallback (no hijack), and visibility suppression. `m0:cold-config-hydration-activates` serves a watch page whose `INNERTUBE_API_KEY` is absent at `document_start` and appears ~600 ms later (simulating mobile `ytcfg` late-hydration), and asserts the extension waits and reaches `active` with a `/videoplayback` source rather than bailing to `not-a-watch-page`; with the wait removed the same case deterministically fails. `m0:element-swap-rehijack` locks the element-swap recovery integration: on detecting our hijack the fixture replaces the `<video>` with a fresh one (a different identity, same URL), and the case asserts the extension re-hijacks the replacement (the live swapped-in element carries a `/videoplayback` source, status `active`). The hermetic desktop bench cannot faithfully starve the injected main-world's `requestAnimationFrame`, so this case exercises the identity-change re-hijack path rather than the rAF-suspension condition itself; the suspension is red-green locked by the unit test above, and the full suspended-rAF path is validated end to end on real Fenix (below), where rAF is genuinely throttled.
- A non-gating live probe checks that the real page video becomes audio-only and its clock advances.
- The non-gating Fenix probe (`tests/e2e/android/probe-audio-hold.mjs`) exercises the real suspended-rAF path and audio decode on Firefox for Android: a cold `m.youtube.com/watch` load must reach `active`, the extension must re-hijack the native element replacement, and `/videoplayback` must remain on the swapped-in element. A trusted gesture works on both a headful emulator and a `-no-window` emulator; the earlier failures were foreground artifacts, not a display requirement. The probe dismisses Fenix's add-on confirmation, onboarding, and default-browser overlays through uiautomator, foregrounds the watch URL (`adb shell am start -W -a android.intent.action.VIEW -d <url> org.mozilla.fenix`), waits for the Play control, and taps it with `adb shell input tap`. It then requires `navigator.userActivation.hasBeenActive`, `paused === false`, `readyState === 4`, `muted === false`, advancing `currentTime`, and `/videoplayback` at every five-second sample for 45 seconds. It runs nightly as best-effort CI on x86_64 and was locally validated on arm64, so architecture-specific drift remains a canary caveat. One caveat observed under real playback that source-only probes miss: around 35-40 s some streams re-source to a different googlevideo host with a brief clock reset, then resume and keep holding audio-only (tracked as a follow-up).
- Release gates: typecheck, lint, unit coverage, integration bench, and Firefox MV2 build.

## Security Considerations

- The InnerTube request always uses `credentials: "omit"`.
- Bridge payloads are fixed booleans and bounded status strings. Signed URLs and player responses never cross the bridge.
- MAIN world accepts no URL or fetch command from the page.

## Rollout and Rollback

Audio-only and background playback default on but are independently instant-disableable. Any unsupported video or runtime failure automatically uses normal YouTube playback.
