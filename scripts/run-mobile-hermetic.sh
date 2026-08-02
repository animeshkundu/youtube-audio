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
adb shell am start -W -a android.intent.action.VIEW -d about:blank "${FENIX_PACKAGE}"
sleep 8

sudo mkdir -p /opt/homebrew/share
sudo ln -sfn "${ANDROID_SDK_ROOT:-${ANDROID_HOME}}" /opt/homebrew/share/android-commandlinetools
python3 tests/e2e/android/ui.py list

tap_when_present() {
  label="$1"
  attempts="$2"
  attempt=1
  while [ "${attempt}" -le "${attempts}" ]; do
    result="$(python3 tests/e2e/android/ui.py tap "${label}")"
    printf '%s\n' "${result}"
    case "${result}" in
      TAPPED*) return 0 ;;
    esac
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

tap_when_present "more options" 15 || tap_when_present "menu" 15
tap_when_present "settings" 15
remote_debugging_enabled=false
for _ in 1 2 3 4 5 6 7 8; do
  if tap_when_present "remote debugging" 3; then
    remote_debugging_enabled=true
    break
  fi
  python3 tests/e2e/android/ui.py scroll down
  sleep 1
done
test "${remote_debugging_enabled}" = true

# Fenix applies the setting to GeckoView during startup. Restart after the toggle so the RDP socket is
# created before the RDP add-ons actor is used.
adb shell am force-stop "${FENIX_PACKAGE}"
adb shell am start -W -a android.intent.action.VIEW -d about:blank "${FENIX_PACKAGE}"

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if adb shell cat /proc/net/unix | grep -q "${FENIX_PACKAGE}/firefox-debugger-socket"; then
    break
  fi
  sleep 1
done
adb shell cat /proc/net/unix | grep -q "${FENIX_PACKAGE}/firefox-debugger-socket"

node tests/e2e/android/probe-hermetic-fixture.mjs dist/youtube-audio-bench.xpi
