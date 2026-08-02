# E2E Consent Seeding

**Date:** 2026-08-01

## Summary

Playback and visual E2E harnesses now seed an explicit granted data-consent record through an extension-owned page before loading YouTube or the hermetic watch fixture. SponsorBlock cases seed its separate opt-in only when segment skipping is enabled.

## Changes

- Added `tests/e2e/consent-helper.mjs` as the single consent-seeding helper.
- Wired the hermetic bench, settings matrix, visual capture, live desktop probes, and Android/Fenix probes to use the helper.
- Added the named hermetic regression `consent:fresh-unconsented-profile-fails-closed`, which verifies that a fresh unconsented profile performs no audio hijack, player request, artwork render, or artwork request.
- Removed obsolete lyrics settings, probes, markers, matrix permutations, and fixture responses from `tests/`.

## Validation

- `npm run format`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 26 files and 265 tests passed; line coverage 98.87%.
- `npm run test:bench`: local Firefox 152 completed but failed 28/52 because temporary installation does not expose a granted `permissions.getAll().data_collection` category; the fresh-unconsented fail-closed case passed. Treatment execution on Firefox 140+ requires the native install-consent grant and is tracked by cross-version qualification.
- `npm run test:matrix`: could not complete locally; geckodriver exited before WebDriver connected (`ECONNREFUSED 127.0.0.1`). The same Firefox 152 built-in-consent requirement remains for treatment sessions once it launches.

## Qualification boundaries

- The complete temporary-install bench and settings matrix are legacy custom-consent gates and require an actual Firefox 128-139 binary through `FIREFOX_BIN`.
- On Firefox 140+/142+, temporary installation can prove fail-closed behavior but cannot grant native data consent. Treatment cases are inapplicable in that lane.
- Native install acceptance and live revocation require a packaged XPI in a persistent profile. The manual release protocol now checks immediate player reclaim and cessation of InnerTube, artwork, and SponsorBlock requests without navigation.
- Programmatically invoking a stored listener callback would not simulate Firefox permission removal, so no such case was added or represented as E2E coverage.
