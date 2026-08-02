# Mobile hermetic Marionette setup

**Date:** 2026-08-02

## Summary

The blocking Fenix fixture matrix now relies on geckodriver's Android Marionette setup instead of trying to enable Fenix's Remote debugging via USB setting through uiautomator.

## Root cause and changes

- The USB setting is for Firefox's remote-debugging protocol, while the fixture probe starts a geckodriver Marionette session. The UI dump and pull commands caused the preceding adb exit-code-1 output and are no longer run in this gating path.
- The runner invokes its checked-in script through POSIX `sh`, avoiding an executable-bit dependency.
- Geckodriver 0.36.0 creates a Fenix 128 session but rejects `installAddon` as desktop-only. Every Fenix leg therefore uses the current driver, whose Android temporary-add-on endpoint the probe requires.
- The probe retries only Android's transient `Resource temporarily unavailable` New-Session error and at most two additional fixture documents before the existing marker, active-state, `/videoplayback`, and player-POST assertions run.
- The report records resolved consent and manifest content-script matches before navigation, so attachment failures surface the installed extension state.

## Validation

- The probe retains its consent, active-state, `/videoplayback`, and fixture player-POST assertions.
- The five-leg GitHub Actions matrix is the integration qualification for this emulator-only path.
