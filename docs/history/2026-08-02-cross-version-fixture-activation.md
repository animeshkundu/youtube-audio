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

The first RDP runner attempted to find only a filesystem socket ending
`/<package>/firefox-debugger-socket` for 15 seconds. Fenix normally exposes the valid abstract socket
as `@<package>/firefox-debugger-socket`, so the shell rejected it before the installer could use its
standard bounded socket wait.

## Fix

- BENCH builds retain only local fixture host permissions. The harness registers the real packaged
  isolated content script for its exact fixture origin from a dedicated extension page before
  navigation. Firefox unregisters dynamically registered scripts when their originating extension
  document unloads, so the harness keeps that page open through fixture navigation.
  The persistent-profile upgrade qualification instead builds a dedicated BENCH artifact with the
  static local fixture matches needed at installation time. Production keeps its four static YouTube
  content-script matches.
- The named fresh-unconsented bench session uses that same registration and remains unseeded, so its
  no-player, no-media, no-artwork, and no-thumbnail assertions continue to exercise a running
  fail-closed content script.
- The Fenix fixture probe loads its temporary XPI through the Firefox Android Remote Debugging Protocol
  add-ons actor. The runner assigns the disposable emulator's browser role to Fenix before launch, so
  Android's default-browser dialog cannot block initialization. It sets Fenix's app-owned
  `fenix_preferences/pref_key_remote_debugging` value while Fenix is stopped, restarts Fenix, requires
  the corresponding remote-debugging preferences in Fenix's real Gecko profile, requires the
  package-owned debugger socket, stages the XPI under the device artifact directory convention used
  by `web-ext`, pins the add-on UUID in that profile, accepts the socket's abstract or filesystem form
  with the same three-minute wait as `web-ext`, forwards that exact socket to the RDP add-ons actor,
  and completes temporary
  installation before Selenium attaches for the real extension-page consent and dynamic-registration
  path.
- `PlayerHandle` accepts the emulator's `10.0.2.2` fixture media URL only in a BENCH build. Production
  remains HTTPS-only.
- The mobile workflow also runs on master pushes. The release job waits for the matching Fenix workflow
  result, preventing archive publication from bypassing the supported Android qualification.

## Validation

- BENCH MV2 output contains local fixture host permissions, exactly four static YouTube content-script
  matches, and the packaged `content-scripts/content.js` registration target.
- Static validation and the required GitHub Actions browser matrices are recorded with this change.
