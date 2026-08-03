# Firefox desktop temporary add-on path installation

**Date:** 2026-08-02

## Scope

Restore the hermetic bench and settings-permutation matrix on Firefox 139, 140, and 142
without changing extension runtime behavior.

## Root cause

Selenium's `driver.installAddon()` helper reads the XPI and sends it to geckodriver as a base64
payload. Geckodriver decodes that payload into the temporary Firefox profile. On Firefox 138-143,
the extension can activate from that profile copy while the content process fails to load its
declarative content script. Firefox logs `Unable to load script` for the extension content bundle.

That explains the misleading partial success: the background and extension pages still ran, so
consent resolved granted, but no isolated content script injected MAIN world and no audio source
attach could occur. The observed player POST was issued by the bench's page probe and was not
evidence that MAIN world had run.

## Change

`tests/e2e/bench/run-bench.mjs` now sends geckodriver's `install addon` command with the absolute
`BENCH_XPI` path and `temporary: true`. The returned permanent add-on ID, onboarding-tab cleanup,
consent seeding, settings seeding, and teardown are unchanged. The matrix imports the same
`runSession`, so the single install-site correction covers both desktop suites.

No extension source, manifest, playback guard, assertion, threshold, or Fenix harness changed.
`PlayerHandle` remains the sole media source writer and unsupported playback still fails open.

## Verification

- `npm run validate`: passed, including 278 unit tests, typecheck, lint, format check, MV2 build,
  package lint, and MV3 build.
- Hermetic bench: 52 passed, 0 failed on Firefox 128.0esr, 133.0, 139.0, 140.0, 142.0, and
  152.0.4.
- Settings matrix: 48 passed, 0 failed on the same six Firefox versions.
- Every bench version reported content marker `1`, active playback, and a `/videoplayback` source.
- Firefox 140 recorded `GET /videoplayback` for `m1:enabled-fetch-and-hijack`.
- `consent:fresh-unconsented-profile-fails-closed` passed on every bench version and remained
  unseeded.

The sampled CI failures were 139, 140, and 142, but direct qualification shows the affected
base64-install range is at least Firefox 138-143.
