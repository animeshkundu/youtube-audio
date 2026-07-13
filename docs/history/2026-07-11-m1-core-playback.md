# Handoff: M1 Core Playback

**Date:** 2026-07-11
**Status:** Implemented on `rebuild`, pending review

## Scope

Added credentialless ANDROID_VR audio acquisition, direct-audio response selection, guarded native video-source hijacking, SPA generation control, background visibility suppression, instant storage-backed settings, popup/options controls, and an in-player audio-only toggle.

## Safety

The player fetch always uses `credentials: "omit"`. Non-OK playability, missing direct audio, stale navigation, fetch/DOM/media errors, and exhausted source reassertions leave or restore normal YouTube playback. The cross-world bridge carries only settings booleans and bounded status values, never player responses or signed media URLs.

## Testing

Unit tests cover response selection/playability and PlayerHandle generation, state preservation, disable, and circuit-breaker behavior. The integration bench is the deterministic end-to-end contract for fetch-to-hijack, disabled behavior, and background visibility handling. The live canary remains non-gating.

## Follow-up

Monitor the dormant source guard in future live canaries. If YouTube begins fighting the hijack, the documented separate media-element fallback can be implemented with its native-scrubber tradeoff.
