# M3b Quality-of-Life Handoff

## Delivered

- Added a selectable, off-by-default maximum video quality and mapped user-facing resolutions to YouTube's internal quality labels.
- Added bounded MAIN-world quality reassertion through `setPlaybackQualityRange` and `setPlaybackQuality`, with player quality-change handling and no perpetual interval.
- Added off-by-default native autoplay-next suppression through the player's autonav toggle.
- Added independent, off-by-default Shorts, recommendations, and comments filters using one extension-managed stylesheet with desktop and mobile semantic selectors.
- Added instant shared settings plus common popup controls and the complete options-page controls.
- Added pure real-source unit coverage and packaged-extension bench fixtures/cases for enabled and disabled behavior.

## Privacy and Failure Boundaries

Cosmetic settings are not mirrored into persistent page marker attributes. No network call, permission, remote configuration, page global, prototype patch, or DOM deletion is introduced. Missing or throwing player APIs and missing/changing selectors are no-ops that preserve native YouTube playback and layout.

## Defaults

Every M3b control defaults off to avoid surprising existing users. Global disable removes the cosmetic stylesheet and prevents further player actions without attempting to reverse native player state.

## Validation

Run `npm run typecheck`, `npm run lint`, the gate-weakener grep, `npm test`, `npm run test:bench`, and `npm run build`. Inspect the production manifest to confirm exactly the four YouTube content matches and no localhost match or permission.
