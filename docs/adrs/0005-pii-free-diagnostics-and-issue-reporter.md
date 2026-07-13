# ADR-0005: PII-free local diagnostics and a serverless issue reporter

## Status

**Accepted.** Implements the diagnostics and issue-reporter feature specified in
SPEC-011.

## Date

2026-07-11

## Context

The extension kept no persistent local logs, so a user bug report carried no signal about
what the extension actually did. The most common failure mode (audio-only reverting to
native playback because the credentialless media path is non-playable) is invisible after
the fact. We want to let users report an issue with enough diagnostic context to debug,
without weakening the project's two hard commitments:

- **Privacy-first.** The extension never uses the user's Google login and touches sensitive
  identifiers (video IDs, watch and signed-media URLs, search queries) throughout normal
  operation. A diagnostic log must not capture any of them.
- **AMO `data_collection_permissions.required: ['none']`.** The manifest declares that the
  extension collects nothing, so there can be no automatic or background transmission of any
  diagnostics.

Two decisions needed a record: how the log guarantees it holds no PII, and how a report
reaches the developer without a server we own and without auto-transmission.

## Decision

### 1. The log is PII-free by construction, not by scrubbing

Every diagnostic event is a fixed `LogCode` with a per-code schema whose values are only
enums, bounded integers, or booleans, with a single deliberate exception: the captured error
stack passes through `redactText` (URLs, ids, emails, IPs, extension UUIDs stripped) and is
length-clamped, so it keeps a file-and-line trail without PII. Error events carry an error-class
enum, a coded call-site, and that redacted stack, never an unbounded message. Reproduction is
captured by properties, not identity: a `player.props` event records whether the video was live,
on YouTube Music, had an audio track, carried a loudness value, was playable, and a coarse
duration bucket, so the developer can reproduce "a live video" or "an age-gated video" (the gate
type is carried by the playability reason enum) without ever seeing which video. Values are
validated and coerced at the trusted background boundary, and the context tag is assigned by the
relay rather than read from the wire. The environment and the settings snapshot are canonicalized
to the same closed-schema discipline. A targeted `redactText` scrub also runs over event detail
as a defensive net and is independently tested, but it is not the primary guarantee.

We considered relying on redaction of richer free-text logs. Cross-lab review showed that
regex redaction cannot reliably neutralize arbitrary strings (usernames, paths, DOM text,
search terms) and would also mangle our own enum values. The closed schema removes the
class of leak instead of chasing it.

We explicitly accept and document one residual: the page-world bridge is forgeable by a
script inside a YouTube page, which could encode low-bandwidth data in the choice or timing
of otherwise-valid events. Enum-only values prevent direct string injection; rate limiting,
duplicate coalescing, per-code caps, and coarse timing bound the channel; and the report is
user-reviewed and user-initiated. We therefore claim "no direct PII and no unbounded
identifiers", not immunity to a deliberately constructed covert channel.

### 2. The log is bounded by size and count, with no wall-clock TTL

The ring buffer is bounded by event count, total serialized bytes, and a per-code cap, with
FIFO eviction. We rejected a wall-clock retention TTL: on a client, an OS sleep/wake or NTP
sync would purge exactly the sleep/wake window (where bugs cluster) and could produce
negative ages. Ordering uses a monotonic sequence number; the report exports only coarse,
non-negative, relative spacing buckets and never an absolute timestamp or a submission-time
anchor.

### 3. Delivery is serverless, user-initiated, and transparent

The reporter assembles the report locally, shows it verbatim for review, and offers copy to
clipboard and open a GitHub issue. The GitHub URL is bare
(`issues/new?labels=bug`) with no body, environment, or diagnostics in the query string, so
nothing is auto-sent; the diagnostics travel only by the user's explicit copy, paste, and
submit. Copy is awaited before the tab opens, and a failed or unavailable clipboard (as on
Firefox Android) blocks the open and falls back to manual selection, so the user is never
told the report was copied when it was not.

We considered a prefilled issue body and a `mailto:` link. The prefilled body would send the
environment to GitHub in a GET request before the user submits and diverges from the
reviewed text; `mailto:` exposes the user's email client and is unreliable. Copy plus a bare
issue URL is the most transparent option that needs no server.

## Consequences

### Positive

- Reports carry actionable signal (fallback reasons, fetch outcomes, feature application,
  error classes, environment) with a defensible no-PII guarantee.
- No new permissions, no network egress, and the AMO `none` declaration stays honest.
- The pure logger, redactor, and report modules are fully unit-testable, and the end-to-end
  path is checked on real Firefox by the hermetic bench.

### Negative

- Enum-only events cannot record novel, unforeseen error detail; adding signal means adding
  a code and schema entry deliberately.
- A theoretical low-bandwidth covert channel remains, accepted and disclosed above.

### Neutral

- The background is the single aggregator. Under MV2 (the shipped target) it is a persistent
  background page, so persistence is robust. Under MV3 the aggregator degrades to best-effort
  because a service worker's debounced flush may not survive suspension; MV3 is a parity
  capability artifact and not shipped.

## Related ADRs

- ADR-0003 AMO distribution preflight (the `data_collection_permissions` declaration this
  feature must not violate).

## References

- SPEC-011 Diagnostics and Issue Reporter.
