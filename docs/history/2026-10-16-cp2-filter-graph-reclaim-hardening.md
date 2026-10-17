# Handoff: CP2 hardening (response filter cost, audio graph lifecycle, reclaim state machine)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP2 block from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`:

- 2.2 response filter cost,
- 2.3 Web Audio lifecycle,
- 2.5 reclaim state machine.

The plan's section 9 conditional (a minimal forward 1.0.5 patch before 1.1.0) was waived by the
user: everything ships as one consolidated 1.1.0 from this branch.

## Changes

### 2.2 Response filter cost

- `src/shared/adblock.ts`: new exported `MAX_PRUNABLE_RESPONSE_BYTES` (8 MiB) and
  `createResponseBudget()`, the bounded buffering state for the MV2 response filter. Below the
  budget chunks are held for a full-body parse; crossing it flushes everything held exactly once
  and every later chunk streams through unparsed.
- `entrypoints/background.ts` `filterPlayerResponse` now buffers through the budget. An over-budget
  body is deliberately delivered unparsed (ad descriptors intact): bounded background memory and
  intact playback matter more than pruning a pathological response. Failure paths write what was
  held and close the filter; the success path still never logs per response.
- MV3 `webRequestFilterResponse` was already declared in the MV3-only lane; it is now pinned by
  `tests/unit/manifest-declaration.test.ts` so it can neither leak into MV2 nor disappear from MV3.
- Bench: the fixture serves a 9 MiB padded `/player` response for `BIG*` ids and the new
  `m2b:over-budget-response-streams-through-unparsed` case asserts the session still reaches
  `active` with a `/videoplayback` source inside a generous latency-sanity bound while the
  page-visible body keeps its ad descriptors (proving it was never buffered for pruning). The
  bounded-memory contract itself is pinned by unit tests.

### 2.3 Web Audio lifecycle

- `src/shared/audiograph.ts`: capture-first registration. The `MediaElementAudioSourceNode` capture
  is permanent, so the handle is now registered the moment capture succeeds, even if the optional
  filter/gain nodes fail to build. A failed build degrades to the dry unity pass-through (inert
  setters, `getEqualizerGains()` of `[]`) instead of leaving an unregistered captured element whose
  next capture attempt would throw.
- Unchanged and now explicitly locked by tests: one page-lifetime `AudioContext`, one capture and
  one chain per element across source swaps and settings echoes, `dispose()` as bypass (unity gain,
  flat bands, still connected) and never a disconnect or close.
- SPEC-007 documents the lifecycle rules and the "no teardown goal" decision.

### 2.5 Reclaim state machine

- New `src/shared/reclaim.ts`:
  - `createReclaimTracker()`: single pending slot with `RECLAIM_TTL_MS` (30 s) expiry and a
    one-generation skew bound (`RECLAIM_MAX_GENERATION_SKEW`), `match`/`take`/`clear`, with `take`
    as the atomic single-consumption point. A `videoId` mismatch returns null without clearing so
    the record can still be consumed by its own video.
  - `armOneShotPause()`: single-winner one-shot pause (immediate at `readyState >= 2`, else first
    `loadeddata`, bounded by the caller's timeout) with a disposer; the caller keeps exactly one arm
    and disposes it before re-arming, so a double pause cannot happen.
- `entrypoints/main-world.ts` rewired onto the tracker: releases record `(record, videoId,
generation)`; `emitStatus('active')` clears; the reclaim coordinator matches with TTL/skew,
  rejects untracked or stale records, and consumes atomically; the attach path consumes the
  released position via the same tracker; a successful re-hijack clears the pause arm.

## Safety

- Over-budget responses are never parsed; they still reach the page verbatim. Playback never
  depends on pruning.
- Every reclaim boundary fails open: expired, generation-skewed, untracked, or `element.src`
  mismatched records are dropped without touching the page; the double-pause interleaving is
  structurally impossible via arm supersession plus the `isCurrent` re-check.
- The audio graph can still never silence a captured element: dispose is bypass, and a failed
  optional build leaves the dry route connected.

## Testing

- `npm run validate` green (typecheck, lint, format, 315 unit tests with coverage including the new
  `reclaim.ts` module, MV2 build, web-ext lint, MV3 build).
- New unit coverage: response budget boundaries and streaming; audio graph capture-once / shared
  context / degraded dry handle / bypass dispose; reclaim tracker TTL, skew, mismatch, untracked
  release, and atomic take; one-shot pause immediate, once, superseded, disposed, timed out.
- New hermetic bench case `m2b:over-budget-response-streams-through-unparsed` (fixture `BIG*` 9 MiB
  padding, probe now parameterizable by video id).
- CI ran the full bench matrix on the previous head; the CP2 head is validated by CI on push, and
  the residential canary stays the release gate.

## Follow-ups

- CP3 (embedded players, per-tab scope, idle-nag defeat, fallback quality, consent UX) is next in
  plan order, then CP4 plus hygiene.
- Re-run the residential canary before the 1.1.0 release and refresh its evidence.
