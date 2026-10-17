# Handoff: coexistence with other YouTube page extensions (CP4 item 2.6)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP4 item 2.6 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`: adopt an
existing visibility override and revert only what we installed, the SponsorBlock double-seek
guard, anchor-tolerant idempotent player buttons for Enhancer / Return YouTube Dislike, and
ADR-0015. The audit found the button contract already correct (locked with a new coexistence test)
and the seek guard already present inline (single-sourced into a unit-tested decision function);
the real gaps were the teardown paths that restored captured originals unconditionally, which
clobber a later foreign patch. ADR-0015 generalizes ADR-0013's additive-chaining rule to every
shared page surface.

## Changes

- `docs/specs/SPEC-019-extension-coexistence.md` (new): the coexistence contract, the three shared
  helpers, the guard semantics, and the tests.
- `docs/adrs/0015-extension-coexistence.md` (new): the decision record, including the documented
  residual (another extension restoring to a captured getter rather than deleting, which our side
  cannot fix for them).
- `src/shared/visibility-override.ts` (new): `installVisibilityOverride(document)`, extracted from
  the page-world inline implementation. Per property (`hidden`, `visibilityState`), an existing
  own-property override is adopted (never stacked, never touched again); otherwise our configurable
  getter is installed; the `visibilitychange` swallow listener is unchanged; cleanup restores by
  deleting the property **only while the current accessor is still ours**.
- `src/shared/own-patch.ts` (new): `installValuePatch(target, key, value)` assigns, verifies the
  write took (returning `null` otherwise), and returns a teardown that restores the previous own
  value or deletes the own property **only while the installed value is still ours**.
- `entrypoints/main-world.ts`: `enableBackgroundPlay` deleted in favour of the shared override; the
  idle-nag `youthereDataChanged_` no-op and `mediaSession.setActionHandler` wrapper now go through
  `installValuePatch` (named values so identity comparison is exact). The neutralized pause
  handler's registry undo stays unconditional: that entry is ours regardless of who owns the
  property now. The segment-skip loop calls `resolveSegmentSkipTarget`; the inline
  range/target logic is gone.
- `src/shared/sponsorblock.ts`: `resolveSegmentSkipTarget({ segment, currentTime, duration })`
  (new): `null` before the start and **at or past the end** (the double-seek guard: another
  skipper's seek, a manual seek, or our own completed skip never triggers a second seek), the
  duration-clamped end otherwise, and `null` when that target is not ahead of the playhead. The
  handled-set latch (mark once playback actually passes the end) stays in the caller, so a seek
  that fails to stick is retried rather than consumed.
- `src/shared/player.ts`: `installDormantGuard` keeps named wrapper getter/setter and
  `restore()` re-applies the captured `src` descriptor only when the current descriptor is still
  that wrapper; internal state clears either way, and the release record / no-src-rewrite contract
  are unchanged.
- `docs/architecture/README.md`: new "Coexistence with Other Extensions" section; the stale
  M0-era MAIN-world paragraph now lists the current ownership (hijack, fetch, visibility override,
  idle-nag, seek decision) and the coexistence contract.
- Tests: `tests/unit/visibility-override.test.ts` (force/cleanup, adoption, foreign-over-patch
  survival, swallow listener; the inherited accessors are stubbed to report hidden so the override
  is observable), `tests/unit/own-patch.test.ts` (delete restores inheritance, previous own value,
  later patch survives, frozen target returns `null`), `tests/unit/player.test.ts` (foreign `src`
  accessor patched over ours survives `disable()`), `tests/unit/sponsorblock.test.ts`
  (`resolveSegmentSkipTarget` matrix incl. the at/past-end nulls and duration clamp),
  `tests/unit/in-player-mount.test.ts` (foreign buttons in the right cluster: ours anchor before
  the gear, a foreign button inserted between ours and the gear is tolerated with one bounded
  re-place, a further reconcile is byte-identical, foreign nodes are never moved or duplicated).
  `vitest.config.ts` adds both new modules to the covered core list.

## Safety

- Stock YouTube behavior is unchanged: with no foreign patches present, every path performs exactly
  the previous install/restore. Adoption only triggers when an own property already exists.
- Fail-open is preserved everywhere: descriptor reads are total, installs/restores are individually
  try/caught, `installValuePatch` returns `null` instead of throwing, and
  `resolveSegmentSkipTarget` is total over numbers.
- The identity checks strictly reduce what teardown can clobber; no new permissions, storage,
  messages, or network paths.

## Testing

- Focused run: 48 tests across the five touched suites, green; full suite green with the coverage
  gate (94+% statements overall and above the floor for the new modules).
- Bench unchanged by design: the fixture models stock YouTube, so adoption/identity paths are inert
  there; the existing background-visibility suppression, segment-skip, and idle-nag cases remain
  the CI integration proof for the shared paths through the real add-on.
- `npm run validate` green (typecheck, lint, format, unit tests incl. coverage, MV2 build,
  `web-ext lint`, MV3 build).

## Follow-ups

- CP4 continues with 2.7 (settings diffing), 1.6 (distraction extras), and 2.8 (teardown on
  disable/update), then the hygiene items (H2-H4).
- The removed inline `enableBackgroundPlay` had one behavior the shared module now also guards: a
  second install after a foreign patch adopts instead of overwriting, which is the intended change.
  No consumer needed the old overwrite.
- Residual documented in ADR-0015: a foreign extension that restores to a captured getter (rather
  than deleting) can leave a stale getter after our cleanup; page navigation resets it. We cannot
  fix another extension's unconditional restore without stacking our own override forever.
