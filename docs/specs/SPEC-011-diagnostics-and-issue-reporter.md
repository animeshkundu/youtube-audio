# Specification: Diagnostics and Issue Reporter

## Overview

Users need an easy, in-extension way to report a problem, and the developer needs to
know what the extension actually did when a report is filed. Today the extension keeps
no persistent local logs, so a bug report carries no signal. This feature adds two
things:

1. A bounded, structured, privacy-preserving **local diagnostic log** shared across the
   background, content, and page (main-world) contexts.
2. A **user-initiated issue reporter** in the options page (and a lightweight entry in
   the popup) that assembles the environment, the current settings snapshot, and recent
   diagnostic events into a human-readable report, shows it verbatim for review, lets the
   user copy it, and opens a prefilled-nothing GitHub "new issue" page.

The hard requirement is that the log and the report contain **no personally identifying
information** (no video IDs, no watch or signed-media URLs, no search queries, no page
content) while still carrying enough signal to debug the known failure modes (audio-only
eligibility fallback reasons, the credentialless `ANDROID_VR` fetch outcome, ad-block and
telemetry-block behaviour, segment-skip and download outcomes, loudness/EQ application,
SPA re-arm, and error classes).

Nothing is ever transmitted automatically. The only ways data leaves the browser are the
user explicitly copying the report to their clipboard and the user choosing to open and
submit a GitHub issue. This upholds the manifest's `data_collection_permissions.required:
['none']` declaration.

## Goals

- Give every context a cheap, fail-open way to record a coded diagnostic event.
- Keep the log bounded in both size and count so it can never grow without limit or
  capture an unbounded history.
- Guarantee, by construction, that no PII enters the log or the report: every stored
  field is a fixed enum, a bounded integer, or a boolean, validated at a trusted boundary.
- Make the reporter transparent: the user sees the exact text before anything leaves the
  browser, and no diagnostics are auto-attached to any network request.
- Work on Firefox desktop and Firefox for Android (the reporter lives in the options page,
  which both platforms expose).
- Keep MV2 shipping and MV3 buildable; degrade the aggregator correctly under a
  non-persistent background.

## Non-Goals

- No remote logging, crash reporting, analytics, or telemetry endpoint of any kind.
- No automatic or background transmission; no server owned by the project.
- No logged-in diagnostics (the extension never uses the user's Google login).
- No attempt to defeat a low-bandwidth covert channel that a script running inside a
  YouTube page could in principle build out of otherwise-valid events (see Security
  Considerations); the report is user-reviewed and user-initiated, which bounds impact.

## Technical Design

### Modules

Three pure, unit-tested modules under `src/shared/` hold the security-critical logic and
are added to the coverage allowlist:

- `logger.ts` — the `LogCode` allowlist, the per-code `LOG_SCHEMA`, the `enum` /
  `boundedInt` / `bool` validators, `validateLogEvent`, the bounded `RingBuffer`
  (count + serialized-byte + per-code caps, FIFO eviction, duplicate coalescing, never
  throws), a token-bucket `RateLimiter`, and an injectable single-flight `Persister`.
- `redact.ts` — `redactText`, a targeted defensive scrub for known PII shapes (URLs,
  watch/embed/short/list/channel/handle forms, emails, IP addresses, extension UUIDs, and
  digit-bearing 11-character id tokens). It is a safety net, not the primary guarantee.
- `report.ts` — `sanitizeEnvironment`, `sanitizeSettingsSnapshot`, `assembleReport`, and
  `buildIssueUrl`. Produces the exact markdown the UI previews and the JSON mirror.

A fourth module, `diagnostics.ts`, is the thin browser-API glue (message-type constants,
the background aggregator hub, and the page/content/options helpers). It depends on
`browser.*` and is exercised by the hermetic bench rather than unit tests, matching the
existing convention for `entrypoints/*` and `config.ts`.

### Event model

```
LogEvent  = { code: LogCode; data: LogData }            // on the wire
StoredEvent = { seq: number; ts: number; ctx: LogContext; code: LogCode; data: LogData }
LogContext = 'bg' | 'content' | 'page'
LogData    = Record<string, string | number | boolean>  // values constrained per code
```

`LogCode` is a fixed union: `playback.status`, `player.props`, `audio.graph`, `segment.armed`,
`download.result`, `spa.rearm`, `sponsor.result`, `download.assembled`, `adblock.pruned`,
`error`. Each code has a schema in `LOG_SCHEMA` naming its exact allowed keys, each bound
to one validator:

- `enum([...])` accepts only listed strings and coerces anything else to `'other'`.
- `boundedInt(min, max)` clamps to a small integer range.
- `bool` accepts only booleans.
- `sanitizedText(max)` is used for exactly one field, the captured error stack: it runs
  `redactText` (stripping URLs, ids, emails, IPs, and extension UUIDs) and clamps the length,
  so the stack carries a file-and-line trail with no PII and no unbounded string.

Apart from that one scrubbed stack there is no string passthrough, so no free text can be
stored. Error events are `{ where: enum(site), name: enum(errorName), stack: sanitizedText }`.
`player.props` records the behavior-determining video properties for reproduction, never the
identity: `live`, `music` (YouTube Music vs YouTube), `hasAudio`, `loudness` (a loudness value
was present), `playable`, and a coarse `duration` bucket (`lt1m`/`lt10m`/`lt1h`/`gte1h`). The
specific gate on a non-playable video (age check, login/members, kids) is carried by the
`playback.status` reason enum. Server-influenced values (the playability status, the fallback
reason) are allowlisted and coerced, so a value outside the known set becomes `'other'`.

`validateLogEvent(raw)` drops any event whose code is unknown, whose data has an unknown
key, or whose value cannot be validated. `ctx` is never read from the wire; the trusted
relay assigns it (content stamps `'page'` for forwarded main-world events and `'content'`
for its own, the background stamps `'bg'`). Uncaught errors and unhandled rejections are
captured by rate-limited global handlers in the background and content contexts (the
page/main-world context uses targeted `try/catch` capture so it never ingests the host
page's unrelated errors); every captured error carries the redacted stack.

### Data flow

```
main-world (page)  --yta:log CustomEvent(JSON string + bridge nonce)-->  content
content            --validate + rate-limit + coalesce------------------>  runtime.sendMessage
background hub     --validateLogEvent + append (assign seq, ts, ctx)---->  RingBuffer (+ debounced storage flush)
options / popup    --runtime.sendMessage('yta:diagnostics-report')----->  background returns { env, settings, events, stats, markdown }
```

- The background is the single aggregator, so there is no cross-context read-modify-write
  race. It owns the `RingBuffer`, two saturating integer counters (`telemetryBlocked`,
  `adPruned`) incremented in hot paths without creating per-event records, and the
  `Persister`.
- On append the hub assigns a monotonic `seq` and an internal absolute `ts` (never
  exported) and pushes through the buffer's caps and coalescing.
- Persistence is best-effort and single-flight: appends schedule a debounced flush of
  `{ events, stats, seq }` to `browser.storage.local` under key `diagnostics`; writes are
  serialized on one promise chain so two `storage.set` calls never overlap. On start the
  hub hydrates from storage behind a shared `ready` promise that gates every mutation, so
  a log arriving during hydration is applied after the hydrated state is installed.
  "Clear logs" advances a generation counter and enqueues an independent empty write on
  the same chain, so an in-flight flush cannot resurrect cleared data.

### Timestamps

Ordering uses the monotonic `seq`. The internal absolute `ts` is used only to compute
inter-event spacing and is never exported. `assembleReport` renders spacing as a coarse
non-negative bucket (`<1s`, `1-5s`, `5-30s`, `30s-5m`, `>5m`) relative to the previous
retained event, clamped so a backward clock change cannot produce a negative value. The
report contains no absolute timestamp and no submission-time anchor, and there is no
wall-clock retention TTL (which would purge exactly the sleep/wake window and is unsound
across clock syncs); the count, byte, and per-code caps keep the window inherently recent.

### Environment and settings snapshot

`sanitizeEnvironment` canonicalizes to a closed schema: `extensionVersion` (validated
version string), `browser` (`Firefox` or `other`), `browserVersion` (major.minor only),
`os` (enum incl. `android`), `manifestVersion` (2 or 3). Architecture is dropped. The
browser version is retained because this product's breakage is frequently
Firefox-version-specific; it is shared by millions of users and is not identifying.
`sanitizeSettingsSnapshot` projects only the known settings keys to booleans, the quality
enum, and the bounded EQ band numbers.

### Delivery UI

A new "Help and feedback" section in the options page loads the assembled report on mount
(through an injectable action, defaulting to the `yta:diagnostics-report` message, matching
the existing `OptionsActions` dependency-injection pattern used by the unit tests). It
shows the report verbatim in a read-only text area and offers:

- **Copy diagnostics** — `await navigator.clipboard.writeText(markdown)`.
- **Open a GitHub issue** — copies first; only if the copy resolves does it open
  `https://github.com/animeshkundu/youtube-audio/issues/new?labels=bug` (a bare URL with a
  static generic title, no body, no environment, no diagnostics in the query string). If
  the copy fails or the clipboard is unavailable (possible on Firefox Android), it does not
  open the tab; it shows an inline error and leaves the full report selected for manual
  copy.
- **Clear logs** — clears the buffer and storage.

The popup gets a single lightweight "Report an issue" affordance that calls
`browser.runtime.openOptionsPage()`; the full reporter lives only in the options page so it
is identical on desktop and Android.

## Error Handling

Every instrumentation call site is wrapped in `safeLog`, which swallows both synchronous
throws and asynchronous rejections (serialization, dispatch, `sendMessage`, storage) and is
always fire-and-forget, never awaited on a control-flow path. A logging failure can never
alter playback or page behaviour. `RingBuffer.push` never throws and drops any single event
whose serialized size exceeds the per-event cap rather than leaving the buffer over its byte
cap. The reporter surfaces load, copy, and clear failures inline without blocking the page.

## Testing Strategy

- Unit (Vitest over real `src/`): `redact.ts` fed known PII (a signed googlevideo URL with
  itag/expire/ip/signature params, a `watch?v=` URL, bare digit-bearing ids, an IP, an
  email) asserting none survive and that enum-shaped strings such as `LOGIN_REQUIRED` are
  preserved; `logger.ts` for the count/byte/per-code caps, FIFO eviction order, duplicate
  coalescing, push-never-throws, schema validation (unknown code, unknown key, out-of-range
  coercion to `'other'`, forged-secret string coerced away), the rate limiter, and the
  persister's single-flight ordering and generation-barrier clear using a deferred fake
  storage backend; `report.ts` for structure, absence of PII and absolute time, settings and
  environment canonicalization, and the bare issue URL. The three pure modules meet the 90%
  coverage bar.
- Options reporter component test (jsdom): renders the preview, verifies Copy calls the
  clipboard with the report, verifies Clear calls its action, and verifies a failed copy
  does not open GitHub.
- Bench and matrix (real Firefox, hermetic 127.0.0.1 fixture): drive a fixture watch session
  so activation and outcomes occur, then open the real options page and read both the
  persisted `browser.storage.local` artifact and the real `yta:diagnostics-report` message
  result. Assert the report carries the environment and at least one outcome event, and that
  the fixture video id `FIXTURE0001` and the `/videoplayback?itag=` media-URL shape are
  absent from the serialized payload.

## Security Considerations

- **PII by construction.** Every value is a fixed enum, bounded integer, or boolean, validated
  at the trusted background boundary, with `ctx` assigned by the relay. The one exception is the
  captured error stack, which passes through `redactText` (URLs, ids, emails, IPs, extension
  UUIDs stripped) and is length-clamped by the schema, so it retains a file-and-line trail
  without PII. The `player.props` event records reproduction-relevant video properties
  (live, music, has-audio, loudness-present, playable, coarse duration) and never the video
  identity. The environment and settings snapshot are likewise closed-schema. `redact.ts` is an
  additional net over event detail and is independently tested.
- **No automatic transmission.** There is no network egress in the feature. The report
  travels only by the user's explicit clipboard copy and the user's own decision to open and
  submit a GitHub issue. The GitHub URL carries no environment or diagnostics.
- **Forgeable page bridge (residual, disclosed).** The `yta:log` bridge lives only on the
  four YouTube hosts, and a script running inside a YouTube page can read the per-load nonce
  and emit schema-valid events. Because values are enum-only, it cannot inject a string, but
  it could in principle encode low-bandwidth data in the choice, order, or coarse timing of
  valid events. This is mitigated by content-side rate limiting, duplicate coalescing,
  per-code caps that bound channel capacity, and coarse timing buckets, and is bounded in
  impact because the report is user-reviewed and user-initiated and the only realistic
  page-side adversary (YouTube) already has the user's identity server-side. The guarantee is
  therefore stated precisely as "no direct PII and no unbounded identifiers", not as
  immunity to a deliberately constructed covert channel.
- **Bounded footprint.** Count, byte, and per-code caps bound memory and storage; the
  persister is single-flight and debounced; hot paths use counters, not per-event records.

## Rollout and Rollback

The feature is additive and off no user setting; the log simply begins accumulating in the
background and the reporter appears in the options page. It ships in MV2 (persistent
background, robust). Under MV3 the aggregator degrades to best-effort persistence because a
service worker's debounced timer may not survive suspension; MV3 is a parity capability
artifact and not shipped, so this is acceptable and documented in ADR-0005. Rollback is
removal of the options section and the instrumentation calls; no storage migration is needed
because the `diagnostics` key is self-bounding and ignored when the feature is absent.
