#!/bin/bash
# Script: setup.sh
# Purpose: Set up the development environment
# Usage: ./scripts/setup.sh

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

main() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  YouTube Audio Extension - Development Setup${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    cd "$PROJECT_ROOT"
    
    # Check for Node.js
    if command -v node &> /dev/null; then
        log_info "Node.js version: $(node --version)"
    else
        log_warn "Node.js not found. Please install Node.js 18 or later."
        exit 1
    fi
    
    # Check for npm
    if command -v npm &> /dev/null; then
        log_info "npm version: $(npm --version)"
    else
        log_warn "npm not found. Please install npm."
        exit 1
    fi
    
    # Install dependencies
    if [ -f "package.json" ]; then
        log_info "Installing dependencies..."
        npm install
    else
        log_warn "package.json not found - skipping dependency installation"
    fi
    
    # Make scripts executable
    log_info "Making scripts executable..."
    chmod +x scripts/*.sh 2>/dev/null || true
    
    # Setup git hooks if husky is configured
    if [ -f "package.json" ] && grep -q '"prepare"' package.json 2>/dev/null; then
        log_info "Setting up git hooks..."
        npm run prepare 2>/dev/null || true
    fi
    
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  ✅ Setup Complete!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run './scripts/validate.sh' to verify setup"
    echo "  2. Load the extension in your browser for testing"
    echo "  3. Read docs/agent-instructions/ before making changes"
    echo ""
}

main "$@"
