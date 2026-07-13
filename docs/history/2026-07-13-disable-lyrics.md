# Handoff: Disable and hide synced lyrics

## Date

2026-07-13

## Summary

The opt-in synchronized-lyrics feature is now disabled and hidden. YouTube Music provides native
time-synced lyrics, so ours is redundant. This removes the only user path to the feature and the
network permission it needs, while keeping the feature code and its setting so the decision is
cheaply reversible. No hard invariant changed: logged-out only, credentialless `ANDROID_VR`,
`PlayerHandle` as the sole `<video>.src` writer, fail-open to native playback, and the page-world
trust boundary all hold. Loudness normalization and the equalizer remain the active YouTube Music
extras.

Branch `rebuild`, PR #65.

## Decision

YouTube Music already shows native, time-synced lyrics. Shipping our own LRCLIB-backed panel on top
of that duplicates a first-party feature, so it is retired from the product surface. It is disabled
rather than deleted so it can be brought back cheaply if the calculus changes (for example on plain
`youtube.com`, where there is no native equivalent).

## What changed

- **Options toggle removed** (`entrypoints/options/App.tsx`). The "Synced lyrics" row, its label,
  description, and search-visibility wiring are gone, so the feature is not reachable from any UI
  (the popup never exposed it).
- **`lrclib.net` host permission dropped** (`wxt.config.ts`). `https://lrclib.net/*` is removed
  from both the MV2 `permissions` and the MV3 `host_permissions`, so the background can no longer
  fetch lyrics even if the setting were on.
- **Feature code kept.** `entrypoints/content.ts`, `entrypoints/main-world.ts`,
  `entrypoints/background.ts`, and `src/shared/lyrics.ts` are unchanged, and the `lyricsEnabled`
  setting (default `false`) stays in `src/shared/config.ts`. The change is reversible.

## Docs updated

- `docs/specs/SPEC-007-m4-youtube-music-extras.md`: marked the Lyrics section disabled and hidden
  with the rationale and the retained-code note, and adjusted the Overview, Goals, Settings, Testing
  Strategy, Rollout, and Security sections. Loudness normalization and the equalizer are the active
  M4 extras.
- `README.md`: removed the Synced lyrics feature row and the defaults-summary mention.
- `docs/release-notes/NEXT.md`: dropped the "Lyrics that behave" bullet and the synced-lyrics
  clause from the YouTube Music line.
- `CLAUDE.md`, `AGENTS.md`, `mkdocs.yml`: dropped "lyrics" from the product feature-set description.

## Verification

- **Options regression test** (`tests/unit/ui/options.test.tsx`): a new lock asserts the
  "Synced lyrics" row is absent (`#option-lyrics` is not rendered), the text "Synced lyrics" is not
  present, and a search for "lyrics" matches nothing and shows the empty-search status. The
  switch-count and description-count assertions drop by one accordingly.
- **Manifests have zero `lrclib`.** MV2 and MV3 builds were inspected: neither the MV2 `permissions`
  nor the MV3 `host_permissions` contains `lrclib.net`.
- **Bench 48/48 unaffected.** The bench seeds `lyricsEnabled` directly through storage (not the UI)
  and its lyrics fetch targets the local fixture origin permitted by the bench-only match patterns,
  not `lrclib.net`, so dropping the `lrclib.net` permission does not change any bench outcome.
- Unit totals: 245 passed (was 244; net +1 from the new regression test). Full gate:
  `npm run validate`.

## Known issues / notes

- **No migration for a persisted `lyricsEnabled: true`.** A profile that had opted in keeps the
  stored `true`; it is not migrated to `false`. That is harmless: with the `lrclib.net` permission
  removed the background cannot fetch and there is no UI, so nothing renders. The extension is also
  not yet released, so no field profile carries this state.

## Next steps

- If lyrics is ever revived, restore the `lrclib.net` permission and the options toggle, and prefer
  scoping it to surfaces without native lyrics (plain `youtube.com`).
