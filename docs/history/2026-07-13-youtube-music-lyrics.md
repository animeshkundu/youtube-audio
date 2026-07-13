# Handoff: YouTube Music synced-lyrics fixes

## Date

2026-07-13

## Summary

Fixes for the opt-in synchronized-lyrics panel on YouTube Music, driven by behavior on real
YouTube Music (not just the hermetic fixtures). The user reported that the panel had no way to
minimize and did not update when switching songs (from search or the sidebar). Root cause was two
separate defects: the fixed panel swallowed clicks meant for the Up Next queue behind it (so a
click landed on a lyric line and the song never changed), and YouTube Music's `history`-based song
switches were not detected, so per-song features never re-armed. This batch adds minimize and close
controls, makes the panel click-through, detects `history.pushState`/`replaceState` song changes,
hardens the fetch lifecycle, and lifts the LRCLIB match rate for canonical uploads. Scope is
unchanged: lyrics remain YouTube-Music-only. No hard invariant changed: logged-out only,
credentialless `ANDROID_VR`, `PlayerHandle` as the sole `<video>.src` writer, fail-open to native
playback, and the page-world trust boundary all hold.

Branch `rebuild`, PR #65, commits `8339619` and `0196003`.

## Key changes

### Minimize + close controls (`entrypoints/content.ts:renderLyrics`)

The panel now has a header with a minimize button (collapses to just the header) and a close
button (removes the panel). A close stays closed for that track: `lyricsDismissedVideoId` records
it and is cleared when a genuinely different track plays or when lyrics are re-enabled from
settings.

### Click-through so the panel never blocks the Up Next queue (`entrypoints/content.ts:renderLyrics`)

The panel container is `pointer-events:none` and only the two buttons are `pointer-events:auto`.
The panel is fixed over the right rail and previously swallowed clicks meant for the Up Next queue
behind it, so switching songs by clicking a queue row silently failed. Now a queue-row click passes
through and switches the song while lyrics stay visible. Trade-off: the lyric body is no longer
manually scrollable or selectable, but it auto-scrolls the active line into view as the song plays,
which is unaffected.

### Song-change detection via the history hook (`src/shared/spa.ts:observeYouTubeSpa`)

YouTube Music switches songs (search results, linked navigation, back/forward, and Up Next
quick-play) via `history.pushState`/`replaceState` and frequently does not fire
`yt-navigate-finish`; its shadow-DOM player update also did not reliably trip the light-DOM
`MutationObserver`. `observeYouTubeSpa` now wraps `pushState`/`replaceState` (invoking the page's
original method first, fail-open) and listens for `popstate`, re-checking the URL immediately so the
operation re-arms (`activateEnhancements`/`emitTrack`): lyrics refresh and the audio-only hijack
re-arm for the new song. Both wrappers and the listener are restored on `stop()`.

### Lyrics lifecycle hardening (`entrypoints/content.ts:handleTrack`)

- A per-fetch generation token drops a superseded lookup, so a slow result for the previous song
  cannot overwrite the current one.
- An in-flight same-track dedup stops a duplicate event from dropping a good result.
- The panel clears when a new track has no lyrics.

### Match rate (`entrypoints/background.ts:fetchLyrics` -> `lrclibGet`)

The `/api/get` lookup is retried once with the `"<Artist> - Topic"` suffix stripped, so canonical
YouTube Music tracks (author reported as `"<Artist> - Topic"`, for example an Adele track) match
when LRCLIB filed them under the plain artist name.

## Docs updated

- `docs/specs/SPEC-007-m4-youtube-music-extras.md`: rewrote the Lyrics section to describe the panel
  behavior now (minimize/close controls, click-through with the no-manual-scroll trade-off,
  song-change refresh via the history hook including Up Next quick-play, the generation/dedup
  lifecycle guards, and the `"<Artist> - Topic"` match retry), and added the new test locks.

## Verification

Real Firefox on real YouTube Music (2026-07-12/13): a real trusted-pointer Up Next click switches
the audio (a new googlevideo audio URL) and updates lyrics, and the panel no longer blocks queue
clicks. Covered by the gate (`npm run validate`: typecheck, lint, format:check, unit + coverage,
build MV2, `web-ext lint`, build MV3). Relevant coverage:

- `tests/unit/spa.test.ts`: a `history.pushState` song change is detected immediately without
  `yt-navigate-finish`; the patched history methods are restored on `stop()`.
- Bench `m4:lyrics-opt-in-fetches-and-renders`: also asserts the panel is `pointer-events:none` and
  carries its Minimize and Close controls.
- Totals: 244 unit, 48/48 bench, 50/50 settings-permutation matrix.

## Known issues

- **LRCLIB content coverage:** LRCLIB is exact-match on track, artist, and duration, so some uploads
  simply have no synced lyrics. That is a data-coverage limit, not a bug. The `"<Artist> - Topic"`
  retry closes the common canonical-upload gap but cannot invent lyrics that are not filed.

## Next steps

- None required for this batch. If coverage complaints recur, evaluate a bounded fuzzy match (for
  example a duration tolerance) against the credentialless and ghost-mode posture before adding it.
