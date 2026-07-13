# Handoff: Mobile cold-load config-hydration wait

## Date

2026-07-13

## Summary

Fixed a Firefox-for-Android (Fenix) bug where a cold-loaded watch page could never activate
audio-only. Mobile YouTube (`ytm-app`) hydrates `window.ytcfg` (and its `INNERTUBE_API_KEY`)
_after_ the content script's `document_start` injection and fires no DOM or navigation event when
it does. The first activation would extract an empty key, bail to `fallback`/`not-a-watch-page`,
and never retry, because on mobile no SPA navigation event follows to re-arm it. Activation now
waits, bounded and generation-guarded, for the key to appear before giving up.

No hard invariant changed: logged-out only, credentialless `ANDROID_VR`, `PlayerHandle` as the sole
`<video>.src` writer, fail-open to native playback, and the page-world trust boundary all hold.
Desktop behavior is unchanged.

Branch `rebuild`, PR #65.

## What changed

- **`entrypoints/main-world.ts`** — new `waitForConfigReady(operationGeneration)`: a bounded poll
  (250 ms steps, ceiling `VIDEO_WAIT_MS` = 8000 ms) for `getConfigString('INNERTUBE_API_KEY')`.
  `activateEnhancements` calls it only when a watch page has a video id but no key yet
  (`if (videoId && !apiKey)`), and re-checks the generation on return so a navigation during the
  wait aborts cleanly. It resolves early the instant the key appears. On desktop (key already
  hydrated) and on genuine non-watch pages (no video id) the poll never runs, so no path that
  already has the key gains any latency.

## Verification

- **New deterministic bench case** `m0:cold-config-hydration-activates`
  (`tests/e2e/bench/run-bench.mjs`, `tests/e2e/bench/fixture-server.mjs`). The fixture watch page
  gained a `coldConfig=1` mode: `INNERTUBE_API_KEY` is omitted from the inline `ytcfg` at
  `document_start` and set ~600 ms later via `ytcfg.set(...)`, reproducing mobile late-hydration.
  The case asserts the extension waits and reaches `active` with a `/videoplayback` source and an
  `active` background-map entry.
- **Red-green proven.** With the wait neutralized the case fails (`fallback` / `not-a-watch-page`,
  bench 48/49); with the wait in place it passes (bench 49/49). This is the deterministic guard the
  production fix previously lacked (the fixture had always exposed the key synchronously).
- **Real Fenix confirmation.** A sequential Firefox-for-Android emulator probe (ARM64 `aosp_atd`
  AVD, Fenix Nightly) showed 8/8 cold `m.youtube.com/watch` loads reaching `status:"active"` with
  the fix, versus the pre-fix `not-a-watch-page` bail. This probe is device-gated and manual, not a
  CI gate; the bench case above is the reproducible regression lock.
- **Gate green:** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`
  (246 passing, coverage 97.97% st / 96.21% br / 96.29% fn / 99.05% ln), and `npm run test:bench`
  (49/49). CI runs the bench and matrix under xvfb (`.github/workflows/ci.yml`), so the new case
  gates on every pipeline run, not only locally.

## Known issues / notes

- **Mobile audio-only still does not hold after activation.** Reaching `active` is necessary but
  not sufficient on Fenix: the native player reclaims the `<video>` within ~165 ms through a path
  that bypasses `PlayerHandle`'s `.src`-property guard entirely (`reassertCount` stayed 0 across
  every sampled run; the reclaim uses attribute-level `setAttribute`/`removeAttribute` plus a
  `srcObject` reset, and a `blob:` re-appears in `currentSrc` via a surface none of the probes
  instrumented, which has the signature of the element being replaced). This is a distinct,
  deeper bug from the cold-load race fixed here, and it is not a "circuit breaker trips too fast"
  problem (the guard never engages). It is being investigated separately to determine whether the
  element is replaced (native takeover = the fail-open outcome) or the same element is re-sourced
  (fixable with an attribute + `srcObject` guard).
- **Mobile HOLD cannot be proven in the headless emulator.** The `-no-window` ARM64 emulator cannot
  produce a _trusted_ user gesture (`navigator.userActivation` stays false; content never gets
  window focus), so YouTube's own player JS re-pauses any scripted `play()`. The emulator can prove
  the reclaim _mechanism_ and whether the src holds, but proving audio keeps decoding for a real
  user needs a real Fenix device (the owner-gated device lane). Perf/memory sampling over ~150 s
  showed no runaway (Total PSS settled 252 MB -> 226 MB; device-wide CPU 18% burst -> 9.3% steady),
  but reflects the activation + reclaim cycle, not continuous audio decode, for the same reason.

## Next steps

- Resolve the mobile reclaim mechanism (element-replacement vs same-element re-source) and either
  implement a same-element attribute/`srcObject` guard or record element-replacement as the native
  fallback in an ADR.
- Stand up the owner-gated real-Fenix device lane so mobile audio-only HOLD has an automated proof.
