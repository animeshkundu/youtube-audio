# Specification: Idle-Nag Defeat

## Overview

When a video plays unattended, YouTube eventually reacts to the lack of input with an
idle check: the desktop "Video paused. Continue watching?" dialog, the mobile
"Still watching?" notice, and Music's "You there?" prompt. For audio-only listening the
dialog is the last thing that stops a long session after the visibility problem is
solved. This spec defines the idle-nag defeat: a new default-on setting and a bounded,
layered, fully reversible page-world implementation that keeps unattended playback
running while preserving every deliberate pause the user makes.

## Goals

- Add `idleNagDefeatEnabled` (default `true`) to `ExtensionSettings`, with an options-page
  toggle in the playback group and no popup control. The toggle is only meaningful while
  `backgroundPlayEnabled` is on; the options copy states that relationship.
- Arm the page-world defeat only while `enabled && backgroundPlayEnabled && idleNagDefeatEnabled`
  and re-evaluate on every settings push, exactly like the existing background-play override.
- Defeat the nag in bounded layers, each existence-checked and individually reversible:
  - **Activity keepalive**: refresh the page's own activity signals at a low, jittered
    frequency (one immediate pass at arm, one primed pass `IDLE_NAG_PRIME_MS` = 2 s later so
    lazily defined clocks still get refreshed, then every `IDLE_NAG_KEEPALIVE_MS` = 240 s with
    +/- 30 s jitter): set `window._lact = Date.now()` when it is a number, and call
    `movie_player.updateLastActiveTime()` when the player exposes it as a function.
  - **You-there state no-op**: while armed, replace `movie_player.youthereDataChanged_`
    with a no-op when the player exposes it as a function, so YouTube's internal
    you-there state transition cannot act on its own; restore the original on teardown.
  - **Dialog auto-confirm**: listen for `yt-popup-opened`; when `event.detail.nodeName`
    is `YT-CONFIRM-DIALOG-RENDERER` or `YTMUSIC-YOU-THERE-RENDERER`, confirm the dialog
    (click its confirm control, fall back to closing the popup container) and resume
    playback if the dialog left the media paused. A bounded `MutationObserver` on
    `document.documentElement` provides the same dismissal for dialogs that appear
    without a matching event.
  - **mediaSession pause neutralisation**: while armed, YouTube's own
    `navigator.mediaSession.setActionHandler('pause', ...)` registrations are replaced
    with a handler that pauses the media element directly
    (`HTMLMediaElement.prototype.pause`), so YouTube's entangled handler never runs
    while a user pause (media key, headset, notification) still pauses immediately.
- Teardown on disarm restores every layer: interval cleared, observer disconnected,
  listeners removed, player methods restored, and the original `setActionHandler`
  reinstated with the last captured YouTube handler re-registered.
- Keep the failure mode honest: every layer is try/catch guarded, missing page objects
  are a silent no-op, and no failure ever throws into page code or blocks playback.

## Non-Goals

- Overriding `video.pause` or otherwise deferring programmatic pauses (the most
  detectable technique, and it interferes with deliberate pause UX; the research
  recommendation is to avoid it).
- Synthetic keyboard/mouse activity pings; the keepalive refreshes the page's own
  activity signals instead of injecting fake input.
- Changing the Page Visibility override (it already ships with background play) or any
  new visibility behaviour.
- Any background-page work: no storage, no network, no new permissions, no bridge
  messages, and no changes to status reporting or diagnostics vocabulary.
- Any DOM UI: the defeat is invisible; the only surface is the options toggle.

## Technical Design

### Settings

`src/shared/config.ts` gains `idleNagDefeatEnabled: boolean` (default `true`),
`setIdleNagDefeatEnabled`, and a `normalizeSettings` entry that falls back to the
default for non-boolean input. Existing installs pick the feature up on update; turning
the toggle off restores native behaviour immediately with no migration.

`entrypoints/main-world.ts` `PageSettings` gains the field, `parseSettings` requires it
as a boolean (a malformed payload still fails the whole push, unchanged), and
`applySettings` gates the arming:

```ts
idleNagCleanup();
idleNagCleanup =
  settings.enabled && settings.backgroundPlayEnabled && settings.idleNagDefeatEnabled
    ? enableIdleNagDefeat()
    : () => undefined;
```

The content script's settings push already forwards the full settings object, so no
bridge change is needed.

### Shared pure helpers (`src/shared/idle-nag.ts`)

Framework-free, unit-tested, DOM-typed only through `ParentNode`:

- `IDLE_NAG_KEEPALIVE_MS` (240 000) and `IDLE_NAG_JITTER_MS` (30 000).
- `nextIdleNagDelayMs(random?: () => number): number`: base +/- jitter, clamped to a
  positive integer; injectable `random` for deterministic tests.
- `isIdleNagNodeName(value: unknown): boolean`: accepts exactly the two renderer node
  names.
- `findIdleNagConfirmTarget(root: ParentNode): Element | null`: first match of
  `yt-confirm-dialog-renderer #confirm-button`, `yt-confirm-dialog-renderer button`,
  `ytmusic-you-there-renderer button`, `#confirm-button`.
