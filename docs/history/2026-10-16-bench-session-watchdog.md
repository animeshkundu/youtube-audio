# Bench session watchdog: fail fast when a driver wedges

**Date:** 2026-10-16

## Summary

One hermetic bench lane stalled on a wedged WebDriver command and was killed by the job's
20-minute timeout, which reports the lane as `cancelled` (indistinguishable from a superseded run)
and hides the cause. The harness now bounds every session, so a stall becomes an `ERROR` verdict
within minutes with the last benchmark step named.

## What happened

- On the `af22049` CI run (`39002751356`), the Firefox 133 bench lane seeded the
  `downloadEnabled: true` session at 04:33:40 and then produced no output for ~17 minutes; the
  job's `timeout-minutes: 20` cancelled it at 04:50:57. The run concluded `cancelled` with every
  other job green.
- The same bench code passed every bench case on all six Firefox lanes ~30 minutes earlier
  (`aa05da2`) and on the other five lanes of the same run, so this was a wedged browser or
  geckodriver on the legacy 133 lane, not a code regression.
- The harness had no per-session bound: one WebDriver command that never returns (transport-level
  hang, e.g. a browser that stops answering) waits forever, because Selenium timeouts only cover
  in-browser navigation and script execution.

## Changes

`tests/e2e/bench/run-bench.mjs`:

- `runSession` is now a thin wrapper that races the session against a three-minute watchdog
  (`BENCH_SESSION_TIMEOUT_MS` to override). The longest legitimate wait inside a session is ~10 s,
  so three minutes cannot race a slow runner. The watchdog rejection names the last `[bench]` log
  line, and the existing `main().catch(...)` prints the `ERROR` verdict and exits 2 — the lane
  fails fast with the stuck step instead of stalling into the job timeout.
- The session body moved to `runSessionUnwatched`; the settings matrix keeps the bound because it
  imports the same `runSession`.
- The WebDriver `pageLoad` timeout is set to 120 s (W3C default 300 s); the W3C `script` timeout
  (30 s) already bounds script execution.

## Safety

Test harness only; no product code, manifests, or permissions touched. The watchdog abandons the
hung session and the process exits through the existing error path, so no cleanup hang either.

## Testing

- `node --check`, ESLint, and a module import check on both bench runners.
- The bench itself cannot launch Firefox inside the sandboxed agent shell, so CI carries the real
  proof: the push that lands this change re-runs all six bench lanes and all six matrix lanes.
- If the Firefox 133 stall recurs, the failure detail now names the session step that wedged.

## Follow-ups

- If a named step recurs as a stall, that is a product-side investigation (the step named in the
  watchdog error); a single occurrence on one legacy lane reads as environmental.
