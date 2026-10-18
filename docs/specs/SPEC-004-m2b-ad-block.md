# Specification: M2b YouTube Ad Blocking

## Overview

M2b removes known client-side YouTube ad descriptors from InnerTube player responses and installs a small bundled anti-adblock compatibility baseline. The implementation is Firefox MV2-first, fully local, instant-disableable, and fail-open.

## Goals

- Rewrite `/youtubei/v1/player` and `/youtubei/v1/next` JSON responses with Firefox `filterResponseData`.
- Prune the initial watch page's inline `window.ytInitialPlayerResponse` in MAIN world, including assignments and parsed player responses.
- Remove `adPlacements`, `playerAds`, `adSlots`, and `adPlacementRenderer` without changing playback data.
- Return the original response bytes on decoding, parsing, pruning, encoding, stream, or settings errors.
- Run only bundled, allowlisted scriptlet operations in MAIN world at `document_start`.
- Best-effort avoid scriptlet double-injection when another blocker already wraps the relevant JSON primitives.
- Apply an `adBlockEnabled` setting immediately through storage, popup, and options.
- Keep rescue configuration local until the post-S5 AMO preflight.

## Non-Goals

- Remote rescue-config, remote code, downloaded filter lists, arbitrary scriptlet text, arbitrary paths, or remote URLs.
- A complete uBlock Origin engine or a claim that server-stitched ads can be removed.
- Detecting uBlock Origin with certainty. Deliberately isolated extension internals make reliable detection unavailable.

## Technical Design

### Response pruning

`src/shared/adblock.ts` exports a pure string-to-string function. It parses JSON, recursively deletes the four allowlisted ad keys from objects and arrays, and serializes the result. Malformed input and every unexpected error return the exact original string.

The persistent MV2 background registers `webRequest.onBeforeRequest` for the existing YouTube patterns and, in bench builds, local fixture hosts. Registration is permission-synced (ADR-0018): the listeners attach only when the optional `webRequest` + `webRequestBlocking` grants are present, re-sync on grant/revoke, and a revoke flips `adBlockEnabled` off so copy never over-claims. For matching POST responses it opens `filterResponseData` and buffers the body for pruning under a hard budget (`MAX_PRUNABLE_RESPONSE_BYTES`, 8 MiB, `src/shared/adblock.ts`). Once a response crosses that budget the filter flushes everything it held and streams the remaining chunks through verbatim, so an over-budget body is deliberately delivered unparsed with its ad descriptors intact: bounded background memory and intact playback matter more than pruning a pathological response. Under budget it writes either the pruned UTF-8 JSON or the original bytes. The filter is inert unless global protection and ad blocking are enabled. All failure paths attempt to write what was held unchanged and close the filter. The success path never logs per response; only unexpected filter failures produce one bounded diagnostics error entry.

### Bundled baseline and scriptlets

`src/shared/rescue.ts` exposes a frozen, versioned baseline containing only allowlisted operation IDs and bounded primitive arguments. `loadRescueConfig` returns this bundled baseline without network access. Remote loading, signature verification, expiry, and anti-rollback remain intentionally deferred until after the S5 AMO policy preflight.

`src/shared/scriptlets.ts` dispatches only known operation IDs. The baseline installs a reversible `ytInitialPlayerResponse` accessor before page scripts run, prunes any already-present response, and wraps `JSON.parse` so parsed player responses containing known ad descriptors are pruned in place. The wrapper inspects only parsed objects with `streamingData` or `playabilityStatus`, returns all non-player values untouched, and catches inspection failures without changing native parse behavior. The baseline also performs conservative operations against already-present page globals: neutralizing an exposed abnormality callback and setting an already-present inline-playback ad flag. Missing or incompatible targets are no-ops. Each operation catches its own failures and returns cleanup behavior.

Coexistence is additive chaining, not a skip: each operation wraps whatever implementation is currently installed (including another extension's or YouTube's own), calls through to it, and prunes only the value it produced, and cleanup restores prior values only when the operation still owns what it installed. The historical "`JSON.parse`/`JSON.stringify` looks non-native, so stand down entirely" heuristic false-positived on stock YouTube (which itself freezes or replaces JSON serialization in places) and disabled every scriptlet there, so it was removed (ADR-0013). Response pruning in the background remains independent and fail-open.

### Settings and UI

`adBlockEnabled` defaults to `false` (ADR-0018: ad blocking is an explicit opt-in), is normalized for older stored settings, and has a dedicated signal and setter. Content forwards the boolean in the existing nonce-protected settings message. MAIN world applies or removes the bundled scriptlet baseline when settings change. Popup and options expose instant-apply controls. Existing users who enabled blocking keep it: the stored value is authoritative, only fresh installs see the new default.

## Error Handling

Every boundary fails open. The background retains original bytes before parsing and writes them unchanged if pruning cannot complete. Scriptlet operations never throw into page code and cleanup restores prior values only when the operation still owns the value it installed. Unknown operations are ignored.

## Testing Strategy

- Unit tests import the real pruner and cover all target fields at multiple depths, arrays, preservation of streaming/video/unknown data, malformed JSON, primitive JSON, and non-mutation of the input string.
- Unit tests also lock the response budget: chunks below the boundary stay buffered, crossing it flushes everything held exactly once, and each later chunk streams through unparsed. The bench serves a 9 MiB padded fixture response (`BIG*` ids) and asserts the session still reaches `active` within a generous latency-sanity bound while the page-visible body keeps its ad descriptors, proving over-budget responses stream through unparsed instead of being buffered.
- The packaged-extension bench fetches the fixture player response from page context and asserts ad descriptors are absent with default settings and present when ad blocking is disabled.
- Release gates: strict typecheck, zero-warning lint, gate-weakener scan, real-source coverage, packaged Firefox bench, MV2 build, and production manifest inspection.

## Security and AMO Considerations

No code or configuration is fetched remotely. The rescue schema cannot name arbitrary functions, paths, URLs, or source text. Player bodies remain inside Firefox's response filter and are not persisted or sent elsewhere. The implementation does not add permissions or origins. The MV3 capability artifact additionally declares `webRequestFilterResponse` so both manifest lanes expose the same response-pruning surface; MV3 is emitted as a capability artifact only and is not a distribution target (ADR-0006).

## Rollout and Rollback

Ad blocking defaults off (ADR-0018: explicit opt-in) but can be enabled immediately and independently. Global disable also makes it inert. A malformed or changed YouTube response passes through unchanged. Remote rescue-config remains deferred to post-S5.
