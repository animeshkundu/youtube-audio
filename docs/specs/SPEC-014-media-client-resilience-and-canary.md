# Specification: M8 Media-Client Resilience and Live Canary

## Overview

Hardens the credentialless media-acquisition path against a single client persona going dark, and
makes the live canary able to say so. The pinned `ANDROID_VR 1.65.10` persona became unreliable on
YouTube's side on 2026-08-17 (yt-dlp removed it from its defaults; commit `dae52d838`, issue
`yt-dlp/yt-dlp#17456`). This milestone replaces the single pinned client with a small, ordered,
credentialless client table, adds one bounded fresh-`visitorData` retry per client, and turns the
nightly canary from a masked 3-second smoke check into a sustained-playback assertion backed by a
per-client audit probe.

## Goals

- Acquire a playable, hijackable player response through the first client in the ordered table that
  yields one: **VISIONOS 1.02 primary, ANDROID_VR 1.65.10 fallback** (ADR-0012).
- Keep every hard invariant: `credentials: "omit"` on every request, fail open to native playback,
  `PlayerHandle` as the sole `<video>.src` writer, bounded bridge statuses, no new permissions.
- Bound the work: at most two HTTP attempts per client (initial plus one fresh-visitorData retry),
  at most two clients, one player response consumed per activation.
- Make the live canary trustworthy: no more masked job failures; per-VOD assertions for sustained
  playback, buffered-ahead margin, and seek-to-80% resume; a per-client audit probe for
  direct-URL yield and a sustained ranged download without logging signed URLs.
- Log a single bounded diagnostic (`media.client`) recording which client served the response and
  how many attempts it took.

## Non-Goals

- No PO-token, JS-player, or session-bound client work. No logged-in paths.
- No automatic retry loops beyond the bounded retry above; no background polling of clients.
- No remote configuration: the table ships in the build.
- No Android `downloads`-adjacent permission changes (tracked separately).

## Technical Design

### Client table (`src/shared/innertube.ts`)

`MEDIA_CLIENTS` is the ordered attempt table:

| Order | id           | Persona fields                                                                                                                                                                                                      |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `visionos`   | `clientName: 'VISIONOS'`, `clientVersion: '1.02'`, `deviceMake: 'Apple'`, `deviceModel: 'RealityDevice17,1'`, `osName: 'visionOS'`, `osVersion: '26.5.23O471'`, yt-dlp's `userAgent` string, `hl: 'en'`, `gl: 'US'` |
| 2     | `android-vr` | The existing `ANDROID_VR 1.65.10` persona (Oculus Quest 3, Android 12L, `androidSdkVersion: 32`, its VR app `userAgent`)                                                                                            |

Personas are pinned to yt-dlp's client definitions as of 2026-10-15, including the `userAgent`
field that lives **inside** the InnerTube client context. `buildPlayerRequest(persona, videoId,
visitorData?)` is the single body builder; `buildAndroidVrPlayerRequest` remains as a thin
compatibility wrapper (probes and legacy tests).

### Bounded retry signal

`extractVisitorData(playerResponse)` reads `responseContext.visitorData`; `retryVisitorData(
playerResponse, used)` returns it only when it is present and different from the value the attempt
used. That is the entire retry policy: one fresh-visitorData retry per client, then move to the
next client, then fail open. No response body is stored beyond the activation.

`walkMediaClients(deps)` (same module) is the whole table walk as a pure function: the ordered
`MEDIA_CLIENTS` loop, the two-attempt cap, the fresh-token retry, the live-terminal rule, and the
allowlist-gated acceptance. Page-world specifics are injected: `fetchPlayer`, `isAllowedUrl`,
`pageVisitorData`, and `isStale`. Keeping the loop pure is what makes the cap unit-testable.

### Walk call sites (`entrypoints/main-world.ts`)

`fetchPlayerResponse(videoId, apiKey, requireDirectAudio, isStale)` is now a thin page-world
adapter: it owns the endpoint, the credentialless POST, the ytcfg `VISITOR_DATA`, and the
bench-aware URL allowlist, and delegates to `walkMediaClients`. It returns:

- `ok`: playable, not live, and (when audio-only is on) carrying an allowlisted direct audio URL;
- `live`: playable live response (liveness is a property of the broadcast, so rotation stops);
- `failed`: no client produced an acceptable response; carries the last reason plus the last
  parsed and last playable responses, if any, so diagnostics can log the bounded player props and
  loudness/EQ can still arm on the native fallback before the `fallback` status is emitted
  (preserving pre-rotation behavior);
