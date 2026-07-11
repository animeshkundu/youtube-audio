#!/bin/bash
# Script: build-ext.sh
# Purpose: Build the Firefox MV2 extension and package its generated WXT output.
# Output: dist/youtube-audio.xpi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

npm run build

SOURCE_DIR=".output/firefox-mv2"
ARTIFACTS_DIR="dist/web-ext-artifacts"
rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR" dist

node_modules/.bin/web-ext build \
  --source-dir="$SOURCE_DIR" \
  --artifacts-dir="$ARTIFACTS_DIR" \
  --overwrite-dest >/dev/null

BUILT="$(find "$ARTIFACTS_DIR" -maxdepth 1 -name '*.zip' -print -quit)"
if [ -z "$BUILT" ]; then
  echo "build-ext: web-ext produced no artifact" >&2
  exit 1
fi

cp "$BUILT" dist/youtube-audio.xpi
printf 'built dist/youtube-audio.xpi from WXT output (%s bytes)\n' "$(wc -c < dist/youtube-audio.xpi)"
