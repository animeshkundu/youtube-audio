# Testing YouTube Audio on Firefox for Android from a Resource-Constrained Mac

How to actually install and drive our WXT-built Firefox WebExtension (MV2) on **Firefox for Android** (Fenix / GeckoView) for real testing, from an **8 GB M1 (Apple Silicon) MacBook that already has other processes running**. The constraint is RAM: a heavy x86_64 Android emulator is off the table, so this brief finds the lightest thing that actually works.

- Date: 2026-07-11. Facts verified against current Mozilla extensionworkshop / MDN docs, Android developer docs, and the Android SDK image catalog (see References).
- Prerequisite reading: `docs/research/03-firefox-mobile-support.md` (API-support matrix, manifest changes, `web-ext run -t firefox-android`, `about:debugging`). This doc is the *hardware/how-to-run* companion to that *what-is-supported* brief.
- Scope: single-developer personal tool. We only need a reliable way to load an **unsigned local build** onto Firefox Android and exercise it on `m.youtube.com` / `music.youtube.com`.

---

## 1. Executive summary

**You do not need Nightly, you do not need signing, and you do not need a Play Store account.** The `web-ext run -t firefox-android` path installs our unpacked build as a **temporary add-on** over adb. Temporary add-ons are exempt from AMO signature enforcement on *every* channel (they vanish on browser restart), so a plain local `dist/` folder loads directly. This is the same Remote Debugging Protocol path that desktop `about:debugging` → "Load Temporary Add-on" uses, just pointed at an Android target.

The only real question on 8 GB is *where Firefox Android runs*:

- **If you own any Android phone** (even an old one): **use it over USB.** It runs on the *phone's* RAM, costing the Mac almost nothing (just adb + a Node process). This is the lightest, most honest test surface — real backgrounding, real lock-screen, real hardware media controls. **This is the recommended path if you have a phone.**
- **If you have no phone:** run **one headless ARM64 emulator** (native on M1 via Hypervisor.framework — no x86 translation), `google_apis;arm64-v8a` image, `1536`–`2048 MB` RAM, `-no-window -gpu swiftshader_indirect -no-boot-anim`. It costs ~2.5–3 GB of real host RAM. On an 8 GB machine this is **workable but tight**: close Chrome/other Firefox windows and heavy IDEs while it runs. **This is the recommended path with no phone.**
- **Cloud device farms (BrowserStack/Sauce/LambdaTest): not useful for us.** They do not let you sideload a custom Firefox extension onto their Android devices. They can smoke-test *Firefox-on-Android itself*, not *our extension*. Skip them for this task.

**Single recommended path (no phone, 8 GB M1):** headless `google_apis;arm64-v8a` emulator at 2 GB + `web-ext run -t firefox-android`. Full commands in §5. **Fallback / lighter:** physical phone over USB (§6), same `web-ext` command.

Honest bottom line: the *loading* mechanism is easy and well-supported. The *hardware* is the pinch. A phone sidesteps it entirely; the emulator works if you give it breathing room.

---

## 2. Option comparison

| Option | Real Mac RAM cost | Can sideload OUR unsigned build? | Automatable (geckodriver/Selenium)? | Cost | Setup effort |
|---|---|---|---|---|---|
| **Physical Android phone + USB + adb** | ~**0.2–0.5 GB** (adb + Node only; Android runs on the phone) | **Yes** — `web-ext run -t firefox-android` temporary add-on | **Yes** — geckodriver `androidPackage` + `androidDeviceSerial` | Free (you own the phone) | Low: enable USB debugging + "Remote debugging via USB" in Firefox |
| **Headless ARM64 emulator** (`google_apis;arm64-v8a`, `-no-window`, 2 GB) | ~**2.5–3 GB** real host RAM per instance; ~8–12 GB disk | **Yes** — same `web-ext` temporary add-on path | **Yes** — same geckodriver config, `androidDeviceSerial=emulator-5554` | Free | Medium: cmdline-tools → sdkmanager/avdmanager → boot; sideload Firefox APK |
| **Headless `aosp_atd;arm64-v8a`** (stripped, automation-only) | ~**2–2.5 GB** (lightest emulator) | Maybe — automation only; **no SystemUI/launcher so no manual tapping** | Yes (headless only) | Free | Medium+, and **risky**: a full browser on ATD is not a supported/stress-tested config |
| **Cloud device farm** (BrowserStack/Sauce/LambdaTest) | ~0 (offloaded) | **No** — cannot sideload a custom extension onto their Android Firefox | Their harness only (not our local build) | Paid tiers; limited free trials | Low, but **can't test our actual extension** |
| **x86_64 emulator on M1** | Very high + unusably slow | Yes in principle | Yes in principle | Free | **Do not.** Full-CPU translation on Apple Silicon (§8) |

