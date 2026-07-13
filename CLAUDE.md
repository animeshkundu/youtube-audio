# YouTube Audio - AI Agent Instructions

This repository is **AI-Enabled** and optimized for Agentic Coding. Before performing any work, you **MUST** follow these instructions. For a concise cross-tool entry point, see [`AGENTS.md`](AGENTS.md); this file is the full protocol.

## Project Overview

**YouTube Audio** is a Firefox extension (desktop + Android) for **YouTube and YouTube Music** that plays only the audio of videos, stopping video bytes to save battery and bandwidth, and adds a paid-tier-like experience for free: audio-only playback, background/lock-screen play, ad + telemetry ("ghost") blocking, SponsorBlock-style segment skipping, quality-of-life tweaks, YouTube Music loudness normalization + EQ, audio download, and a PII-free local diagnostics log with a serverless issue reporter. Simple by default, powerful on demand.

### Technology Stack

- **Language**: TypeScript (strict).
- **Build**: WXT (esbuild/Vite under the hood); `web-ext` for lint/sign.
- **UI**: Preact + `@preact/signals` (extension pages only; content/background/page-world are vanilla TS).
- **Manifest**: MV2 primary (Firefox keeps blocking `webRequest` + `filterResponseData`); MV3 built in parallel as a capability artifact.
- **Platform**: Firefox desktop + Firefox for Android (`gecko_android`, `strict_min_version` 128).
- **APIs**: `webRequest`/`webRequestBlocking`, `storage`, `tabs`, `downloads`.

### Core mechanism

A credentialless **ANDROID_VR** InnerTube `POST /youtubei/v1/player` (`credentials:"omit"`) returns a direct audio URL; the extension hijacks the page `<video>.src` to it (native player UI intact, video bytes stop). It falls back to normal playback whenever the credentialless fetch is non-playable (live, made-for-kids, age-restricted, members-only, unavailable).

### Distribution

Production ships from a **single permanent add-on ID `youtube-audio@animesh.kundus.in`** on the AMO **listed** channel; **AMO is the sole update authority** (no self-hosted `update_url` in production), giving hands-off auto-update on Firefox desktop and Firefox for Android. A **beta** channel uses the same ID signed **unlisted** at a distinct pre-release version, installed by hand for desktop + Android testing. Publishing to AMO is **on demand** (a manual run after testing), never automatic on a tag. See ADR-0006 (this supersedes the two-identity model in ADR-0002).

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
- Capture UX/design decisions in `docs/design/`, grounding research in `docs/research/`, and product direction and notable issues where they are tracked
- Keep `CLAUDE.md` and `AGENTS.md` accurate, current, and optimized as the project evolves (they load into every agent session)

### Rule 4: Research, Don't Hallucinate

> **"If you're unsure, search the internet. Do not make up APIs."**

- Use web search to verify library versions and APIs
- Check official documentation before using any external dependency
- Validate browser extension API compatibility
- Never guess at function signatures or configurations

## Hard invariants (do not violate)

- **Logged-out is the only supported use case.** Do not build or test any logged-in path.
- **Credentialless.** Every InnerTube / googlevideo / external fetch uses `credentials:"omit"`. The extension never attaches the user's YouTube login.
- **`PlayerHandle` (`src/shared/player.ts`) is the sole `<video>.src` writer.** Do not set the source elsewhere.
- **Fail open.** Any unsupported or failed path reverts cleanly to native YouTube playback; no retry loops, no dual playback.
- **Live/DVR streams fall back** (they are not hijackable as a progressive `src`); detection is in `isLiveStream` (`src/shared/innertube.ts`).
- **MV2 ships; MV3 must stay buildable.** Keep network-interception + background behind the platform adapters.

## Coding Standards

### TypeScript

- Strict TypeScript; `const`/`let`, arrow functions, destructuring, `async`/`await`.
- Descriptive names; JSDoc on public functions.
- No `eslint-disable` gate-weakeners; fix the root cause.
- Run Prettier (`npm run format`); keep `format:check` green.

