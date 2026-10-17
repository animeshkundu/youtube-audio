# ADR-0014: Per-tab audio-only scope is an in-memory, tab-keyed override

## Status

Accepted.

## Date

2026-10-16

## Context

The popup hero shipped (SPEC-012, ADR-0007) with an honest status line but a toggle that
writes the **global** `audioOnlyEnabled` preference. Toggling audio-only off for one noisy
tab therefore changes behavior for every tab, window, and Firefox for Android view. Users
expect a quick control in the popup to act on the tab in front of them, which is also why the
status channel was built tab-keyed in the first place.

SPEC-012's non-goals forbid persisting volatile per-tab state to disk, and the release plan's
item 1.2 requires: an in-memory override keyed by tab id, pruned on `tabs.onRemoved`, never
persisted, with the popup hero toggling the tab, the footer staying global, and a shortcut
(`Alt+Shift+A`) for the same tab-scoped action. SPEC-015 additionally requires that a
per-tab override reach every frame of the tab through the existing settings push, so embedded
players follow the tab they are embedded in.

### Problem Statement

Where should a per-tab audio-only override live, how does it reach the page and the popup,
and what is its precedence and lifetime?

### Constraints

- No persistence of volatile per-tab state; no new storage keys and no schema migration.
- No new permissions, no new origins, and no change to the trusted bridge payload bounds.
- The four content-script match patterns and the credentialless core stay unchanged.
- Fail open: every channel step must degrade to the global preference, never to a broken page.
- Extension restarts (background reload, browser restart) may drop overrides.

## Decision

A per-tab audio-only override is a **background-owned, in-memory `Map<tabId, boolean>`**:

- **Effective value.** For a tab, effective audio-only is `override ?? globalAudioOnlyEnabled`.
  The override only ever covers the `audioOnlyEnabled` field; `enabled` (the global pause) and
  every other setting stay global and still win when off.
- **Surfaces.** Every quick control acts on the tab in front of the user: the popup hero, the
  in-player toggle on a watch page, and the new `Alt+Shift+A` command. The options page,
  onboarding, and every other surface keep editing the global preference. The popup hero always
  renders the effective value, and the background resolves or constrains the SET target itself
  (active tab for extension pages, the sender's own tab for content scripts, YouTube-family only)
  so no caller can target an arbitrary tab.
- **Transport.** Three message types on the existing ADR-0007 channel: `yta:get-tab-scope` (popup
  for the active tab, content scripts for their own `sender.tab.id`), `yta:set-tab-scope` (popup
  for the active tab; a content script only for its own `sender.tab.id`, which is how the
  in-player toggle sets its tab), and `yta:tab-scope-changed` (background to the tab's frames via
  `tabs.sendMessage`, and to the popup via the active-tab broadcast).
- **Application.** Each frame's content script merges the override into the consented settings
  snapshot it already pushes to the page world, so the override reaches every frame of the tab
  (embedded players included) through the same bounded settings channel.
- **Lifetime.** Never written to storage; pruned on `tabs.onRemoved`; lost on background restart.
  The override for a tab survives reloads and SPA navigations within that tab.

### Considered Options

1. **In-memory background map plus the existing tab-keyed channel (chosen).**
   - Pros: reuses ADR-0007's store and broadcast patterns; no storage writes or migrations; dies
     on restart by construction; the popup can read it from the same authority that owns it; the
     content scripts already have a per-frame settings push to merge into.
   - Cons: overrides do not survive a background reload; a new message vocabulary and a `commands`
     manifest entry are needed.
2. **`sessionStorage` written by the content script.**
   - Pros: survives background restarts; no messaging.
   - Cons: per-origin and invisible to the background and popup (the popup cannot read it without
     asking the content script anyway); the origin is shared with the hostile page, so a
     poisoned value could not be validated against a tab id; no tab id is available in the page.
3. **Persisted per-tab settings.**
   - Pros: survives restarts.
   - Cons: directly violates SPEC-012's non-goal, leaks tab ids across sessions, and needs garbage
     collection and migration rules for a value whose meaning is "right now, this tab".
4. **A general per-tab override of every setting.**
   - Pros: uniform.
   - Cons: a much larger surface and unclear semantics (which fields are per-tab safe?); not
     required by the plan; can be layered on later without changing this decision's mechanics.

### Chosen Option

Option 1. It keeps the volatile state where the tab-keyed authority already lives, requires no
persistence or permissions, and composes with SPEC-015's frame model with no new transport.

## Consequences

### Positive

- The popup hero and `Alt+Shift+A` act on the tab in front of the user without changing other
  tabs, and the hero always shows the effective value.
- No storage writes, no migration, no new egress, and no new permissions.
- The override reaches embedded frames through the existing settings push.

### Negative

- An explicit override silently wins over later global changes until the tab closes; the popup
  shows the effective value, but the options page cannot show per-tab state.
- Overrides are lost on background reload or browser restart. This is accepted as the honest
  meaning of "this tab, right now"; a future persisted tier would need its own ADR.
- `Alt+Shift+A` is a new command; on Firefox for Android `commands` is not supported, so the
  shortcut is desktop-only while the popup path works everywhere.

### Neutral

- The `tabs` permission is still used for active-tab resolution here; the release's later
  permission work (plan item 1.5) must keep active-tab resolution working if `tabs` is dropped.
- No new origin or match pattern; bench-only seams stay behind the `__BENCH__` flag.

## Related ADRs

- ADR-0007: popup playback status delivery (the tab-keyed channel this extends).
- ADR-0010 and ADR-0011: consent and egress (untouched; the scope never transmits anything).
- ADR-0012: media client rotation (independent; the scope rides the settings push).

## References

- `docs/specs/SPEC-012-holistic-ux-foundations.md` (per-tab scope section)
- `docs/specs/SPEC-015-m9-embedded-player-frames.md` (frames follow the tab)
- `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md` (item 1.2)
