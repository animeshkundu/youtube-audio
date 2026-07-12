# Handoff: Diagnostics and Issue Reporter

## Summary

Added a bounded, PII-free local diagnostic log shared across the background, content, and
main-world contexts, and a user-initiated issue reporter in the options page (with a
lightweight entry in the popup). The log captures feature outcomes, video properties (never
identity), the environment, the settings snapshot, and sanitized errors. The reporter shows
the exact report for review, copies it to the clipboard, and opens a bare GitHub new-issue
page. Nothing is ever transmitted automatically, upholding the manifest's
`data_collection_permissions.required: ['none']`. Specified in SPEC-011, decided in ADR-0005.

## Delivered

- `src/shared/logger.ts` (pure): the `LogCode` allowlist, per-code closed schema
  (enum/boundedInt/bool, plus one redacted+clamped error-stack field), `validateLogEvent`, a
  bounded `RingBuffer` (count + bytes + per-code caps, FIFO eviction, duplicate coalescing into
  a repeat count, never throws), a token-bucket `RateLimiter`, and a single-flight `Persister`.
- `src/shared/redact.ts` (pure): `redactText`, a targeted scrub for URLs, watch/short/embed/
  list/channel ids, emails, IPs, and extension UUIDs.
- `src/shared/report.ts` (pure): closed-schema environment and settings projection, coarse
  inter-event delta buckets (no absolute time), the assembled markdown, and the bare issue URL.
- `src/shared/diagnostics.ts` (browser glue): the background aggregator hub (single writer,
  hydrate-gated appends, single-flight debounced persistence, generation-safe clear), the
  page/content/options helpers, `safeLog`, `errorFields`, and rate-limited global uncaught-error
  and unhandled-rejection capture.
- Instrumentation: `playback.status`, `player.props`, `audio.graph`, `segment.armed`,
  `download.result`, `spa.rearm` (main-world); `sponsor.result`, `download.assembled`,
  `adblock.pruned` and telemetry/ad counters (background); coded errors with a sanitized stack
  across all three contexts.
- UI: `entrypoints/ui/IssueReporter.tsx` plus options/popup wiring and styles. Copy is awaited
  before GitHub opens; a failed clipboard blocks the open and offers manual copy.
- Docs: SPEC-011, ADR-0005, mkdocs nav; fixed a pre-existing prettier non-idempotency in
  `docs/design/audio-mode-artwork.md`.
- Tests: unit suites for the redactor, ring buffer, rate limiter, persister (deferred fake
  storage), report assembler, and the reporter component; a hermetic bench case and a matrix
  case that read the real persisted log and assembled report and assert env + outcomes present,
  the log actually persisted (non-vacuous), and the fixture video id and media URL absent.

## Validation

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run format:check`: clean.
- `npm test` (unit + coverage): 139 passed; coverage 97.7% stmts / 95.3% branch / 95.7% funcs /
  98.9% lines (the three pure modules are on the 90% allowlist).
- `npm run test:bench` (real Firefox, hermetic fixture): 32 passed, 0 failed. Diagnostics cases
  confirm env, `player.props`/`playback.status`/`audio.graph`/`spa.rearm`/`adblock.pruned`
  capture, non-empty persistence (7 stored events), and no PII in the report or the stored log.
- `npm run test:matrix`: 48 passed, 0 failed.
- Cross-lab peer review (plan and diff) addressed; the residual page-world covert-channel is
  documented in SPEC-011 Security Considerations.

## Follow-up

- Optional, owner-approved as a follow-up: a subtle, dismissible "report this?" affordance shown
  when an error is captured, deferred to avoid destabilizing the near-complete implementation.
  Filing must remain a user action; do not add any auto-send path.
- Owner decisions still open: the exact GitHub issue template/labels (currently `labels=bug` with
  a static title), and whether to keep the popup entry as a link into options (current) or embed
  a compact reporter there.
