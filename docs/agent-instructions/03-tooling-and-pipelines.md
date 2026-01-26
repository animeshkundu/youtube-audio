# Tooling and Pipelines Guidelines

## The Prime Directive
> **Automate everything you do twice. No exceptions.**

## Principle 1: Tool Creation Rule

### The Two-Time Rule
If you perform any verification, validation, or build task **twice**, you **MUST** create a script for it.

### Why Scripts?
- Consistency across agents and developers
- Reproducibility
- Documentation through code
- Reduced human error
- Faster onboarding

### Script Requirements
Every script must:
1. Be executable (`chmod +x`)
2. Have clear error messages
3. Return appropriate exit codes
4. Be documented in `scripts/README.md`
5. Work in CI environment

### Script Template
```bash
#!/bin/bash
# Script: [name]
# Purpose: [what it does]
# Usage: ./scripts/[name].sh [args]

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Functions
log_info() {
    echo "[INFO] $1"
}

log_error() {
    echo "[ERROR] $1" >&2
}

# Main logic
main() {
    log_info "Starting [task]..."
    
    # Your code here
    
    log_info "Completed successfully"
}

main "$@"
```

## Principle 2: CI/CD Priority

### Pipeline Priority Order
When setting up CI/CD, implement in this order:

1. **Lint** - Fast feedback on code quality
2. **Build** - Ensure code compiles/bundles
3. **Test** - Verify functionality
4. **Coverage** - Enforce quality gates
5. **Security** - Scan for vulnerabilities
6. **Deploy** - Only after all checks pass

### GitHub Actions Structure
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    # First - fastest feedback
  
  build:
    # Second - ensure it compiles
    needs: lint
  
  test:
    # Third - verify behavior
    needs: build
  
  security:
    # Fourth - check for vulnerabilities
    needs: test
  
  deploy:
    # Last - only after all checks
    needs: [lint, build, test, security]
    if: github.ref == 'refs/heads/main'
```

### Required Checks
Every PR must pass:
- [ ] Linting (ESLint/Prettier for JS)
- [ ] Build succeeds
- [ ] Tests pass
- [ ] Coverage ≥ 90%
- [ ] No security vulnerabilities
- [ ] No merge conflicts

## Principle 3: Standard Scripts

### Required Scripts
Every project must have these scripts in `scripts/`:

#### `validate.sh`
**Purpose**: Run all validation checks locally

```bash
#!/bin/bash
# Run full validation suite

set -e

echo "🔍 Running linter..."
npm run lint

echo "🔨 Building..."
npm run build

echo "🧪 Running tests..."
npm test

echo "📊 Checking coverage..."
npm run test:coverage

echo "✅ All validations passed!"
```

#### `setup.sh`
**Purpose**: Set up development environment

```bash
#!/bin/bash
# Set up development environment

set -e

echo "📦 Installing dependencies..."
npm install

echo "🔧 Setting up git hooks..."
npm run prepare

echo "✅ Setup complete!"
```

#### `lint.sh`
**Purpose**: Run linting with auto-fix option

```bash
#!/bin/bash
# Run linting

set -e

if [ "${1:-}" = "--fix" ]; then
    npm run lint:fix
else
    npm run lint
fi
```

### Script Documentation
Maintain `scripts/README.md`:

```markdown
# Scripts

## Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| validate.sh | Run all checks | `./scripts/validate.sh` |
| setup.sh | Setup dev environment | `./scripts/setup.sh` |
| lint.sh | Run linter | `./scripts/lint.sh [--fix]` |
```

## Principle 4: Tooling Standards

### Required Development Tools
| Tool | Purpose | Configuration File |
|------|---------|-------------------|
| ESLint | JavaScript linting | `.eslintrc.js` |
| Prettier | Code formatting | `.prettierrc` |
| Jest | Testing | `jest.config.js` |
| Husky | Git hooks | `.husky/` |

### Configuration Files
Keep all configuration in project root:
```
project/
├── .eslintrc.js
├── .prettierrc
├── jest.config.js
├── package.json
└── scripts/
    └── ...
```

### Version Pinning
All tools must be version-pinned in `package.json`:

```json
{
  "devDependencies": {
    "eslint": "8.56.0",
    "prettier": "3.2.4",
    "jest": "29.7.0"
  }
}
```

## CI/CD Workflow Template

### Complete GitHub Actions Workflow
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage
      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 90" | bc -l) )); then
            echo "Coverage is $COVERAGE%, minimum is 90%"
            exit 1
          fi

  security:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - name: Run CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript
      - uses: github/codeql-action/analyze@v3
```

## Summary
1. **Automate on second occurrence** - Script everything repeatable
2. **CI/CD is mandatory** - Lint → Build → Test → Deploy
3. **Standard scripts** - validate.sh, setup.sh, lint.sh
4. **Pin all versions** - Reproducibility is key
