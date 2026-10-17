# Handoff: distraction extras (CP4 item 1.6)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP4 item 1.6: "CSS-only hiding of thumbnails and avatars; never network-block
`i.ytimg.com`". Two new independent toggles join the existing "Cleaner YouTube" group, both
default-off, applied through the same extension-managed distraction stylesheet as Shorts,
recommendations, and comments. Nothing in the network layer changes: no webRequest rule, no filter,
no fetch rewriting. The switch is pure `display: none`.

## Changes

- `src/shared/quality-of-life.ts`: `DistractionSettings` gains `hideThumbnails` and `hideAvatars`;
  `buildDistractionStyles` emits one rule per enabled toggle.
  - Thumbnails: `ytd-thumbnail`, `ytd-playlist-thumbnail` (the semantic desktop tile containers),
    plus the mobile media-item containers verified from a real m.youtube.com page source and its
    stylesheet: `ytm-large-media-item .large-media-item-thumbnail-container`,
    `.video-thumbnail-container-large`, `.video-thumbnail-container-compact`.
  - Avatars: `ytd-comments #author-thumbnail` (the ImprovedTube-vetted comment-avatar selector
    recorded in `docs/research/10-quality-of-life-ux.md`), `ytd-video-owner-renderer #avatar` (the
    watch-page owner row), `ytd-rich-grid-media #avatar` (home-feed tiles), and
    `#channel-header-container yt-img-shadow#avatar` (the channel header). No mobile avatar selector
    is claimed: none is verified in-repo, and guessing `ytm-*` avatar tags is exactly what the
    research doc warns against.
- `src/shared/config.ts`: both fields in `ExtensionSettings`, the `QualityOfLifeSetting` union,
  `DEFAULT_SETTINGS` (false), and `normalizeSettings` (booleans or defaults).
- `src/shared/settings-signals.ts`: `hideThumbnailsSignal` / `hideAvatarsSignal` mirrors (the
  signals bridge test enumerates `DEFAULT_SETTINGS` keys, so the names are enforced).
- `src/shared/report.ts`: both keys join `BOOLEAN_SETTING_KEYS` (diagnostics report).
- `entrypoints/options/App.tsx`: two rows in "Cleaner YouTube" (`option-thumbnails`,
  `option-avatars`) with labels, on/off descriptions, and search visibility, through the existing
  `setQualityOfLifeSetting` mutator.
- `docs/specs/SPEC-006-m3b-quality-of-life.md`: goals, settings list, the new selector paragraph
  (including the cosmetic-only contract and the mobile scope note), the non-goal for
  network-level image blocking, and the bench/matrix coverage.
- `docs/release-notes/NEXT.md`: the "Tidy up the page" bullet now lists thumbnails and channel
  pictures.
- Website (`website/src/content/guide/cleaner.md`, `guide/settings.md`, `pages/index.astro`) and
  `amo-metadata.json`: the cleaner copy enumerates the two new switches (five total).
- `docs/testing/smoke-test-protocol.md`: the manual QoL checklist names the two new settings.
- Bench: `fixture-server.mjs` adds `#fixture-thumbnail` (a bare `ytd-thumbnail`) and
  `#fixture-avatar` (`ytd-video-owner-renderer > #avatar`), both deliberately outside every
  conditionally hidden container so a combined combo cannot pass on an inherited `display: none`.
  `run-bench.mjs` probes `thumbnailsHidden` / `avatarsHidden` and the `m3b` treatment asserts both
  hidden (with the no-addon control asserting both visible). `run-matrix.mjs` adds both toggles to
  the per-toggle and pairwise coverage, the master-gate non-interference check, and the renamed
  `pair:all-distractions` combo.

## Testing

- `tests/unit/quality-of-life.test.ts`: per-feature selector cases plus two cosmetic-only locks: the
  stylesheet contains no `url(` and no `background` declaration, so it can never rewrite or fetch an
  image, and the two rules do not leak into each other's selectors.
- `tests/unit/config-reset.test.ts`: defaults-off for installs that predate the toggles, malformed
  stored values normalize back to off, and the mutator persists both fields.
- `tests/unit/ui/options.test.tsx`: the switch/description inventory counts move 18/17 to 20/19, and
  a new test clicks both rows and asserts the mutator calls.
- `npm run validate` green (typecheck, lint, format, unit tests with coverage, both builds,
  `web-ext lint`).
- CI (hermetic bench + settings matrix) carries the runtime proof: the new probe nodes are read by
  the shared `runSession` probe used by both runners, so the m3b case and every matrix combo now
  assert the two new toggles' computed visibility.

## Safety

- Fail-open is untouched: the stylesheet is injected/removed by the existing
  `updateDistractionStyle` path, a selector that stops matching simply hides nothing, and no
  playback path reads these settings.
- No new permissions, storage keys beyond the two booleans, messages, or network behavior.
- Turning both toggles off removes the rules at the next push, same as the existing cosmetics.

## Follow-ups

- Mobile avatar selectors, if a user report ever justifies them; today the extension claims only the
  verified desktop avatar set (documented in SPEC-006).
- CP4 continues with 2.8 (teardown on disable/update), then hygiene H2-H4.
