# Handoff: observer and timer hygiene (CP4 item 2.4)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP4 item 2.4 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`: scope
filters, cheap checks first, teardown on SPA/unload, and the uncleared status timeout. The audit
covered the four raced-timeout helpers (background status/scope replies and the three popup
channels) and the content script's mutation pipeline. The observers' teardown wiring
(visibility/pagehide/pageshow), the SPA observer's single-pending-check bound, and the reconciler's
per-frame coalescing were already correct and are now pinned by tests; the real defects were the
never-cleared timeout timers and a record filter that walked removed nodes it could not act on.

## Changes

- `docs/specs/SPEC-018-observer-timer-hygiene.md` (new): the timer-clearing contract, the migrated
  call sites, the two-signal record filter, the verified teardown properties, and the tests.
- `src/shared/timers.ts` (new): `withTimeout(promise, ms, fallback)` and
  `requireWithin(promise, ms, message)`. Both clear their timer the moment the wrapped promise
  settles in either direction; a late settle after the timeout won is a no-op. The module joins the
  covered core modules in `vitest.config.ts`.
- `entrypoints/background.ts`: the local `withTimeout` is deleted; the `get-status`,
  `get-tab-scope`, and `set-tab-scope` replies use the shared helper, so a fast reply no longer
  leaves a fallback timer armed for up to `GET_STATUS_TIMEOUT_MS` in the persistent background.
- `entrypoints/popup/playback-status.ts`, `entrypoints/popup/tab-scope.ts`,
  `entrypoints/popup/consent-state.ts`: local copies replaced with `requireWithin`, preserving the
  exact `status-timeout` / `tab-scope-timeout` / `consent-timeout` messages and durations.
- `entrypoints/content.ts`: `mutationMayReplacePlayer` now walks only `record.addedNodes` in
  early-exit `for..of` loops (no per-record `Array.from`). The removed-node walk is gone because the
  cheap first check (detached observed player) already covers every removal: detaching any ancestor
  disconnects the player, and a remove-then-readd of an ancestor in the same batch is caught by the
  added-node scan.

## Safety

- No behaviour change: same timeout durations, fallbacks, error messages, status/scope/consent
  values, and observer firing model. The helpers only release timers earlier.
- The record filter keeps the same matching rules (`instanceof Element`, `matches`, then
  `querySelector`) and only drops iteration over nodes whose only possible hit was already covered
  by the connectivity check, verified by the two new jsdom tests.
- No new permissions, storage keys, messages, or network paths.

## Testing

- `tests/unit/timers.test.ts` (new, 6 tests): value-before-timeout resolves and leaves
  `vi.getTimerCount() === 0`; the timeout path resolves the fallback and ignores a late settle;
  rejections forward immediately and clear; `requireWithin` rejects with the exact message. The
  timer-count assertions are the regression the item exists to prevent.
- `tests/unit/in-player-mount.test.ts`: two new jsdom tests with real `MutationObserver` and a
  manual frame pump: routine document churn schedules nothing, detaching the player schedules
  exactly one reconnect frame; a player that appears after mount is found through the added-node
  filter and gets the in-player toggle mounted. The existing fake-observer visibility test keeps
  pinning the teardown wiring, and the coalescing test keeps pinning one execution per frame.
- Bench: no new case. The migrated call sites are exercised by every status/scope session and by
  the bench's own options-page reads; the coalescing case (`ux:reconcile-churn-is-coalesced-per-animation-frame`)
  continues to pin the observer pipeline. CI runs are the first real execution.
- `npm run validate` green (typecheck, lint, format, unit tests incl. the coverage gate, MV2
  build, `web-ext lint`, MV3 build).

## Follow-ups

- CP4 continues with 2.6 (coexistence policy + ADR-0015), 2.7 (settings diffing), 1.6 (distraction
  extras), and 2.8 (teardown on disable/update), then the hygiene items.
- `src/shared/spa.ts` keeps its 100 ms fallback timer by design (Firefox for Android rAF
  throttling); it is bounded to one pending check and mutually cancelled with rAF, so the audit
  deliberately left it unchanged.
