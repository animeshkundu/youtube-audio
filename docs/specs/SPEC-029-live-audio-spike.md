# SPEC-029: Live audio-only spike (research only)

**Status:** Draft (research spike, no code)
**Date:** 2026-10-17
**Depends on:** SPEC-002 (core playback), SPEC-014 (media client resilience)
**Relates to:** Issues #15, #34, #57

## 1. Goal

Research whether audio-only playback is feasible for live streams. Currently, live streams fail open to native playback (lowest quality cap applied). The spike evaluates whether a TVHTML5 or similar client exposes a finite audio stream for live broadcasts.

## 2. Non-goals

- No code in 1.1.0. Research only.
- No promise to ship. If it works, include as experimental behind a flag.
- No change to `isLiveStream` → fallback default.

## 3. Research questions

1. Does the TVHTML5 client return a finite audio URL for live streams?
2. Does the TVHTML5 client return HLS/DASH manifests that can be played as audio-only?
3. Can the MediaSource API be used to play only the audio track of a live HLS stream?
4. What is the latency and bandwidth impact?
5. Does it require PoToken (which we don't handle)?

## 4. Evaluation criteria

- **Feasible:** A finite audio URL or HLS audio-only manifest is returned by a credentialless client.
- **Reliable:** The stream plays without buffering issues on desktop + Android.
- **Fail-open:** If it fails, native playback continues (no regression).
- **Minimal surface:** No new UI (experimental flag in Advanced settings only).

## 5. If feasible

- Create a spec (SPEC-030) for live audio-only.
- Create an ADR for the client choice.
- Implement behind `experimentalLiveAudio` flag (default off).
- Add bench case for live stream audio-only.
- Add to settings matrix.

## 6. If not feasible

- Document findings in `docs/research/`.
- Keep live streams as native playback (current behavior).
- Improve fallback messaging: popup shows "Live stream — playing normally" instead of just "fallback".

---

_Spec written per "no spec, no code" rule._
