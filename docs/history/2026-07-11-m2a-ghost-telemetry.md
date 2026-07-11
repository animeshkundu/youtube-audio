# Handoff: M2a Ghost Telemetry Blocking

**Date:** 2026-07-11
**Status:** Implemented on `rebuild`, pending review

## Scope

Added a pure, data-driven first-party YouTube telemetry policy; a persistent MV2 blocking `webRequest` listener; conservative and aggressive storage-backed toggles; popup/options controls; explicit YouTube host permissions; unit coverage; and a packaged-extension bench assertion.

## Policy

Conservative mode defaults on and blocks quality, ad, attribution, legacy tracking, and instrumentation endpoints. It deliberately permits `/youtubei/v1/log_event`, watch-time/playback statistics, core InnerTube APIs, attestation/BotGuard/PoToken, and Googlevideo media. Aggressive mode is opt-in and additionally blocks watch-time and playback statistics, which may affect history and resume position.

## Safety

The listener is scoped to the existing four YouTube product host patterns and uses an endpoint allowlist. Malformed URLs, unknown paths, storage problems, and listener exceptions fail open. No third-party host permissions or outbound services were added.

## Testing

Unit tests exercise every endpoint class and protected boundary using the real source predicate. The integration bench loads the packaged extension and proves the fixture's QoE beacon is canceled while `log_event` still reaches the server under conservative defaults. Release gates cover strict types, zero-warning lint, coverage, Firefox MV2 build, and manifest scope.
