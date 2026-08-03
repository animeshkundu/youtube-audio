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

# Geckodriver writes Fenix's GeckoView Marionette configuration and waits for New Session. Do not
# launch Fenix or toggle Remote debugging via USB here: that RDP-only setting is release-specific and
# geckodriver's app-data setup can clear it before the fixture probe connects.
echo "Fenix readiness is established by the geckodriver Marionette New Session."
node tests/e2e/android/probe-hermetic-fixture.mjs dist/youtube-audio-bench.xpi
