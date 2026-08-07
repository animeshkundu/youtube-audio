# Mobile hermetic RDP readiness

**Date:** 2026-08-03

## Summary

The Fenix fixture probe establishes Marionette before it enables native remote debugging, then installs
the temporary BENCH XPI through the Firefox Android RDP add-ons actor.

## Root cause and changes

- Fenix app-data preparation can clear settings made before the Marionette session. The runner therefore
  installs the APK only; the probe establishes that session before it drives the native setting.
- The UI helper treats a well-formed `<hierarchy>` dump as the readiness signal. It retries transient
  adb and uiautomator failures with backoff, verifies that the dump file exists and is non-empty before
  parsing, accepts menu and secret-settings layouts, and includes raw command and dump output on failure.
- The probe fails closed unless Fenix creates its native debugger socket. It then forwards that socket
  and uses the RDP add-ons actor, removing the temporary forward after every attempt. Fenix 128 rejects
  WebDriver temporary installation and later releases did not attach content scripts after the WebDriver
  command.
- A direct preference write is not a reliable substitute: Fenix's preference-change listener updates
  both its stored preference and the live Gecko runtime setting, so storage alone does not enable RDP
  in the running app.
- The fixture is mapped to emulator loopback with `adb reverse`, which supplies both the BENCH media
  allowlist route and the secure context required by the bridge. The probe still requires granted
  consent, `active` status, a `/videoplayback` source, and a fixture player POST.
- `adb` exit-code-1 messages during the emulator action's boot polling are a device-offline bootstrap
  race. The action waits for completed boot before the checked-in runner begins.

## Validation

- `npm run validate` passed: lint, typecheck, formatting, 278 unit tests, MV2 build and package lint,
  and MV3 build.
- Mobile Hermetic E2E run
  [`30780566139`](https://github.com/animeshkundu/youtube-audio/actions/runs/30780566139) passed each
  Fenix 128.0, 136.0, 141.0, 142.0, and 145.0 leg. Every probe reported granted consent, `active`,
  `/videoplayback` hijack, and at least one fixture player POST.
