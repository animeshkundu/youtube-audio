# Specification: M4 YouTube Music Extras

## Overview

M4 adds local Web Audio loudness normalization and equalization. It also shipped opt-in synchronized LRCLIB lyrics, now disabled and hidden because YouTube Music provides native synchronized lyrics that make ours redundant (see the Lyrics section). Loudness normalization and the equalizer are the active M4 extras. Enhancements are instant-disableable and fail open to native YouTube playback.

## Goals

- Route the current page media element through one shared `AudioContext` and exactly one `MediaElementAudioSourceNode` per element.
- Normalize each track from YouTube's `playerConfig.audioConfig.loudnessDb`, with a bounded gain that avoids extreme amplification or attenuation.
- Offer an off-by-default five-band equalizer with validated gain settings.
- Fetch timed lyrics anonymously from LRCLIB only when the user opts in, and render synchronized text safely on YouTube Music. (Now disabled and hidden; see the Lyrics section.)
- Apply loudness and EQ settings instantly.

## Non-Goals

- No scrobbling, account linkage, identifying lyrics headers, arbitrary remote URLs, Musixmatch/Genius fallback, crossfade, compressor, or native YouTube lyrics proxy.
- No attempt to bypass unavailable lyrics or CORS-tainted Web Audio.

## Technical Design

### Audio graph

`src/shared/audiograph.ts` owns one lazily-created page-world `AudioContext` and a `WeakMap` keyed by media element. Before attachment it sets `crossOrigin = "anonymous"`. A source is connected in series through five `BiquadFilterNode` bands and one `GainNode` to the destination. Repeated requests for the same element reuse the existing graph. Settings update node parameters without rebuilding it.

Loudness gain is `10 ** (-loudnessDb / 20)`, clamped to `0.5..2`. Invalid values use unity gain. Disabling normalization uses unity gain. AudioContext creation, source creation, connection, and updates are guarded; failure leaves the native media path untouched.

### Lyrics

> **Status: disabled and hidden.** YouTube Music now provides native synchronized lyrics, so this feature is redundant. The options "Synced lyrics" toggle was removed, and the `https://lrclib.net/*` host permission was dropped from both the MV2 `permissions` and the MV3 `host_permissions` in `wxt.config.ts`, so the feature can no longer fetch. The feature code (`entrypoints/content.ts`, `entrypoints/main-world.ts`, `entrypoints/background.ts`, `src/shared/lyrics.ts`) and the `lyricsEnabled` setting (default `false`) are retained for possible future use, but the feature is no longer user-reachable. The design below documents the retained behavior.

The MAIN-world player response supplies bounded title, artist, duration, and video ID metadata to the isolated content layer. The content layer requests a fixed background operation. Background constructs only `https://lrclib.net/api/get` with `track_name`, `artist_name`, and `duration`, uses `credentials: "omit"`, `referrerPolicy: "no-referrer"`, and no identifying headers. Bench builds may substitute the validated local fixture origin. Lyrics remain YouTube-Music-only: `handleTrack` returns unless the host is `music.youtube.com`.

`src/shared/lyrics.ts` parses LRC timestamps into sorted immutable lines. Content renders only text nodes into one extension-owned region, highlights the active line from the page video's `timeupdate`, and removes all state immediately when disabled or navigation changes.

#### Match retry

`background.ts:fetchLyrics` first calls `lrclibGet` with the reported artist. YouTube Music canonical (Content-ID) tracks report the author as `"<Artist> - Topic"`, which LRCLIB usually files under the plain artist name, so a miss triggers one retry with the `\s*-\s*topic\s*$` suffix stripped. This lifts the match rate for canonical uploads (for example an Adele track filed as `Adele - Topic`).

#### Panel controls and click-through (`content.ts:renderLyrics`)

The panel is a fixed `section` over the right rail with a header (an uppercase "Lyrics" label) carrying two controls:

- Minimize collapses the body to just the header and toggles its glyph; expand restores it.
- Close removes the panel and records the track in `lyricsDismissedVideoId` so it stays closed for that track. The dismissal clears when a genuinely different track plays or when lyrics are re-enabled from settings.

