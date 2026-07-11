# Specification: M3a Private Segment Skipping

## Overview

M3a adds SponsorBlock-compatible automatic skipping through a minimal telemetry-free client. It uses the documented four-hex-character SHA-256 prefix lookup, filters the anonymity bucket locally, and seeks the same page video controlled by audio-only playback.

## Goals

- Auto-skip enabled `sponsor` and `music_offtopic` segments by default.
- Query only `GET /api/skipSegments/<four-hex-prefix>` from the privileged background context.
- Explicitly omit credentials and avoid identifying headers, referrers, view-count telemetry, submissions, and votes.
- Merge overlapping ranges before scheduling and fail open on every malformed or failed path.
- Apply the master toggle and category choices instantly through shared extension settings.
- Preserve correct behavior across playback rates, manual seeks, media replacement, and SPA navigation.

## Non-Goals

- Segment submissions, voting, user IDs, view counting, `/api/viewedVideoSponsorTime`, manual skip overlays, seek-bar decoration, undo notices, or remote configuration.
- Sending a plaintext video ID to SponsorBlock.
- Replacing or independently controlling the page media element.

## Technical Design

### Private bucket client

`src/shared/sponsorblock.ts` hashes a video ID once with SubtleCrypto SHA-256 and returns the first four lowercase hex characters. The background requests the fixed SponsorBlock origin with `credentials: "omit"`, `referrerPolicy: "no-referrer"`, and no custom headers. Bench builds substitute the hermetic fixture origin at compile time.

The response parser accepts only an array bucket, selects entries whose `videoID` exactly matches locally, retains enabled categories with `actionType: "skip"`, rejects malformed and non-finite ranges, sorts by start, and merges overlapping ranges.

### Cross-world flow

MAIN world emits a nonce-authenticated, fixed-shape request containing only the video ID and selected categories. The isolated content script validates that request and forwards it through `browser.runtime.sendMessage`. The background accepts only the named operation and validates the payload again before performing the fixed-origin request. Responses contain only normalized ranges.

### Skip scheduler

MAIN world resolves the page video independently of audio-only activation, then listens to `timeupdate`. When playback enters an unhandled range, it marks that range handled before seeking to its end. A range is skipped at most once per navigation, so repeatedly seeking into it does not fight the user. Navigation and settings changes increment the generation, remove prior listeners, and ignore stale fetches. Media replacement causes the scheduler to attach to the current page video. All reads, listener operations, and seeks are guarded so failures leave native playback untouched.

### Settings and UI

`segmentSkipEnabled` defaults to `true`. `segmentSkipCategories` is normalized to a unique subset of the supported categories and defaults to `sponsor` plus `music_offtopic`. Popup and options expose the instant master toggle; options also expose the two category choices.

## Error Handling

Hashing, messaging, fetch, JSON parsing, response validation, media discovery, and seeking all fail open. Network failures and invalid data produce an empty segment list. No retry loop runs automatically.

## Testing Strategy

- Unit tests import the real hash and response-selection functions and cover a known digest vector, exact video filtering, category gating, sorting, overlap merging, malformed data, and invalid ranges.
- The packaged-extension bench serves a matching anonymity bucket and proves the real page video clock jumps past the configured segment while existing cases remain green.
- Release gates include strict typecheck, zero-warning lint, the gate-weakener scan, real-source coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

The production manifest adds only `https://sponsor.ajay.app/*`. The background fetch sends neither cookies nor a YouTube referrer and never contacts the view-count endpoint. The request path contains only a four-character hash prefix; exact video matching remains local. MAIN-world input cannot select an arbitrary URL.

## Rollout and Rollback

Segment skipping defaults on and can be disabled instantly. Global disable also makes it inert. Any remote, parsing, bridge, or seek failure preserves normal YouTube playback.
