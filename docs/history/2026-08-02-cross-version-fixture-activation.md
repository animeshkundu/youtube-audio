# Cross-version fixture activation and Fenix installation

**Date:** 2026-08-02

## Root cause

Temporary XPI installation was successful on affected desktop Firefox and current Fenix releases, but
the static BENCH HTTP content-script match did not consistently activate. As a result, no isolated
content script marked the fixture document or injected MAIN world, so playback assertions observed the
native video source. This was independent of the resolved data-consent state.

Fenix 128 additionally rejects Marionette `Addon:Install` because that endpoint is desktop-only. The
later Fenix releases accepted the temporary XPI through Marionette but still had the same inactive
fixture content-script symptom.

## Fix

- BENCH builds retain only local fixture host permissions. The harness registers the real packaged
  isolated content script for its exact fixture origin from an extension page before navigation.
  The persistent-profile upgrade qualification repeats that registration in both browser phases.
  Production keeps its four static YouTube content-script matches.
- The named fresh-unconsented bench session uses that same registration and remains unseeded, so its
  no-player, no-media, no-artwork, and no-thumbnail assertions continue to exercise a running
  fail-closed content script.
- The Fenix fixture probe loads its temporary XPI through the Firefox Android Remote Debugging Protocol
  add-ons actor. It stages the XPI under the device artifact directory convention used by `web-ext`,
  waits for exactly one package-owned debugger socket with the same bounded discovery window, and then
  uses the returned add-on identity for the real extension-page consent and dynamic-registration path.
- `PlayerHandle` accepts the emulator's `10.0.2.2` fixture media URL only in a BENCH build. Production
  remains HTTPS-only.

## Validation

- BENCH MV2 output contains local fixture host permissions, exactly four static YouTube content-script
  matches, and the packaged `content-scripts/content.js` registration target.
- Static validation and the required GitHub Actions browser matrices are recorded with this change.
