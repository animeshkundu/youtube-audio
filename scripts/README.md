# Scripts

This folder contains automation scripts for development and CI/CD.

## Available Scripts

| Script         | Purpose                                                    | Usage                       |
| -------------- | ---------------------------------------------------------- | --------------------------- |
| `build-ext.sh` | Build WXT Firefox MV2 and package `dist/youtube-audio.xpi` | `./scripts/build-ext.sh`    |
| `validate.sh`  | Run all validation checks                                  | `./scripts/validate.sh`     |
| `setup.sh`     | Setup development environment                              | `./scripts/setup.sh`        |
| `lint.sh`      | Run linter (with optional fix)                             | `./scripts/lint.sh [--fix]` |

## Quick Start

```bash
# First time setup
./scripts/setup.sh

# Before committing
./scripts/validate.sh

# Fix linting issues
./scripts/lint.sh --fix
```

## Script Details

### validate.sh

Runs the complete validation suite:

1. Runs ESLint and strict TypeScript checks
2. Checks formatting
3. Runs real-source unit tests with the 90% coverage threshold
4. Builds Firefox MV2 and MV3 artifacts
5. Runs `web-ext lint` on the generated Firefox MV2 extension

**Exit codes:**

- `0`: All validations passed
- `1`: One or more validations failed

### setup.sh

Sets up the development environment:

1. Verifies Node.js and npm are installed
2. Installs npm dependencies
3. Makes scripts executable
4. Sets up git hooks (if configured)

### lint.sh

Runs the linter with optional auto-fix:

```bash
# Check only
./scripts/lint.sh

# Auto-fix issues
./scripts/lint.sh --fix
```

## Adding New Scripts

When adding a new script:

1. Use the standard template:

```bash
#!/bin/bash
# Script: [name]
# Purpose: [description]
# Usage: ./scripts/[name].sh [args]

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Your code here
```

2. Make it executable: `chmod +x scripts/[name].sh`
3. Add documentation to this README
4. Test in both local and CI environments

## CI/CD Integration

These scripts are used by GitHub Actions in `.github/workflows/ci.yml`:

```yaml
- name: Run validation
  run: ./scripts/validate.sh
```

## Troubleshooting

### "Permission denied" when running scripts

```bash
chmod +x scripts/*.sh
```

### "npm command not found"

Ensure Node.js is installed:

```bash
node --version
npm --version
```

### Scripts fail in CI but work locally

- Check for platform-specific commands
- Verify all dependencies are in `package.json`
- Check environment variables
