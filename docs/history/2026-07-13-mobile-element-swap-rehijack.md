# Handoff: Mobile audio-only hold via element-swap re-hijack

## Date

2026-07-13

## Summary

Fixed the second half of Firefox-for-Android audio-only: after the extension hijacks the `<video>`,
the native mobile player was reclaiming playback and our audio-only did not hold. The root cause is
that the native reclaim REPLACES the `<video>` element (it detaches the hijacked element and installs
a fresh one carrying the native source), which is why `PlayerHandle`'s `.src` property-setter guard
never engaged (`reassertCount` stayed 0 across every sampled Fenix run). The SPA observer already
treats a `<video>` identity change as a `player-change` and re-hijacks the new element through the
normal generation/`PlayerHandle` path, but it deferred that check through `requestAnimationFrame`,
and Fenix throttles rAF to a single frame after load, so the swap was never detected. The mutation
check now arms a bounded `setTimeout` fallback alongside rAF, so it still runs when rAF is starved.

No hard invariant changed: `PlayerHandle` stays the sole `<video>.src` writer (the re-hijack routes
through the existing `player-change` -> activation -> `attach` path), fail-open holds (the identity
comparison only re-arms on a real element change, so no loop), credentialless `ANDROID_VR`, and the
page-world trust boundary are all intact. Desktop is unchanged: on a visible tab rAF wins the race
(~16 ms) and cancels the timer.

Branch `rebuild`, PR #65. Follows the cold-load config-wait fix (see
[[2026-07-13-mobile-cold-load-config-wait]]).

## Root cause (empirical, real Fenix)

A device-gated Fenix investigation (ARM64 `aosp_atd` emulator, Fenix Nightly, committed build) with
an independent MAIN-world identity probe established, across multiple cold loads of two VOD ids:

- The hijacked element (`id1`) acquires the `/videoplayback` source, then ~60-95 ms later a fresh
  element (`id2`) appears while `id1` becomes `isConnected: false`. `querySelectorAll('video')` stays
  at one across the swap (atomic replace). The native `blob:` always lands on `id2`.
- `reassertCount: 0` and `circuitTrippedAt: null` every run: the reclaim bypasses the `.src` property
  guard entirely (attribute-level writes plus element replacement), so this is NOT a
  "circuit-breaker trips too fast" problem and threshold tuning is irrelevant.
- A cheap one-shot re-hijack of the replacement element held 4/4 (src stable on `/videoplayback`,
  `readyState` 4, no fight), confirming the fix shape is invariant-safe (single re-apply, no loop).
- The existing SPA observer's mutation path uses `requestAnimationFrame`, which was suspended after
  the first frame on Fenix (a 20 ms timer captured every swap), so its `player-change` never fired.

## What changed

- **`src/shared/spa.ts`** — `scheduleMutationCheck` now arms `window.setTimeout(checkForMutation..,
MUTATION_CHECK_MS = 100)` alongside `requestAnimationFrame`; `cancelMutationCheck` clears both and
  `checkForMutationNavigation` cancels the sibling before running the check. The coalescing guard and
  the `emit` microtask dedup are preserved, so a visible desktop tab keeps the paint-aligned fast
  path unchanged and a starved-rAF context (mobile, or any hidden/backgrounded tab) still detects a
  navigation or element swap. This also fixes navigation detection on hidden desktop tabs as a
  side benefit.

## Verification

- **Unit red-green (the deterministic lock), proven** (`tests/unit/spa.test.ts`): with
  `requestAnimationFrame` stubbed to never fire (the Fenix/hidden-tab condition), a `<video>`
  identity change still emits `player-change` through the timer fallback; deleting the fallback line
  makes it fail (verified by a serial toggle: fail without, 5/5 pass with).
- **Bench integration lock** (`m0:element-swap-rehijack`, green): the fixture replaces the `<video>`
  on detecting our hijack, and the case asserts the extension re-hijacks the replacement (live
  swapped-in element carries `/videoplayback`, status `active`, active status-map entry). NOTE: the
  hermetic desktop bench cannot faithfully starve the injected main-world's `requestAnimationFrame`
  (a page-level rAF override does not reach the extension's realm), so this case exercises the
  identity-change re-hijack path under working rAF, not the suspension itself. The suspension is
  covered by the unit test; the real suspended-rAF end to end is the Fenix probe below. (An earlier
  in-fixture rAF neuter was removed because it was a no-op for the extension and therefore
  misleading.)
- **Cross-lab review**: the `spa.ts` fix and the unit test were reviewed by gpt-5.3-codex and
  gemini-3.1-pro (line-level); both returned no findings.
- **Gate green**: typecheck, lint, format, unit 247/247 (coverage ~98%), bench 50/50. CI runs the
  bench + matrix under xvfb.

## Known issues / notes

- **Fenix confirmation of the real build is the immediate next step** (not yet run at time of this
  handoff): confirm the shipped fix (not the investigation's injected candidate) re-hijacks the
  replacement element and holds the `/videoplayback` src on real Fenix, and determine whether
  `PlayerHandle.attach` needs to null `srcObject` before its `.src` write on the replacement element.
  The sacred sole-writer module was deliberately left untouched pending that evidence.
- **Audio-decode HOLD needs a real device.** The headless emulator cannot supply the trusted user
  gesture YouTube's player gate demands, so it can prove src-level hold but not sustained audible
  playback. That final proof is the owner-gated real-Fenix device lane.

## Next steps

- Run the Fenix confirmation; if `srcObject` shadows our `.src` on the replacement element, add a
  `srcObject = null` before the write in `PlayerHandle` (desktop-safe no-op) as a follow-up commit.
- Stand up the owner-gated real-Fenix device lane for the audio-decode HOLD proof.
