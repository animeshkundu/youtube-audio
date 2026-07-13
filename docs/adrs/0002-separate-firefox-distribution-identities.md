# ADR-0002: Separate Firefox Distribution Identities

> **Superseded by ADR-0006 (partial).** The owner has since consolidated to a **single**
> permanent add-on ID (`youtube-audio@animesh.kundus.in`) with AMO-listed production plus an
> unlisted beta channel on the same ID. The two-identity decision below no longer holds; see
> [`0006-firefox-amo-distribution-and-beta-channel.md`](./0006-firefox-amo-distribution-and-beta-channel.md).
> The channel semantics this ADR documents (listed vs unlisted, listed omits `update_url`)
> remain accurate.

## Status

**Superseded (partial) by ADR-0006.** Originally Accepted.

## Date

2026-07-11

## Context

YouTube Audio needs self-hosted desktop updates and hands-off Android updates. Firefox desktop supports unlisted signed XPIs that update through `browser_specific_settings.gecko.update_url`. Firefox for Android automatically updates only AMO-installed listed extensions. AMO submission does not permit one add-on identity to combine a listed channel with a self-hosted update URL.

### Problem Statement

Provide both distribution experiences without making the default build ineligible for an AMO listing or suggesting that Android supports self-hosted auto-update.

### Constraints

- Every release/beta Firefox artifact must be Mozilla-signed.
- Android hands-off updates require an AMO listing and review.
- Self-hosted desktop updates require a stable Gecko ID and HTTPS `update_url`.
- Add-on IDs are permanent installed identities and cannot safely move between channels.
- Production content matches must remain the four YouTube patterns.

## Decision

Maintain two distribution identities from one source tree:

1. An unlisted, self-hosted desktop channel built with a permanent channel ID and `SELF_HOSTED_UPDATE_URL`.
2. An AMO-listed Android channel built with a different permanent ID and no `update_url`.

Default builds omit `update_url`; only an explicit build-time environment variable inserts it. The tag workflow signs and publishes the unlisted self-hosted channel. AMO listing submission and review remain human-gated.

### Considered Options

1. **One ID with both `update_url` and AMO listing**
   - Pros: one installed identity.
   - Cons: incompatible submission/distribution semantics; cannot satisfy both channels.
2. **AMO listing only**
   - Pros: one identity and automatic updates on desktop and Android.
   - Cons: removes the requested independent self-hosted desktop channel.
3. **Two IDs and opt-in `update_url`**
   - Pros: supports both paths honestly and keeps default artifacts listing-compatible.
   - Cons: users cannot migrate between channels without installing a distinct add-on identity.

### Chosen Option

Option 3. Channel separation is explicit, technically valid, and prevents an accidental `update_url` from blocking the Android listing.

## Consequences

### Positive

- Desktop can use signed self-hosted XPI updates.
- Android can receive hands-off AMO updates after listing approval.
- Default builds remain eligible for AMO submission.
- One source tree and validation pipeline serve both channels.

### Negative

- Two permanent IDs and release records must be maintained.
- A user switching channels installs a separate add-on identity.
- AMO listing metadata, policy review, and real-device validation remain manual gates.

### Neutral

- `strict_min_version` remains `128.0` due to the March 2025 signing-root transition.
- Unlisted file-installed Android copies remain manually updatable only.

## Related ADRs

- `0001-wxt-typescript-preact-foundation.md`

## References

- `docs/specs/SPEC-010-m7-release-infrastructure.md`
- `docs/research/07-distribution-signing-updates.md`
- `RELEASE.md`
