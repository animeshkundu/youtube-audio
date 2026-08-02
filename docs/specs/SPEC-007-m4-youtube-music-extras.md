# Specification: M4 YouTube Music Extras

## Overview

M4 provides local Web Audio loudness normalization and equalization. Loudness normalization and the equalizer are the active M4 extras. They are instant-disableable and fail open to native YouTube playback.

## Goals

- Route the current page media element through one shared `AudioContext` and exactly one `MediaElementAudioSourceNode` per element.
- Normalize each track from YouTube's `playerConfig.audioConfig.loudnessDb`, with a bounded gain that avoids extreme amplification or attenuation.
- Offer an off-by-default five-band equalizer with validated gain settings.
- Apply loudness and EQ settings instantly.

## Non-Goals

- No scrobbling, account linkage, arbitrary remote audio-processing URLs, crossfade, or compressor.
- No attempt to bypass CORS-tainted Web Audio.

## Technical Design

### Audio graph

`src/shared/audiograph.ts` owns one lazily-created page-world `AudioContext` and a `WeakMap` keyed by media element. Before attachment it sets `crossOrigin = "anonymous"`. A source is connected in series through five `BiquadFilterNode` bands and one `GainNode` to the destination. Repeated requests for the same element reuse the existing graph. Settings update node parameters without rebuilding it.

Loudness gain is `10 ** (-loudnessDb / 20)`, clamped to `0.5..2`. Invalid values use unity gain. Disabling normalization uses unity gain. AudioContext creation, source creation, connection, and updates are guarded; failure leaves the native media path untouched.

### Navigation lifecycle

The SPA history observation remains because audio-only playback and per-track audio enhancements rely on it to re-arm after YouTube Music navigation.

### Settings

- `loudnessNormalization`: default `true`
- `equalizerEnabled`: default `false`
- `equalizerBands`: five validated gains at 60, 250, 1000, 4000, and 12000 Hz; default flat

Options exposes the loudness and equalizer toggles and the five EQ gain controls.

## Error Handling

All graph, response, DOM, and synchronization failures are caught and affect only the enhancement. Native media remains audible and controllable.

## Testing Strategy

- Unit tests import real source functions for loudness conversion and clamps and EQ parameter mapping. `tests/unit/spa.test.ts` locks immediate song-change detection through `history.pushState` without `yt-navigate-finish`, plus restoration of patched history methods on `stop()`.
- The packaged bench seeds settings through the options-page storage path (not the UI) and compares graph-on versus graph-off sessions using a bench-only graph marker.
- Release gates: strict typecheck, zero-warning lint, real-source unit coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

The audio graph processes the existing page media locally. Scrobbling is deliberately excluded because sending listening history conflicts with ghost mode.

## Rollout and Rollback

Loudness normalization defaults on; EQ defaults off. Each can be disabled instantly. If Web Audio cannot attach, the graph is not installed.
