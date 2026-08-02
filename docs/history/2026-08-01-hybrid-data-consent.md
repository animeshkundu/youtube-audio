# Handoff: Hybrid Firefox data-transmission consent

## Date

2026-08-01

## Summary

AMO's version 1.0.3 rejection is addressed with truthful `websiteContent` declaration and a hybrid consent system that preserves Firefox 128 support. Firefox versions exposing built-in data consent use it without duplication. Older supported versions open an extension-owned focused consent tab on install and upgrade and remain fail-closed until explicit acceptance.

## What changed

- Manifest declaration changed from `required: ["none"]` to `required: ["websiteContent"]`; `strict_min_version` remains `128.0`; `management` is added for the required decline-and-uninstall path.
- `src/shared/consent.ts` owns version-and-platform support detection, built-in permission verification, versioned local state, acceptance, revocation, and consent-filtered settings. Desktop 140+ and Android 142+ require the built-in `websiteContent` grant; older versions require custom acceptance. Unknown runtime capability takes the built-in path and stays denied rather than trusting a custom record.
- `entrypoints/consent/` adds the responsive single-page Preact consent view with exact destination/data disclosures, impacts, an unchecked SponsorBlock choice, accept, and decline/uninstall.
- Content resolves consent before MAIN-world injection. Denied or unreadable state produces inert settings and no extension-owned network startup.
- Background consent starts denied and independently gates SponsorBlock. Install and update use the version/platform detector, so an echoed unknown manifest key on Firefox 128-139 cannot suppress the custom tab, while Firefox 140+/Android 142+ never opens a custom tab during a missing or pending native grant.
- Options adds a permanent Data & consent review/revoke control.
- SPEC-013, ADR-0010, and the architecture consent flow document the behavior.

## Data disclosure

The custom screen identifies exactly:

1. `www.youtube.com`: opened `videoId`, page `VISITOR_DATA`, and ANDROID_VR descriptor via credentialless player POST to obtain direct audio.
2. `*.googlevideo.com`: audio bytes.
3. `i.ytimg.com`: video thumbnail for lock-screen/media-session artwork.
4. Optional `sponsor.ajay.app`: only the first four SHA-256 hex characters (16 bits); the video ID stays local.

It states that no request carries identity, cookies, login, analytics, or data to a developer server, and diagnostics are local-only.

## Verification

Unit coverage includes native/custom feature detection, fail-closed errors and malformed state, persistence, revocation, SponsorBlock separation, effective startup settings, full consent copy, checkbox default, acceptance, uninstall, and failure UI. Final gate results are recorded in the implementing agent's handoff report.

## Follow-up qualification

Cross-version runtime qualification is a separate coordinated task: Firefox 128/139 must show the custom tab; Firefox 140+ desktop and 142+ Android must use built-in consent without the duplicate page. E2E fixtures must seed explicit consent before exercising transmission-dependent cases.
