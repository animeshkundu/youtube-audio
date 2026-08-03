# Mobile hermetic Fenix UI readiness

**Date:** 2026-08-03

## Summary

The blocking Fenix fixture probe now waits for a usable accessibility hierarchy before it drives
Remote debugging via USB. It retries transient uiautomator command failures, missing dump files,
and malformed XML with backoff, retaining the raw command and dump output in its terminal error.

## Decision

The native Fenix Remote debugging setting remains the installer bridge for the hermetic matrix.
The non-UI Marionette command was qualified first: Fenix 128 rejects temporary add-on installation
as desktop-only, and Fenix 136 through 145 returned an add-on ID but did not attach the extension
content script to the fixture. A GeckoView debug configuration does not create the native RDP socket
used by the add-ons actor.

## Changes

- `ui.py` treats well-formed `<hierarchy>` XML as the readiness signal instead of assuming Fenix is
  ready after a fixed delay.
- Failed dump attempts include the `uiautomator dump`, file-size check, file-read result, and raw
  output. The final error preserves the most recent attempts rather than exposing an unadorned XML
  parser error.
- Settings navigation accepts direct Settings access, the More options/Menu routes, and the
  About Firefox secret-settings layout used by supported Fenix releases.
- The fixture assertions remain unchanged: temporary XPI installation, consent seeding, `active`
  status, `/videoplayback` hijack, and a recorded fixture player `POST` are all still required.

## Validation

- Exercised malformed and absent uiautomator dump retries with a local command stub.
- Ran `npm run validate` successfully: lint, typecheck, formatting, 278 unit tests, MV2 build and
  package lint, and MV3 build.
- Mobile Hermetic E2E runs `30775691447` and `30776002762` reached remote-debugging enablement and
  RDP temporary XPI installation on Fenix 128, 136, 141, 142, and 145. The probe then consistently
  found the BENCH marker but no terminal status, `/videoplayback` source, or fixture player request.
- The second run recorded zero `yta:settings` messages while the MAIN-world script had already
  consumed the bridge nonce. This is an entrypoint startup-handshake failure, not a UI or adb
  readiness failure. The probe assertions remain strict. Repairing the one-shot bridge requires an
  `entrypoints/` change, which is outside this Android-CI-only scope.
