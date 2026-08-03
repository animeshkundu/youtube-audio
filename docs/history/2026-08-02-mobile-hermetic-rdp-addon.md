# Mobile hermetic Android add-on installation

**Date:** 2026-08-02

## Summary

The blocking Fenix fixture probe now installs its temporary BENCH XPI through Firefox Android's RDP
add-ons actor while retaining geckodriver Marionette for browser control.

## Root cause and decision

- Run `30772570975` proved that the non-UI Marionette path starts Fenix on every qualified release.
- Fenix 128 rejected WebDriver's `installAddon` with `Only supported in desktop applications`.
- Fenix 136, 141, 142, and 145 returned an add-on ID from that command, but the extension content
  script did not attach to the fixture after three complete navigations. The extension manifest and
  seeded consent were present, so this was not an APK, consent, or fixture-origin failure.
- Firefox Android's supported temporary-install channel is the Remote Debugging Protocol add-ons
  actor used by `web-ext`. The Marionette-created Gecko profile can enable the debugger directly with
  `devtools.debugger.remote-enabled` and `devtools.debugger.prompt-connection=false`, but run
  `30773218195` proved those Gecko preferences do not create Fenix's native debugger socket.
- Fenix reads `pref_key_remote_debugging` to configure its Gecko runtime. The setting must change after
  geckodriver clears app data, so the probe enables it only after a successful Marionette session.

## Changes

- The uiautomator helper retries command failures, missing dump files, and malformed XML with backoff;
  it includes the raw command and dump output when the UI never stabilizes.
- Its combined enable command tolerates the menu labels used across supported Fenix releases, verifies
  the toggle when the UI exposes its checked state, and relies on the subsequent debugger socket as
  the final readiness proof.
- It dismisses Android's transient "isn't responding" dialog with its `Close app` action before
  looking for Fenix controls, so a stalled launcher cannot be mistaken for a missing browser menu.
- The probe waits for Fenix's debugger socket and includes the raw socket listing in its failure
  output if it never appears.
- It uploads the XPI to the emulator, forwards the Unix debugger socket, and installs through the
  RDP add-ons actor before seeding consent and navigating to the fixture.
- The existing fixture marker, granted consent, `active` status, `/videoplayback` source, and player
  POST checks remain required.

## Validation

- The API-34 x86_64 Fenix matrix is the required integration qualification for this Android-only path.
- `adb: device offline` exit-code-1 messages emitted while the emulator action polls
  `sys.boot_completed` are a documented bootstrap race. The action continues until boot completes
  before the checked-in runner begins, and no uiautomator command runs in the blocking lane.
