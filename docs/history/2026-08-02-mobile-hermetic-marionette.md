# Mobile hermetic Marionette setup

**Date:** 2026-08-02

## Summary

The blocking Fenix fixture matrix now relies on geckodriver's Android Marionette setup instead of
trying to enable Fenix's Remote debugging via USB setting through uiautomator.

## Root cause

- The setting is for Firefox's remote-debugging protocol, while the fixture probe starts a
  geckodriver Marionette session.
- The Android WebDriver setup writes the GeckoView configuration and controls the application launch.
  Pre-launching Fenix and tapping its settings UI added a fixed delay, release-specific labels, and
  unsettled `uiautomator dump` calls without making the Marionette session more reliable.
- The UI dump and pull commands accounted for the preceding adb exit-code-1 output. They are not
  required by the fixture probe and are no longer run in this gating path.
- Fenix 128 uses geckodriver 0.36.0. The later driver rejects temporary add-on installation on Gecko
  128, while releases at Fenix 136 and above retain the npm-provided driver.

## Changes

- Removed the Fenix launch, fixed sleeps, SDK-path shim, and uiautomator settings taps from
  `scripts/run-mobile-hermetic.sh`.
- Added a checksum-verified geckodriver 0.36.0 setup step only for the Fenix 128 matrix leg.
- Made the hermetic Android probe honor `GECKODRIVER_BIN`, matching the established desktop harness
  contract.

## Validation

- The probe keeps its consent, active-state, `/videoplayback`, and fixture player-POST assertions.
- The five-leg GitHub Actions matrix is the integration qualification for this emulator-only path.
