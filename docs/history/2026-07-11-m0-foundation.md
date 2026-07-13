# Handoff: M0 Foundation Scaffold

**Date:** 2026-07-11
**Status:** Implemented on `rebuild`, pending review

## Scope

Replaced the legacy untyped extension layout with a WXT + strict TypeScript foundation. Added Preact/signals UI pages, real storage-backed enabled state, inert shared feature contracts, and a tested pure ANDROID_VR request-body builder. Preserved the stable XPI path used by the Selenium harness and added a Firefox MV3 capability build.

## Behavior

M0 intentionally contains no playback, request-blocking, SponsorBlock, rescue-config, audio-graph, or download feature behavior. Both content and page-world entrypoints initialize without modifying YouTube. The popup toggle persists immediately to extension storage; options exposes the same state.

## Migration

Retired the root hand-authored manifest and legacy `js/`/`html/options.html` scripts. WXT now generates the manifest and extension pages from entrypoints.

## Verification

The handoff is complete only after these gates pass:

1. Firefox MV2 WXT build.
2. `web-ext lint` over the generated MV2 directory with zero errors.
3. Strict TypeScript check.
4. Real-source unit tests with non-zero coverage and a 90% threshold.

## Follow-up

M1 implements the proven credentialless ANDROID_VR audio acquisition and `<video>.src` hijack behind the shared player contracts. S4/S5 remain user-gated Phase 0 work.
