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

**Purpose**: Run all validation checks locally (mirrors `.github/workflows/ci.yml`)

```bash
#!/bin/bash
# Run the deterministic quality gate (see scripts/validate.sh)

set -euo pipefail

npm run lint
npm run typecheck
npm run format:check
npm test                       # Vitest + 90% coverage floor
npm run build                  # Firefox MV2 (shipping)
npx web-ext lint --source-dir=.output/firefox-mv2
npm run build:mv3              # Firefox MV3 (capability artifact)

echo "All validations passed."
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

| Script      | Purpose               | Usage                       |
| ----------- | --------------------- | --------------------------- |
| validate.sh | Run all checks        | `./scripts/validate.sh`     |
| setup.sh    | Setup dev environment | `./scripts/setup.sh`        |
| lint.sh     | Run linter            | `./scripts/lint.sh [--fix]` |
```

## Principle 4: Tooling Standards

### Required Development Tools

| Tool       | Purpose            | Configuration File |
| ---------- | ------------------ | ------------------ |
| TypeScript | Strict type checks | `tsconfig.json`    |
| ESLint     | Lint (TS/JS)       | `.eslintrc.js`     |
| Prettier   | Code formatting    | `.prettierrc`      |
| Vitest     | Unit tests         | `vitest.config.ts` |
| WXT        | Extension build    | `wxt.config.ts`    |
| Husky      | Git hooks          | `.husky/`          |

### Configuration Files

Keep all configuration in project root:

```
project/
├── .eslintrc.js
├── .prettierrc
├── tsconfig.json
├── vitest.config.ts
├── wxt.config.ts
├── package.json
└── scripts/
    └── ...
```

### Version Pinning

All tools must be version-pinned in `package.json`:

```json
{
  "devDependencies": {
    "eslint": "^8.56.0",
    "prettier": "^3.2.4",
    "typescript": "5.9.3",
    "vitest": "4.1.10",
    "wxt": "0.20.27"
  }
}
```

## CI/CD Workflow Template

### The repository's actual gate

The live pipeline is [`.github/workflows/ci.yml`](https://github.com/animeshkundu/youtube-audio/blob/master/.github/workflows/ci.yml). Coverage is
enforced by the thresholds in `vitest.config.ts` (not a separate script), and the project does
not run CodeQL. Mirror that gate rather than the generic example above:

```yaml
name: CI

on:
  push:
    branches: [main, master, rebuild]
  pull_request:
    branches: [main, master, rebuild]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test # Vitest + 90% coverage floor
      - run: npm run build # Firefox MV2 (shipping)
      - run: npx web-ext lint --source-dir=.output/firefox-mv2

  build-mv3:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run build:mv3 # Firefox MV3 (capability artifact)
```

The optional Selenium bench runs only on manual dispatch and is non-gating.

## Summary

1. **Automate on second occurrence** - Script everything repeatable
2. **CI/CD is mandatory** - Typecheck → Lint → Test → Build (MV2 + MV3)
3. **Standard scripts** - validate.sh, setup.sh, lint.sh
4. **Pin all versions** - Reproducibility is key
