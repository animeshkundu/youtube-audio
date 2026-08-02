# Live WEB player-response capture — 2026-08-01

## Goal

Replace the unverified claim that YouTube's real WEB player response has no reusable direct audio URL with a dated, reproducible live observation.

## Changes

- Extended `tests/e2e/real-youtube-capture.mjs` to inspect the real `window.ytInitialPlayerResponse` and fall back to observing the page's own `/youtubei/v1/player` fetch/XHR response when necessary.
- Recorded bounded format metadata and only the presence of `url` or `signatureCipher`; signed URLs themselves are not persisted.
- Added a concise WEB-versus-ANDROID_VR count summary to the probe report and console output.
- Removed a Firefox command-line argument that current geckodriver rejects when supplied through capabilities, allowing the live probe to start.
- Recorded the full method, raw counts, and verdict in `docs/research/20-live-web-player-response.md`.

## Verification

Ran the probe logged out against two public VODs:

- `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- `https://www.youtube.com/watch?v=jNQXAC9IVRw`

Across both real WEB responses, 12/12 audio entries had neither a direct URL nor `signatureCipher`; both responses exposed `serverAbrStreamingUrl`. Across the paired ANDROID_VR responses, 8/8 audio entries had direct URLs. The SABR-only claim therefore held for audio in both observations on 2026-08-01.

`npm run lint -- --no-cache` and targeted Prettier checking passed before the live runs. The live harness completed the requested captures but exited non-zero on its separate visual assertions because the concurrently introduced consent flow left optional network playback unconsented in each fresh profile. See the research note for this caveat.
