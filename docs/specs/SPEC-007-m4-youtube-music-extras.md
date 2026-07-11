# Specification: M4 YouTube Music Extras

## Overview

M4 adds local Web Audio loudness normalization and equalization plus opt-in synchronized LRCLIB lyrics. Enhancements are instant-disableable and fail open to native YouTube playback.

## Goals

- Route the current page media element through one shared `AudioContext` and exactly one `MediaElementAudioSourceNode` per element.
- Normalize each track from YouTube's `playerConfig.audioConfig.loudnessDb`, with a bounded gain that avoids extreme amplification or attenuation.
- Offer an off-by-default five-band equalizer with validated gain settings.
- Fetch timed lyrics anonymously from LRCLIB only when the user opts in, and render synchronized text safely on YouTube Music.
- Apply loudness, EQ, and lyrics settings instantly.

## Non-Goals

- No scrobbling, account linkage, identifying lyrics headers, arbitrary remote URLs, Musixmatch/Genius fallback, crossfade, compressor, or native YouTube lyrics proxy.
- No attempt to bypass unavailable lyrics or CORS-tainted Web Audio.

## Technical Design

### Audio graph

`src/shared/audiograph.ts` owns one lazily-created page-world `AudioContext` and a `WeakMap` keyed by media element. Before attachment it sets `crossOrigin = "anonymous"`. A source is connected in series through five `BiquadFilterNode` bands and one `GainNode` to the destination. Repeated requests for the same element reuse the existing graph. Settings update node parameters without rebuilding it.

Loudness gain is `10 ** (-loudnessDb / 20)`, clamped to `0.5..2`. Invalid values use unity gain. Disabling normalization uses unity gain. AudioContext creation, source creation, connection, and updates are guarded; failure leaves the native media path untouched.

### Lyrics

The MAIN-world player response supplies bounded title, artist, duration, and video ID metadata to the isolated content layer. The content layer requests a fixed background operation. Background constructs only `https://lrclib.net/api/get` with `track_name`, `artist_name`, and `duration`, uses `credentials: "omit"`, `referrerPolicy: "no-referrer"`, and no identifying headers. Bench builds may substitute the validated local fixture origin.

`src/shared/lyrics.ts` parses LRC timestamps into sorted immutable lines. Content renders only text nodes into one extension-owned region on `music.youtube.com`, highlights the active line from the page video's `timeupdate`, and removes all state immediately when disabled or navigation changes.

### Settings

- `loudnessNormalization`: default `true`
- `equalizerEnabled`: default `false`
- `equalizerBands`: five validated gains at 60, 250, 1000, 4000, and 12000 Hz; default flat
- `lyricsEnabled`: default `false`

Popup exposes the three feature toggles. Options exposes the toggles and five EQ gain controls.

## Error Handling

All graph, metadata, bridge, network, response, parsing, DOM, and synchronization failures are caught and affect only the enhancement. Native media remains audible and controllable. Lyrics failures remove or leave absent the extension-owned lyrics region.

## Testing Strategy

- Unit tests import real source functions for loudness conversion and clamps, EQ parameter mapping, and LRC parsing.
- The packaged bench seeds settings through the options-page storage path and compares graph-on versus graph-off sessions using a bench-only graph marker. It also proves the fixture LRCLIB response reaches an opt-in lyrics marker.
- Release gates: strict typecheck, zero-warning lint, empty gate-weakener scan, real-source unit coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

LRCLIB is contacted only after explicit opt-in. Requests omit credentials and referrers and contain only track, artist, and duration. Response text is rendered through DOM text nodes, never HTML. The background accepts no arbitrary production URL. Scrobbling is deliberately excluded because sending listening history conflicts with ghost mode.

## Rollout and Rollback

Loudness normalization defaults on; EQ and lyrics default off. Each can be disabled instantly. If Web Audio cannot attach, the graph is not installed. If LRCLIB is unavailable or malformed, no lyrics UI is shown.
