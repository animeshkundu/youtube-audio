# ADR-0001: WXT, TypeScript, and Preact Foundation

## Status

**Accepted**

## Date

2026-07-11

## Context

The legacy MV2 extension consists of untyped scripts and a hand-authored manifest. Its media-request interception no longer works on modern YouTube, its tests reimplement rather than import production functions, and it has no maintainable route to dual-manifest builds or a richer extension UI.

### Problem Statement

Establish a typed, testable foundation that supports Firefox desktop and Android, keeps page-facing logic framework-free, and can emit both MV2 and MV3 manifests without duplicating source.

### Constraints

- Firefox MV2 remains the shipping target because persistent background and blocking `webRequest` are required by planned features.
- Firefox Android requires `gecko_android` and a minimum Firefox version compatible with MAIN-world support.
- Extension-owned UI needs reactive state, while host-page code must remain small and framework-free.
- Existing Selenium probes expect `dist/youtube-audio.xpi`.

## Decision

Use strict TypeScript and WXT for entrypoint discovery, bundling, and manifest generation. Use Preact with `@preact/signals` only for popup and options pages. Background, isolated content, MAIN-world, and shared feature modules remain vanilla TypeScript. Build Firefox MV2 by default and Firefox MV3 as a capability artifact from the same source.

### Considered Options

1. **WXT + TypeScript + Preact**
   - Pros: first-class extension entrypoints, MV2/MV3 generation, Vite integration, MAIN-world injection helper, compact UI runtime.
   - Cons: adds build-tool conventions and generated output layout.
2. **Vite + web-ext with hand-authored manifests**
   - Pros: direct control and fewer framework conventions.
   - Cons: duplicated manifest/build plumbing and manual MAIN-world/resource wiring.
3. **Keep legacy JavaScript and Jest**
   - Pros: smallest immediate change.
   - Cons: retains obsolete architecture, unsound tests, and no clean dual-manifest path.

### Chosen Option

Option 1. WXT directly addresses the extension-specific build and manifest problems while preserving a Vite escape hatch. Preact is limited to extension-owned documents to avoid host-page bundle and lifecycle costs.

## Consequences

### Positive

- One source tree builds Firefox MV2 and MV3.
- Strict typing and import-based tests make shipped modules verifiable.
- The page/content/background layers have explicit boundaries.
- UI state can update immediately and synchronize through extension storage.

### Negative

- Developers must understand WXT entrypoint naming and generated directories.
- MV3 is capability-only in M0; feature parity still requires future adapter work.

### Neutral

- Generated manifests replace the root `manifest.json`.
- WXT output is repackaged to the stable XPI path expected by the existing harness.

## Related ADRs

- None.

## References

- `docs/specs/SPEC-001-m0-foundation.md`
- `docs/research/03-firefox-mobile-support.md`
- `docs/research/08-resilience-and-testing.md`
- `docs/research/14-design-language-and-ux.md`
- `docs/research/17-phase0-spike-results.md`
- https://wxt.dev/
