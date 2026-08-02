#!/bin/sh
# Run the fixture-backed Firefox Android qualification inside a booted emulator.

set -eu

: "${FENIX_VERSION:?FENIX_VERSION must name the Fenix release to qualify}"

adb wait-for-device
adb root || true
adb wait-for-device

fenix_apk_url="https://archive.mozilla.org/pub/fenix/releases/${FENIX_VERSION}/android/fenix-${FENIX_VERSION}-android-x86_64/fenix-${FENIX_VERSION}.multi.android-x86_64.apk"
echo "Installing x86_64 Fenix from: ${fenix_apk_url}"
curl -fL --retry 3 --retry-delay 5 -o /tmp/fenix.apk "${fenix_apk_url}"
adb install -r -g /tmp/fenix.apk
fenix_package="$(adb shell pm list packages | grep -E '^package:org\.mozilla\.(fenix|firefox)$' | head -1 | cut -d: -f2 | tr -d '\r')"
test -n "${fenix_package}"
export FENIX_PACKAGE="${fenix_package}"
echo "Driving Android package: ${FENIX_PACKAGE}"

adb shell monkey -p "${FENIX_PACKAGE}" -c android.intent.category.LAUNCHER 1 || true
sleep 8

# Fenix's first-run default-browser chooser is Android system UI. Dismiss it, then set the app-owned
# remote-debugging preference while Fenix is stopped. Fenix ignores a supplied Gecko profile, but
# Core reads this `fenix_preferences` key when it creates its GeckoView runtime.
adb shell input keyevent 4
adb shell am force-stop "${FENIX_PACKAGE}"
fenix_preferences="/data/user/0/${FENIX_PACKAGE}/shared_prefs/fenix_preferences.xml"
adb shell test -f "${fenix_preferences}"
adb shell "if grep -q 'name=\"pref_key_remote_debugging\"' '${fenix_preferences}'; then sed -i 's#<boolean name=\"pref_key_remote_debugging\" value=\"false\" />#<boolean name=\"pref_key_remote_debugging\" value=\"true\" />#' '${fenix_preferences}'; else sed -i 's#</map>#<boolean name=\"pref_key_remote_debugging\" value=\"true\" /></map>#' '${fenix_preferences}'; fi"
adb shell "grep -q '<boolean name=\"pref_key_remote_debugging\" value=\"true\" />' '${fenix_preferences}'"
adb shell monkey -p "${FENIX_PACKAGE}" -c android.intent.category.LAUNCHER 1

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if adb shell cat /proc/net/unix | grep -q "${FENIX_PACKAGE}/firefox-debugger-socket"; then
    break
  fi
  sleep 1
done
adb shell cat /proc/net/unix | grep -q "${FENIX_PACKAGE}/firefox-debugger-socket"

node tests/e2e/android/probe-hermetic-fixture.mjs dist/youtube-audio-bench.xpi
