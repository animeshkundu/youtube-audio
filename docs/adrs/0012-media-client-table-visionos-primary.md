# ADR-0012: Media-client table with VISIONOS primary and ANDROID_VR fallback

## Status

Accepted. Supersedes the single-client wording of the "media-acquisition path" invariant in
`CLAUDE.md` and `AGENTS.md` (the invariant remains: acquisition is credentialless and goes through
`src/shared/innertube.ts`; the client is now a table, not one pinned persona).

## Date

2026-10-15

## Context

Since 1.0.0 the extension has pinned exactly one credentialless InnerTube client:
`ANDROID_VR 1.65.10`. ADR-0009 already flagged this as the biggest single risk, citing
`yt-dlp/yt-dlp#16150` (2026-03) on the persona eroding under regional A/B tests.

On 2026-08-17 the erosion became terminal: yt-dlp records that **all formats requested with
`ANDROID_VR 1.65.10` are 403'd** (commit `dae52d838` demoted the client; the comment still stands
in yt-dlp master's `_base.py`; issue `yt-dlp/yt-dlp#17456`), and the client was removed from the
default client set. VISIONOS `1.02` is the surviving JS-player-less client in yt-dlp's defaults,
with a stable direct-URL format list. Our own canary could not see any of this: the nightly job
had been failing at the probe step since at least 2026-07-11 while the workflow reported success
because `continue-on-error` masked it, and the probe only asserted a 3-second clock advance.

Two independent 2026 projects also moved to VISIONOS, and yt-dlp keeps the persona current. A
single pinned client is a single point of failure for the whole product; the fix is an ordered
table plus the evidence tools to re-audit it.

## Decision

1. Introduce an ordered, credentialless media-client table in `src/shared/innertube.ts`:
   **VISIONOS 1.02 primary, ANDROID_VR 1.65.10 fallback**, personas pinned to yt-dlp's definitions
   (including the `userAgent` field inside the client context).
2. Activation and download walk the table in order and accept the first response that is playable,
   not live, and (when audio-only is on) carries a direct audio URL. At most two HTTP attempts per
   client: the initial one, plus one retry carrying a fresh `visitorData` harvested from
   `responseContext.visitorData` when it differs from the value used.
3. Log exactly one bounded diagnostic per activation (`media.client`: `client`, `attempt`). No
   other client-identity data is recorded.
4. Add `tests/e2e/probe-live-client-audit.mjs` (per-client direct-URL yield plus a sustained ranged
   download, URLs never logged) and strengthen `probe-audio-playback.mjs`; unmask
   `live-canary.yml` job failures. The audit probe is a release-gate input.
5. ANDROID_VR is retained only as the ordered fallback and for probe comparison, not as a trusted
   primary.

## Consequences

- The "media-acquisition path" invariant in `CLAUDE.md` and `AGENTS.md` is rewritten to name the
  credentialless table (with this ADR) instead of `ANDROID_VR` specifically. SPEC-002 and SPEC-014
  carry the design and testing contract.
- Fail-open behavior is unchanged: a table with two failing clients degrades to native playback
  exactly as one failing client did, with the last bounded reason in the popup status.
- The table is versioned in-tree; changing personas or order requires this ADR to be amended, and
  the pinned values must be re-checked against yt-dlp master at release time.
- The canary work is part of the same change: a table without an unmasked, sustained-assertion
  canary would repeat the July-August blindness this ADR exists to end.

## Related

- ADR-0009 (ANDROID_VR video mode, deferred, risk section), SPEC-002, SPEC-004, SPEC-014,
  `docs/research/04-youtube-streaming-internals.md`, `src/shared/innertube.ts`,
  `tests/e2e/probe-live-client-audit.mjs`.
