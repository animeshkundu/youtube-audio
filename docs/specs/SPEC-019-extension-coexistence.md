# Specification: Coexistence with Other YouTube Page Extensions

## Overview

CP4 item 2.6 of the 1.1.0 release plan, with ADR-0015 as the decision record. Several extensions
share the YouTube page world and touch overlapping surfaces: background-play visibility overrides,
the media element `src` descriptor, idle-nag method patches, media-session handlers, player control
buttons, and sponsor-segment seeks. This spec pins the coexistence contract so every surface the
extension controls follows the same rules: **adopt what is already there, wrap additively when
wrapping is the only option, and at teardown revert only what we installed**. It also moves the
segment-skip decision into one shared, unit-tested function with the "never re-seek when playback is
already past the segment end" guard, and locks the player-button placement against foreign buttons
with a coexistence test.

## Goals

- Extract the page-world visibility override into a shared, unit-tested module
  (`src/shared/visibility-override.ts`) that:
  - per property (`document.hidden`, `document.visibilityState`), **adopts an existing own-property
    descriptor instead of installing ours**: any own property on the target already means someone
    (another extension, or the page) owns that name, so our override is skipped for it;
  - installs our configurable accessor only where the property is still inherited;
  - keeps the capture-phase `visibilitychange` swallow that stops YouTube's listeners from seeing
    the event;
  - on cleanup, restores a property **only while the current accessor is still the one we
    installed**, and otherwise leaves the current owner's patch in place (delete/restore otherwise,
    exactly as before);
  - stays fail-open: a throwing `defineProperty` or listener registration skips that layer.
- Add `src/shared/own-patch.ts` (`installValuePatch`) for page-object method patches and route the
  idle-nag's two own-property patches through it: the player's `youthereDataChanged_` no-op and the
  `mediaSession.setActionHandler` wrapper. The helper returns `null` when the patch does not take,
  and its teardown restores (or deletes) the property only while the installed value is still
  ours, so a later wrapper that patched over us keeps its patch.
- Give `PlayerHandle.restore` the same identity check for the `HTMLMediaElement.prototype.src`
  accessor it installs: restore the captured descriptor only when the current accessor is still the
  wrapper we installed. Wrapping remains additive (the wrapper always calls through to the captured
  descriptor, in the spirit of ADR-0013); only the teardown changes.
- Single-source the sponsor-skip decision in `src/shared/sponsorblock.ts` as
  `resolveSegmentSkipTarget({ segment, currentTime, duration })`:
  - `null` when playback is before the segment start or **already at/past the segment end** (the
    double-seek guard: another skipper's seek, a manual seek, or one of our own completed skips
    never triggers a second seek);
  - otherwise the seek target (the segment end, clamped to `duration`), and `null` when that target
    is not ahead of the current time;
  - the handled-set semantics stay in the caller: a segment latches as handled only once playback
    has actually moved past its end, so a seek that fails to stick stays retryable.
- Keep the player-button contract and prove the coexistence case: anchor before the native gear when
  it is a child of the controls, else before the first non-managed child, else append; never anchor
  on a node the placement moves; insertion is idempotent (same order, no duplicates, no churn) with
  foreign buttons (Enhancer for YouTube / Return YouTube Dislike shapes) present anywhere in the
  controls; foreign buttons are never moved or removed.
- Record the whole policy as ADR-0015, extending ADR-0013's additive-chaining rule to descriptors,
  page-object patches, DOM buttons, and seek decisions.

## Non-Goals

- No detection of specific extensions: no known-extension lists, DOM fingerprints, or UA checks.
  The policy applies to whatever is present, uniformly.
- No change to the scriptlet operations' chaining semantics (ADR-0013 stands unchanged).
- No change to the bench fixture: it models stock YouTube. The existing background-visibility
  suppression and segment-skip bench cases remain the integration proof for the extracted code
  paths; adoption/identity paths are inert on a stock page and covered by unit tests.
- No new settings, permissions, message types, or diagnostics vocabulary. No user-visible change
  on a stock YouTube page.
- No change to the sponsor request/lookup path (`hashVideoIdPrefix`, category filtering).

## Technical Design

### Visibility override (`src/shared/visibility-override.ts`)

```ts
export function installVisibilityOverride(target: Document): () => void;
```

For each of `{ hidden: () => false, visibilityState: () => 'visible' }`, read
`Object.getOwnPropertyDescriptor(target, name)`:

- own descriptor present (any kind) = someone's override is already effective for that name → adopt
  it, install nothing, and never touch it, including at cleanup;
- no own descriptor → install our configurable getter, remembering the previous descriptor (which
  is `undefined` for the inherited native accessor) and the getter function itself.

After the per-property pass, register the `visibilitychange` swallow listener (capture, on the
target). Cleanup removes the listener and, for each installed property, re-reads the descriptor and
restores the remembered previous state **only if `descriptor.get` is still our getter**; a foreign
patch installed after ours is left in place. Every operation is individually try/caught and
fail-open, matching the current inline implementation's guarantees.

