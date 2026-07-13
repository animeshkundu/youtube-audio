# Handoff: Settings-permutation real-Firefox validation

## Date

2026-07-12

## Summary

Two exhaustive real-Firefox validation passes on branch `rebuild` (PR #65): real headful Firefox,
real YouTube and YouTube Music, logged out. They covered every setting singly, key combinations,
and edge cases. This complements the deterministic surfaces that already lock the setting _logic_
with no human and no live network (the hermetic bench, 48 scenarios, and the settings-permutation
matrix, 50 combos); this pass confirmed the same mechanisms against REAL YouTube's live endpoints
and DOM. Result: everything PASSED except one real defect, a slow-load race in
`disableAutoplayNext`, now fixed and locked by a new bench scenario. No hard invariant changed:
logged-out only, credentialless `ANDROID_VR`, `PlayerHandle` as the sole `<video>.src` writer,
fail-open to native playback, and the page-world trust boundary all hold.

## Singles (all PASS)

Each setting was exercised alone against real YouTube:

- `audioOnlyEnabled`: real googlevideo audio `currentSrc` (video bytes stopped).
- `audioArtworkEnabled`: the artwork overlay mounts.
- `hideShorts` / `hideRecommendations` / `hideComments`: each hides only its target;
  `hideRecommendations` ON with `hideComments` OFF leaves comments visible (the narrowed
  renderer-scoped selector, per SPEC-006).
- `forceQualityMax`: 240p resolves to YouTube's `small` label versus off.
- `downloadEnabled`: exactly one `.m4a` file.
- `backgroundPlayEnabled`: visibility suppression confirmed (see the smoke-convergence correction
  below).
- `ghostEnabled` + `aggressiveTelemetry`: tiered telemetry-endpoint blocking, corroborated by the
  diagnostics counter.
- `disableAutoplayNext`: the native autonav toggle is switched off (this is where the one bug
  surfaced, below).
- `loudnessNormalization` + `equalizerEnabled`: the Web Audio graph is armed, confirmed via the
  extension's `audio.graph` diagnostics events.
- `lyricsEnabled`: best-effort while logged out.

## Combinations (all PASS)

- All-on: no cross-feature interference.
- `audioOnly` + ad-block.
- `audioOnly` + download.
- `audioOnly` + loudness + equalizer.
- `hideShorts` + `hideRecommendations` + `hideComments` + segment-skip.
- MASTER GATE: `enabled=false` applies nothing.

## Edge cases (all PASS)

- Mid-playback live toggles apply through `storage.onChanged` with no reload and no stall.
- Regular / long video audio-only.
- Made-for-kids fallback.
- Live-stream fallback, re-confirmed against a currently-live stream (the old test video ID had
  ended).
- SponsorBlock genuine segment skip.

## Ad-block confirmed on real YouTube (#69)

With audio-only OFF (native video), live in-player ads surfaced 0/5 videos with ad-block ON versus
4/5 with it OFF, and inline `ytInitialPlayerResponse` ad fields were stripped 5/5. Residual:
SABR-stitched ads in native video remain a documented limitation per ADR-0009. This confirms the
ad-block mechanism works on live YouTube (the earlier ad-block follow-up, #69).

## The one bug (fixed): disableAutoplayNext slow-load race

`applyQualityOfLife` (`entrypoints/main-world.ts`) clicked the native autonav toggle only on a
fixed retry schedule `[300, 800, 1500, 3000]` ms. When YouTube rendered
`.ytp-autonav-toggle-button` past ~3s on a slow load, the click was silently missed (1/4
real-Firefox runs), leaving autoplay-next ON.

Fix: a bounded `MutationObserver` fallback now covers the late button, mirroring the event-driven
reassertion `reassertQuality` already gets from the player's quality-change event. It observes
`document.documentElement` with `childList` + `subtree` and an `aria-checked` `attributeFilter`,
clicks the toggle off whenever the control appears or turns on late, and disconnects on success or
at a 10s hard cap (fail-open, never spins indefinitely). The click still fires only when the toggle
reports `aria-checked="true"`, so it uses YouTube's own state transition and never forces autoplay
on.

Locked by a new hermetic bench scenario, `m3b:disable-autoplay-late-button`: the fixture removes
and re-inserts the autonav button at 3.5s (past the last fixed 3s timer), and the bench asserts the
observer still switches it off. Bench 48/48, matrix 50/50.

## Follow-ups (watch items, not defects)

- A transient self-healing `TypeError` at `page.activate` was observed once during a loudness run.
  Fail-open handled it and three later cycles were clean. The stack was empty, so it is not
  root-caused; recorded for watch, not a reproducible defect.
- `hideShorts` shelf-presence and `lyricsEnabled` coverage are inherently best-effort on a fresh
  logged-out session (the target shelf or synced lyrics may simply be absent), not a functional
  gap.

## Verification

Real headful Firefox, real YouTube and YouTube Music, logged out, across two full permutation
passes. The deterministic gates remain green: hermetic bench 48/48 (adds
`m3b:disable-autoplay-late-button`), settings-permutation matrix 50/50, and `npm run validate`
(typecheck, lint, format:check, unit + coverage, build MV2, `web-ext lint`, build MV3) clean.