- `stale`: the activation was superseded by SPA navigation; nothing is consumed.

The download path (`yta:download-request`) uses the same walk with `preferCompatible` selection so
a download succeeds through the fallback client when the primary cannot serve one.

Acceptance logs exactly one `media.client` event: `{ client: 'visionos' | 'android-vr', attempt:
1..8 }`. No other client-identity data is logged.

### Canary truth

- `tests/e2e/probe-audio-playback.mjs` (the probe `live-canary.yml` actually runs) gains, per VOD
  case: sustained progress sampling over `PROBE_SUSTAIN_MS` (default 45 s; release runs use 90 s),
  a buffered-ahead margin, and a seek to 80% of duration that must resume advancing. Live cases
  keep the graceful-fallback assertion.
- `tests/e2e/probe-live-client-audit.mjs` (new, Node-only, no browser): for each persona, POST the
  credentialless player request with the page's own `INNERTUBE_API_KEY` and `VISITOR_DATA`
  (extracted from watch-page HTML; env overrides available), then ranged-download the best audio
  URL up to 8 MiB or the declared `contentLength`, reporting HTTP status, bytes, and a clean/error
  verdict. Signed URLs are never printed.
- `.github/workflows/live-canary.yml` drops `continue-on-error`, so a red probe is a red run
  (still not a required check), and uploads the probe log as an artifact plus a step summary.

## Error Handling

- Every fetch, parse, and download step is individually caught; any failure moves to the next
  attempt, then the next client, then emits the existing bounded `fallback` status with a reason.
- A superseded generation aborts the walk without consuming or emitting.
- The request handlers remain fail-open: a storage or settings failure cannot block the walk.

## Testing Strategy

- Unit (`tests/unit/innertube.test.ts`): table order and persona pinning; `buildPlayerRequest`
  bodies for both personas (userAgent inside the client context); compatibility wrapper
  equivalence; `extractVisitorData`/`retryVisitorData` bounds (fresh-only, never the same value);
  and the full `walkMediaClients` policy against a scripted transport: primary accepted on the
  first attempt, one fresh-token retry and its acceptance, the two-attempt-per-client cap (a fifth
  request is impossible because the fake transport throws), no retry with an already-used token,
  live terminal for the whole table, allowlist rejection continuing the walk, transport/HTTP
  failure continuing the walk, and the `stale` abort.
- Hermetic bench (`tests/e2e/bench/`): `m8:client-rotation-falls-back-to-second-client` serves a
  `ROTATE*` video id whose fixture response is `LOGIN_REQUIRED` for VISIONOS and `OK` for
  ANDROID_VR, and asserts the session reaches `active` with a `/videoplayback` source and that the
  first ANDROID_VR request was immediately preceded by a VISIONOS request. The assertion is
  order-based, not an exact global count, because a duplicate activation generation (a
  settings/visibility-driven re-arm) may interleave an extra aborted attempt; with the table
  collapsed to one client the case still deterministically fails. A second case
  (`m8:visitorData-retry-is-bounded-and-effective`) uses a `VISITOR*` id: the fixture rejects any
  attempt without the token it handed back and accepts the retried one, so reaching `active` proves
  the retry happened with the fresh token.
- Live canary: strengthened `probe-audio-playback.mjs` and the per-client audit probe, both
  non-gating; the audit probe is run locally before any release decision (ADR-0012). Its persona
  table is pinned to `MEDIA_CLIENTS` by `tests/unit/probe-personas-sync.test.mjs`. The canary
  distinguishes a datacenter-IP bot wall (or a publisher-side unavailable fixture) from a real
  regression: those cases are reported as environment-blocked, so the verdict is `INCONCLUSIVE`
  (exit 0 with a warning annotation) when nothing was measurable, `PASS (partial)` when some cases
  measured and passed, and `FAIL` only when a case that reached YouTube media misbehaved. The
  residential runbook remains the authoritative live evidence.
- The pre-existing unit suite pins fail-open behavior for malformed responses and live streams.

## Security Considerations

- Both personas are credentialless; no cookies, no login state, no page data beyond the video id,
  the API key, and the page-owned visitorData.
- Signed media URLs and player responses never cross the world boundary (unchanged).
- The audit probe prints only bounded statuses, counts, and byte totals; never URLs.

## Rollout and Rollback

The table ships with the release. If VISIONOS regresses, ANDROID_VR remains as the ordered fallback
during the same session; if both fail, the extension falls open to native playback exactly as
before. The audit probe re-run is a release-gate input, and any future table change follows
ADR-0012's amendment path.