Takeaways: **phone > headless ARM64 emulator > everything else** for our need. Cloud farms are eliminated by the no-sideload limitation, not by cost. ATD is a niche automation-only micro-optimization with real caveats.

---

## 3. Why ARM64-native is the whole game on M1

The Android Emulator on Apple Silicon ships an **arm64 host binary** and runs an **arm64-v8a guest** through **Hypervisor.framework** — the guest CPU is virtualized, not translated. That is why a headless ARM64 AVD is genuinely light enough to consider on 8 GB.

An **x86_64 guest image on an M1** has no hardware virtualization path; every guest instruction is software-translated. It is slow enough to be useless for interactive testing and it burns CPU the whole time. On this hardware, **ARM64 images are mandatory, not a preference** (see §8).

Practical consequence for image choice (verified against the current SDK catalog):

- Google **stopped publishing the plain `default` (AOSP-only, no Google) `arm64-v8a` image for recent API levels** (34/35/36). For those APIs the arm64 choices are `google_apis`, `google_apis_playstore`, and `aosp_atd`.
- **`google_apis;arm64-v8a`** is therefore the lightest *currently-published* arm64 image that still has a **real launcher + SystemUI** (so you can tap, grant permissions, and watch the UI) and **no Play Store** (so no forced Google sign-in — which suits us, since our product is logged-out-only anyway). **This is the image to use.**
- `google_apis_playstore` is the heaviest and needs a Google account to use Play — pointless for us, since we install Firefox with `adb install` regardless of image.
- `aosp_atd;arm64-v8a` (Automated Test Device) is the smallest/fastest, but it **strips SystemUI, the launcher, and bundled apps** and disables hardware rendering. Fine for pure headless automation, but there is no home screen to tap and running a full browser on it is not a well-trodden path. Treat it as an experiment, not the default.
- If you want *less* than `google_apis` and are willing to drop to an **older API level** (e.g. API 30/31/32/33), the plain `default;arm64-v8a` images *do* still exist there and run Firefox fine (Firefox for Android supports Android 5.0+). That is a valid "even lighter, no-GMS" option; just pick an API old enough to still have `default` arm64 but new enough for the Firefox build you install.

---

## 4. How our unsigned build actually loads (the part people overconfuse)

There are **three different operations** that guides blur together. Only the first matters for us:

1. **Temporary add-on load (what we use).** `web-ext run -t firefox-android` (or desktop `about:debugging` → device → "Load Temporary Add-on") pushes the unpacked build over adb and installs it **temporarily**. **No signing. Works on Release, Beta, or Nightly.** Gone on browser restart — which is exactly right for a test loop. This is our path.
2. **Permanent install of an unsigned `.xpi`.** Blocked on Release. On Nightly/Beta you'd use Mozilla's **custom add-on collection** developer menu (Settings → About → tap the logo to unlock → set collection owner/id). Note: `xpinstall.signatures.required` is **not exposed in Fenix `about:config`** the way it is on desktop, so the custom-collection flow — not that pref — is the real mechanism. We don't need this for testing.
3. **Normal AMO install.** Requires an AMO-signed, Android-flagged listing. That's a *distribution* step (see `docs/research/07-distribution-signing-updates.md`), not a *testing* step.

So: **channel choice is free.** Because we must `adb install` Firefox onto a no-Play emulator anyway, install **Firefox Nightly arm64-v8a** (official single APK from `archive.mozilla.org`, easy to `adb install`, and gives the friendlier developer menu for later). On a **physical phone** you can just use whatever Firefox you already have from Play — temporary loading works on Release too.

---

## 5. Recommended path — headless ARM64 emulator, memory-tuned for 8 GB

Full, copy-pasteable. Everything is command-line; **no Android Studio install required**.

### 5.1 One-time: SDK command-line tools (no Android Studio)

```bash
# Command-line tools only (Homebrew cask), ~500 MB, not the full IDE
brew install --cask android-commandlinetools

# Point the SDK env at Homebrew's location and add tools to PATH
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# (persist the three lines above in ~/.zshrc)

yes | sdkmanager --licenses
sdkmanager "platform-tools" "emulator"

# Lightest currently-published arm64 image with a real UI and no Play Store:
sdkmanager "system-images;android-34;google_apis;arm64-v8a"
```

Disk footprint: platform-tools + emulator + one system image is roughly **8–12 GB** on disk. RAM is what matters at runtime, not this.

### 5.2 One-time: create a minimal AVD

