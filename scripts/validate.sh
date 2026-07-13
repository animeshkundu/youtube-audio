#!/bin/bash
# Script: validate.sh
# Purpose: Run the deterministic M0 quality gates.
# Usage: ./scripts/validate.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
node_modules/.bin/web-ext lint --source-dir=.output/firefox-mv2
npm run build:mv3

printf '\nAll validations passed.\n'
