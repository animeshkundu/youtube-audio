# ADR-0010: Source audio selection and tab-scoped download progress

## Status

**Accepted**

## Date

2026-07-22

## Context

The opt-in audio download currently always chooses compatible AAC itag 140 and shows an
indeterminate spinner while the background assembles the complete file. Dedicated audio tools let
users choose an available output/quality and show how much data has arrived.

The extension has no transcoder. YouTube supplies finite audio-only AAC/MP4 and Opus/WebM streams at
several bitrates, and the background already reads validated `Content-Range` totals while assembling
one stream. The page trust boundary must not gain arbitrary URLs, free-form format values, or a
broadcast progress channel.

## Decision

1. Expose closed settings for source format (`auto | m4a | opus`) and bitrate tier (`auto | high |
medium | low`). Auto preserves compatible AAC itag 140. Choices select only direct
   `adaptiveFormats`; no conversion or renamed container is implied.
2. Select known source tiers when present (AAC 139/140/141, Opus 249/250/251), with bitrate-based
   fallback inside the requested codec and compatible-format fallback when that codec is absent.
3. Correlate each explicit click with the content-generated UUID already used on the
   nonce-authenticated content-to-MAIN exchange. Forward that bounded ID to background.
4. Report validated range-chunk progress from background to only the originating tab with
   `tabs.sendMessage`. The message contains the fixed discriminator, request ID, loaded bytes, and
   total bytes. Content validates all fields and ignores stale/foreign request IDs.
5. Render determinate progress only after a valid total is known. A complete `200` response or a
   response without usable `Content-Range` remains indeterminate.

## Considered Options

1. **Offer MP3/OGG/FLAC through in-browser transcoding.** Rejected because it adds a large codec/Wasm
   runtime, CPU and memory cost, and new failure modes for no gain in source quality.
2. **Use a long-lived runtime port for progress.** Rejected because one tab-scoped message per range
   chunk fits the existing extension messaging model and avoids port lifecycle state.
3. **Broadcast progress with `runtime.sendMessage`.** Rejected because every extension page would
   receive unrelated download activity and correlation would be weaker than targeting the source tab.
4. **Estimate progress without a total.** Rejected because an inaccurate percentage is worse than an
   honest indeterminate state.

## Consequences

### Positive

- Users can choose the real source container and bitrate tier without a lossy conversion.
- Default downloads remain compatible `.m4a` itag 140.
- Progress is honest, bounded, request-correlated, and visible only in the initiating tab.
- Playback and the `PlayerHandle` sole-writer invariant are unchanged.

### Negative

- Available tiers vary by video and ANDROID_VR response; a requested tier may fall back.
- Range progress advances per assembled chunk rather than per network packet.
- A server that ignores ranges cannot expose byte-granular progress with the current assembly path.

### Neutral

- The whole file is still assembled in background memory before the single downloads API call.
- MV2 remains the shipping target and MV3 remains buildable using the same message contract.

## Related ADRs

- ADR-0001: WXT, TypeScript, and Preact foundation.
- ADR-0005: PII-free diagnostics and closed-schema settings projection.

## References

- `docs/specs/SPEC-008-m5-audio-download.md`
- `docs/research/04-youtube-streaming-internals.md`
- `docs/research/11-audio-download-offline.md`
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/sendMessage
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Range
