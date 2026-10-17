# SPEC-030: Audio-only fallback chain Phase B (TVHTML5 age-restricted bypass)

**Status:** Draft
**Date:** 2026-10-17
**Depends on:** SPEC-014 (media client resilience), SPEC-022 (reliability cluster)
**Relates to:** ADR-0012 (media client table)

## 1. Goal

Add TVHTML5_SIMPLY_EMBEDDED_PLAYER as a fallback client for age-restricted videos. This client bypasses age-gating without authentication but returns ciphered URLs (signatureCipher instead of url). Requires signature cipher decoding (parse base.js swap/splice/reverse operations) and signatureTimestamp extraction.

## 2. Non-goals

- No PoToken handling (research only).
- No live audio-only (separate spec, SPEC-029).
- No change to the fail-open default (if cipher fails, try next client; if all fail, native playback).

## 3. Design

### 3.1 Client persona

```typescript
export const TVHTML5_SIMPLY_CLIENT = Object.freeze({
  clientName: 'TVHTML5_SIMPLY',
  clientVersion: '1.0',
  hl: 'en',
  gl: 'US',
});
```

### 3.2 Player request

The player request must include:

- `context.client` with the TVHTML5_SIMPLY persona
- `context.thirdParty.embedUrl` = 'https://www.youtube.com'
- `playbackContext.contentPlaybackContext.signatureTimestamp` (extracted from base.js)

### 3.3 Signature cipher decoding

When the response contains `signatureCipher` instead of `url`:

1. Fetch base.js from YouTube (`https://www.youtube.com/s/player/{version}/player_ias.vflset/en_US/base.js`)
2. Parse the cipher function (search for `a=a.split("")`)
3. Extract the cipher operations (swap/splice/reverse sequence)
4. Extract `signatureTimestamp` from base.js
5. Decode the signature using the extracted operations
6. Reconstruct the URL: `url + "&" + sp + "=" + decodedSignature`

### 3.4 base.js fetcher

- Fetch base.js on first need (cached per page load).
- Extract player version from `/iframe_api` response.
- Extract signatureTimestamp by searching for `signatureTimestamp` in base.js.
- Extract cipher function by searching for `a=a.split("")`.

### 3.5 Fail-open

- If base.js fetch fails → skip TVHTML5 client, try next.
- If cipher parsing fails → skip TVHTML5 client, try next.
- If signature decoding fails → skip TVHTML5 client, try next.
- If all clients fail → native playback.

## 4. Test strategy

- Unit: cipher decoding against known base.js versions (swap/splice/reverse).
- Unit: base.js parsing (signatureTimestamp extraction, cipher function extraction).
- Bench: age-restricted video fixture → TVHTML5 client returns audio URL → hijack.
- Bench: age-restricted video → cipher fails → fallback to native.

## 5. Implementation phases

**Phase B1:** Signature cipher decoder (pure function, tested against known base.js).
**Phase B2:** base.js fetcher + signatureTimestamp extraction.
**Phase B3:** TVHTML5 client persona + player request with signatureTimestamp.
**Phase B4:** Integration into MEDIA_CLIENTS (ordered after ANDROID_VR, before IOS).
**Phase B5:** Bench cases for age-restricted videos.

---

_Spec written per "no spec, no code" rule._
