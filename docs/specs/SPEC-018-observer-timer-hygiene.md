# Specification: Observer and Timer Hygiene

## Overview

CP4 item 2.4 of the 1.1.0 release plan. The extension's own long-lived contexts (the persistent MV2
background, popup documents opened repeatedly, the content script and page world for a whole
session) must not accumulate work they no longer need: a timeout that has already lost its race
still holds a live timer, and a mutation filter that walks nodes it cannot act on still pays for
every batch. This spec pins the timer contract in one shared, unit-tested helper, migrates every
raced-timeout call site to it, and tightens the content script's record filter to the two signals
that can actually mean "the player moved" while preserving the existing bounded, coalesced observer
pipeline.

## Goals

- One shared timeout helper pair in `src/shared/timers.ts` that **always clears its timer the
  moment the wrapped promise settles**, in either direction, for both shapes in use today:
  - `withTimeout(promise, ms, fallback)`: resolves with the promise's value, or `fallback` after
    `ms`; propagates a rejection (timer cleared).
  - `requireWithin(promise, ms, message)`: resolves with the value, or rejects
    `new Error(message)` after `ms`; propagates a rejection (timer cleared).
- Migrate every raced-timeout site to the shared helpers:
  - `entrypoints/background.ts` `get-status` / `get-tab-scope` / `set-tab-scope` replies
    (previously `withTimeout` over `GET_STATUS_TIMEOUT_MS` with a fixed fallback; the losing timer
    stayed armed for up to the full timeout after a fast reply).
  - `entrypoints/popup/playback-status.ts`, `entrypoints/popup/tab-scope.ts`, and
    `entrypoints/popup/consent-state.ts` initial reads (`status-timeout`, `tab-scope-timeout`,
    `consent-timeout` rejections keep their exact messages).
- Tighten `installPlayerControls`' `mutationMayReplacePlayer` to the signals that can really mean a
  replacement, with cheap checks first:
  - a detached observed player (already the first check) covers every removal path, including a
    removed ancestor that contains the player, because detaching any ancestor disconnects the
    player;
  - a newly added node that matches the player selector or contains a match covers a player that
    appears or is replaced while the observed reference is still connectable.
    The removed-node walk and the per-record `Array.from` allocations are dropped; iteration uses
    early-exit `for..of` loops.
- Verify, without changing, the already-correct hygiene properties and keep them pinned:
  - the player reconciler's rAF coalescing (bench
    `ux:reconcile-churn-is-coalesced-per-animation-frame`;
    unit coalescing test);
  - visibility/pagehide/pageshow teardown of both content observers (unit
    disconnect/reconnect test);
  - `spa.ts`'s single pending-check bound (rAF plus one 100 ms fallback timer, mutually
    cancelling), which exists because Firefox for Android throttles rAF after load.

## Non-Goals

- No scheduling-model change: no new observers, intervals, or polling, and no change to when the
  SPA observer or the reconciler fires.
- No behaviour change for the user: same status/scope/consent values, same fallback semantics,
  same error messages, same timeout durations.
- No change to page-world (idle-nag, reclaim, media-session) timers, which already fire or clear
  on their own teardown paths (SPEC-016, SPEC-015).
- No new permissions, storage keys, message types, or diagnostics vocabulary.

## Technical Design

### Shared helpers (`src/shared/timers.ts`)

```ts
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T>;
export function requireWithin<T>(promise: Promise<T>, ms: number, message: string): Promise<T>;
```

Both build on the same settle-once pattern: arm `setTimeout`, attach both handlers to the wrapped
promise, and on either settlement `clearTimeout` before forwarding the outcome. A late settle after
the timeout already won is a no-op (`clearTimeout` on a fired timer is defined and harmless). The
module joins the covered core modules in `vitest.config.ts` so the clearing contract stays enforced
at the 90% floor.

### Content record filter (`entrypoints/content.ts`)

`mutationMayReplacePlayer(records)` keeps its one-line summary contract ("can this batch have moved
the player?") but only walks `record.addedNodes`:

- the cheap pre-check `observedPlayer && !observedPlayer.isConnected` stays first and returns true
  for every detach, including a removed ancestor of the player;
- `containsPlayer` keeps the `instanceof Element` guard, `matches` first, `querySelector` second;
- loops return on the first hit; no per-record node arrays are allocated.

The document observer's callback already checks `observersActive` before the filter, and the
reconnect path is itself coalesced (`reconnectScheduler`), so a burst of qualifying batches still
performs at most one player lookup per frame.

### Timeout call sites

`entrypoints/background.ts` deletes its local `withTimeout` and imports the shared one. The popup
channels delete their local copies and call `requireWithin` with their existing message strings.
Durations and fallbacks are untouched (`GET_STATUS_TIMEOUT_MS`, 1.5 s popup reads).

## Error Handling

- A rejection of the wrapped promise is forwarded immediately with the timer cleared; the existing
  callers' try/catch behaviour (deny/fallback) is unchanged.
- `clearTimeout` on an already-fired timer is a no-op; a post-timeout settlement cannot settle the
  outer promise twice.
- The record filter only reads nodes and selectors; malformed batches cannot throw (guards intact).

## Testing Strategy

- Unit `tests/unit/timers.test.ts` (fake timers): value-before-timeout resolves and leaves zero
  armed timers; timeout resolves the fallback (and a late settle is ignored); rejection forwards
  and clears; `requireWithin` timeout rejects with the exact message; all four paths assert
  `vi.getTimerCount() === 0` after settling, which is the regression the item exists to prevent.
- Unit `tests/unit/in-player-mount.test.ts` (jsdom, real `MutationObserver`, manual rAF pump):
  routine document churn schedules nothing; detaching the player re-arms exactly one lookup; a
  player that appears after mount is found through the added-node filter and gets the in-player
  controls mounted. The existing fake-observer visibility test keeps pinning the teardown wiring.
- Bench: the existing coalescing case and the status/scope cases continue to exercise the migrated
  call sites through the real add-on; no bench case is added (the behaviour under test is timer
  cleanup, unobservable from the page).
- `npm run validate` is the gate.

## Dependencies

- None new. `src/shared/timers.ts` uses only `setTimeout`/`clearTimeout`.

## Security and Privacy Considerations

- No egress, storage, or permission changes. The helper only removes work; it cannot widen access.
- The record filter keeps the same matching rules, so no new node data is read beyond selectors
  already used.

## Performance Considerations

- Every fast status/scope/consent reply now releases its fallback timer immediately instead of
  holding it for up to 1.5 s (the background is persistent, so those timers used to accumulate per
  popup interaction).
- Document batches no longer allocate per-record node arrays or walk removed subtrees; removal
  detection is the O(1) connectivity check that already ran first.
