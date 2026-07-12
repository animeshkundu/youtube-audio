# Specification: M0 Extension Foundation

## Overview

M0 replaces the legacy JavaScript/WebExtension layout with a buildable, typed foundation for the Firefox desktop and Android extension. It establishes module boundaries and a minimal instant-apply UI without implementing playback, blocking, rescue-config, SponsorBlock, audio processing, or download behavior.

## Goals

- Build Firefox Manifest V2 with WXT, strict TypeScript, and framework-free background/content/page-world modules.
- Build extension-owned popup and options pages with Preact and `@preact/signals`.
- Produce a second Firefox Manifest V3 artifact in CI-compatible form.
- Scope permissions to YouTube surfaces and `*.googlevideo.com`.
- Preserve the existing Selenium probes and their expected `dist/youtube-audio.xpi` artifact.
- Test real source modules with meaningful non-zero coverage and a 90% global threshold.

## Non-Goals

- No audio-source hijacking, ad or telemetry filtering, background-play workarounds, segment skipping, EQ, lyrics, downloads, or remote rescue-config behavior.
- No Android device or AMO policy validation. Those remain Phase 0 S4/S5 gates.
- No production network proxy or feature implementation beyond typed fail-open stubs.

## Technical Design

### Build and manifests

WXT generates manifests and bundles from `entrypoints/`. The default production command targets Firefox MV2. A separate command targets Firefox MV3. MV2 uses a persistent background script. Both builds include:

- permissions: `tabs`, `webRequest`, `webRequestBlocking`, `storage`, `downloads`
- content matches: `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*`, `*://music.youtube.com/*`, `*://m.youtube.com/*`
- host access: `*://*.googlevideo.com/*`
- Gecko ID `youtube-audio@local`, minimum Firefox `128.0`, Android opt-in via `gecko_android: {}`, and `data_collection_permissions.required: ["none"]`

Future optional origins are documented but not granted: `https://sponsor.ajay.app/*` and `https://lrclib.net/*`.

### Layers

- `entrypoints/background.ts`: persistent MV2 background bootstrap.
- `entrypoints/content.ts`: isolated content bootstrap and MAIN-world injection.
- `entrypoints/main-world.ts`: page-context bootstrap, bundled as an unlisted script.
- `entrypoints/popup/`: minimal Preact on/off UI.
- `entrypoints/options/`: minimal Preact settings shell.
- `src/shared/`: framework-neutral contracts and fail-open stubs for configuration, InnerTube, player coordination, SPA observation, rescue config, scriptlets, audio graph, SponsorBlock, and MV2/MV3 platform capabilities.

### State and storage

`src/shared/config.ts` owns the framework-neutral, storage-backed settings store (getters, `subscribeSettings`, mutators) that every context imports. The Preact reactive layer lives separately in `src/shared/settings-signals.ts`, which the popup and options UI import; it mirrors the store into `@preact/signals` via a single `subscribeSettings` listener, keeping `@preact/signals` (and the Preact runtime) out of the background, content, and page-world bundles. UI changes update the signals immediately and persist to `browser.storage.local`; storage changes synchronize other extension contexts. Persistence failures restore the prior state and surface an error to the caller.

### ANDROID_VR request builder

`src/shared/innertube.ts` exports a pure request builder using the experimentally proven `ANDROID_VR` client body:

- client version `1.65.10`
- Oculus Quest 3 / Android 12L identity
- `videoId`, `contentCheckOk: true`, `racyCheckOk: true`
- optional `visitorData`

Network execution is intentionally deferred. Production requests must use `credentials: "omit"`.

## API/Interface Design

Shared modules export explicit types and functions. Feature stubs return inert defaults, avoid side effects at import time, and carry TODO markers naming the milestone that will implement behavior.

## Error Handling

- Entry points catch startup failures and log a scoped error rather than breaking the host page.
- Storage writes roll back optimistic state if persistence fails.
- All feature stubs fail open and leave YouTube behavior unchanged.

## Testing Strategy

- Vitest imports real `src/` modules.
- Unit tests verify the exact ANDROID_VR body, optional visitor data, and fresh-object behavior.
- Coverage includes `src/shared/innertube.ts` and enforces 90% statements, branches, functions, and lines for collected source.
- Required release checks: WXT MV2 build, `web-ext lint`, strict TypeScript, and unit tests with coverage.

## Security Considerations

- No arbitrary URL proxy exists in M0.
- No page-originated message is trusted or handled yet.
- External optional origins are not granted until their features land.
- The request builder contains no cookies or credentials and network execution will be credentialless.

## Performance Considerations

Entrypoints are small and feature modules are inert. Preact is restricted to extension-owned pages. Host-page execution remains vanilla TypeScript.

## Dependencies

- WXT
- TypeScript
- Preact and `@preact/signals`
- `@preact/preset-vite`
- Vitest and V8 coverage
- ESLint with TypeScript support

## Rollout Plan

M0 is the base for M1 core playback. The legacy manifest and scripts are retired atomically so no obsolete mechanism remains wired.

## Open Questions

- Android runtime behavior and direct downloads remain gated on S4.
- AMO policy and rescue-config distribution remain gated on S5.
