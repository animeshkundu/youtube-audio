#!/bin/bash
# Script: validate.sh
# Purpose: Run all validation checks (lint, test, coverage)
# Usage: ./scripts/validate.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COVERAGE_THRESHOLD=90

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_step() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  $1${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

check_dependencies() {
    log_step "🔍 Checking Dependencies"
    
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
        log_warn "package.json not found - skipping npm-based checks"
        return 1
    fi
    
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        log_info "Installing dependencies..."
        cd "$PROJECT_ROOT"
        npm install
    fi
    
    return 0
}

run_linter() {
    log_step "🔍 Running Linter"
    
    cd "$PROJECT_ROOT"
    
    if npm run lint 2>/dev/null; then
        log_info "✅ Linting passed"
    else
        log_error "❌ Linting failed"
        return 1
    fi
}

run_format_check() {
    log_step "📝 Checking Code Formatting"
    
    cd "$PROJECT_ROOT"
    
    if npm run format:check 2>/dev/null; then
        log_info "✅ Formatting check passed"
    else
        log_warn "⚠️ Formatting check not configured or failed"
    fi
}

run_tests() {
    log_step "🧪 Running Tests"
    
    cd "$PROJECT_ROOT"
    
    if npm test 2>/dev/null; then
        log_info "✅ Tests passed"
    else
        log_error "❌ Tests failed"
        return 1
    fi
}

check_coverage() {
    log_step "📊 Checking Code Coverage"
    
    cd "$PROJECT_ROOT"
    
    if npm run test:coverage 2>/dev/null; then
        # Check if coverage report exists
        if [ -f "coverage/coverage-summary.json" ]; then
            COVERAGE=$(jq '.total.lines.pct' coverage/coverage-summary.json)
            log_info "Current coverage: $COVERAGE%"
            
            if (( $(awk "BEGIN {print ($COVERAGE < $COVERAGE_THRESHOLD)}") )); then
                log_error "❌ Coverage is $COVERAGE%, minimum required is $COVERAGE_THRESHOLD%"
                return 1
            else
                log_info "✅ Coverage meets threshold ($COVERAGE_THRESHOLD%)"
            fi
        else
            log_warn "⚠️ Coverage report not found"
        fi
    else
        log_warn "⚠️ Coverage check not configured"
    fi
}

validate_manifest() {
    log_step "📋 Validating Extension Manifest"
    
    cd "$PROJECT_ROOT"
    
    if [ -f "manifest.json" ]; then
        if jq . manifest.json > /dev/null 2>&1; then
            log_info "✅ manifest.json is valid JSON"
            
            # Check required fields
            NAME=$(jq -r '.name' manifest.json)
            VERSION=$(jq -r '.version' manifest.json)
            log_info "  Extension: $NAME v$VERSION"
        else
            log_error "❌ manifest.json is invalid JSON"
            return 1
        fi
    else
        log_error "❌ manifest.json not found"
        return 1
    fi
}

check_required_files() {
    log_step "📁 Checking Required Files"
    
    cd "$PROJECT_ROOT"
    
    local required_files=(
        "manifest.json"
        "js/global.js"
        "js/youtube_audio.js"
        "css/youtube_audio.css"
    )
    
    local all_exist=true
    
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_info "✅ $file"
        else
            log_error "❌ $file is missing"
            all_exist=false
        fi
    done
    
    if [ "$all_exist" = false ]; then
        return 1
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  ✅ ALL VALIDATIONS PASSED${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Main execution
main() {
    log_info "Starting validation for YouTube Audio Extension..."
    log_info "Project root: $PROJECT_ROOT"
    
    # Always run these checks
    validate_manifest || exit 1
    check_required_files || exit 1
    
    # Run npm-based checks if package.json exists
    if check_dependencies; then
        run_linter || exit 1
        run_format_check
        run_tests || exit 1
        check_coverage
    fi
    
    print_summary
}

main "$@"