The panel container is `pointer-events:none` and only the two buttons are `pointer-events:auto`. The panel sits over the Up Next queue, and before this it swallowed queue clicks (a click landed on a lyric line, so the song never changed). Now a click on a queue row passes through and switches the song while lyrics stay visible. Trade-off: the lyric body is no longer manually scrollable or selectable, but the active line still auto-scrolls into view (`scrollIntoView`) as playback advances, unaffected by the click-through.

#### Song-change refresh (`src/shared/spa.ts:observeYouTubeSpa`)

YouTube Music switches songs (search results, linked navigation, back/forward, and Up Next quick-play) via `history.pushState`/`replaceState` and frequently does not fire `yt-navigate-finish`; its shadow-DOM player update also did not reliably trip the light-DOM `MutationObserver`, so the `?v=` change could go undetected and per-song features would not re-arm. `observeYouTubeSpa` wraps `pushState`/`replaceState` (invoking the page's original method first, fail-open) and listens for `popstate`, re-checking the URL immediately so the operation re-arms (`activateEnhancements`/`emitTrack`): lyrics refresh and the audio-only hijack re-arm for the new song. Both wrappers and the listener are restored on `stop()`.

#### Lifecycle guards (`content.ts:handleTrack`)

- A per-fetch generation token (`lyricsRequestGeneration`) drops a superseded lookup, so a slow result for the previous song cannot overwrite the current one.
- An in-flight same-track dedup (`lyricsFetchingVideoId`) skips a duplicate event so a redundant failing lookup cannot drop the first good result.
- When a new track has no lyrics, the stale panel from the previous track is cleared.

### Settings

- `loudnessNormalization`: default `true`
- `equalizerEnabled`: default `false`
- `equalizerBands`: five validated gains at 60, 250, 1000, 4000, and 12000 Hz; default flat
- `lyricsEnabled`: default `false`; retained in storage but no longer surfaced in any UI (see the Lyrics section)

Options exposes the loudness and equalizer toggles and the five EQ gain controls. The `lyricsEnabled` setting is no longer exposed in the popup or options.

## Error Handling

All graph, metadata, bridge, network, response, parsing, DOM, and synchronization failures are caught and affect only the enhancement. Native media remains audible and controllable. Lyrics failures remove or leave absent the extension-owned lyrics region.

## Testing Strategy

- Unit tests import real source functions for loudness conversion and clamps, EQ parameter mapping, and LRC parsing. `tests/unit/spa.test.ts` adds two locks: a `history.pushState` song change is detected immediately without `yt-navigate-finish`, and the patched history methods are restored on `stop()`. `tests/unit/ui/options.test.tsx` locks the hidden state: the "Synced lyrics" row is absent (`#option-lyrics` is not rendered) and a search for "lyrics" matches nothing and shows the empty-search status.
- The packaged bench seeds settings through the options-page storage path (not the UI) and compares graph-on versus graph-off sessions using a bench-only graph marker. Because lyrics is disabled, `m4:lyrics-disabled-even-when-forced` seeds `lyricsEnabled` true directly through storage and asserts the kill switch holds: the panel never renders and no LRCLIB fetch is attempted, even with the setting forced on. (The matrix's `lyricsEnabled` case asserts the same never-renders invariant across the toggle space.)
- Suite totals after this batch: 245 unit, 48/48 bench, 50/50 settings-permutation matrix.
- Release gates: strict typecheck, zero-warning lint, empty gate-weakener scan, real-source unit coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

With lyrics currently disabled and the `lrclib.net` host permission removed, LRCLIB is not contacted at all. The retained design contacts LRCLIB only after explicit opt-in. Requests omit credentials and referrers and contain only track, artist, and duration. Response text is rendered through DOM text nodes, never HTML. The background accepts no arbitrary production URL. Scrobbling is deliberately excluded because sending listening history conflicts with ghost mode.

## Rollout and Rollback

Loudness normalization defaults on; EQ defaults off. Each can be disabled instantly. If Web Audio cannot attach, the graph is not installed. Lyrics is disabled and hidden (see the Lyrics section): its setting stays `false`, and with the `lrclib.net` host permission removed it cannot fetch, so no lyrics UI is shown.
