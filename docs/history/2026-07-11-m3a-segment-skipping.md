# M3a Segment Skipping Handoff

## Delivered

- Added a telemetry-free SponsorBlock-compatible client using a four-character SHA-256 anonymity prefix and exact local bucket filtering.
- Added sorted overlap merging and strict malformed-response rejection for enabled `sponsor` and `music_offtopic` categories.
- Added a fixed-origin, credentialless, no-referrer background fetch and a validated content-to-background bridge. Isolated-to-MAIN SponsorBlock responses use a JSON string because Firefox blocks object-valued `CustomEvent.detail` across extension-world boundaries.
- Added MAIN-world `timeupdate` skipping on the same page video used by audio-only playback, with one skip per range per navigation and stale-work cleanup.
- Added instant settings, popup master control, options category controls, and SponsorBlock host permission for both manifest versions.
- Added real-source unit coverage and a packaged-extension bench fixture/case.

## Privacy and Failure Boundaries

The only production remote request is `GET https://sponsor.ajay.app/api/skipSegments/<prefix>`. No cookies, identifying headers, YouTube referrer, user ID, submissions, votes, view-count tracking, or `/api/viewedVideoSponsorTime` call exists. Every network, parsing, messaging, media, and seeking error fails open.

## Defaults

Segment skipping is enabled with `sponsor` and `music_offtopic`. Users can disable the feature immediately in popup or options and choose categories in options.

## Validation

Run `npm run typecheck`, `npm run lint`, the gate-weakener grep, `npm test`, `npm run test:bench`, and `npm run build`. Inspect the production manifest to confirm exactly the four YouTube match patterns, the SponsorBlock permission, and no localhost permission.
