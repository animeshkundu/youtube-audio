# SPEC-026: Mobile mini-player verification

**Status:** Draft
**Date:** 2026-10-17
**Depends on:** SPEC-015 (embedded player frames), SPEC-018 (observer/timer hygiene)
**Relates to:** Issues #25, #6

## 1. Goal

Verify and fix the mobile (Fenix) mini-player selector set so the audio-only toggle appears in mini-player mode. Capture real DOM snapshots for portrait, landscape, fullscreen, and mini-player. Desktop-only for drag; PiP on mobile instead.

## 2. Non-goals

- No new in-player buttons on mobile (keep minimal surface).
- No drag/rotate/screenshot on mobile (desktop-only, per Research 10 §7).
- No new permissions.

## 3. Design

### 3.1 Current state

`reconcileInPlayerControls` in `content.ts` has a mobile branch that queries `.player-controls-bottom` / `.player-controls-bottom-container` and `.player-controls-right` / `.player-controls-bottom-right` / `.player-controls-content`. The comment notes "Real-Fenix confirmation is still required for this selector set."

### 3.2 Verification

- Capture DOM snapshots from a real Fenix device/emulator for: portrait, landscape, fullscreen, mini-player.
- Update selectors if they don't match.
- Add a bench probe for the mini-player control bar (automated where possible, manual otherwise).

### 3.3 Fail-open

- If selectors don't match, the in-player button simply doesn't appear. Playback is unaffected.
- No crash, no broken playback.

## 4. Test strategy

- Mobile canary: nightly, device-gated.
- Bench probe: automated where selectors are stable, manual checklist otherwise.

---

_Spec written per "no spec, no code" rule._
