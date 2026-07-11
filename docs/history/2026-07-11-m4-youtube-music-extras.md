# M4 YouTube Music Extras Handoff

## Scope

Implemented shared Web Audio loudness normalization and five-band EQ, plus opt-in synchronized LRCLIB lyrics.

## Behavior

- Loudness normalization defaults on and uses the player response's per-track `loudnessDb`, clamped to `0.5..2` linear gain.
- EQ defaults off and exposes five independently persisted bands.
- One shared page-world `AudioContext` and one media source per element feed serial filters and a gain node. Attachment failures preserve native playback.
- Lyrics default off. Opt-in requests send only track, artist, and duration to LRCLIB with credentials and referrer omitted, then render timed text nodes on YouTube Music.
- Scrobbling remains deliberately unimplemented because it conflicts with the ghost posture.

## Validation

Unit coverage includes loudness conversion, EQ mapping, and LRC parsing. The packaged bench adds graph-on, graph-off, and lyrics opt-in cases while retaining prior cases. See the implementation agent's handoff for exact gate output.
