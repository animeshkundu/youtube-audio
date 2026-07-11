# Specification: M7 Release Infrastructure

## Overview

M7 adds reproducible Firefox release validation, Mozilla unlisted signing, GitHub Release publishing, and documented desktop/Android distribution paths without changing extension features or default manifest behavior.

## Goals

- Build and validate Firefox MV2 and MV3 from the same source on every push and pull request.
- Sign the Firefox MV2 artifact through AMO's API with credentials supplied only at runtime.
- Publish a signed XPI and a matching update manifest from version tags.
- Support an opt-in self-hosted desktop build carrying `gecko.update_url` while keeping default builds compatible with an AMO listing.
- Document the separate AMO-listed Android path and all remaining human gates.

## Non-Goals

- No product behavior, setting, permission, host-match, or content-match changes.
- No committed AMO credentials or automated AMO listing submission.
- No claim that a self-hosted XPI auto-updates on Firefox for Android.
- No completion of S4 real-device testing or S5 AMO policy preflight.

## Technical Design

### Build variants

The default WXT build emits no `browser_specific_settings.gecko.update_url`. Setting `SELF_HOSTED_UPDATE_URL` at build time opts into a self-hosted desktop variant and inserts that HTTPS URL. `FIREFOX_EXTENSION_ID` may select a stable channel-specific ID; it defaults to `youtube-audio@local`.

The channels use distinct permanent IDs because one AMO identity cannot simultaneously be an unlisted self-hosted add-on with `update_url` and an AMO-listed add-on. The tag workflow is the self-hosted/unlisted channel. The AMO-listed Android channel is built separately from the default no-`update_url` manifest with its own ID.

### Signing

`scripts/release.sh` checks `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, builds Firefox MV2, validates it with `web-ext lint`, and calls `web-ext sign --channel=unlisted`. The credentials are passed through command options and never written to disk or source control. The downloaded signed XPI is copied to `dist/` with a stable versioned name.

### CI and tagged releases

CI runs strict typecheck, zero-warning lint, unit tests, Firefox MV2/MV3 builds, and `web-ext lint`. The Selenium Firefox bench remains a non-gating manual workflow job because it requires a browser stack.

A `v*` tag runs the same release gates, builds the self-hosted MV2 variant, signs it through AMO, computes its SHA-256 digest, generates a versioned `updates.json`, and attaches both files to the GitHub Release. The XPI is published before the update manifest is made available as an asset.

## Error Handling

- Missing credentials stop signing before any AMO request with a direct error message.
- Build, lint, signing, artifact discovery, hashing, or publishing failure stops the release job.
- The signing script replaces only its own temporary artifacts and does not delete unrelated `dist/` files.

## Testing Strategy

- Run typecheck, lint, unit coverage, and all 20 hermetic bench cases.
- Build Firefox MV2 and MV3.
- Run `web-ext lint` on MV2.
- Parse both workflow YAML files and validate `updates.json` as JSON.
- Run `bash -n scripts/release.sh`.
- Inspect the default production manifest for exactly four YouTube content matches, no localhost match, and no `update_url`.

## Security Considerations

- AMO API credentials exist only in environment variables or GitHub encrypted secrets.
- Release workflow permissions are limited to `contents: write`.
- Update links use HTTPS and the generated update entry contains a SHA-256 hash of the exact signed XPI bytes.
- Default builds stay AMO-listing-compatible by omitting `update_url`.

## Rollout and Rollback

Create a version tag only after S5 policy preflight and required release checks. Deleting the tag workflow and release script removes automation without changing extension runtime behavior. Existing signed installations retain their identity and must never be moved between channel IDs.
