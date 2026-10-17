# ADR-0015: Coexist with other YouTube extensions by adoption and identity-checked teardown

## Status

Accepted. Extends ADR-0013 (additive chaining) from scriptlets to every shared page surface.

## Date

2026-10-16

## Context

YouTube users commonly run several extensions at once: Enhancer for YouTube, Return YouTube
Dislike, other background-play and ad-skip tools, and general scriptlets. They share the same page
world, so more than one of them can touch the same surface:

- `document.hidden` / `document.visibilityState` (background-play overrides),
- the `HTMLMediaElement.prototype.src` accessor (playback hijacks),
- page-object methods (`youthereDataChanged_`, `mediaSession.setActionHandler`),
- the player control-bar DOM (buttons appended next to the native gear),
- sponsor-segment seeks (more than one skipper watching the same timeline),
- `ytInitialPlayerResponse` / `JSON.parse` (already settled by ADR-0013).

Two failure modes shape the policy. First, teardown that restores a captured original
unconditionally clobbers whoever patched over us last, so a second extension breaks when our
feature toggles off. Second, install-time stacking (both extensions forcing the same value) makes
teardown order-dependent and can leave a page with a dead override if one side restores to its
captured "original" that is actually the other side's patch. Both are avoidable with the rules the
project already proved for scriptlets.

## Decision

One coexistence contract for every shared surface (described in SPEC-019):

1. **Adopt what is already there.** If an own-property override already exists for a surface name
   we would install (`document.hidden`, `document.visibilityState`), skip ours for that name: the
   existing override is already effective, and stacking adds nothing but teardown risk. Applied
   per property, so a partial foreign override gets ours only where it has none.

2. **Wrap additively where wrapping is unavoidable.** Accessors we must own to do our job (the
   media `src` descriptor, whose wrapper protects our audio URL while calling through), and
   scriptlet wrappers, always capture and call through to the current implementation, in the
   spirit of ADR-0013. They never replace behavior, only chain it.

3. **Revert only what we installed.** Every teardown re-reads the surface and restores (or
   deletes) it **only while the installed value is still the one we installed** (getter/setter
   identity for descriptors, value identity for object patches, function identity for history
   wrappers). A later foreign patch owns the surface and survives our teardown; a property the
   page deleted stays deleted.

4. **Be idempotent and anchor-tolerant in the DOM.** Injected controls use our own ids/classes,
   are created once and re-placed only when the placement check fails, never anchor on a node we
   move, and never touch foreign nodes (removal is scoped to our own ids).

5. **One seek decision, with a past-end guard.** Sponsor skips go through a single decision
   (`resolveSegmentSkipTarget`): a skip is issued only while the playhead is inside an unhandled
   segment and the target lies ahead. A playhead already at/past the segment end means someone
   (another skipper, a manual seek, or a retried skip) already handled it, so no second seek is
   issued. A seek that fails to stick stays retryable because the segment latches as handled only
   once playback actually passes its end.

We deliberately do not detect or special-case named extensions: the rules are applied to whatever
is present, so there is no list to maintain and no fingerprinting of other add-ons.

## Consequences

- Feature teardown can no longer break another extension's patch, and another extension's later
  patch no longer breaks ours: whichever is installed last owns the surface, and both restores are
  safe in either order.
- When a foreign override is adopted, our own teardown is a no-op for that property; that is the
  intended behavior (we never installed anything to revert).
- The contract is unit-testable on jsdom documents, and the shared helpers
  (`installVisibilityOverride`, `installValuePatch`, `resolveSegmentSkipTarget`) keep the logic in
  covered core modules rather than entrypoint glue.
- Stock YouTube pages are unaffected: with nothing foreign present, every path is the previous
  behavior byte-for-byte, so the existing hermetic bench cases remain the integration proof.
- Known residual: two extensions both forcing `document.hidden` where the SECOND one restores to
  a captured "original" that is our getter (rather than deleting) will leave our getter installed
  after we already cleaned up. Our teardown is identity-correct; we cannot fix another
  extension's unconditional restore, and the stale getter only keeps reporting visible while our
  feature is off, which the page's own navigation resets.

## Related

- ADR-0013 (scriptlet additive chaining, the pattern this generalizes),
- SPEC-019 (the design and tests), SPEC-016 (idle-nag defeat), SPEC-012 (player controls/tab scope),
- `src/shared/visibility-override.ts`, `src/shared/own-patch.ts`, `src/shared/player.ts`,
  `src/shared/sponsorblock.ts`, `entrypoints/main-world.ts`, `entrypoints/content.ts`.
