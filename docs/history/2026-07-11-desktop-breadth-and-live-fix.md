# Desktop breadth matrix + live-stream fallback fix — 2026-07-11

## Why

Finishing desktop-Firefox testing before moving to the mobile emulator. Direction: test a
**variety of videos (35+)**, not a hand-picked few, so real edge cases surface. Logged-out only.

## What was run (all real Firefox, logged-out, geckodriver/Selenium, BENCH xpi)

- `tests/e2e/probe-audio-matrix.mjs` — **breadth matrix**: harvests 40+ currently-valid videos live
  from YouTube search across 11 categories (+8 seeds), classifies **every** one through the
  extension's real credentialless ANDROID_VR fetch, then deep-verifies a representative sample on
  real watch pages. Report: `tests/e2e/audio-matrix-report.json`.
- `tests/e2e/probe-audio-playback.mjs` — plays VOD (audio-only advances) and live (fallback) cases.
- `tests/e2e/probe-live-shape.mjs` — dumps the live player-response shape used to design the gate.
- `tests/e2e/probe-adblock-live.mjs` — A/B ad-field pruning (see "Ad-block live" below).

## Results

**Breadth matrix (42 videos, 16 categories):** 0 classify errors. 31 eligible → audio-only;
11 fallback-expected. Deep-verify sample 8/8 passed.

| Class | Categories observed | ANDROID_VR result | Extension behavior |
| --- | --- | --- | --- |
| Eligible (hijack) | music, podcast, classical, gaming, 10h-long, tiny-desk, ambient, K-pop, seeds | `OK`, audio itag 251 | hijack → `videoWidth 0`, `readyState 4`, `currentTime` advances |
| Kids ("made for kids") | Baby Shark + 3 harvested | `UNPLAYABLE` credentialless | graceful fallback → normal video (`vw 854`) |
| Live / DVR | live-news, live-radio (7) | `OK`, audio itag 140, `isLive:true` | fallback (see fix) |

## Bug found + fixed: audio-only hijacked LIVE streams and stalled them

**Symptom:** a live stream was hijacked (`currentSrc → googlevideo`, `videoWidth 0`) but
`currentTime` stayed at `0` — broken playback. Reproduced on 4 live streams.

**Root cause:** `activateEnhancements` gated only on `getPlayability().isPlayable` (`status === "OK"`).
Live/DVR responses are `OK` and carry audio `adaptiveFormats` with urls, but those are live-edge
segments that do not play as a progressive `<video>.src`. There was **no live check** (`PlayerResponse`
did not even parse `isLive`). The plan always intended live to fall back to normal playback.

**Fix:**
- `src/shared/innertube.ts`: parse `videoDetails.isLive/isLiveContent` + `streamingData.hls/dashManifestUrl`;
  add `isLiveStream()` — true on `isLive`, or `isLiveContent` + a manifest url (defensive). Precisely
  excludes currently-live; a finished-stream **VOD replay** (`isLiveContent` only, no manifest) stays eligible.
- `entrypoints/main-world.ts`: gate the audio-only hijack and the audio-download path on `!isLiveStream`.
  For live, emit `fallback`/`live`; the audio graph (loudness/EQ) still arms on the native element.
- `entrypoints/content.ts`: surface the status `reason` to `data-yta-reason` (bench signal).

**Verification:**
- New unit tests for `isLiveStream` (live / VOD-replay / manifest-only / normal). Unit **90/90**.
- New deterministic bench case `m1:live-stream-falls-back-no-hijack` (fixture returns `isLive:true`
  for a `LIVE*` videoId; asserts `status==="fallback"`, `reason==="live"`, no `/videoplayback` hijack).
  Bench **21/21**.
- Live re-run: 3 VOD hijack + advance; **4 live streams fall back** (not hijacked, native video,
  live position advancing e.g. `46796→46800s`). No stall.

## Ad-block live (honest status)

`probe-adblock-live.mjs` could not observe live pruning: a raw WEB `/youtubei/v1/player` fetch returns
`UNPLAYABLE` (needs full playback context), and logged-out sessions on the sampled videos carried no ad
fields to prune. Ad-field pruning remains proven **deterministically in the bench**
(`m2b:enabled-prunes-player-ads`); live observability is environmental, not a defect.

## Gates

typecheck ✓ · eslint 0/0 ✓ · unit 90/90 ✓ · bench 21/21 ✓ · prettier ✓ · MV2 prod build clean
(no bench markers leak; only the benign `isSafeMediaUrl` `127.0.0.1` remains).

## Next

Desktop testing complete. Next: lightest mobile-Firefox emulator (Android). OpenJDK +
android-commandlinetools already installed in the background; do not boot the emulator until now.

## Addendum — cross-lab review hardening (same day)

A cross-lab review of the fix (codex + gemini + opus) raised two issues with the first `isLiveStream`
(which gated on `videoDetails.isLive` OR `isLiveContent` + a manifest url):
1. **3-lab-confirmed bug:** `hlsManifestUrl ?? dashManifestUrl` uses `??`, which does not skip an
   empty string — an API `hlsManifestUrl: ''` with a valid `dashManifestUrl` would slip through and
   re-open the stall.
2. **Empirical question:** could a finished ex-live VOD retain a manifest url and be wrongly blocked?

Resolved by an empirical signal audit (`tests/e2e/probe-live-signal-audit.mjs`, n=38): currently-live
11/11 had a manifest and **0/11** had audio `contentLength`; ex-live VOD **0/4** had a manifest and
**4/4** had `contentLength`; normal VOD 0/23 manifest, 23/23 `contentLength`. So (2) is a non-issue
(ANDROID_VR strips the manifest on finished streams) and, better, audio **`contentLength` is a
perfect, causal discriminator**. `isLiveStream` was reworked to `videoDetails.isLive === true` OR
**best audio format has no usable `contentLength`** — which eliminates the empty-string bug entirely,
never false-positives on ex-live replays, is fail-safe, and covers a live stream with an absent
`isLive` flag. Bench now exercises the `contentLength` path end-to-end (live fixture omits
`contentLength`); re-verified on 4 real live streams (fall back) + 3 VOD (hijack + advance).
