# AGENTS.md

The cross-tool entry point for coding agents (and humans) working in this repository.
Read this first. It is authoritative and deliberately concise; it links out to the
detailed sources rather than duplicating them.

- Deep agent protocol: [`CLAUDE.md`](./CLAUDE.md)
- The documentation "brain": [`docs/`](./docs/) (specs, ADRs, architecture, history, research)
- Contribution workflow and setup: [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## What this project is

**YouTube Audio** is a Firefox WebExtension that plays **YouTube and YouTube Music as
audio only**: it fetches the audio stream through a credentialless `ANDROID_VR` InnerTube
request and hijacks the page `<video>` source so playback continues without downloading
video. It also handles background play, ad/telemetry blocking, SponsorBlock-style segment
skipping, quality-of-life tweaks, YouTube Music loudness normalization / EQ, audio
download, and a PII-free local diagnostics log with a serverless issue reporter.

|                 |                                                                         |
| --------------- | ----------------------------------------------------------------------- |
| Language        | TypeScript (strict)                                                     |
| Build framework | [WXT](https://wxt.dev)                                                  |
| UI              | Preact + `@preact/signals` (popup and options only)                     |
| Manifest        | **MV2 is the shipping target**; MV3 is emitted as a capability artifact |
| Targets         | Firefox desktop and Firefox for Android (Fenix)                         |
| Node            | 20+                                                                     |

**Distribution.** Production ships from a **single add-on ID `youtube-audio@animesh.kundus.in`**
on the AMO **listed** channel (AMO is the sole update authority for desktop + Android; no
self-hosted `update_url` in production), with an **unlisted** signed **beta** on the same ID at a
distinct pre-release version for hand-installed desktop/Android testing. Publishing to AMO is
**on demand** (manual, post-testing). See ADR-0006 (supersedes ADR-0002's two-identity model).

## Core rules

These mirror [`CLAUDE.md`](./CLAUDE.md); that file is the full version.

1. **No spec, no code.** Before writing code, create or update the spec in
   [`docs/specs/`](./docs/specs/). After writing code, record a handoff in
   [`docs/history/`](./docs/history/).
2. **Check before you code.** Read [`docs/adrs/`](./docs/adrs/) for past decisions and
   [`docs/history/`](./docs/history/) for context before proposing changes. Search the
   codebase for an existing pattern before inventing one.
3. **Keep code and docs in sync.** A code change that alters behavior, structure, or a
   dependency must update the matching spec, architecture doc, and (for significant
   decisions) an ADR, in the same change.
4. **Research, don't hallucinate.** Verify browser-extension APIs, library versions, and
   YouTube behavior against primary sources. Never guess a signature or a config key.

## Gate commands

Run the full gate with one command (this is exactly what CI enforces, see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) and
[`scripts/validate.sh`](./scripts/validate.sh)):

```bash
npm run validate
```

That runs, in order, the individually runnable gates:

| Gate                                              | Command                                             |
| ------------------------------------------------- | --------------------------------------------------- |
| Type check (strict)                               | `npm run typecheck`                                 |
| Lint                                              | `npm run lint`                                      |
| Format check                                      | `npm run format:check`                              |
| Unit tests + coverage (90% floor on core modules) | `npm test`                                          |
| Build Firefox MV2 (shipping)                      | `npm run build`                                     |
| Package lint                                      | `npx web-ext lint --source-dir=.output/firefox-mv2` |
| Build Firefox MV3 (capability artifact)           | `npm run build:mv3`                                 |

Auto-fixers: `npm run lint:fix`, `npm run format`.

## How to run tests

- **Unit (default gate).** `npm test` runs Vitest against the real `src/shared/` modules
  in a jsdom environment and enforces the 90% branch/function/line/statement threshold on
  the core logic modules configured in [`vitest.config.ts`](./vitest.config.ts). Watch mode:
  `npm run test:watch`.
- **Hermetic integration bench.** `npm run test:bench` builds the extension with the
  `BENCH=1` flag and drives the **real built add-on** in Firefox (Selenium + geckodriver)
  against a fully local fake-YouTube fixture ([`tests/e2e/bench/`](./tests/e2e/bench/)).
  No live YouTube, no real media decoding: it asserts fetch-to-hijack, disabled = untouched,
  and background visibility suppression, then emits a PASS/FAIL summary. This is the
  preferred no-human validation bench for new features. Headful: `HEADLESS=0 npm run test:bench`.
- **Settings-permutation matrix.** `npm run test:matrix`
  ([`tests/e2e/bench/run-matrix.mjs`](./tests/e2e/bench/run-matrix.mjs)) drives the same real
  built add-on against the hermetic fixture across the full toggle space (all-off, each toggle
  alone, a pairwise covering array, key interaction pairs, and quality/EQ edges), so a
  regression in any setting or interaction surfaces deterministically. Add a combo here when you
  add a toggle. Heavier than the smoke bench; not part of `npm run validate`.
- **Installability check.** `npm run test:e2e` builds a packaged XPI and verifies it loads
  in Firefox ([`tests/e2e/verify-firefox.mjs`](./tests/e2e/verify-firefox.mjs)).
- **Firefox Android (Fenix).** Device/emulator-gated and run manually, outside the default
  gate: the uiautomator UI driver [`tests/e2e/android/ui.py`](./tests/e2e/android/ui.py) and
  [`tests/e2e/probe-mobile-fenix.mjs`](./tests/e2e/probe-mobile-fenix.mjs) require an attached
  device or emulator via `adb`.
- **Live canary.** The `tests/e2e/probe-*-live*.mjs` probes hit real YouTube. They are
  canary-only, never gating, and are not part of `npm run validate`.

## File map

```
youtube-audio/
├── entrypoints/            # WXT per-context bundles (one build target each)
│   ├── background.ts       # Persistent MV2 background: webRequest telemetry/ad filter,
│   │                       #   SponsorBlock + LRCLIB proxies, downloads (all credentialless)
│   ├── content.ts          # Isolated content script (document_start): injects MAIN world,
│   │                       #   owns the cross-world bridge and the QoL stylesheet
│   ├── main-world.ts       # MAIN world: credentialless ANDROID_VR fetch, playability gate,
│   │                       #   SPA generation, visibility override, PlayerHandle, Web Audio graph
│   ├── popup/              # Preact quick-control popup
│   ├── options/            # Preact full settings page (Android-first quick controls + groups)
│   └── ui/                 # Shared tokenized Preact control kit (tokens.css, components)
├── src/shared/             # Framework-free contracts + pure logic, unit-tested directly
│   ├── innertube.ts        # ANDROID_VR request body builder + player-response/format selection
│   ├── player.ts           # PlayerHandle: the SOLE writer of the page <video>/<audio> src
│   ├── platform.ts         # Manifest-version (MV2/MV3) capability flags for bg/webRequest adapters
│   ├── adblock.ts          # Pure ad-descriptor pruner for player/next InnerTube responses
│   ├── sponsorblock.ts     # Prefix-hash segment fetch + local filter/merge
│   ├── telemetry.ts        # First-party telemetry allowlist policy (fail-open)
│   ├── audiograph.ts       # Web Audio loudness normalization + 5-band EQ graph
│   ├── lyrics.ts           # LRCLIB timed-lyrics fetch/parse
│   ├── download.ts         # Direct audio format selection + filename sanitization
│   ├── quality-of-life.ts  # QoL settings -> managed stylesheet / bounded player hints
│   ├── rescue.ts           # Static page-world rescue operation baseline (compiled op IDs only)
│   ├── scriptlets.ts       # Page-world scriptlet helpers used by rescue
│   ├── spa.ts              # SPA navigation generation control (invalidates stale work)
│   ├── config.ts           # Settings model, defaults, and storage keys
│   ├── logger.ts           # Pure PII-free-by-construction log primitives (closed per-code schema)
│   ├── redact.ts           # Defensive PII scrub applied over the final report (safety net)
│   ├── report.ts           # Assembles the human-readable, timestamp-free diagnostic report
│   └── diagnostics.ts      # Browser-API glue: background aggregator hub + page/content/options helpers
├── tests/
│   ├── unit/               # Vitest unit tests over real src/ modules (incl. ui/ Preact tests)
│   └── e2e/                # Selenium probes + hermetic bench/, android/ Fenix driver
├── docs/                   # MkDocs site and brain: specs/ (SPEC-001..012), ADRs, architecture, history, research
├── scripts/                # validate.sh, build-ext.sh, release.sh, setup.sh, lint.sh
├── .github/workflows/      # ci.yml, pages.yml, beta.yml, publish-amo.yml, mobile-e2e.yml, live-canary.yml
├── wxt.config.ts           # WXT config: MV2/MV3 manifests, match patterns, permissions, BENCH flag
├── vitest.config.ts        # Vitest config + coverage thresholds
└── package.json            # Scripts and dependencies
```

## Docs-driven workflow

For any behavior change, follow the loop (see
[`docs/agent-instructions/`](./docs/agent-instructions/) `00` → `03` for the full protocol):

1. **Spec.** Write or update `docs/specs/SPEC-NNN-*.md` (goals, non-goals, design, testing).
2. **Check.** Read relevant ADRs and history so you do not reintroduce a rejected approach.
3. **Test.** Add or extend a unit test, and a hermetic bench case when the feature has a
   runtime surface. Every feature must have automated, no-human validation.
4. **Implement.** Keep the change behind the right layer (see invariants below).
5. **Validate.** `npm run validate` must pass; add a bench case where it applies.
6. **Handoff.** Record a short handoff in `docs/history/` (scope, safety, testing, follow-up).

## Hard invariants

Do not break these without an ADR that supersedes the decision:

- **Logged-out only.** The extension never needs the user's YouTube login and must not
  depend on it. Detect the logged-in / unsupported case and fall back to native playback.
- **Credentialless core.** Every media and metadata fetch uses `credentials: "omit"`. The
  `ANDROID_VR` InnerTube client (`src/shared/innertube.ts`) is the media-acquisition path.
- **MV2 primary, MV3 dual-build.** MV2 (`npm run build`) is what ships; MV3
  (`npm run build:mv3`) must keep building as a capability artifact. Both come from one
  source tree via [`wxt.config.ts`](./wxt.config.ts).
- **`PlayerHandle` is the sole `<video>.src` writer.** All audio-source swaps go through
  `PlayerHandle` in `src/shared/player.ts`. No other module writes a media element `src`.
- **Four production content-script matches only.** Keep content scripts scoped to the four
  YouTube match patterns and never widen them to `*://*/*`. The credentialless fetch-origin
  permissions for `*://*.googlevideo.com/*` and `https://sponsor.ajay.app/*` are separate,
  intended, and required. (The `https://lrclib.net/*` origin was dropped when the redundant
  synced-lyrics feature was disabled.)
- **Fail open to native YouTube.** Live streams, YouTube Kids, age-restricted / auth-required
  videos, and any fetch/parse/DOM/media failure must leave or restore normal YouTube
  playback. A feature failure is never a broken page.
- **Trust boundary.** Page-world data is untrusted; the cross-world bridge carries only
  settings booleans and bounded status codes, never signed media URLs or player responses.
  The background never accepts arbitrary URLs.

## Style and attribution

- TypeScript strict, ESLint + Prettier clean, JSDoc on public functions. See
  [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full standard.
- Do not attribute work to an AI, LLM, assistant, or vendor anywhere (commits, PRs, code,
  comments, docs). Avoid em dashes in prose.
