#!/bin/bash
# Script: release.sh
# Purpose: Build, validate, and request an unlisted Mozilla signature for Firefox MV2 (the beta
#          channel under the single permanent add-on ID, ADR-0006). Set BETA_SUFFIX (e.g. b1) to
#          sign a pre-release beta version; the manifest version becomes e.g. 0.0.2.5b1.
# Usage: AMO_JWT_ISSUER=... AMO_JWT_SECRET=... [BETA_SUFFIX=b1] npm run release:sign
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

if [ -z "${AMO_JWT_ISSUER:-}" ]; then
  echo "release:sign: AMO_JWT_ISSUER is required (AMO Developer Hub JWT issuer)" >&2
  exit 1
fi

if [ -z "${AMO_JWT_SECRET:-}" ]; then
  echo "release:sign: AMO_JWT_SECRET is required (AMO Developer Hub JWT secret)" >&2
  exit 1
fi

npm run build
node_modules/.bin/web-ext lint --source-dir=.output/firefox-mv2

ARTIFACTS_DIR="dist/web-ext-signed"
rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR" dist

node_modules/.bin/web-ext sign \
  --source-dir=.output/firefox-mv2 \
  --artifacts-dir="$ARTIFACTS_DIR" \
  --channel=unlisted \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET"

SIGNED_XPI="$(find "$ARTIFACTS_DIR" -maxdepth 1 -name '*.xpi' -print -quit)"
if [ -z "$SIGNED_XPI" ]; then
  echo "release:sign: AMO returned no signed XPI" >&2
  exit 1
fi

# Derive the version from the BUILT manifest so a BETA_SUFFIX build (e.g. 0.0.2.5b1) names the
# artifact after the version that was actually signed, not the clean package.json base.
VERSION="$(node -p "require('./.output/firefox-mv2/manifest.json').version")"
DESTINATION="dist/youtube-audio-${VERSION}-signed.xpi"
cp "$SIGNED_XPI" "$DESTINATION"
printf 'signed %s (%s bytes)\n' "$DESTINATION" "$(wc -c < "$DESTINATION")"
