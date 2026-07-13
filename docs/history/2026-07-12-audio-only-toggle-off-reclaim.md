# Handoff: Audio-only toggle-off reclaims native playback in place

## Date

2026-07-12

## Summary

A P0 fix on branch `rebuild` (PR #65), verified on real headful Firefox against a real YouTube
music video, logged out. Toggling audio-only OFF used to stall the video indefinitely (stuck at
`readyState 0`, no `MediaError`) and reset the playback position to 0. Teardown now hands the live
release state to a MAIN-world coordinator that re-establishes native playback in place through
YouTube's own player API at the live position. No hard invariant changed: logged-out only,
credentialless `ANDROID_VR`, `PlayerHandle` as the sole `<video>.src` writer, fail-open to native
playback, and the page-world trust boundary all hold.

## Root cause

`PlayerHandle.restore()` (`src/shared/player.ts`) reassigned the native `blob:` src it had captured
at attach time. That blob is backed by a MediaSource YouTube had already discarded, so reassigning it
silently stalled the `<video>` (`readyState 0`, no `MediaError`). `restore()` also restored the stale
attach-time `currentTime`, discarding the user's listening position.

## Key changes

### PlayerHandle stops writing a dead URL on teardown (`src/shared/player.ts`)

- `restore()` no longer writes `<video>.src` on teardown at all. It releases the dormant-guard
  prototype descriptor, clears internal state, fires the restore listeners (artwork teardown), and
  hands a `PlayerReleaseRecord` `{ element, ownedUrl, currentTime, paused }` plus a
  `PlayerReleaseReason` (`navigate` | `attach` | `circuit` | `disable`) to a single `onRelease`
  coordinator.
- `currentTime` is read live from the element BEFORE internal state is cleared, so it reflects where
  the hijacked audio actually is, not the stale attach-time snapshot. `ownedUrl` lets the coordinator
  prove the element still holds our URL.
- This keeps `PlayerHandle` the sole `<video>.src` writer (it now writes only on attach and simply
  stops writing a dead URL on teardown) and stays fail-open.
- Files: `src/shared/player.ts`, `tests/unit/player.test.ts`.

### MAIN-world native-reclaim coordinator (`entrypoints/main-world.ts`)

- A coordinator re-establishes native playback in place via `#movie_player.loadVideoById({ videoId,
startSeconds })` at the live position. Resolution is driven by the operation's terminal status:
  `active` means a (re-)hijack owns the element, so the pending record is dropped; a terminal
  `disabled`/`fallback` triggers the reclaim; a circuit-breaker/disable release (which emits no
  following status) drives it via `queueMicrotask`.
- The reclaim is pinned to the exact `videoId` captured on the successful attach, so an SPA navigation
  (which changes the live videoId) never reloads the wrong video at the old position, and it is
  guarded by `element.src === ownedUrl` so it never fires once YouTube has reasserted its own src.
- It always uses `loadVideoById`, never `cueVideoById` (`cueVideoById` only fetches a thumbnail and
  defers the media stream until `playVideo`/`seekTo`, which re-stalls a paused release). For a paused
  release, `pauseVideo()` is called only AFTER the freshly loaded media actually attaches
  (`readyState >= 2` or a one-shot `loadeddata`, bounded by `VIDEO_WAIT_MS`), because calling
  `pauseVideo()` synchronously right after `loadVideoById` is a race YouTube silently drops.
- One-shot and fail-open: no retry loops, no dual playback.
- Files: `entrypoints/main-world.ts`.

## Invariants preserved

- `PlayerHandle` remains the sole `<video>.src` writer: the native reclaim uses YouTube's own player
  API rather than a direct src write.
- Fail-open is preserved: the reclaim is one-shot and postcondition-guarded, with no retry loops and
  no dual playback.

## Docs updated

- `docs/specs/SPEC-002-m1-core-playback.md`: added a "Teardown and native reclaim" subsection
  describing the new contract (PlayerHandle never rewrites src on teardown; native playback is
  reclaimed via the YouTube player API at the live position; sole-writer and fail-open preserved), and
  noted the new unit coverage.
- `docs/architecture/README.md`: the M1 Playback Flow now describes the teardown/reclaim step.

## Verification

Real headful Firefox, real YouTube music video, logged out:

- Playing, then toggle-off resumes native playback at the live position with `readyState 4`.
- Paused, then toggle-off resumes at the paused position, stays paused, `readyState 4`.
- Toggle back on re-hijacks cleanly.
- SPA-navigating with audio-only ON re-hijacks the new video.

Cross-lab reviewed (`codex_critic` design; `codex_reviewer` + `gemini_reviewer` line-level) with
findings folded in: src-only ownership guard, `videoId` pinning, clear-pending-only-on-decision, and
bookkeeping before the synchronous dispatch. Unit: `tests/unit/player.test.ts` locks that `restore()`
does not rewrite src and reports the live release record. Hermetic bench 47/47, settings-permutation
matrix 50/50.

## Follow-ups still open

- **Toggle-off recovery latency:** recovery time is dominated by YouTube reloading the video via
  `loadVideoById` (a few seconds, inherent to reloading native). Worth shrinking separately if a
  snappier toggle-off is wanted.
- **Post-reclaim "did it recover" check:** a bounded post-`loadVideoById` recovery check was
  considered and deferred. Real-Firefox testing showed `loadVideoById` reliably restores playback, and
  a pre-emptive fallback risks the no-retry-loop invariant.
