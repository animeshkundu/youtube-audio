# Specification: M2a Ghost Telemetry Blocking

## Overview

M2a reduces first-party YouTube telemetry with a conservative, account-compatible blocking policy. A persistent Firefox MV2 background listener cancels only an enumerated set of YouTube telemetry endpoints and leaves playback, attestation, media delivery, and watch-history logging intact by default.

## Goals

- Block a conservative set of first-party quality, ad, attribution, and instrumentation beacons on supported YouTube hosts.
- Keep `/youtubei/v1/log_event`, player APIs, attestation, BotGuard/PoToken, and Googlevideo media fail-open.
- Offer an opt-in aggressive mode for watch-time and playback statistics that may impair resume position.
- Apply both protection settings immediately through extension storage, popup, and options.
- Prove endpoint policy with unit tests and the packaged-extension integration bench.

## Non-Goals

- Third-party ad hosts, new host permissions, URL-parameter stripping, synthetic success responses, page-world fetch patches, or response rewriting.
- Anonymity, undetectability, or elimination of server-side account/IP correlation.
- Blanket cancellation of InnerTube endpoints.

## Technical Design

### Endpoint policy

`src/shared/telemetry.ts` owns a pure URL predicate. Conservative mode blocks `/api/stats/qoe`, `/api/stats/atr`, `/api/stats/ads`, `/pagead/`, `/ptracking`, `/csi_204`, and `/generate_204`. Aggressive mode additionally blocks `/api/stats/watchtime` and `/api/stats/playback`.

The predicate accepts only HTTP(S) URLs on the supported YouTube domain families. It never matches `*.googlevideo.com`, `/youtubei/v1/player`, `/youtubei/v1/att`, BotGuard/PoToken paths, or conservative `/youtubei/v1/log_event`. Malformed and unknown URLs fail open.

### Background listener

The persistent MV2 background initializes settings, keeps an in-memory snapshot synchronized from storage, and registers one blocking `webRequest.onBeforeRequest` listener on the same four YouTube patterns used by the extension. The listener returns `{ cancel: true }` only when global protection, ghost mode, and the endpoint predicate all permit blocking. Any initialization, parsing, or listener error returns no blocking response.

### Settings and UI

The storage-backed settings object adds `ghostEnabled`, defaulting to `true`, and `aggressiveTelemetry`, defaulting to `false`. Popup and options controls persist changes through the shared adapter and update signals immediately. Aggressive mode is labeled as potentially affecting resume position.

## Error Handling

All unrecognized hosts, malformed URLs, storage failures, and listener failures fail open. No failure in telemetry logic may throw into or interrupt a YouTube page or playback request.

## Testing Strategy

- Unit tests import the real predicate and cover every conservative endpoint, aggressive-only gating, supported hosts, never-block paths, malformed URLs, and near-match boundaries.
- The hermetic packaged-extension bench verifies `/api/stats/qoe` never reaches the fixture while `/youtubei/v1/log_event` still does under default conservative settings.
- Release gates are strict TypeScript, zero-warning lint, unit coverage, the integration bench, and Firefox MV2 build/manifest inspection.

## Security and Privacy Considerations

The listener is allowlist-based and host-scoped. It neither reads request bodies nor adds permissions or outbound calls. Conservative mode intentionally preserves `log_event` and watch-time endpoints to avoid breaking history, resume position, and recommendations. This feature reduces selected telemetry; it does not provide anonymity.

## Rollout and Rollback

Ghost mode defaults on and can be disabled instantly. Aggressive mode defaults off. Disabling global protection or ghost mode makes the listener inert without requiring a page reload.
