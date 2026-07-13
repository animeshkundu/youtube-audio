# ADR-0009: Ad-free video mode via ANDROID_VR (deferred)

## Status

Deferred. Recorded for a future decision; not implemented. The core stays audio-only, and native
video-mode ad relief remains the best-effort field-pruning path (task #69).

## Date

2026-07-12

## Context

The credentialless **ANDROID_VR** `POST /youtubei/v1/player` (`credentials:"omit"`) response is
genuinely **ad-free** (no `adPlacements`/`playerAds`), unlike the native `WEB` player response, which
needs constant JSON-surgery to strip ads (`docs/research/02-youtube-ad-blocking.md`). Today the
extension uses that response only for the best **audio** adaptive format, hijacking `<video>.src` for
audio-only playback (stopping video bytes to save battery and bandwidth).

The same response also carries **video**: `streamingData.formats` includes **itag-18** progressive
muxed (audio+video, single direct URL, no cipher, ~360p, sometimes 720p via itag-22), and
`streamingData.adaptiveFormats` includes video-only tracks up to 2160p (direct URL, no cipher). This
raises the question of an ad-free **video** mode, as a more robust alternative to fighting ads in the
native `WEB` player.

Two implementation paths were analysed.

### Path A: hijack the itag-18 progressive URL as `<video>.src`

- Trivial: identical mechanism to audio-only (progressive-format selection, then `PlayerHandle.attach()`).
  No new writer, no new invariant; reuses the dormant-guard / circuit-breaker / fail-open `restore()`.
- Genuinely ad-free (no JSON surgery, no anti-adblock arms race).
- No new permissions (`*://*.googlevideo.com/*` already granted; same credentialless POST already made).
- **Quality capped** at ~360p (occasionally 720p), no adaptive bitrate.
- **itag-18 not guaranteed present** (see the risk below), so the toggle silently no-ops on some videos.
- **Live/DVR detection would need extending, not just reusing.** The existing `isLiveStream`
  (`src/shared/innertube.ts`) gate keys on the best _adaptive audio_ format lacking `contentLength`.
  A progressive itag-18-only live response with no `videoDetails.isLive` could be misclassified as
  VOD and hijacked into a stalling live-edge `src`. A progressive-video path needs its own live/finite
  check (e.g. on the itag-18 format's own `contentLength`), so "reuse the existing gates" is not free.

### Path B: MediaSource Extensions (full adaptive quality)

- Full quality (adaptive video-only + audio-only tracks up to 2160p).
- Reimplements YouTube's adaptive player: two `SourceBuffer`s, manual ABR, buffer/eviction,
  keyframe-aligned seeking, A/V sync, stall recovery, fMP4 correctness. Order-of-magnitude larger than
  the ad arms race the project already declined as untenable for a solo maintainer.
- **Breaks the "PlayerHandle is the sole `<video>.src` writer" invariant** (one static write becomes a
  live `MediaSource` with continual `appendBuffer`); each mid-playback failure mode
  (`QuotaExceededError`, `InvalidStateError`, partial buffers) must fail open cleanly.

### Risks common to both

- **ANDROID_VR longevity is the biggest risk and is not hypothetical.** yt-dlp/yt-dlp#16150 (2026-03)
  reports `android_vr` becoming erratic since 2026-03-05: regional A/B testing intermittently collapses
  the format list to **itag-18 only** (no adaptive) and on other attempts to **SABR-only** (itag-18
  missing). yt-dlp pins `clientVersion 1.65.10` because `>1.65` may return SABR-only. The direct-URL /
  no-cipher / no-PO-token properties both paths depend on are being actively tightened in production.
- **Battery and bandwidth reversal.** Both paths flow video bytes again, the opposite of the tool's
  audio-only value proposition, so a video mode must be a distinct, clearly-labelled, off-by-default
  opt-in, never default-on.

## Decision

**Defer both paths.** Keep audio-only as the core and keep native video-mode ad relief on the bounded,
low-risk field-pruning path (task #69, including the `fetch`/`Response.json` prune already shipped).

If a video mode is later pursued, **Path A is the recommended approach**: a small, off-by-default
"Ad-free video (SD)" toggle that hijacks the itag-18 progressive stream via the existing
write-once/fail-open machinery, with automatic silent fallback to native (ad-supported) playback
whenever itag-18 is absent, live/DVR, or age-restricted (the audio-only gates plus a
progressive-specific live/finite check, since `isLiveStream` keys on the adaptive audio format; see
Path A).
**Path B is not justified** given its cost, the sole-writer invariant change, and, decisively, the
already-eroding ANDROID_VR foundation both paths sit on.

## Consequences

- No ad-free video mode ships now; users wanting ad relief in video mode get best-effort field-pruning
  (#69), which is honest about being non-guaranteed against SABR-stitched ads.
- If Path A is later added, it is invariant-neutral and reuses existing machinery, so the incremental
  cost is small; but expect it to silently fall back on a growing fraction of videos as ANDROID_VR is
  tightened. Revisit only if ANDROID_VR's direct-URL guarantee proves durable rather than eroding.

## Related

- Task #69 (native-video ad-block parser gap), `docs/research/02-youtube-ad-blocking.md`,
  `docs/research/04-youtube-streaming-internals.md`, `src/shared/innertube.ts`, `src/shared/player.ts`.