`entrypoints/main-world.ts` deletes its local `enableBackgroundPlay` and calls the shared function;
the call site's re-arm contract (cleanup the previous override, install a fresh one) is unchanged.

### Own-property patches (`src/shared/own-patch.ts`)

```ts
export function installValuePatch<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K]
): (() => void) | null;
```

- remembers whether the property was an own property and its previous value;
- assigns and verifies (`target[key] === value` after assignment), returning `null` when the write
  threw or was intercepted (frozen object, accessor without a setter that ignores writes);
- the returned teardown checks `target[key] === value` before restoring the previous own value or
  deleting the own property, so a later patch owns the property and survives our teardown.

`enableIdleNagDefeat` uses it for `youthereDataChanged_` (the no-op is now a named function so the
identity check is exact) and for `setActionHandler` (the wrapper is a named const; the previous
`hadOwnSetActionHandler` restore/delete logic moves into the helper). Re-registering the neutralized
`pause` handler through the original bound function stays unconditional (that registry entry is
ours regardless of who owns the property now). A `null` result skips that layer exactly like the
current failed-patch paths.

### Media `src` descriptor (`src/shared/player.ts`)

`installDormantGuard` stores the installed getter/setter pair. `restore()` compares the current
descriptor against that pair before re-applying `originalDescriptor`; on mismatch (a foreign
wrapper patched over ours) it leaves the current descriptor alone. Internal state (`mediaElement`,
`originalDescriptor`, the accessor pair) is cleared either way, so the release record and the
"no `<video>.src` write" contract are unchanged.

### Sponsor-skip decision (`src/shared/sponsorblock.ts`)

```ts
export function resolveSegmentSkipTarget(params: {
  segment: SponsorSegment;
  currentTime: number;
  duration: number;
}): number | null;
```

Returns `null` when `currentTime` is outside `[start, end)` (including at/past the end), else the
clamped end when it is ahead of the current time, else `null`. `installSegmentSkipping` keeps the
handled-set latch (mark on `currentTime >= end`) and calls this function for the skip decision;
the telemetry-free `SEGMENT_SKIPPED_EVENT` dispatch happens only when the function returns a
target.

### Player buttons (`entrypoints/content.ts`)

No code change (the anchor/placement contract already avoids managed nodes and the gear-absent hot
loop, per the earlier hardening). The coexistence case is locked by a new unit test: with foreign
buttons placed between our buttons and the gear, after the gear, and bespoke ids/classes, one
reconcile re-places our buttons immediately before the gear without touching foreign nodes, and a
second reconcile performs no DOM move (byte-identical innerHTML).

## Error Handling

- Adoption never throws: descriptor reads are total, and installs/restores are individually
  try/caught with the page's state preserved on failure.
- `installValuePatch` returns `null` instead of throwing when a patch cannot take.
- `resolveSegmentSkipTarget` is total over numbers (NaN/Infinity fall back to the unclamped end,
  matching the existing `Number.isFinite` guard) and never throws.
- No new failure modes for stock pages: with no foreign patches present, every path is byte-for-byte
  the previous behavior.

## Testing Strategy

- `tests/unit/visibility-override.test.ts` (new, jsdom): forces the inherited getter to report
  hidden, installs the override, proves the forced values, and proves cleanup returns the inherited
  behavior; adoption (pre-existing own accessor for one property is left untouched while the other
  gets ours; cleanup leaves the adopted one); identity- guarded restore (a foreign accessor patched
  over ours survives cleanup); the swallow listener (a listener added after install never sees a
  dispatched `visibilitychange`, and does see one after cleanup).
- `tests/unit/own-patch.test.ts` (new): own property round-trip (delete restores inheritance),
  existing own value restore, foreign-over-patch survival, frozen target returns `null`, intercepted
  assignment returns `null`.
- `tests/unit/player.test.ts`: a foreign `src` accessor installed after `attach` survives
  `disable()`, and the handle still reports the release record with internal state cleared.
- `tests/unit/sponsorblock.test.ts`: `resolveSegmentSkipTarget` returns the target inside a segment,
  `null` before the start, `null` at and past the end (the double-seek guard), clamps to `duration`,
  and returns `null` when the end is not ahead of the playhead.
- `tests/unit/in-player-mount.test.ts`: the foreign-button coexistence case above (placement +
  stability + foreign nodes untouched).
- Bench: unchanged; the existing background-visibility suppression, segment-skip, and idle-nag
  cases re-validate the shared paths through the real add-on in CI.
- `npm run validate` is the gate.

## Dependencies

- None new. The extracted modules use only DOM APIs already in use.

## Security and Privacy Considerations

- No new data access, egress, storage, or permissions. Adoption reads descriptor shape only.
- The identity checks strictly reduce what teardown can clobber another extension's patch with;
  they cannot widen our write surface.
- The visibility override still lives only in the page world with the same fail-open boundary.

## Performance Considerations

- Adoption can skip one or both `defineProperty` calls and the corresponding restores.
- The sponsor decision is a pure function replacing inline logic (same work); the buttons already
  reconcile through the coalesced frame scheduler.
