# SPEC-027: Loop toggle

**Status:** Draft
**Date:** 2026-10-17
**Depends on:** SPEC-002 (core playback), SPEC-020 (settings diffing)
**Relates to:** Issue #52 (playlist loop ignored)

## 1. Goal

Preserve YouTube's native loop behavior when audio-only is active. The `loop` property on the `<video>` element should survive the src swap and re-attach. Provide an in-player loop button (on by default when YouTube's loop is on) as a momentary action. No settings row (minimal surface).

## 2. Non-goals

- No settings toggle (loop is a momentary in-player action).
- No new permissions.
- No new onboarding.

## 3. Design

### 3.1 Shared logic (done)

- `PlaybackSnapshot` includes `loop: boolean`.
- `attach()` captures `mediaElement.loop`.
- `restorePlaybackState()` restores `mediaElement.loop = snapshot.loop`.
- `ratechange` listener syncs `playbackRate` to snapshot (for speed changes).

### 3.2 In-player button

- Add a loop button to `reconcileInPlayerControls` in `content.ts`.
- `ytp-button` class, `aria-pressed`, native tooltip "Toggle loop".
- Click handler toggles `media.loop` and updates `aria-pressed`.
- Only on desktop (mobile uses native loop).
- Only visible when audio-only is enabled.

### 3.3 Fail-open

- If loop sync fails, native loop behavior is lost but playback continues.
- No crash, no broken playback.

## 4. Test strategy

- Unit: loop preservation across src swap.
- Bench: loop toggle case (verify audio loops when enabled).
- Manual: verify loop button in player.

---

_Spec written per "no spec, no code" rule._
