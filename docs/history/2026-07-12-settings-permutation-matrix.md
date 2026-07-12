# Handoff: Exhaustive settings-permutation E2E matrix

## Date

2026-07-12 (documenting work committed 2026-07-11, `5d2f55c`)

## Summary

Added a settings-permutation end-to-end matrix that drives the real built extension in Firefox
against the hermetic fake-YouTube fixture across the full toggle space, so a regression in any
one setting or in a setting interaction surfaces deterministically with no human and no live
network. Runs via `npm run test:matrix` (`tests/e2e/bench/run-matrix.mjs`), a sibling of the
smoke-level `npm run test:bench`.

## Key changes

- `tests/e2e/bench/run-matrix.mjs`: 47 deterministic real-Firefox cases built as
  all-off, each toggle alone, per-value `forceQualityMax`, a pairwise covering array over the
  boolean toggles, hand-picked interaction pairs (audio-only + ad-block, audio-only +
  loudness + EQ, audio-only + background, ghost + aggressive telemetry, the three
  distraction-hiders together), quality/EQ edges, and the manifest-icon outcome that a
  page-context test cannot see. Each combo applies the settings, loads the fixture, and asserts
  the observable extension behavior; the covering array is emitted so silent truncation cannot
  masquerade as full coverage.
- `package.json`: `test:matrix` script; `SKIP_BUILD=1` reuses `dist/youtube-audio-bench.xpi`.

## Testing

All 47 cases pass on real Firefox (Selenium + geckodriver, BENCH build). Deterministic and
hermetic: no live YouTube, no real media decode. This is a gating-quality bench, complementary
to `test:bench` (fetch-to-hijack / disabled-untouched / background-suppression smoke).

## Context for continuation

- The matrix is the preferred no-human validation surface for any feature that adds a setting
  or interacts with an existing one: add a combo here when you add a toggle.
- `test:matrix` is not yet wired into `scripts/validate.sh` / CI as a required gate (like
  `test:bench`, it is a heavier Firefox-driving job); running it before a settings change is the
  current expectation.

## Next steps

- Consider promoting `test:matrix` to a non-gating scheduled CI job alongside the bench.
