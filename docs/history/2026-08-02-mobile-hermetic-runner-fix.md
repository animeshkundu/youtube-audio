# Mobile hermetic runner startup fix

**Date:** 2026-08-02

## Summary

The first blocking Android matrix run did boot every API-34 emulator, but the workflow failed before
installing Fenix because its multiline emulator-runner script assumed one persistent shell. The
workflow now starts adb before emulator launch and delegates qualification to one portable checked-in
script. The matrix also begins at the declared Firefox Android support floor, Fenix 128.

## Root cause and evidence

- Run `30739419336` showed the emulator launch at `08:16:39`, followed immediately by `Unable to
connect to adb daemon on port: 5037`. The action did not invoke adb until roughly ten seconds later,
  when it logged `daemon not running; starting now`; the device was briefly offline, then every leg
  reached `Boot completed` in about 40 seconds. The adb message was therefore a startup race and not
  an emulator boot failure, KVM failure, Java failure, or Fenix-version issue.
- The actual fatal error occurred after boot. The action logged a separate `/usr/bin/sh -c` command
  for every input line. `FENIX_APK_URL=...` ran in one shell, then `echo` and `curl` ran in later
  shells with an empty value. All legs failed with curl exit 3 (`URL rejected: Malformed input`).
- Upstream `src/script-parser.ts` splits multiline input on newlines. `src/main.ts` loops over that
  array and executes each line as a distinct `sh -c`. This also meant the previous `set -eu`, package
  variable, and `export FENIX_PACKAGE` did not persist.
- The existing nightly workflow has the same early emulator warning, then boots successfully. Its APK
  URL survives only because it is supplied in the action environment rather than assigned inside the
  multiline script.

## Changes

- Added an explicit `adb start-server` step before `reactivecircus/android-emulator-runner` launches
  the emulator.
- Replaced multiline action commands with one `./scripts/run-mobile-hermetic.sh` invocation, keeping
  fail-fast state, computed URL/package, and environment exports in one shell.
- Retained the documented KVM udev rule before launch and JDK 17 setup before the emulator action.
- Added `-no-metrics` to avoid the emulator's forthcoming metrics prompt; existing deterministic
  cold-boot options remain.
- Changed the matrix to `128.0`, `136.0`, `141.0`, `142.0`, and `145.0`. Direct archive checks returned
  HTTP 200 for each x86_64 APK. This covers the support floor, representative custom-consent releases,
  both sides of the Android 141/142 boundary, and a later built-in-consent release.

## Validation

- Parsed `.github/workflows/mobile-hermetic.yml` with `yaml.safe_load`.
- Checked the portable script with `sh -n`.
- Confirmed Mozilla archive HTTP 200 responses for all five pinned x86_64 APKs.
- Ran the repository's static gates locally.

The x86_64 emulator cannot be executed on this Apple Silicon host with hardware acceleration. The
next GitHub Actions run is required to verify the complete boot, Fenix install, temporary XPI install,
consent seed, active status, `/videoplayback` hijack, and recorded fixture player POST.
