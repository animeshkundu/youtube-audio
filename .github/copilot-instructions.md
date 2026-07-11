# YouTube Audio - Copilot Instructions

YouTube Audio is a **Firefox WebExtension** that plays **YouTube and YouTube Music as audio
only** by fetching audio through a credentialless `ANDROID_VR` InnerTube request and
hijacking the page `<video>` source. It also does background play, ad/telemetry blocking,
segment skipping, quality-of-life tweaks, YouTube Music loudness/EQ/lyrics, and audio
download.

Read [`AGENTS.md`](../AGENTS.md) for the full map and [`claude.md`](../claude.md) for the
agent protocol. This repo is documentation-driven: **No spec, no code.**

## Stack

- **TypeScript strict**, built with **WXT**. **MV2 ships**; **MV3** is a capability artifact
  (both from [`wxt.config.ts`](../wxt.config.ts)).
- **Preact + `@preact/signals`** for popup/options UI only, never in background, content, or
  MAIN-world code.
- Promise-based `browser.*` APIs, not callback `chrome.*`.

## Where code goes

- `entrypoints/background.ts` - privileged APIs: `webRequest` telemetry/ad filter,
  SponsorBlock/LRCLIB proxies, downloads (all credentialless).
- `entrypoints/content.ts` - isolated content script: injects MAIN world, cross-world
  bridge, in-player buttons, lyrics, QoL stylesheet.
- `entrypoints/main-world.ts` - page world: `ANDROID_VR` fetch, playability/live gate, SPA,
  visibility override, `PlayerHandle`, Web Audio graph.
- `entrypoints/{popup,options,ui}/` - Preact UI + shared tokenized control kit.
- `src/shared/*` - framework-free pure logic; unit-tested directly. Put testable logic here.

## Hard invariants (do not break)

- **Logged-out only.** Never depend on the user's login. Credentialless by construction.
- **Credentialless.** Every fetch uses `credentials: 'omit'`. `ANDROID_VR` is in
  `src/shared/innertube.ts`.
- **`PlayerHandle` (`src/shared/player.ts`) is the sole `<video>.src` writer.** No other
  module writes a media element `src`.
- **Fail open.** Live streams, YouTube Kids, age-restricted / auth-required, and any failure
  fall back to native playback.
- **Trust boundary.** The cross-world bridge carries only settings booleans and bounded
  status codes; nonce-authenticate content -> MAIN messages; background never accepts
  arbitrary URLs.

## Gate (run before proposing changes complete)

```bash
npm run validate   # typecheck, lint, format:check, test, build MV2, web-ext lint, build MV3
```

Individually: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
`npm run build`, `npm run build:mv3`. Unit tests are Vitest over real `src/` modules with a
90% coverage floor; `npm run test:bench` runs a hermetic Selenium bench against a local
fake-YouTube fixture. Add a bench case for any runtime-facing feature.

## Conventions

- ESLint + Prettier clean: 2-space, single quotes, semicolons, 100 columns, LF, ES5 trailing
  commas. Only `console.warn` / `console.error`. JSDoc on public functions.
- Update the spec (`docs/specs/`), relevant ADR/architecture, and a `docs/history/` handoff
  in the same change.
- **No AI / LLM / assistant / vendor attribution** anywhere (commits, code, docs). Avoid em
  dashes.
