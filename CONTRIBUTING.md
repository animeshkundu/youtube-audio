# Contributing to YouTube Audio

Thanks for helping improve YouTube Audio. This guide covers setup, the branch/PR flow, the
quality gate, and the documentation requirements. It applies to both human contributors and
coding agents.

Start with [`AGENTS.md`](./AGENTS.md) for the project map and hard invariants, and
[`CLAUDE.md`](./CLAUDE.md) for the full agent protocol. The documentation "brain" lives in
[`docs/`](./docs/).

## Prerequisites

- **Node.js 20+** (see `engines` in [`package.json`](./package.json)) and npm.
- **Firefox** (desktop) for manual testing and the Selenium bench. A Firefox for Android
  (Fenix) device or emulator is only needed for mobile checks.
- A ready-made environment is provided in [`.devcontainer/`](./.devcontainer/); opening the
  repo in a devcontainer installs the toolchain and runs `npm ci` for you.

## Setup

```bash
npm ci          # reproducible install from package-lock.json (runs wxt prepare + git hooks)
```

Useful during development:

```bash
npm run dev             # WXT dev build for Firefox MV2
npm run test:watch      # Vitest in watch mode
npm run lint:fix        # ESLint autofix
npm run format          # Prettier write
```

## Branch and PR flow

1. Branch off `master` with a descriptive name (for example `feat/eq-presets` or
   `fix/live-fallback`). Active development for the current rebuild happens on `rebuild`.
2. Make focused commits. Keep code and docs in the same commit/PR.
3. Open a PR **against `master`** and fill in
   [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).
4. Ensure the full gate is green (below) before requesting review.

## The quality gate

Run everything CI enforces with a single command:

```bash
npm run validate
```

It runs, and each is individually runnable:

| Check                          | Command                                             |
| ------------------------------ | --------------------------------------------------- |
| Type check (strict TypeScript) | `npm run typecheck`                                 |
| Lint (ESLint)                  | `npm run lint`                                      |
| Format check (Prettier)        | `npm run format:check`                              |
| Unit tests + coverage          | `npm test`                                          |
| Build Firefox MV2 (shipping)   | `npm run build`                                     |
| Package lint                   | `npx web-ext lint --source-dir=.output/firefox-mv2` |
| Build Firefox MV3 (capability) | `npm run build:mv3`                                 |

Additional, non-gating validation:

- `npm run test:bench` runs the hermetic Selenium bench against the local fake-YouTube
  fixture. Add a bench case for any feature with a runtime surface.
- `npm run test:e2e` verifies the packaged XPI installs in Firefox.
- The `tests/e2e/probe-*-live*.mjs` probes are live-YouTube canaries and never gate a PR.

See [`AGENTS.md`](./AGENTS.md#how-to-run-tests) for details on each test tier.

## Testing standards

- **90% coverage floor** on the core logic modules (branches, functions, lines, statements),
  enforced by [`vitest.config.ts`](./vitest.config.ts). Prefer testing real `src/shared/`
  modules over mocks.
- Write the test with (or before) the implementation. Every feature must have automated,
  no-human validation, preferably on the hermetic bench; live YouTube is canary-only.
- Fixing a bug: add a failing test that reproduces it first, then fix.

## Documentation requirements

This repo is documentation-driven ("No spec, no code"). A behavior change is not complete
until the docs are updated in the same PR:

1. **Spec.** Create or update `docs/specs/SPEC-NNN-*.md`.
2. **ADR.** Add `docs/adrs/NNNN-*.md` for a significant or hard-to-reverse decision (use
   [`docs/adrs/0000-template.md`](./docs/adrs/0000-template.md)).
3. **Architecture.** Update [`docs/architecture/`](./docs/architecture/) if structure or a
   data flow changes.
4. **History handoff.** Record a short handoff in `docs/history/YYYY-MM-DD-*.md` covering
   scope, safety, testing, and follow-ups (see the existing entries for the format).

## Coding standards

- **TypeScript strict.** No `any` escape hatches where a real type fits;
  `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Keep pure logic in
  `src/shared/` so it is unit-testable without the browser.
- **ESLint + Prettier** must be clean: 2-space indent, single quotes, semicolons, LF,
  100-column width, trailing commas (ES5). `no-var`, `prefer-const`, and
  `no-console` (only `console.warn` / `console.error` allowed) are enforced.
- **JSDoc** on exported/public functions: purpose, params, return, and any failure behavior.
- **Preact** is used only in popup, options, and the shared `ui/` kit, never in background,
  content, or MAIN-world code.
- **Respect the hard invariants** in [`AGENTS.md`](./AGENTS.md#hard-invariants): logged-out
  only, credentialless fetches, `PlayerHandle` as the sole `<video>.src` writer, MV2 primary
  with MV3 dual-build, and fail-open to native YouTube.
- **No AI/vendor attribution** anywhere (commits, PRs, code, comments, docs). Avoid em dashes.

## Where to find things

| Looking for                   | Location                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Project map, invariants, gate | [`AGENTS.md`](./AGENTS.md)                                                     |
| Full agent protocol           | [`CLAUDE.md`](./CLAUDE.md)                                                     |
| Specs (what/why per feature)  | [`docs/specs/`](./docs/specs/)                                                 |
| Decisions                     | [`docs/adrs/`](./docs/adrs/)                                                   |
| System design + data flows    | [`docs/architecture/`](./docs/architecture/)                                   |
| Prior work handoffs           | [`docs/history/`](./docs/history/)                                             |
| Background research           | [`docs/research/`](./docs/research/)                                           |
| Agent role guides             | [`.github/agents/`](./.github/agents/), [`.claude/agents/`](./.claude/agents/) |
| Build / release / signing     | [`scripts/`](./scripts/), [`RELEASE.md`](./RELEASE.md)                         |

## Reporting issues

Use the issue forms: a bug report, a feature request, and a dedicated
**YouTube breakage report** for when a YouTube change breaks a working feature. Please
confirm you are reproducing **logged out** in a fresh profile before filing.
