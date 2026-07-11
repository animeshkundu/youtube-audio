#!/bin/bash
# Script: build-ext.sh
# Purpose: Build a clean, installable extension package (XPI) from the working-tree
#          source, so verification always runs against the CURRENT source, not a
#          stale prebuilt artifact.
# Output:  dist/youtube-audio.xpi  (+ dist/extension/ staging dir)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

STAGE="dist/extension"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Only the actual extension files (never node_modules/docs/tests/etc).
cp manifest.json "$STAGE/"
cp -r js css html img "$STAGE/"

# Package via web-ext (produces a zip; an XPI is just a zip).
node_modules/.bin/web-ext build --source-dir="$STAGE" --artifacts-dir=dist --overwrite-dest >/dev/null

BUILT="$(ls -t dist/youtube_audio-*.zip 2>/dev/null | head -1)"
if [ -z "$BUILT" ]; then
  echo "build-ext: web-ext produced no artifact" >&2
  exit 1
fi
cp "$BUILT" dist/youtube-audio.xpi
echo "built dist/youtube-audio.xpi from source ($(wc -c < dist/youtube-audio.xpi) bytes)"