- `findIdleNagPopupContainer(root: ParentNode): Element | null`:
  `ytd-popup-container` then `ytmusic-popup-container`.
- `dismissIdleNag(root: ParentNode): boolean`: clicks the confirm target, else the popup
  container; returns whether anything was clicked; never throws.

### Page-world wiring (`entrypoints/main-world.ts`)

`enableIdleNagDefeat(): () => void`, in the shape of `enableBackgroundPlay` (single
cleanup closure, rollback on partial failure):

1. Snapshot restorables: the `_lact` descriptor is not touched (only its numeric value is
   refreshed), the captured `youthereDataChanged_` value, and the original
   `mediaSession.setActionHandler`.
2. Activity keepalive: `runKeepalive()` performs the guarded `_lact` write and
   `updateLastActiveTime()` call; it runs once immediately and then through a
   `setTimeout` chain using `nextIdleNagDelayMs` (so a settings flip clears one timer
   instead of racing an interval).
3. You-there no-op: when `movie_player.youthereDataChanged_` is a function, replace it
   with a no-op; restore the captured value on teardown.
4. Dialog auto-confirm: a capture-phase `yt-popup-opened` listener plus a
   `MutationObserver` (`childList`, `subtree`) on `document.documentElement`, both
   routed through one `handleDialog()` that checks `dismissIdleNag(document)` and then
   resumes the document's media element `play()` only when the dialog was dismissed and
   the media is paused.
5. mediaSession: capture the original `setActionHandler`, then install a wrapper that,
   while armed and `action === 'pause'`, records the passed handler as
   `lastBlockedPauseHandler` and registers the direct-pause handler instead; every other
   action passes through unchanged. Teardown restores the original method and
   re-registers `lastBlockedPauseHandler` when one was captured, so YouTube's handler
   resumes control without waiting for its next registration.

The player object is resolved defensively (`document.getElementById('movie_player')`,
fallbacks tolerated): a missing player skips layers 2 and 3 only, the keepalive and
dialog layers still run.

### Options surface

`entrypoints/options/App.tsx` adds the toggle to the playback group next to background
play, with copy that explains the trade-off plainly: keeps audio playing past the
"still watching" check; YouTube's pause action is still honoured, but stopping playback
from the system notification may be ignored while armed.

## Error Handling

- Every layer is individually guarded: a throwing page getter, a frozen property, a
  missing player, or a detached DOM is caught and skipped; the rest of the layers stay
  armed and native playback is never disturbed.
- The wipe-on-arm supersedes any previous instance, so a settings flap cannot double-arm
  observers or leave timers behind.
- A dismissal that finds nothing to click reports `false` and does not call `play()`;
  the extension never resumes media on its own without an observed nag dialog.

## Testing Strategy

- **Unit**: `tests/unit/idle-nag.test.ts` covers the node-name predicate (both accepted
  names, near misses, non-strings), the jittered delay (bounds across random values,
  clamping at the extremes), confirm-target selection order and container fallback, and
  `dismissIdleNag` returning `false` on an empty root and `true` on each accepted shape.
  Config tests cover the new setting's default, setter, and normalization fallback.
- **Bench**: the fixture serves `/watch?v=NAG0001` with `window._lact` pre-seeded to a
  stale value and a delayed synthetic nag (a `yt-confirm-dialog-renderer` with a
  `#confirm-button`, announced with a `yt-popup-opened` event and a fixture-side click
  marker). With the default settings the case asserts the dialog was dismissed, playback
  was resumed by the extension when the fixture paused it, and `_lact` was refreshed.
  Two off sessions prove the gate: `idleNagDefeatEnabled: false` and
  `backgroundPlayEnabled: false` both leave the dialog untouched and `_lact` stale.
- **Matrix**: a dedicated row runs the fixture nag with `idleNagDefeatEnabled` off inside
  an otherwise-on configuration, so the new toggle is covered by the permutation harness
  alongside every existing one.
- **Canary**: the residential desktop canary exercises the keepalive path against live
  YouTube; the mobile canary is the release gate for the Android surface.
- **Release gates**: `npm run validate` (strict typecheck, zero-warning lint, format,
  real-source unit coverage, MV2 build, package lint, MV3 build).

## Security Considerations

- No new network paths, permissions, origins, storage keys, or bridge messages. The
  setting travels through the existing validated settings push.
- The page world touches only its own document, window, and media element; no data
  leaves the page, and nothing user-identifiable is recorded.
- The dialog path clicks only elements matching the fixed renderer selectors; it never
  executes page-provided strings.

## Rollout and Rollback

- Default on, gated behind background play (itself default on), with an options toggle;
  the release notes and the options copy mention the behaviour.
- Rollback is instant and local: toggling "Keep long videos playing" off (or background
  play off) tears every layer down on the next settings push; shipping the previous
  build needs no state migration.
- The mediaSession pause variant is the one deliberate deviation from the plan's
  shorthand "pause no-op": YouTube's handler is neutralised, but the user's pause action
  still pauses. If the canary shows spurious OS-initiated pauses while armed, the
  documented escalation is to make the replacing handler itself the no-op (one line).
