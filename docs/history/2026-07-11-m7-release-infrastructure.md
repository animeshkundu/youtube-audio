# Handoff: M7 Release Infrastructure

## Summary

Implemented Firefox release validation, AMO unlisted signing, tagged GitHub Release publishing, and separate documented desktop self-hosted and Android AMO-listed distribution paths.

## Delivered

- Added `scripts/release.sh` and `npm run release:sign`; missing AMO JWT issuer/secret fail before signing, and returned signed XPIs are copied to `dist/`.
- Replaced the obsolete legacy CI with Node 20 typecheck, lint, unit coverage, Firefox MV2 `web-ext lint`, dual MV2/MV3 builds, and an optional non-gating Selenium bench job.
- Added a `v*` release workflow that validates, unlisted-signs, hashes, and publishes the signed XPI followed by its generated `updates.json` Release asset.
- Added the valid checked-in `updates.json` template with placeholder HTTPS release URL and SHA-256 marker.
- Kept default manifests free of `update_url`; `SELF_HOSTED_UPDATE_URL` enables an explicit HTTPS self-hosted desktop variant and `FIREFOX_EXTENSION_ID` selects the permanent distribution identity.
- Documented local signing, CI tags, desktop update hosting, AMO-listed Android updates, user gates, compatibility floor, and rollback in `RELEASE.md`.
- Accepted ADR-0002: two separate Gecko IDs resolve the incompatibility between a self-hosted `update_url` identity and an AMO-listed Android identity.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero ESLint warnings/errors.
- `npm test`: 11 files and 86 tests passed; 98.22% statements, 94.81% branches, 97.05% functions, 99.29% lines.
- `npm run test:bench`: all 20 cases passed.
- `npm run build`: Firefox MV2 built successfully.
- `npm run build:mv3`: Firefox MV3 built successfully.
- `web-ext lint`: 0 errors, 5 existing generated-bundle/compatibility warnings.
- `bash -n scripts/release.sh`: passed.
- `updates.json`: parsed as valid JSON.
- CI and release workflows parsed as valid YAML.
- Default production manifest retained exactly four YouTube content matches, no localhost entries, and no `update_url`.

## User-gated follow-up

- Select permanent, distinct self-hosted and AMO-listed Gecko IDs and replace release workflow template values.
- Create AMO API credentials and GitHub encrypted secrets.
- Complete S5 AMO policy preflight and submit the listed Android channel for AMO review.
- Complete S4 testing on a real Firefox for Android device.
- Host the generated update manifest at the configured HTTPS Pages URL for desktop auto-update.