```bash
echo "no" | avdmanager create avd \
  -n ff_android \
  -k "system-images;android-34;google_apis;arm64-v8a" \
  --device "pixel_5"     # a modest, non-tablet profile

# Cap guest RAM in the AVD config so it never balloons on an 8 GB host:
CFG="$HOME/.android/avd/ff_android.avd/config.ini"
{ echo "hw.ramSize=2048"; echo "vm.heapSize=256"; echo "disk.dataPartition.size=6G"; } >> "$CFG"
```

### 5.3 Boot it headless and memory-tuned

```bash
emulator -avd ff_android \
  -no-window \                 # headless: no emulator UI window (saves RAM + GPU)
  -no-audio \                  # no audio backend
  -no-boot-anim \              # skip boot animation (faster cold boot)
  -memory 2048 \               # guest RAM cap; drop to 1536 if the Mac is thrashing
  -cores 2 \                   # 2 vCPUs is plenty for a browser
  -gpu swiftshader_indirect \  # software GL — correct choice when headless
  -no-snapshot \               # clean cold boot; avoids stale-snapshot flakiness
  &                            # background it

# Wait for full boot:
adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done; echo booted'
adb devices     # expect:  emulator-5554   device
```

Notes on the flags:
- `-no-window` is the single biggest RAM/GPU saver; you interact via adb, `web-ext`, and desktop `about:debugging`, so you never need the emulator's own window.
- `-gpu swiftshader_indirect` (software) is the right pick **headless**. `-gpu host` (Metal) only helps a *visible* window and can be flaky headless. Use `host` only if you deliberately run windowed.
- `-memory 2048` is the sweet spot; **`1536` still boots and runs Firefox** if you need to claw back ~0.5 GB. Below that, Firefox gets OOM-killed under load.
- `-no-snapshot` = deterministic cold boot each time. If you value fast reboots more than cleanliness, drop it (snapshots cost disk, not much RAM) and let the emulator save/restore state; just be ready to cold-boot when a snapshot goes stale.

### 5.4 Install Firefox (Nightly arm64) onto the emulator

The `google_apis` image has **no Play Store**, so sideload Mozilla's official arm64 APK:

```bash
# Grab the arm64-v8a Firefox Nightly APK from Mozilla's official archive:
#   https://ftp.mozilla.org/pub/mobile/nightly/latest-mozilla-central-android-aarch64/
# (pick the fenix ...arm64-v8a.apk). Then:
adb install -r ~/Downloads/fenix-*.arm64-v8a.apk

# Launch once so it creates a profile, then enable remote debugging:
adb shell monkey -p org.mozilla.fenix -c android.intent.category.LAUNCHER 1
# In the emulator (or via automation): Firefox ☰ → Settings → bottom →
#   enable "Remote debugging via USB".
```

Package ids by channel (matters for `web-ext --firefox-apk`): Nightly `org.mozilla.fenix`, Beta `org.mozilla.firefox_beta`, Release `org.mozilla.firefox`.

### 5.5 Load OUR extension

From the repo, build the Firefox MV2 output, then point `web-ext` at the device:

```bash
# Produce the unpacked build (WXT). Adjust to our scripts; output is a dist dir:
npm run build            # or: npx wxt build -b firefox
#   -> e.g. .output/firefox-mv2/  (contains manifest.json)

# Load it as a TEMPORARY add-on onto the running emulator over adb:
npx web-ext run \
  --target=firefox-android \
  --android-device=emulator-5554 \
  --firefox-apk=org.mozilla.fenix \
  --source-dir=.output/firefox-mv2

# web-ext opens Firefox on the device, installs the temp add-on, and tails logs.
# Then drive it:
adb shell am start -a android.intent.action.VIEW -d "https://m.youtube.com/"    org.mozilla.fenix
adb shell am start -a android.intent.action.VIEW -d "https://music.youtube.com/" org.mozilla.fenix
```

`web-ext` requires the device's "Remote debugging via USB" toggle on (5.4) and adb to see the device. It loads into the browser's main profile and needs at least one tab open. Requires `web-ext` 7.12.0+ for the `firefox-android` target.

### 5.6 Inspect / debug from desktop

```bash
# Desktop Firefox -> about:debugging -> "Setup"/"This Firefox" -> Enable USB Devices
#   -> the emulator appears in the sidebar -> Connect
#   -> under the device, find "YouTube Audio" -> Inspect (background + content contexts)

# If about:debugging doesn't see it, forward the RDP port manually:
adb forward tcp:9222 tcp:9222

# Native logs (install/version warnings, our console.* from the background page):
adb logcat | grep -i -E "Gecko|fenix|youtube-audio"
```

