#!/bin/bash
# Script: lint.sh
# Purpose: Run linting with optional auto-fix
# Usage: ./scripts/lint.sh [--fix]

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

main() {
    cd "$PROJECT_ROOT"
    
    if [ ! -f "package.json" ]; then
        log_error "package.json not found"
        exit 1
    fi
    
    if [ "${1:-}" = "--fix" ]; then
        log_info "Running linter with auto-fix..."
        npm run lint:fix 2>/dev/null || npm run lint -- --fix 2>/dev/null || {
            log_error "Lint fix command not available"
            exit 1
        }
    else
        log_info "Running linter..."
        npm run lint 2>/dev/null || {
            log_error "Lint command not available"
            exit 1
        }
    fi
    
    log_info "✅ Linting complete"
}

main "$@"
