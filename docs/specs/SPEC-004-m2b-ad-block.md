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

The persistent MV2 background registers `webRequest.onBeforeRequest` for the existing YouTube patterns and, in bench builds, local fixture hosts. For matching POST responses it opens `filterResponseData`, copies and buffers every byte, then writes either the pruned UTF-8 JSON or the original bytes. The filter is inert unless global protection and ad blocking are enabled. All failure paths attempt to write the original byte sequence and close the filter.

### Bundled baseline and scriptlets

`src/shared/rescue.ts` exposes a frozen, versioned baseline containing only allowlisted operation IDs and bounded primitive arguments. `loadRescueConfig` returns this bundled baseline without network access. Remote loading, signature verification, expiry, and anti-rollback remain intentionally deferred until after the S5 AMO policy preflight.

`src/shared/scriptlets.ts` dispatches only known operation IDs. The baseline installs a reversible `ytInitialPlayerResponse` accessor before page scripts run, prunes any already-present response, and wraps `JSON.parse` so parsed player responses containing known ad descriptors are pruned in place. The wrapper inspects only parsed objects with `streamingData` or `playabilityStatus`, returns all non-player values untouched, and catches inspection failures without changing native parse behavior. The baseline also performs conservative operations against already-present page globals: neutralizing an exposed abnormality callback and setting an already-present inline-playback ad flag. Missing or incompatible targets are no-ops. Each operation catches its own failures and returns cleanup behavior.

Before applying operations, the engine checks whether `JSON.parse` or `JSON.stringify` appears non-native. This is a best-effort coexistence heuristic for page-context blocker hooks. It can have false positives and false negatives because extensions may hide wrappers or inject by other means; response pruning remains independent and fail-open.

### Settings and UI

`adBlockEnabled` defaults to `true`, is normalized for older stored settings, and has a dedicated signal and setter. Content forwards the boolean in the existing nonce-protected settings message. MAIN world applies or removes the bundled scriptlet baseline when settings change. Popup and options expose instant-apply controls.

## Error Handling

Every boundary fails open. The background retains original bytes before parsing and writes them unchanged if pruning cannot complete. Scriptlet operations never throw into page code and cleanup restores prior values only when the operation still owns the value it installed. Unknown operations are ignored.

## Testing Strategy

- Unit tests import the real pruner and cover all target fields at multiple depths, arrays, preservation of streaming/video/unknown data, malformed JSON, primitive JSON, and non-mutation of the input string.
- The packaged-extension bench fetches the fixture player response from page context and asserts ad descriptors are absent with default settings and present when ad blocking is disabled.
- Release gates: strict typecheck, zero-warning lint, gate-weakener scan, real-source coverage, packaged Firefox bench, MV2 build, and production manifest inspection.

## Security and AMO Considerations

No code or configuration is fetched remotely. The rescue schema cannot name arbitrary functions, paths, URLs, or source text. Player bodies remain inside Firefox's response filter and are not persisted or sent elsewhere. The implementation does not add permissions or origins.

## Rollout and Rollback

Ad blocking defaults on but can be disabled immediately and independently. Global disable also makes it inert. A malformed or changed YouTube response passes through unchanged. Remote rescue-config remains deferred to post-S5.
