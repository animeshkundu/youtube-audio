# SPEC-022: Reliability cluster and native-speed fix

**Status:** Implemented (1.1.0) — see docs/history/2026-10-17-1.1.0-gap-work.md
**Date:** 2026-10-17
**Depends on:** SPEC-002, SPEC-015, SPEC-019, SPEC-020, SPEC-021, ADR-0014, ADR-0015
**Relates to:** Issues #16, #19, #23, #25, #30, #39, #41, #42, #44, #45, #46, #50, #52, #56, #60, #62

## 1. Goal

Eliminate the reliability regressions that drive the 3.74 AMO rating: playlist/queue failures, PiP crashes, stall-induced restarts, speed-change jumps, toggle refreshes, resume-position loss, and mobile selector rot. Every fix must be repro-first (confirm still present on 1.0.6 beta) and fail-open (native YouTube playback never disrupted).

## 2. Non-goals

- Live audio-only (research spike, separate spec).
- Chrome port (written decision, separate).
- Per-site permissions (separate spec, SPEC-028).

## 3. Design

### 3.1 Playlist/queue handling (#52, #42, #16, #30)

**Root cause:** YouTube SPA navigation during playlist advance fires `yt-navigate-finish` or `pushState`/`replaceState`. Our SPA observer (`spa.ts`) detects URL changes and emits `url-change`, but the reclaim coordinator (`reclaim.ts`) may not consume the pending record correctly when the video element is swapped (mobile) or when the queue advances without a full navigation.

**Fix:**

