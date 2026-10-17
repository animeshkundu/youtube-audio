# Handoff: teardown on disable and update (CP4 item 2.8)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP4 item 2.8: "Best-effort page cleanup message; document residual until reload". The
extension installs state that outlives a settings push (page-world patches, the audio graph, a
possible audio-only hijack, plus content-side DOM), so two exits get defined behavior:

1. The user's own switch (`settings.enabled = false`): the page-world teardown already ran through
   the SPEC-020 diff path; the missing half was the DOM. A disabled extension now removes its nodes
   and stops mounting them, instead of leaving a dead in-player toggle behind.
2. The add-on is disabled or updated while pages are open: `runtime.onSuspend` broadcasts a bounded
   teardown message to every tab, each tab drops its DOM and drives the page world's existing
   disable path through the ordinary settings bridge. The residual (suspend never runs, a tab is
   unreachable, MV3) is documented rather than silently accepted.

## Changes

- `src/shared/teardown.ts` (new): `TEARDOWN_MESSAGE`, `isTeardownMessage`, `buildTeardownSnapshot`.
  The message names an action and carries no data; the builder only forces `enabled: false`, because
  every page-world subsystem is gated on it.
- `entrypoints/content.ts`:
  - `removeInPlayerControls()` (exported): removes the audio-only toggle, download button, status
    region, tooltip, injected control styles, legacy segment button, and any live segment toast by
    id, tolerating duplicates. The distraction stylesheet stays `updateDistractionStyle`'s job.
  - `applyEffectiveSettings`: a disabled snapshot removes the controls; an enabled one updates state
    and nudges a reconcile (`requestControlReconcile`, wired by `installPlayerControls`). This makes
    a re-enable re-mount immediately instead of waiting for a page mutation.
  - `installPlayerControls`: the reconcile early-returns while disabled (disposing the toast first)
    and only installs the control styles on the enabled path, so a disabled page carries zero
    `yta-` nodes. `requestControlReconcile` resets in the cleanup.
  - `beginTeardown()`: terminal per page (`contentTornDown`). It removes the stylesheet and DOM,
    then posts `buildTeardownSnapshot(lastDelivered)` over the bridge only when a snapshot was ever
    delivered. The terminal flag also makes `applyEffectiveSettings` a no-op, so a teardown that
    lands during startup cannot be followed by the still-queued post-injection push (the same
    delivery contract 2.7 broke once; see SPEC-020's correction).
  - The runtime message listener checks `isTeardownMessage` first.
- `entrypoints/background.ts`: `registerSuspendTeardownHandler()` (registered before any await)
  broadcasts the message to every tab on `runtime.onSuspend`, fire-and-forget with per-send catch.
  MV2 only: an MV3 event page suspends between events while the extension stays live, so MV3 keeps
  the documented residual instead of tearing down healthy pages.
- `docs/specs/SPEC-021-teardown-on-disable-and-update.md` (new): the design, the page-world reuse,
  the residual, and the tests. `SPEC-012` §5 gains the "absent while disabled" sentence.
- `docs/release-notes/NEXT.md`: one user-facing line ("Cleans up when switched off").

## Testing

- `tests/unit/teardown.test.ts`: the predicate accepts exactly the control message and rejects
  malformed/unrelated values; the builder forces `enabled` off, keeps every other field, and does
  not mutate its input.
- `tests/unit/in-player-mount.test.ts`: `removeInPlayerControls` removes a fully mounted set plus
  tooltip/toast/style nodes, leaves foreign nodes and YouTube's controls intact, and no-ops when
  nothing was installed.
- Bench (`run-bench.mjs`):
  - `m1:disabled-untouched` now also asserts no in-player control and `ytaNodeCount === 0` for a
    seeded-disabled session.
  - `m1:teardown-message-removes-everything` (new): an active session with two distraction rules
    live; the harness broadcasts the real control message from the extension's own options page to
    every tab (it cannot disable a real add-on mid-session), then asserts `status: disabled`, a
    native `loadVideoById` reclaim, zero extension nodes, the restored native `src`, and stored
    preferences still `enabled: true`.
- Matrix (`run-matrix.mjs`): the master-gate combo additionally fails on a present in-player control
  or any remaining extension node.
- `npm run validate` green locally; CI carries the bench and matrix proof.
- **Correction from the first CI run.** All six hermetic bench lanes failed `m1:disabled-untouched`:
  the case asserted `ytaNodeCount`, but `runSession` never returned that field, so it evaluated
  `undefined` and could not pass (the matrix master-gate check read the same missing field through
  `?? 0` and was silently vacuous). `runSession` now exposes `ytaNodeCount: snap.ytaNodeCount`,
  which both the case and the matrix check consume; the follow-up commit carries the fix.

## Safety

- Best-effort by construction: every send is caught, the handler is idempotent, and the residual is
  in the spec.
- No new permissions (`tabs.query`/`tabs.sendMessage` need none; `tabs` remains unrequested), no new
  storage keys, no network, no page data crossing the boundary.
- Teardown never rewrites preferences; the bench asserts stored settings stay `enabled: true` after
  the broadcast.

## Follow-ups

- CP4 continues with hygiene H2 (AMO review replies), H3 (GitHub hygiene + manifest support
  fields), H4 (provenance/NOTICE), then the residential canary and release prep.