Desktop `about:debugging` → "Load Temporary Add-on" is the **manual equivalent** of `web-ext run` if you'd rather not use the CLI: connect the device, pick our `manifest.json`, done. Same temporary-add-on mechanism, no signing.

---

## 6. Fallback / lighter — a physical Android phone over USB

If you have **any** Android phone, this is strictly lighter than the emulator (Android runs on the phone; the Mac only runs adb + Node) and gives the most honest behavior:

```bash
# On the phone: Settings -> About -> tap "Build number" 7x -> enable USB debugging.
# Install Firefox (any channel) from Play, or adb install the arm64 APK.
# Firefox -> Settings -> "Remote debugging via USB" -> ON.  Plug in USB, authorize.

adb devices                                   # confirm the phone's serial appears
npx web-ext run --target=firefox-android \
  --android-device=<PHONE_SERIAL> \
  --firefox-apk=org.mozilla.firefox \         # or org.mozilla.fenix for Nightly
  --source-dir=.output/firefox-mv2
```

Everything in §5.5–§5.6 (driving URLs, `about:debugging` inspect, logcat, geckodriver automation) is identical — just swap `emulator-5554` for the phone's serial. On 8 GB this is the path to prefer whenever a phone is available.

---

## 7. Automation notes (geckodriver + Selenium against Android)

Yes — **geckodriver drives Firefox on Android** over Marionette. It requires geckodriver 0.26.0+, adb on PATH, the device/emulator visible to adb, and "Remote debugging via USB" enabled. You set `moz:firefoxOptions.androidPackage`:

```python
# Python + Selenium 4, driving Firefox on the emulator (or a phone: swap the serial)
from selenium import webdriver
from selenium.webdriver.firefox.options import Options

opts = Options()
opts.set_capability("moz:firefoxOptions", {
    "androidPackage": "org.mozilla.fenix",       # org.mozilla.firefox for Release
    "androidDeviceSerial": "emulator-5554",       # from `adb devices`
    # Optional: seed prefs / point at a specific geckodriver-managed profile.
})
# geckodriver bridges Selenium -> Marionette on the device.
driver = webdriver.Firefox(options=opts)
driver.get("https://m.youtube.com/")
# ... assert our content-script effects (audio-only stream swap, toggle state) ...
driver.quit()
```

Caveat worth knowing: geckodriver installs/launches Firefox with a **fresh geckodriver profile**, which is not the same profile `web-ext` uses to temp-load the add-on. For automated runs that must include our extension, either (a) load the add-on into the geckodriver session via the Remote Debugging install API / an `install-addon`-style step, or (b) keep automation focused on page-level assertions and use `web-ext` for the interactive add-on loop. On an 8 GB machine, prefer **one** approach at a time; don't stack a geckodriver session, a `web-ext` session, and the desktop `about:debugging` Firefox all at once.

---

## 8. What NOT to attempt on 8 GB, and honest limits

**Do not:**
- **Run an x86/x86_64 system image on the M1.** No hardware virtualization on Apple Silicon → full software CPU translation. Interactive testing is unusably slow and pins the CPU. ARM64 images only.
- **Run the emulator windowed with `-gpu host` alongside a heavy IDE and a desktop Selenium bench.** That trio will exhaust 8 GB, swap hard, and slow the whole Mac. Pick one heavy thing at a time.
- **Run two AVDs at once**, or leave a windowed AVD idling in the background. One headless AVD, booted only while you test.
- **Reach for a cloud device farm to test the extension.** BrowserStack/Sauce/LambdaTest do not expose the debug-level access needed to sideload a custom Firefox add-on onto their Android devices. They can verify *Firefox-on-Android* renders our target pages, not that *our extension* behaves. Not worth the spend for this.

**Honest RAM math (8 GB M1, headless google_apis AVD @ 2 GB):** macOS + background apps ~3 GB, headless AVD ~2.5–3 GB, desktop Firefox for `about:debugging` ~1–2 GB, editor/Node ~1 GB. That already meets or exceeds 8 GB, so **expect memory pressure and some swap.** Mitigations: drop `-memory` to 1536, quit Chrome/other browsers while testing, skip the desktop `about:debugging` Firefox when `web-ext`'s console logs are enough, and don't run our desktop Selenium suite simultaneously. It is workable, not comfortable. **A phone removes this pinch entirely** — which is why §6 is the preferred path when hardware allows.