- In `main-world.ts` `activateEnhancements`, after `waitForVideo`, check if the media element changed identity. If so, treat as a new attach (not a re-attach) and skip reclaim.
- In `spa.ts`, ensure `yt-navigate-finish` fires for playlist advancement (YouTube sometimes fires it, sometimes doesn't). The history-wrap already catches pushState/replaceState.
- In `reclaim.ts`, the `take()` method already handles generation skew. Ensure the reclaim record's `videoId` matches the new video before reclaiming.
- For track-list loop (#30): YouTube Music track lists use `?v=` changes via pushState. The history wrap catches these. Ensure `getVideoId()` reads the new `?v=` param.

**Fail-open:** If any step fails, emit `fallback` and let YouTube handle playback.

### 3.2 Native-speed sync (#41)

**Root cause:** `PlayerHandle.attach()` captures `playbackRate` in the snapshot at attach time. If the user changes speed later, the snapshot is stale. On re-attach (SPA nav), the stale rate is applied, causing a jump.

**Fix (partially done):**

- `ratechange` listener on the media element updates `this.snapshot.playbackRate` (already implemented).
- On re-attach, `restorePlaybackState` uses `snapshot.playbackRate` (already implemented).
- Additionally: sync `playbackRate` to YouTube's player API on `ratechange` so the UI and audio stay in sync. If YouTube's player reports a different rate, adopt it.

**Fail-open:** If sync fails, leave the element's rate unchanged.

### 3.3 PiP crash (#50)

**Root cause:** PiP may swap or reparent the `<video>` element. The dormant guard (installed on `HTMLMediaElement.prototype`) keys off element identity. A new element in PiP mode bypasses the guard, and YouTube's src reassertion on the PiP element can trigger an unexpected src write. The reclaim coordinator's `element.src === ownedUrl` check may also mismatch.

**Fix (partially done):**

- Add `enterpictureinpicture` and `leavepictureinpicture` event listeners (already implemented).
- On PiP entry: log, do NOT touch src.
- On PiP leave: re-arm the hijack via SPA rearm path (already implemented).
- Additionally: guard against `document.pictureInPictureElement` being null during transitions; wrap all PiP handlers in try/catch (already done).

**Fail-open:** All PiP handlers are try/catch. If anything fails, native playback continues.

### 3.4 Stall/auto-restart (#56, #44, #39)

**Root cause:** When the hijacked audio stalls (network, expired URL), the media element fires `stalled`. Without handling, playback stops. YouTube's native player would have handled this, but our src swap bypasses that.

**Fix:**

- Add a `stalled` event listener on the media element. `waiting` is deliberately NOT a retry trigger: it fires during normal buffering (seeks, slow start), so reacting to it would re-fetch on routine playback.
- Bounded retry: max 2 retries PER VIDEO. Each retry re-fetches the player response and re-attaches. The budget resets only on a different video (or a fresh settings/SPA intent); a same-video re-attach never replenishes it.
- Detach the old element's listeners before the async re-walk so a burst of `stalled` events cannot stack concurrent activations.
- Generation guard: only retry if `videoId` and `generation` are unchanged.
- After 2 retries, emit `fallback` and let YouTube handle it.
- Never retry on `ended`, `pause`, or `waiting` (those are normal, not stalls).
- Deliberate trade-off: a wedge that manifests as `waiting` forever with `stalled` never firing
  has no recovery trigger. In practice a dead network progresses `waiting` to `stalled` (~3s of
  no data) and expired URLs surface as `error`, both of which are covered; a `waiting`-only
  wedge is out of scope because reacting to `waiting` at all re-fetches on routine buffering.

**Fail-open:** If retry fails or generation changes, emit `fallback`. Native playback takes over.

### 3.5 Toggle on/off refresh (#23)

**Root cause:** Enabling/disabling the extension triggers a teardown (`SPEC-021`) that removes in-player controls and sends a master-disabled snapshot to the page world. The page world's disable path restores native playback. But the teardown might not complete cleanly on all pages.

**Fix:** Verify SPEC-021 teardown works correctly. The `beginTeardown` function in `content.ts` already handles this. Add a bench case for disable/enable cycle.

**Fail-open:** If teardown fails, the page keeps its current state (audio-only or native). No broken playback.

### 3.6 Resume position (#19)

**Root cause:** When toggling audio-only off and back on, the position should be preserved. `PlayerHandle.attach()` captures `currentTime` in the snapshot and `restorePlaybackState` restores it. But if the element is mid-reload (transient state), the position can be lost.

**Fix (already partially done):** The `intent` parameter in `attach()` allows the caller to supply the real pre-toggle-off position/paused. The reclaim coordinator (`reclaim.ts`) tracks the released record with `currentTime` and `paused`. Verify this flows correctly through `activateEnhancements`.

**Fail-open:** If position restoration fails, playback starts at 0 (YouTube's default). No broken playback.

### 3.7 Mobile selectors (#25, #6)

**Root cause:** Mobile (Fenix) has different DOM selectors for the player controls. The `reconcileInPlayerControls` function in `content.ts` has mobile-specific selectors that may not match current Fenix DOM.

**Fix:** Capture real Fenix DOM snapshots (portrait/landscape/fullscreen/mini-player). Update selectors. Add bench probe.

**Fail-open:** If selectors don't match, the in-player button simply doesn't appear. Playback is unaffected.

### 3.8 Live streams (#57, #34, #15)

**Root cause:** Live streams are detected by `isLiveStream` (checks `isLive` flag and `contentLength` absence). They fail open to native playback. But the fallback messaging could be clearer.

**Fix:** Keep non-goal (no audio-only for live). Improve the popup status to show "Live stream — playing normally" instead of just "fallback". Improve fallback messaging.

**Fail-open:** Live streams always use native playback. No change to core behavior.

### 3.9 Broad "doesn't work" (#45, #46, #32, #60, #62)

**Root cause:** Various. Many may be fixed by 1.0.6 (media-client rotation, consent, permissions). Need to repro on 1.0.6 beta first.

**Fix:** Repro each on 1.0.6 beta. Close as already fixed if repro passes. For remaining, investigate individually.

**Fail-open:** All fixes must fail open.

## 4. Test strategy

- **Unit:** Add tests for each fix in `tests/unit/`. 90% bar on all shared logic.
- **Bench:** Add bench cases for playlist next-track, PiP toggle, stall retry, speed change.
- **Matrix:** Add matrix combos for new toggles (if any).
- **Mobile:** Fenix mini-player bench probe.
- **Canary:** Residential baseline for live streams and overall.

## 5. Fail-open enforcement

Every fix must pass a bench case:

- Feature on → works.
- Feature off → native playback untouched.
- Permission denied → native playback untouched.
- Fetch/parse failure → native playback untouched.
- SPA navigation → re-arms correctly.
- Stall → bounded retry or fallback, never broken playback.

## 6. UI/UX constraint

- All new toggles default off, in Advanced settings behind disclosure, searchable.
- Popup stays light.
- No new in-player buttons except loop (and only if proven needed).
- Complexity in code, not in surface.

---

_Spec written per "no spec, no code" rule. Implementation follows._
