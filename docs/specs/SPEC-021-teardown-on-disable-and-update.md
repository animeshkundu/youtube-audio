# Specification: Teardown on Disable and Update

## Overview

CP4 item 2.8 of the 1.1.0 release plan. The extension installs state in two places that outlive a
simple settings push: page-world patches (visibility override, idle-nag layers, scriptlet wrappers,
player hints, the audio graph, and possibly an active audio-only hijack) and content-side DOM (the
distraction stylesheet, the in-player controls, the tooltip, the status region). Two ways the
extension goes away must leave neither behind:

1. **The user's own switch** (`settings.enabled = false`). Fully observable: the ordinary settings
   push already runs a complete page-world teardown (SPEC-020 re-arms the affected groups;
   `PlayerHandle` + the reclaim tracker restore native playback). What was missing is the DOM: a
   disabled extension must remove its nodes instead of leaving a dead toggle (and a disabled
   extension also stops mounting controls at all).
2. **The add-on is disabled or updated in the browser** while pages are open. No settings push can
   happen: the background contexts are unloaded first. `runtime.onSuspend` is the last moment the
   extension still runs, so it asks every tab to tear down through a bounded control message, and
   the residual (a suspend that never runs, a tab that cannot be reached) is documented instead of
   silently accepted.

The teardown reuses the settings bridge end to end. The content script answers the message by
dropping its own DOM and posting a master-disabled snapshot over the ordinary settings channel; the
page world applies it through the existing disable path, so there is no second cleanup protocol to
keep in sync.

## Goals

- `src/shared/teardown.ts` (new) exports:
  - `TEARDOWN_MESSAGE`: the runtime message type (`'yta:teardown'`).
  - `isTeardownMessage(message)`: true for exactly that control message, false for every malformed
    or unrelated value.
  - `buildTeardownSnapshot(settings)`: the last delivered snapshot with `enabled` forced to `false`
    and every other field untouched (pure; used for both the page-world post and the local
    stylesheet removal).
- A disabled extension leaves zero extension-owned nodes in the page. `removeInPlayerControls()`
  (content, exported) removes the audio-only toggle, the download button, the status region, the
  tooltip, the injected control styles, the legacy segment button, and any live segment toast; the
  distraction stylesheet is removed through the existing `updateDistractionStyle` path (an empty
  sheet is not emitted).
- The reconcile loop (content) refuses to mount while the effective snapshot is disabled, so a
  seeded-disabled page never shows the controls, and it removes the nodes if a disable lands
  mid-session. A settings push nudges a reconcile (`requestControlReconcile`) so a re-enable
  re-mounts the controls immediately instead of waiting for a page mutation that a static page may
  never deliver.
- On suspend (MV2 persistent background only), the background broadcasts `{ type: TEARDOWN_MESSAGE }`
  to every tab, fire-and-forget, each send caught.
- The content script handles the message once per page: it removes its DOM and posts
  `buildTeardownSnapshot(lastDelivered)` over the settings bridge, then never applies or pushes
  another snapshot for the life of the page.
- Page world: **no new code**. A master-disabled snapshot drives the existing disable path
  (visibility, idle-nag, scriptlets, quality of life, segments, graph dispose, media release +
  native reclaim, and an honest `disabled` status).

## Non-Goals

- **Not a settings reset.** Teardown removes page state; stored preferences are never rewritten
  (asserted in the bench).
- **No MV3 path.** An MV3 event page suspends between events while the extension stays live, so a
  suspend there does not mean "unloading"; broadcasting on it would tear down healthy pages. MV3
  keeps the documented residual.
- **No new permissions.** `tabs.query`/`tabs.sendMessage` need none; the extension still does not
  request `tabs` (ADR-0014 era decision).
- **Not a guarantee.** Teardown is best-effort by construction; see Residual.

## Technical Design

### `src/shared/teardown.ts`

```ts
export const TEARDOWN_MESSAGE = 'yta:teardown';
export function isTeardownMessage(message: unknown): boolean;
export function buildTeardownSnapshot<T extends { enabled: boolean }>(settings: T): T;
```

The message carries no data in either direction: it names an action, nothing more. The snapshot
builder edits only `enabled`, because every page-world subsystem is gated on it and the remaining
fields keep the snapshot otherwise identical to what the page was running with.

### Background (`entrypoints/background.ts`)

`registerSuspendTeardownHandler()` runs before any await in `main()`:

```ts
if (!getExtensionPlatform().persistentBackground) return;
browser.runtime.onSuspend.addListener(() => {
  void browser.tabs
    .query({})
    .then((tabs) =>
      Promise.all(
        tabs.map((tab) =>
          typeof tab.id === 'number'
            ? browser.tabs.sendMessage(tab.id, { type: TEARDOWN_MESSAGE }).catch(() => undefined)
            : undefined
        )
      )
    )
    .catch(() => undefined);
});
```