**What stays genuinely manual (any surface, per our own testing notes):**
- **OS backgrounding / screen-off audio continuation** — Android app lifecycle and Doze behavior; observe on-device, not scriptable.
- **Lock-screen + notification-shade media controls** (play/pause/seek from the system) — these are OS surfaces outside the page and outside Marionette.
- **Hardware media keys / Bluetooth headset controls** — physical, phone-only, not emulable meaningfully.
- **YouTube Music per-track SPA transitions** and the injected-banner placement on the mobile player DOM — automatable to a point, but eyeball the result; the mobile player layout differs from desktop (see `03-firefox-mobile-support.md` §4.3).

Everything else — installing the build, navigating to `m.youtube.com` / `music.youtube.com`, asserting the audio-only stream swap and toggle state, reading background/content logs — is automatable via `web-ext` + geckodriver + adb.

---

## 9. References

**Mozilla — extension dev on Android (temporary add-on, web-ext, about:debugging):**
- extensionworkshop — Developing extensions for Firefox for Android: https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- MDN — Developing extensions for Firefox for Android: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Developing_extensions_for_Firefox_for_Android
- Firefox Source Docs — about:debugging: https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html
- Mozilla Discourse — Test and debug extension on Android (2025): https://discourse.mozilla.org/t/test-and-debug-extension-on-android/142489
- Stefan Van Damme — Developing and testing an extension on Firefox for Android (Jan 2026; confirms `web-ext run -t firefox-android --android-device=emulator-5554` against an Android Studio emulator on stable Firefox): https://www.stefanvd.net/blog/2026/01/12/developing-and-testing-extension-on-firefox-for-android/

**Firefox for Android APKs (arm64-v8a, official):**
- Mozilla archive — Nightly mobile builds (aarch64 / arm64-v8a): https://ftp.mozilla.org/pub/mobile/nightly/latest-mozilla-central-android-aarch64/
- Mozilla nightly archive root: https://archive.mozilla.org/pub/firefox/nightly/

**Android emulator on Apple Silicon — cmdline-tools, ARM64 images, headless, memory:**
- Android Studio docs — Run the emulator from the command line / emulator startup options: https://developer.android.com/studio/run/emulator-commandline
- Android Studio docs — Configure hardware acceleration for the emulator (Hypervisor.framework on Apple Silicon): https://developer.android.com/studio/run/emulator-acceleration
- Setting up/managing Android emulators on macOS via Homebrew (cmdline-tools, sdkmanager/avdmanager, `-no-window`): https://dev.to/mochafreddo/setting-up-and-managing-android-emulators-on-macos-with-homebrew-3fg0
- Install Android Emulator on macOS (arm64-v8a images, headless launch): https://gist.github.com/guo-steve/a9c7bb575d7050b3c19b05673d38ec89
- Stack Overflow — changing emulator RAM allocation (2 GB config ≈ 2.5–3 GB host): https://stackoverflow.com/questions/40068344/how-can-i-change-the-ram-amount-that-the-android-emulator-is-using

**System-image weight — AOSP / google_apis / play / ATD, and the missing `default` arm64 images:**
- Android Developers — Gradle Managed Devices & ATD (aosp_atd stripped image): https://developer.android.com/studio/test/gradle-managed-devices#gmd-atd
- emulator.wtf — Benchmarking Android ATD emulators (ATD ~lighter/faster): https://blog.emulator.wtf/posts/2022-04-15-atd-images/
- Google issue tracker — `default` system images missing for recent SDK (arm64 `default` not published): https://issuetracker.google.com/issues/432143095
- google_apis arm64-v8a image (android-34): https://android.googlesource.com/platform/prebuilts/android-emulator-build/system-images/+/refs/heads/master/generic/system-images/android-34/google_apis/arm64-v8a

**geckodriver / Selenium on Android (Marionette, androidPackage):**
- Appium Geckodriver — Android testing guide (`androidPackage`, `androidDeviceSerial`): https://appium.github.io/appium-geckodriver/v3/guides/android/
- geckodriver docs — Firefox for Android capabilities (0.26.0+ required): https://firefox-source-docs.mozilla.org/testing/geckodriver/

**Cloud device farms (comparison; no custom-extension sideload on Android):**
- LambdaTest vs BrowserStack vs SauceLabs comparison: https://mantelgroup.com.au/lambdatest-vs-browserstack-vs-saucelabs-testing-tools-analysis/
- Sauce Labs vs LambdaTest: https://saucelabs.com/sauce-labs-vs-lambdatest

**Our own prior brief:**
- `docs/research/03-firefox-mobile-support.md` — Firefox Android API-support matrix, required manifest changes (`gecko_android`), `web-ext run -t firefox-android`, `about:debugging`, reference extensions.
- `docs/research/07-distribution-signing-updates.md` — AMO signing / permanent-install path (out of scope for local testing).
</content>
</invoke>
