# YouTube Audio - AI Agent Instructions

This repository is **AI-Enabled** and optimized for Agentic Coding. Before performing any work, you **MUST** follow these instructions.

## Project Overview

**YouTube Audio** is a Firefox browser extension that allows users to stream only audio from YouTube videos. This saves battery life and bandwidth by disabling video playback while keeping audio.

### Technology Stack
- **Language**: JavaScript (ES6+)
- **Platform**: Browser Extension (Firefox/Chrome)
- **Manifest**: WebExtension Manifest V2
- **APIs**: WebRequest, Storage, Tabs, BrowserAction

## Required Reading

**Before answering any request, you MUST read:**

1. `docs/agent-instructions/` - All files in order (00 → 03)
2. `docs/adrs/` - Check for past architectural decisions
3. `docs/specs/` - Review existing specifications
4. `docs/architecture/` - Understand system design

## Core Rules

### Rule 1: Documentation First
> **"No spec, no code."**

- Before writing code, create or update the specification in `docs/specs/`
- After writing code, update `docs/history/` with a handoff record
- Architecture changes require updates to `docs/architecture/`

### Rule 2: Check Before You Code
> **"Avoid regression by learning from history."**

- Check `docs/adrs/` for past decisions before proposing changes
- Review existing specs to understand design rationale
- Search the codebase for similar patterns before creating new ones

### Rule 3: Update Documentation
> **"Code and docs must stay synchronized."**

If you modify code, you **MUST**:
- Update the corresponding spec in `docs/specs/`
- Update architecture diagrams if structure changes
- Create an ADR for significant decisions
- Record a handoff in `docs/history/`

### Rule 4: Research, Don't Hallucinate
> **"If you're unsure, search the internet. Do not make up APIs."**

- Use web search to verify library versions and APIs
- Check official documentation before using any external dependency
- Validate browser extension API compatibility
- Never guess at function signatures or configurations

## Coding Standards

### JavaScript
- Use ES6+ features (const/let, arrow functions, destructuring)
- Prefer async/await over callbacks where possible
- Use descriptive variable and function names
- Add JSDoc comments for public functions

### Browser Extension Specifics
- Follow WebExtension API conventions
- Handle permissions gracefully
- Consider cross-browser compatibility (Firefox/Chrome)
- Test in private/incognito modes

### Testing
- **90% code coverage minimum** for new code
- Write tests before or with implementation
- Run `./scripts/validate.sh` before committing

## File Structure

```
youtube-audio/
├── css/                    # Stylesheets
├── docs/                   # Documentation (THE BRAIN)
│   ├── adrs/              # Architecture Decision Records
│   ├── agent-instructions/ # Agent protocols
│   ├── architecture/      # System diagrams
│   ├── history/           # Handoffs and deprecated logic
│   └── specs/             # Technical specifications
├── html/                   # HTML pages
├── img/                    # Icons and images
├── js/                     # JavaScript source
├── scripts/               # Automation scripts
├── tests/                 # Test files
├── .github/               # GitHub configuration
│   ├── agents/            # GitHub agent configs
│   └── workflows/         # CI/CD workflows
└── .claude/               # Claude agent configs
```

## Common Tasks

### Adding a New Feature
1. Write spec in `docs/specs/SPEC-NNN-feature.md`
2. Update architecture if needed
3. Write tests first
4. Implement feature
5. Verify 90%+ coverage
6. Run `./scripts/validate.sh`
7. Record handoff in `docs/history/`

### Fixing a Bug
1. Check `docs/history/` for related context
2. Write a failing test that reproduces the bug
3. Fix the bug
4. Verify the test passes
5. Update documentation if behavior changed

### Updating Dependencies
1. Research the update (breaking changes, security fixes)
2. Create ADR documenting the decision
3. Update `manifest.json` or `package.json`
4. Run full test suite
5. Update documentation

## Quick Reference

| Task | Command |
|------|---------|
| Run all validations | `./scripts/validate.sh` |
| Run linter | `npm run lint` |
| Run tests | `npm test` |
| Check coverage | `npm run test:coverage` |

## Questions?

If you're unsure about something:
1. Check the documentation in `docs/`
2. Search the codebase for examples
3. Research using web search
4. Ask for clarification rather than guessing

---

*This repository follows the AI-Enabled Repository Standard. Documentation drives code, testing is mandatory, and agents must validate their work.*
