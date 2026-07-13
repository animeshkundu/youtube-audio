# ADR-0006: AMO-listed distribution under a single ID, with an unlisted beta channel

## Status

**Accepted.** Production ships from a **single permanent add-on ID
`youtube-audio@animesh.kundus.in`** on the AMO **listed** channel, with AMO as the sole
update authority for Firefox desktop and Firefox for Android. A pre-release **beta** channel
uses the **same ID** signed **unlisted** at a distinct pre-release version, installed by hand
for desktop and Android testing. Publishing to AMO is **on demand** (a manual run after
hands-on testing), never automatic on a tag. This **supersedes ADR-0002** (which chose two
separate identities) and **refines ADR-0004** (Firefox-only CD): the target and browsers are
unchanged, but production distribution and update authority move from the self-hosted
`updates.json` path to the AMO listing.

## Date

2026-07-12

## Why an ADR

Distribution decisions with lasting, hard-to-reverse consequences live in `docs/adrs/`. An
installed add-on ID is a permanent identity, and choosing the AMO listed channel over the
self-hosted path changes who controls updates. That is exactly the kind of decision this
series records, and it amends two prior distribution ADRs, so it needs its own entry.

## Context

The owner created AMO Developer Hub API credentials (a JWT issuer and secret, stored as the
GitHub repo secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`) and decided that production should
be an **AMO listing**, because the listed channel is the only path to hands-off auto-update on
**Firefox for Android** (the platform the product targets) and it removes the need to host and
serve `updates.json` ourselves. A separate way to hand testers a pre-release build, on both
desktop and Android, is still wanted before any public promotion.

### Problem Statement

Ship production through AMO under one durable identity with hands-off desktop and Android
updates, keep a pre-release test build for both platforms, and never publish to AMO
automatically, without maintaining two permanent add-on identities.

### Constraints

- **Firefox has no alpha/beta/prod tracks.** AMO exposes exactly two channels, `listed` and
  `unlisted`; there is no pre-release channel and no percentage-based staged rollout
  (`docs/research/19-amo-channels-and-ondemand-publish.md`, executive summary point 1). "Beta"
  on Firefox is a self-distributed, version-driven concept, not an AMO feature.
- A **listed** version must **omit** `browser_specific_settings.gecko.update_url`; AMO manages
  updates for listed copies.
- Every release/beta Firefox artifact must be Mozilla-signed; both channels sign through AMO.
- An installed add-on ID is permanent and cannot safely move between installs later.
- AMO scopes "already signed" **per add-on ID**, so under one shared ID the beta build must
  carry a version distinct from any listed version (research 19, section 3).
- Firefox for Android does **not** auto-update a file-installed unlisted XPI; only an AMO
  listing gives hands-off Android updates (`docs/research/07-distribution-signing-updates.md`).
- Production content matches remain the four YouTube patterns.

## Decision

1. **One permanent add-on ID for every channel: `youtube-audio@animesh.kundus.in`.** The
   two-identity split of ADR-0002 is dropped.
2. **Production is the AMO `listed` channel.** The listed build carries **no** `update_url`;
   **AMO is the sole update authority**, delivering hands-off auto-update on Firefox desktop
   and Firefox for Android.
3. **Beta is the AMO `unlisted` channel under the same ID, at a distinct pre-release version.**
   It is a Mozilla-signed XPI installed by hand for desktop and Android testing. Because the ID
   is shared, the beta version is always ahead of the last listed version so its bytes never
   collide with a listed submission. A file-installed unlisted build does not auto-update on
   Android, so testers reinstall the next signed beta; there is **no self-hosted `update_url`
   in production**.
4. **Publishing to AMO is on demand.** A manual `workflow_dispatch` run (after hands-on
   testing) signs and submits the chosen tag with `web-ext sign --channel=listed`. No `push`,
   tag, `release`, or `schedule` trigger can publish to AMO. The human test-and-promote gate is
   the "staging" that AMO's missing rollout feature does not provide.
5. **The source-code archive uploaded with a listed submission is a review artifact, not a
   user download.** AMO reviewers need the un-minified sources plus a pinned toolchain to
   rebuild and diff the bundled build; users only ever install the AMO-signed XPI.

### Considered Options

1. **Two separate identities (ADR-0002 / uBlock "Dev Build" pattern; research 19 shape b).**
   - Pros: beta and prod are different add-ons, so the same version string can be signed for
     both with no conflict; a public beta could get its own AMO listing.
   - Cons: two permanent identities to steward, two AMO surfaces, and a channel switch orphans
     a user's installed add-on. More machinery than the owner wants.
2. **Single ID, listed production plus unlisted beta by version (research 19 shape a).**
   - Pros: one identity and one listing to maintain; AMO gives hands-off desktop and Android
     updates; a pre-release build needs no second listing and no self-hosted update endpoint.
   - Cons: the beta must always be version-bumped ahead of production; an `update_url`-bearing
     build must never be submitted to the listed channel (AMO rejects it), so the build flag
     that inserts `update_url` must stay off for listed.
3. **AMO listed only, no beta channel.**
   - Pros: the simplest possible model.
   - Cons: no pre-release test build on desktop or Android before a public listed release.
     Rejected: hands-on testing of the exact signed bytes is required before promotion.

### Chosen Option

Option 2. One identity is the least operational surface that still delivers hands-off Android
auto-update (the whole point of going listed) and a real pre-release test build on both
platforms. The version-bump discipline and the "no `update_url` on listed" rule are cheap,
well-understood guardrails; the on-demand manual publish makes promotion an explicit human act.

## Consequences

### Positive

- One durable identity and one AMO listing to steward.
- Hands-off auto-update on Firefox desktop **and** Firefox for Android, AMO-managed, with no
  self-hosted `updates.json` endpoint to serve or keep in sync.
- The exact signed bytes are testable as an unlisted beta before the same version line is
  promoted to the listed channel.
- Publishing can never fire on its own; a tag push never touches AMO.

### Negative

- The beta version must always lead production; a mistaken `update_url` on a listed build would
  be rejected by AMO, so the listed build path must keep that flag off.
- A single ID means beta and production share one add-on entry; testers cannot run both
  side by side under different IDs (the two-ID model's one advantage, now given up).
- First listed submission still requires AMO metadata and the source-code archive, and remains
  owner-gated on AMO policy review and a real-device Android test.

### Neutral

- `strict_min_version` stays `128.0` (the March 2025 signing-root transition).
- The self-hosted desktop path built for ADR-0004 (a `SELF_HOSTED_UPDATE_URL` build flag and a
  `releases/latest/download/updates.json` redirect) is retired for production; the flag may
  still drive a desktop-only beta self-update if ever wanted, but it never applies to the
  listed build.
- The Firefox-only, MV2 scope of ADR-0004 is unchanged; only the production channel and update
  authority change.

## Related ADRs

- Supersedes (in part) `0002-separate-firefox-distribution-identities.md` (two identities to one).
- Refines `0004-multi-browser-cd.md` (Firefox-only CD retained; production moves to AMO listed).
- Builds on `0003-amo-distribution-preflight.md` (listed policy preflight, source submission).

## References

- `docs/research/19-amo-channels-and-ondemand-publish.md` (Firefox has only `listed` vs
  `unlisted`; no alpha/beta/prod tracks or staged rollout; single-ID shape (a); on-demand
  publish design).
- `docs/research/07-distribution-signing-updates.md` (signing mandatory; Android auto-update
  requires an AMO listing).
- `.github/workflows/release.yml`, `scripts/release.sh`, `wxt.config.ts`, `RELEASE.md`.
