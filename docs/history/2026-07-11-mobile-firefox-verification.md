# Mobile Firefox (Android emulator) verification — 2026-07-11

## Goal

Per the sequencing directive ("finish desktop first, then the lightest emulator for mobile Firefox"),
verify the extension's core behavior on **real Firefox for Android**, fully headless and automated,
on an 8 GB M1. Logged-out only.

## Environment (lightest workable path)

- **Toolchain:** Homebrew `openjdk` (26) + `android-commandlinetools`; `sdkmanager` installs
  `platform-tools`, `emulator`, and the **`system-images;android-34;aosp_atd;arm64-v8a`** image
  (AOSP Automated-Test-Device — the lightest arm64 image: stripped UI, fast boot, low RAM; native
  on Apple Silicon, no x86 translation).
- **AVD:** `yta_test`, booted headless: `-no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
-memory 1536`. Booted in seconds; host stayed ~21-27% RAM free throughout (workable on 8 GB).
- **Browser:** Firefox Nightly (Fenix `154.0a1`, `org.mozilla.fenix`), official arm64-v8a APK from
  `archive.mozilla.org/pub/fenix/nightly/...`, sideloaded with `adb install`.

## Headless techniques that made it work (not in doc 18, worth keeping)

- **`screencap` returns a blank surface** under headless swiftshader → drive the UI by the
  **accessibility tree** instead: `adb shell uiautomator dump` gives every node's text + bounds, so
  taps are computed from the XML with no pixels. Helper: `tests/e2e/android/ui.py`. Used to walk
  Fenix onboarding and toggle **Settings → Advanced → Remote debugging via USB** (confirmed by the
  `@org.mozilla.fenix/firefox-debugger-socket` unix socket appearing in `/proc/net/unix`).
- **`adb root`** (the aosp_atd image is userdebug) is **required** for geckodriver to push its
  profile: without it the session dies with `adb error: fchown failed: Operation not permitted`
  (Fenix Nightly is not debuggable, so geckodriver's app-storage `run-as` path fails; root lets it
  chown the pushed profile).
- **geckodriver + Marionette** (not web-ext) drives Fenix, so the same `executeScript` DOM-marker
  assertions as the desktop bench apply. `selenium enableMobile('org.mozilla.fenix')` with **no
  serial** (geckodriver auto-detects the single device; selenium's `deviceSerial` field is rejected
  by geckodriver 0.37). Extension loaded via `driver.installAddon(xpi, /*temporary*/ true)` — no
  signing. Defaults already have `audioOnlyEnabled:true`, so no settings seeding is needed.

## Result — `tests/e2e/probe-mobile-fenix.mjs`, 4/4 PASS

Extension installs as a temporary add-on (`youtube-audio@local`); content script injects on
`m.youtube.com` (`data-yta-bench=1`).

| Video                   | Branch                               | Observed                                                                  |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `Bu4ztj3R32k` (music)   | audio-only hijack                    | `status=active`, `currentSrc`→googlevideo, `videoWidth=0`, `readyState=4` |
| `DaWe9L1iwNw` (podcast) | audio-only hijack                    | `status=active`, hijacked, `videoWidth=0`, `readyState=4`                 |
| `fOdo1GkzZAk` (kids)    | credentialless `UNPLAYABLE` fallback | `status=fallback`, `reason=UNPLAYABLE`, not hijacked                      |
| `X4VbdwhkE10` (live)    | live fallback                        | `status=fallback`, `reason=live`, not hijacked                            |

**Conclusions:** the MV2 build loads and runs on Firefox for Android; the credentialless ANDROID_VR
fetch + `<video>.src` hijack works on the mobile (`m.youtube.com`) DOM; and both fallback branches
(kids-UNPLAYABLE and the newly-fixed **live** exclusion) behave correctly on mobile, exactly as on
desktop.

## Reproduce

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"
emulator @yta_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -memory 1536 &
adb wait-for-device && adb root
# (first time only) sideload Fenix + enable Remote debugging via tests/e2e/android/ui.py
node tests/e2e/probe-mobile-fenix.mjs dist/youtube-audio-bench.xpi
```

## Not covered on mobile (honest carve-out)

Background/lock-screen `mediaSession` controls and the popup/options UI rendering are not asserted
here (headless, no compositor). Core playback + protection logic is identical JS to desktop (same
Gecko), and is proven on both surfaces.