### Browser extension specifics

- Follow WebExtension API conventions; handle permissions gracefully.
- Treat every page-world message as hostile: fixed schemas, origin/tab checks, endpoint allowlists.
- Keep exactly four production **content-script** matches for YouTube; never widen content-script matching to `*://*/*`. The credentialless fetch-origin permissions for `*://*.googlevideo.com/*` and `https://sponsor.ajay.app/*` are separate, intended, and required. (The `https://lrclib.net/*` origin was dropped when the redundant synced-lyrics feature was disabled.)

### Testing

- **90% coverage minimum** for new code.
- Write tests with (or before) implementation.
- Run `./scripts/validate.sh` (or the individual gates) before committing.

## File Structure

```
youtube-audio/
├── entrypoints/            # WXT entrypoints: background.ts, content.ts, main-world.ts, ui/, popup/, options/
├── src/shared/             # Core logic: innertube, player, audiograph, adblock, scriptlets, rescue,
│                           #   sponsorblock, telemetry, quality-of-life, lyrics, download, config, spa, platform,
│                           #   logger + redact + report + diagnostics (PII-free log & serverless reporter)
├── tests/
│   ├── unit/               # Vitest unit tests
│   └── e2e/                # Selenium bench (bench/) + live/mobile probes + tests/e2e/android/ui.py
├── docs/                   # Documentation (THE BRAIN)
│   ├── adrs/               # Architecture Decision Records
│   ├── agent-instructions/ # Agent protocols (00-03)
│   ├── architecture/       # System diagrams
│   ├── history/            # Handoff records
│   ├── research/           # Grounding research (01-19)
│   └── specs/              # Technical specifications (SPEC-001..012)
├── img/                    # Icons and images
├── scripts/                # build-ext.sh, validate.sh, release.sh
├── .github/                # agents/, workflows/ (ci.yml, pages.yml, beta.yml, publish-amo.yml,
│                           #   mobile-e2e.yml, live-canary.yml), templates
├── .claude/                # Claude agent configs
├── wxt.config.ts           # Manifest + build config
├── AGENTS.md               # Concise cross-tool agent entry point
└── CLAUDE.md               # This file
```

## Common Tasks

### Adding a New Feature

1. Write spec in `docs/specs/SPEC-NNN-feature.md`
2. Update architecture if needed
3. Write tests (unit + a bench case where observable)
4. Implement the feature
5. Verify 90%+ coverage and all gates
6. Run the gates (below)
7. Record a handoff in `docs/history/`

### Fixing a Bug

1. Check `docs/history/` for related context
2. Write a failing test that reproduces the bug (unit or bench)
3. Fix the bug
4. Verify the test passes
5. Update documentation if behavior changed

### Updating Dependencies

1. Research the update (breaking changes, security fixes)
2. Create an ADR if significant
3. Update `package.json` / `wxt.config.ts`
4. Run the full gate set
5. Update documentation

## Quick Reference

| Task                        | Command                                             |
| --------------------------- | --------------------------------------------------- |
| Type-check                  | `npm run typecheck`                                 |
| Lint                        | `npm run lint`                                      |
| Format check / fix          | `npm run format:check` / `npm run format`           |
| Unit tests (+cov)           | `npm test`                                          |
| Hermetic Firefox bench      | `npm run test:bench`                                |
| Settings-permutation matrix | `npm run test:matrix`                               |
| Build MV2 / MV3             | `npm run build` / `npm run build:mv3`               |
| Validate MV2 package        | `npx web-ext lint --source-dir=.output/firefox-mv2` |
| All gates                   | `./scripts/validate.sh`                             |

The hermetic bench and the Android-emulator / live-YouTube probes are documented in `docs/ci-cd.md`.

## Questions?

If you're unsure about something:

1. Check the documentation in `docs/`
2. Search the codebase for examples
3. Research using web search
4. Ask for clarification rather than guessing

---

_This repository follows the AI-Enabled Repository Standard. Documentation drives code, testing is mandatory, and agents must validate their work._
