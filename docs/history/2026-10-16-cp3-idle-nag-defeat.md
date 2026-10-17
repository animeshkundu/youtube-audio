# Handoff: idle-nag defeat (CP3 item 1.3)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP3 item 1.3 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`, specified
as SPEC-016 (new): a default-on, layered, fully reversible page-world defeat for YouTube's idle
check (the desktop "Video paused. Continue watching?" dialog, the mobile "Still watching?" notice,
and Music's "You there?" prompt), gated on background play, with an options toggle and an instant
teardown. The default-on product call (reviewer dissent retained) stands; flipping to opt-in is the
documented one-line escape hatch. Fallback quality (1.4) and the consent UX items (1.5) of CP3
remain open.

## Changes

- `docs/specs/SPEC-016-idle-nag-defeat.md` (new): goals, non-goals, the four layers, the settings
  contract, error handling, testing, security, and rollout/rollback.
- `src/shared/idle-nag.ts` (new): `IDLE_NAG_KEEPALIVE_MS` (240 s), `IDLE_NAG_JITTER_MS` (30 s),
  `IDLE_NAG_PRIME_MS` (2 s), `nextIdleNagDelayMs` (bounded jitter, injectable random),
  `isIdleNagNodeName`, and the DOM locators `findIdleNagRenderer`, `findIdleNagConfirmTarget`,
  `findIdleNagPopupContainer`, `dismissIdleNag` (click the confirm control, else the popup
  container; never throws).
- `src/shared/config.ts`: `idleNagDefeatEnabled` (default `true`), `setIdleNagDefeatEnabled`, and
  the normalize fallback for non-boolean input.
- `src/shared/settings-signals.ts`: `idleNagDefeatEnabledSignal`. `src/shared/consent.ts`: the
  consent-denied snapshot forces the field off with the other playback features.
- `entrypoints/main-world.ts`: `PageSettings` + strict `parseSettings` gain the field; the gate in
  `applySettings` arms only while `enabled && backgroundPlayEnabled && idleNagDefeatEnabled`;
  `enableIdleNagDefeat()` implements the four layers with one cleanup closure:
  - keepalive chain (`window._lact` when numeric, `movie_player.updateLastActiveTime()` when
    present) with a primed first pass, then jittered 240 s;
  - `youthereDataChanged_` no-op, patched lazily once the player mounts, restored on teardown;
  - `yt-popup-opened` capture listener plus a throttled (one check per 500 ms window, one trailing
    check) `MutationObserver` fallback, both routed through one dismissal that resumes paused media
    only after a confirmed nag dialog;
  - `mediaSession.setActionHandler` interception: YouTube's `pause` registrations are neutralised
    in favour of a handler that pauses directly via `HTMLMediaElement.prototype.pause`, so user
    pauses (media key, headset, notification) still pause; teardown restores the original method,
    deletes the own property when it created it, and re-registers the last captured handler.
- `entrypoints/options/App.tsx`: "Keep long videos playing" in the playback group, disabled with a
  "turn on background play" description while background play is off, with the honest consequence
  note. `docs/design/ux-onboarding.md`: the default-on list gains the field.
- `tests/e2e/bench/fixture-server.mjs`: `nag=1` serves the nag scenario (a stale `window._lact` seed
  and, after 6 s, a `yt-confirm-dialog-renderer` in a `ytd-popup-container` announced with
  `yt-popup-opened`, with a click marker and a pause).
- `tests/e2e/bench/run-bench.mjs`: `probeIdleNag` ('confirmed' | 'untouched') and three cases
  (`idle-nag:confirmed-and-clock-refreshed`, `idle-nag:disabled-keeps-dialog-and-clock`,
  `idle-nag:background-play-off-gates`). `tests/e2e/bench/run-matrix.mjs`: the mixed-row cell
  `idle-nag:off-inside-mixed-row-leaves-untouched` (defeat off while audio-only, ad-block, and
  loudness are on), the base settings gain the field, and `global:all-on` sets it explicitly.
- `vitest.config.ts`: `src/shared/idle-nag.ts` joins the covered core modules.

## Safety

- No new permissions, hosts, match patterns, network paths, storage keys, or bridge messages; the
  setting rides the existing validated settings push as one boolean. The page world touches only its
  own document, window, and media element, and `PlayerHandle` remains the sole media `src` writer.
- Every layer is existence-checked and try/catch guarded; a missing player, frozen property, or
  refused resume is a silent no-op, and native playback is never blocked.
- Teardown on disarm clears both timers, disconnects the observer, removes the listener, restores
  the page method, and reinstates the mediaSession method.

## Testing

- Unit: `tests/unit/idle-nag.test.ts` (node-name predicate, jitter bounds and clamping, the prime
  constant, locator order and fallbacks, dismissal clicks and false no-ops),
  `tests/unit/config-reset.test.ts` (default-on for pre-field installs, explicit off preserved,
  non-boolean rejected, setter persistence), `tests/unit/consent.test.ts` (the denied snapshot
  disables it), the options UI suite (row count and the new action).
- Bench: the three `idle-nag:` cases prove the confirmed-dialog + refreshed-clock + resumed-media
  outcome with the defaults and the untouched outcome when the toggle or background play is off.
  The settings matrix re-runs the off state inside a mixed row.
- Local bench runs remain sandbox-blocked (Firefox launch timeout under the agent shell), so CI
  executes the new cases and cell; this run is their first execution.
- `npm run validate` green (typecheck, lint, format, unit tests incl. the 90% coverage gate, MV2
  build, web-ext lint, MV3 build).

## Follow-ups

- CP3 items 1.4 (fallback quality) and 1.5 (consent UX + optional permissions) are next, then CP4
  plus hygiene.
- Two mechanisms are grounded but not directly verifiable against live YouTube internals:
  `youthereDataChanged_` (the patch skips cleanly when the method is absent) and how YouTube's own
  `pause` action handler behaves. The canary should watch for (a) the dialog still appearing despite
  the layer, (b) spurious OS-initiated pauses while armed, in which case the documented escalation
  is making the replacing handler itself a no-op (one line), and (c) any state weirdness around
  long-idle sessions.
- The release notes and the options copy mention the behaviour; mobile canary remains the release
  gate for the Android surface.
