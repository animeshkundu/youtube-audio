# Specification: M7 Release Infrastructure

> **Amended by ADR-0006 (2026-07-12).** The two-identity, self-hosted-desktop distribution
> model below is superseded: production now ships from a single add-on ID
> (`youtube-audio@animesh.kundus.in`) on the AMO **listed** channel with AMO as the sole update
> authority, plus an unlisted beta on the same ID; the self-hosted `updates.json` path is
> retired for production. The tag-triggered `release.yml` was replaced by `beta.yml` (unlisted
> pre-release signing) and `publish-amo.yml` (manual, listed on-demand publishing). The
> build/signing mechanics this spec documents remain accurate; only the channel, identity, and
> update-authority decisions changed. See
> [`../adrs/0006-firefox-amo-distribution-and-beta-channel.md`](../adrs/0006-firefox-amo-distribution-and-beta-channel.md).

## Overview

M7 adds reproducible Firefox release validation, Mozilla unlisted signing, GitHub Release publishing, and documented desktop/Android distribution paths without changing extension features or default manifest behavior.

## Goals

- Build and validate Firefox MV2 and MV3 from the same source on every push and pull request.
- Sign the Firefox MV2 artifact through AMO's API with credentials supplied only at runtime.
- Publish a signed unlisted beta XPI to a GitHub prerelease from a pre-release version tag.
- Keep every build AMO-listing-compatible by omitting `update_url`, and publish the clean listed version to AMO on demand under the single permanent ID.
- Document the AMO-listed desktop/Android path and all remaining human gates.

## Non-Goals

- No product behavior, setting, permission, host-match, or content-match changes.
- No committed AMO credentials or automated AMO listing submission.
- No claim that a hand-installed unlisted beta XPI auto-updates on Firefox for Android; only the AMO listing gives hands-off Android updates.
- No completion of S4 real-device testing or S5 AMO policy preflight.

## Technical Design

### Build variants

The default WXT build emits no `browser_specific_settings.gecko.update_url` and carries the single permanent add-on ID `youtube-audio@animesh.kundus.in` (ADR-0006; the `FIREFOX_EXTENSION_ID` env is a local-experiment override only). Setting `BETA_SUFFIX` at build time appends a Firefox-toolkit pre-release suffix (e.g. `0.0.2.5b1`) for the unlisted beta. The `SELF_HOSTED_UPDATE_URL` build flag is retired for production and set by no workflow; it survives only as a dormant optional capability and must never be applied to a listed build.

Both channels share one identity, differentiated by AMO channel and version: the **listed** production version is the clean base with no `update_url`, and the **unlisted** beta is a distinct pre-release version signed under the same ID. A single AMO submission can never be both listed and self-hosted-auto-updating (a listed version must omit `update_url`).

### Signing

`scripts/release.sh` checks `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, builds Firefox MV2, validates it with `web-ext lint`, and calls `web-ext sign --channel=unlisted`. The credentials are passed through command options and never written to disk or source control. The downloaded signed XPI is copied to `dist/` with a stable versioned name.

### CI and tagged releases

CI runs strict typecheck, zero-warning lint, unit tests, Firefox MV2/MV3 builds, and `web-ext lint`. The Selenium Firefox bench remains a non-gating manual workflow job because it requires a browser stack.

A **pre-release** version tag (e.g. `v0.0.2.5b1`) runs `beta.yml`: it validates before signing, builds with `BETA_SUFFIX`, signs the unlisted MV2 XPI through AMO, re-checks the signed bytes, and attaches the XPI to a GitHub prerelease. Promotion to the AMO listed channel is a separate, manual `publish-amo.yml` (`workflow_dispatch` only) that signs `--channel=listed` with a reviewer source archive; AMO hosts the listed XPI, so there is no Release asset and no self-hosted update manifest.

## Error Handling

- Missing credentials stop signing before any AMO request with a direct error message.
- Build, lint, signing, artifact discovery, hashing, or publishing failure stops the release job.
- The signing script replaces only its own temporary artifacts and does not delete unrelated `dist/` files.

## Testing Strategy

- Run typecheck, lint, unit coverage, and all 20 hermetic bench cases.
- Build Firefox MV2 and MV3.
- Run `web-ext lint` on MV2.
- Parse the workflow YAML files as valid YAML and confirm `publish-amo.yml` has no automatic (push/tag/release/schedule) trigger.
- Run `bash -n scripts/release.sh`.
- Inspect the default production manifest for exactly four YouTube content matches, no localhost match, and no `update_url`.

## Security Considerations

- AMO API credentials exist only in environment variables or GitHub encrypted secrets.
- Release workflow permissions are limited to `contents: write`.
- The listed submission uploads an un-minified source archive of exactly the tracked files (via `git archive`) for reviewer rebuild; it is a review artifact, never shipped to users.
- Default builds stay AMO-listing-compatible by omitting `update_url`.

## Rollout and Rollback

Create a version tag only after S5 policy preflight and required release checks. Deleting the tag workflow and release script removes automation without changing extension runtime behavior. Existing signed installations retain their identity and must never be moved between channel IDs.
