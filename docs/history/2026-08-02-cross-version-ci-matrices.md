# Cross-version desktop and Android CI matrices

**Date:** 2026-08-02

## Summary

Blocking end-to-end coverage now spans both hybrid-consent branches on desktop and Android. Desktop
runs the complete hermetic bench and settings-permutation suite across the supported Firefox range.
Android adds a fixture-backed PR gate across representative Fenix releases while retaining the live
YouTube probe as a separate nightly, non-gating canary.

## Changes

- Added `fail-fast: false` desktop matrices for both suites on Firefox `128.0esr`, `133.0`, `139.0`,
  `140.0`, `142.0`, and `latest`; job names identify the exact browser version.
- Kept the named fresh-unconsented bench case unseeded. Every treatment session uses the shared
  consent helper, which reads browser/platform/permission state and throws if consent did not resolve
  granted.
- Added a blocking Android workflow for Fenix `130.0`, `136.0`, `141.0`, `142.0`, and `145.0`.
- Added a hermetic Android probe that drives the local fixture through the emulator host alias
  `10.0.2.2`, requires active audio hijack plus a recorded player request, and makes no live YouTube
  request.
- Added `10.0.2.2` only to BENCH build matches/permissions. Production matches are unchanged.
- Generalized the fixture server start method so it can bind on all interfaces while advertising the
  emulator-facing hostname.
- Updated SPEC-013 and `docs/ci-cd.md` with the qualification lanes and what each proves.

## Validation

- `.github/workflows/ci.yml`, `.github/workflows/mobile-hermetic.yml`, and the unchanged live mobile
  workflow parsed successfully with `yaml.safe_load`.
- Changed E2E modules passed `node --check`; the fixture server's default bind path passed a local
  start/close smoke test.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format` and `npm run format:check`: passed.
- `npm test`: 27 files and 277 tests passed; line coverage 98.75%.
- BENCH MV2 build passed and contained the `10.0.2.2` match. A subsequent production MV2 build passed
  and retained exactly the four production YouTube content-script matches.

The emulator workflow itself requires GitHub Actions/KVM and was not run locally.
