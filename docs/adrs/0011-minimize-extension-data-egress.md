# ADR-0011: Minimize extension data egress

## Status

Accepted. Partially supersedes ADR-0005 by removing its serverless issue-delivery decision. The local diagnostics architecture remains accepted.

## Date

2026-08-01

## Context

AMO rejected version 1.0.3 because the manifest declared `data_collection_permissions.required: ['none']` while the extension initiated network requests. Independently of the corrected disclosure and consent work, the executable data surface should contain only behavior users actively choose and the product still needs.

Three paths required decisions:

1. LRCLIB lyrics had already been made unreachable and its host permission removed, but the endpoint, request handler, renderer, parser, and setting remained in source and could still appear in packaged code.
2. ADR-0005's options-page issue reporter built a GitHub issue URL. Its local bounded diagnostics log remains essential for Android field debugging, but remote issue delivery is not essential.
3. SponsorBlock used a privacy-preserving 16-bit SHA-256 prefix lookup but was enabled by default, so new users could trigger `sponsor.ajay.app` requests without making an explicit feature choice.

## Decision

### Delete the retired lyrics feature completely

Remove the LRCLIB endpoint and request handler, cross-world track and lyrics messages, rendered panel, LRC parser, setting and signal, fixtures, and dedicated tests. YouTube Music's native synchronized lyrics remain untouched. No retired third-party endpoint string may remain in production source or the packaged extension.

### Keep diagnostics local and remove issue delivery

Keep `logger.ts`, `redact.ts`, `diagnostics.ts`, and the closed-schema formatter in `report.ts`. Preserve signed-URL, visitor-data, video-ID, token, email, IP, and extension-URL redaction. The options surface continues to let the user view, copy, export to a local Markdown file, refresh, and clear the log.

Remove the GitHub issue base URL, URL builder, browser-tab action, and issue-opening button. The diagnostics feature itself now has no network egress. This supersedes only ADR-0005's serverless delivery decision, not its local log, schema, bounds, persistence, or redaction decisions.

### Make SponsorBlock explicit opt-in

Change the new-install default for `segmentSkipEnabled` from `true` to `false`. Preserve any stored boolean during normalization, including `true`, so existing users who already use skipping are not silently changed on upgrade. Missing or malformed values use the new off default.

Keep the existing anonymity design unchanged: SHA-256 the video ID, send only the first four hexadecimal characters (16 bits) to `sponsor.ajay.app`, then match the full video ID locally. Requests continue to omit credentials and referrers. The options row names the recipient and explains the 16-bit prefix before opt-in.

## Consequences

### Positive

- Dead third-party endpoint and issue-delivery strings no longer ship.
- Local diagnostics remain available on desktop and Android without a network declaration.
- New installs make a clear choice before SponsorBlock traffic starts.
- Existing users retain their explicit stored SponsorBlock choice.
- The k-anonymous SponsorBlock lookup is unchanged.

### Negative

- Users must export or copy diagnostics and choose their own support channel.
- Restoring extension-rendered lyrics would require a new specification, consent decision, implementation, and permission review rather than flipping a dormant setting.
- Segment skipping is less discoverable in the default experience, offset by explicit options copy.

## Related ADRs

- ADR-0003: AMO distribution preflight.
- ADR-0005: PII-free local diagnostics and serverless issue reporter, partly superseded here.
- ADR-0008: Artwork egress decision, unchanged by this ADR.

## References

- SPEC-005: Private Segment Skipping.
- SPEC-007: YouTube Music Extras.
- SPEC-011: Local Diagnostics.
