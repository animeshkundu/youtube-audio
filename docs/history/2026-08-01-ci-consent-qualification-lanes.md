# CI Consent Qualification Lanes

**Date:** 2026-08-01

## Summary

Modern Firefox temporary installs report a manifest required data category through
`permissions.getAll().data_collection`, even though they bypass the native consent UI. The E2E
harnesses now leave that capability at its real default, assert that seeded treatment sessions
actually resolve granted, and retain a deliberately unconsented fail-closed bench case. A blocking
persistent-profile job measures the Firefox 139-to-140 browser boundary for granted and revoked
consent.

## Changes

- Removed `extensions.dataCollectionPermissions.enabled = false` from the desktop, visual, live, and
  Fenix E2E treatment harnesses.
- Extended `tests/e2e/consent-helper.mjs` to read the literal permission, browser-version, and platform
  state after seeding and throw if consent would still resolve denied.
- Kept `consent:fresh-unconsented-profile-fails-closed` honest by suppressing the automatic required
  category only for that fresh-profile session and never writing a stored grant.
- Added `tests/e2e/bench/qualify-browser-upgrade.mjs`. It stages a non-temporary BENCH XPI in granted
  and revoked Firefox 139 Developer Edition profiles, shuts Firefox down, and reopens the same
  profiles in Firefox 140 Developer Edition.
- Made the upgrade lane print the literal permission and consent objects plus an unambiguous
  `NOT BRICKED`, `BRICKED`, or `NO EMPIRICAL ANSWER` result.
- Added the upgrade verifier to the release prerequisites.
- Updated SPEC-013 and `docs/ci-cd.md`. The detailed qualification analysis in
  `docs/testing/amo-compliance-qualification-plan.md` remains the source for upgrade risks, manual
  protocols, and submission stop conditions.

## Validation

- Workflow YAML parsed with `yaml.safe_load`.
- E2E scripts passed `node --check`.
- `npm run format`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 27 files and 268 tests passed; line coverage 98.87%.
- The Firefox 139-to-140 empirical answer remains pending the first GitHub Actions run. No Firefox
  version was installed locally for this work.

## Known separate issues

- The persistent browser-boundary test is not an extension-update simulation. A 1.0.3-to-candidate
  update adds `websiteContent` as a required category and still needs the native pending/acceptance
  path measured separately.
- `npm run test:matrix` can die locally with `ECONNREFUSED` after geckodriver exits before WebDriver
  connects. This work records but does not attempt to fix that separate harness issue.