The shape mirrors the existing consent broadcast (query all tabs, per-tab catch, never reject).

### Content script (`entrypoints/content.ts`)

- `removeInPlayerControls()` (module-level, exported): removes the extension-owned node ids
  (`yta-audio-only-toggle`, `yta-segment-status`, `yta-download-audio`, `yta-player-status`,
  `yta-audio-only-tooltip`, `yta-player-control-style`, `yta-segment-toast`) via
  `querySelectorAll('[id="..."]')`, so duplicates can never survive. The distraction stylesheet
  stays `updateDistractionStyle`'s business.
- Settings push (`applyEffectiveSettings`): a disabled snapshot removes the controls; an enabled one
  updates their state and nudges one reconcile. The stylesheet update follows either way.
- Reconcile (`installPlayerControls`): early-returns while the effective snapshot is disabled after
  disposing the toast and removing the nodes; the enabled path installs the control styles (moved
  out of the install-time call so a disabled page never carries them) and mounts as before.
- `beginTeardown()` (once per page, terminal):
  - sets `contentTornDown`, which makes `applyEffectiveSettings` a no-op, so a still-queued
    post-injection push cannot resurrect the extension after a teardown that lands during startup;
  - removes the stylesheet (`buildTeardownSnapshot(lastDelivered ?? storedSettings)`) and the
    controls;
  - posts `buildTeardownSnapshot(lastDelivered)` over the bridge **only if a snapshot was ever
    delivered**: if none was, the page world has nothing of ours to take down.
- The runtime message listener checks `isTeardownMessage` first.

### Page world (`entrypoints/main-world.ts`)

Unchanged. The posted snapshot is a normal settings message whose `enabled` is `false`, so
`applySettings` runs its disable path exactly as if the user had flipped the master switch.

## Residual

Best-effort means the following cases leave the installed state (page-world patches and any active
hijack; the content DOM dies with the extension) until the page reloads:

- `runtime.onSuspend` never runs (crash, force-kill, the browser tearing the background down before
  the handler executes);
- the message cannot be delivered (the tab's content script is already gone);
- any MV3 context (by design, see Non-Goals).

On update, the new instance re-injects on the next navigation, so the residual window ends at the
first reload.

## Error Handling

- Every broadcast send is caught; a tab without our content script rejects and is ignored.
- `beginTeardown` and `removeInPlayerControls` are idempotent (terminal flag; removal of absent
  nodes is a no-op).
- The page-world post reuses the validated settings channel: a malformed snapshot is dropped by the
  existing parser, and the bridge nonce still gates delivery.

## Testing Strategy

- `tests/unit/teardown.test.ts`: the predicate accepts exactly the control message and rejects
  malformed/unrelated values; the snapshot builder forces `enabled` off, keeps every other field,
  and never mutates its input.
- `tests/unit/in-player-mount.test.ts`: `removeInPlayerControls` removes a fully mounted control set
  plus the tooltip/toast/style nodes and leaves foreign nodes and YouTube's own controls intact; it
  is a no-op when nothing was installed.
- Bench (`tests/e2e/bench/run-bench.mjs`):
  - `m1:disabled-untouched` (seeded `enabled: false`) now also asserts no in-player control and zero
    `[id^="yta-"]` nodes.
  - `m1:teardown-message-removes-everything` (new): an active session with two distraction rules
    live; the harness broadcasts the real control message from the extension's own options page to
    every tab (it cannot disable a real add-on mid-session), then asserts `status: disabled`, a
    native `loadVideoById` reclaim, zero extension nodes, the restored native `src`, and stored
    preferences still `enabled: true`.
- Settings matrix (`tests/e2e/bench/run-matrix.mjs`): the master-gate combo (every feature on,
  `enabled: false`) additionally fails if the in-player control is present or any extension node
  remains.
- `npm run validate` is the gate; CI runs the bench and the matrix.

## Dependencies

- None new.

## Security and Privacy Considerations

- The teardown message is a bounded control message with no payload in either direction; it joins
  the same trust class as the existing runtime messages. Page-world data stays untrusted, and the
  settings post still requires the bridge nonce.
- The broadcast uses tab ids only; it lists no tab contents and reads nothing from pages.

## Performance Considerations

- One broadcast per extension unload; one DOM sweep per disable. Both are O(1) in practice.
- The reconcile nudge is coalesced by the existing frame scheduler (SPEC-018), so a burst of
  settings pushes produces at most one reconcile per frame.

## Related Documents

- `docs/specs/SPEC-020-settings-diffing.md`: the push path the teardown reuses, including the
  post-injection delivery guarantee the terminal guard protects.
- `docs/specs/SPEC-012-holistic-ux-foundations.md` §5: the in-player control that is absent while
  disabled.
- `docs/adrs/0015-extension-coexistence.md`: identity-checked teardown of foreign-visible patches.
