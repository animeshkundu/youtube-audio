#!/bin/sh
# Run the fixture-backed Firefox Android qualification inside a booted emulator.

set -eu

: "${FENIX_VERSION:?FENIX_VERSION must name the Fenix release to qualify}"

adb wait-for-device
adb root || true
adb wait-for-device
adb shell settings put system system_locales en-US
adb shell settings put global adb_enabled 1
adb shell settings get global adb_enabled | tr -d '\r' | grep -Fx 1

fenix_apk_url="https://archive.mozilla.org/pub/fenix/releases/${FENIX_VERSION}/android/fenix-${FENIX_VERSION}-android-x86_64/fenix-${FENIX_VERSION}.multi.android-x86_64.apk"
echo "Installing x86_64 Fenix from: ${fenix_apk_url}"
curl -fL --retry 3 --retry-delay 5 -o /tmp/fenix.apk "${fenix_apk_url}"
adb install -r -g /tmp/fenix.apk
fenix_package="$(adb shell pm list packages | grep -E '^package:org\.mozilla\.(fenix|firefox)$' | head -1 | cut -d: -f2 | tr -d '\r')"
test -n "${fenix_package}"
export FENIX_PACKAGE="${fenix_package}"
echo "Driving Android package: ${FENIX_PACKAGE}"

# Assign the browser role before Fenix launches, so Android does not overlay its first-run default
# browser chooser over Fenix's own Remote debugging via USB setting.
adb shell cmd role add-role-holder --user 0 android.app.role.BROWSER "${FENIX_PACKAGE}"
adb shell cmd role get-role-holders --user 0 android.app.role.BROWSER | tr -d '\r' | grep -Fx "${FENIX_PACKAGE}"
adb shell cmd package resolve-activity --brief \
  -a android.intent.action.MAIN \
  -c android.intent.category.LAUNCHER \
  "${FENIX_PACKAGE}"
start_fenix() {
  started=false
  for attempt in 1 2 3; do
    if adb shell am start -W -n "${FENIX_PACKAGE}/.App"; then
      started=true
      break
    fi
    echo "Fenix launch attempt ${attempt} failed; retrying after device startup settles" >&2
    sleep 3
  done
  test "${started}" = true
}

start_fenix

# Fenix starts its DevTools server through its live GeckoView runtime setting. Writing backing
# preference files bypasses that listener on some archived releases, so use the app's own checked
# Remote debugging via USB control and leave this process running through RDP installation.
python3 tests/e2e/android/enable-remote-debugging.py

# The UI writes the setting through Fenix's runtime listener. Mirror the corresponding Gecko
# preferences in Fenix's real profile, then restart once so archived GeckoView releases construct
# their debugger server from the persisted runtime and Gecko settings together.
fenix_gecko_prefs="$(adb shell find "/data/user/0/${FENIX_PACKAGE}/files/mozilla" -name prefs.js -print -quit | tr -d '\r')"
test -n "${fenix_gecko_prefs}"
adb shell "printf '\\nuser_pref(\"devtools.debugger.remote-enabled\", true);\\nuser_pref(\"devtools.debugger.force-local\", true);\\nuser_pref(\"devtools.debugger.prompt-connection\", false);\\nuser_pref(\"devtools.remote.usb.enabled\", true);\\n' >> '${fenix_gecko_prefs}'"
adb shell am force-stop "${FENIX_PACKAGE}"
start_fenix
# Firefox Android creates its Gecko runtime when it owns a browser tab. A local about:blank tab keeps
# this qualification hermetic while giving the restarted runtime a place to start its RDP server.
adb shell am start -W \
  -a android.intent.action.VIEW \
  -d 'about:blank' \
  -p "${FENIX_PACKAGE}"
# Reapply the switch in the final GeckoView process so its runtime listener starts the RDP server.
python3 tests/e2e/android/enable-remote-debugging.py --force

node tests/e2e/android/probe-hermetic-fixture.mjs dist/youtube-audio-bench.xpi
