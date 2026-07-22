# Download Format, Quality, and Progress Handoff

## Scope

Extended the opt-in player download with direct-source format and bitrate choices plus
request-correlated byte progress.

## Behavior

- Downloads remain off by default. `auto` format and quality preserve AAC itag 140 with an `.m4a`
  filename.
- Options progressively discloses M4A/AAC, Opus/WebM, and automatic/high/medium/low source bitrate
  choices. No transcoding or container renaming was added.
- MAIN selects only direct ANDROID_VR audio formats. Missing requested renditions fall back to a
  compatible direct audio source without affecting playback.
- Background assembles validated ranges credentiallessly and reports bounded progress only to the
  originating tab. Content ignores malformed, stale, and unrelated request IDs.
- The player button displays a percentage ring once `Content-Range` establishes a total and keeps an
  honest indeterminate state for a complete `200` response.

## Safety

The Googlevideo allowlist, canonical filename check, UUID correlation, size cap, logged-out behavior,
and `PlayerHandle` sole-writer boundary are unchanged. Progress delivery is best-effort and cannot
fail an otherwise valid download.

## Validation

- Unit tests cover settings normalization, codec and bitrate selection, Opus extensions, assembly
  progress, message bounds, options disclosure, diagnostics projection, and throttled player
  feedback.
- The 53-case packaged Firefox bench preserves the default itag-140 assertion and verifies Opus itag
  250, `.webm`, and 100% progress.
- The 51-case settings matrix includes the non-default Opus/medium combination and passes.
- `npm run validate` passes for strict typecheck, lint, formatting, unit coverage, MV2 package lint,
  and both Firefox builds.

## Follow-up

No follow-up is required. Additional codecs remain out of scope unless YouTube supplies them as
direct audio-only formats.
