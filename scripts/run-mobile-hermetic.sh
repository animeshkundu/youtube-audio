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

# Assign the browser role before Fenix launches, so Android does not overlay its first-run default
# browser chooser over Fenix's own Remote debugging via USB setting.
adb shell cmd role add-role-holder --user 0 android.app.role.BROWSER "${FENIX_PACKAGE}"
adb shell cmd role get-role-holders --user 0 android.app.role.BROWSER | tr -d '\r' | grep -Fx "${FENIX_PACKAGE}"
adb shell monkey -p "${FENIX_PACKAGE}" -c android.intent.category.LAUNCHER 1
sleep 8

# Fenix ignores an injected Gecko profile, but Core reads this app-owned setting when it creates
# GeckoView. Set the source-defined preference while the disposable emulator's Fenix process is stopped.
adb shell am force-stop "${FENIX_PACKAGE}"
fenix_preferences="/data/user/0/${FENIX_PACKAGE}/shared_prefs/fenix_preferences.xml"
adb shell test -f "${fenix_preferences}"
adb shell "if grep -q 'name=\"pref_key_remote_debugging\"' '${fenix_preferences}'; then sed -i 's#<boolean name=\"pref_key_remote_debugging\" value=\"false\" />#<boolean name=\"pref_key_remote_debugging\" value=\"true\" />#' '${fenix_preferences}'; else sed -i 's#</map>#<boolean name=\"pref_key_remote_debugging\" value=\"true\" /></map>#' '${fenix_preferences}'; fi"
adb shell "grep -q '<boolean name=\"pref_key_remote_debugging\" value=\"true\" />' '${fenix_preferences}'"
adb shell monkey -p "${FENIX_PACKAGE}" -c android.intent.category.LAUNCHER 1

FENIX_RDP_SOCKET=''
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  FENIX_RDP_SOCKET="$(adb shell cat /proc/net/unix | awk -v suffix="/${FENIX_PACKAGE}/firefox-debugger-socket" '$NF ~ (suffix "$") { print $NF; exit }')"
  if [ -n "${FENIX_RDP_SOCKET}" ]; then
    break
  fi
  sleep 1
done
test -n "${FENIX_RDP_SOCKET}"
export FENIX_RDP_SOCKET
echo "Using Fenix RDP socket: ${FENIX_RDP_SOCKET}"

node tests/e2e/android/probe-hermetic-fixture.mjs dist/youtube-audio-bench.xpi
