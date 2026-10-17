# Research 21: Live audio-only spike (SPEC-029)

**Date:** 2026-10-17
**Status:** Spike complete for 1.1.0 scope; implementation deliberately deferred
**Related:** SPEC-014 (media-client resilience), SPEC-029 (spike criteria), ADR-0012 (media-client table)

## Question

Can the extension play a **live** YouTube broadcast as audio only, without regressing the
fail-open guarantee that live streams currently enjoy?

## What we already know (in-repo, primary observations)

- The credentialless `/youtubei/v1/player` response for a live broadcast is `status: "OK"` and
  carries an audio adaptive format **with** a `url`, but that URL is a live-edge segment: hijacked
  as a progressive `<video>.src` it stalls at `currentTime 0`. `isLiveStream()` in
  `src/shared/innertube.ts` detects this two ways (the explicit `videoDetails.isLive === true` flag,
  and the absence of `contentLength` on the best audio format) and the extension **fails open** to
  YouTube's native DASH/HLS player. Empirically (2026-07-11 signal audit, n=38): 11/11 live formats
  lacked `contentLength`; 27/27 finite VOD formats had it.
- Live playback therefore currently works normally (native), just not as audio-only.

## Why a naive hijack cannot work

A progressive audio URL only exists for finite, seekable files. Live is delivered as a manifest
(DASH/HLS), and Firefox has no native HLS support, so an audio-only live path would need
MediaSource Extensions (MSE) wired to the audio rendition of the manifest. That is a materially
different media pipeline from the single-URL hijack the rest of the extension is built on, and it
would touch the `PlayerHandle` "sole `<video>.src` writer" invariant.

## Candidate approaches (most promising first)

1. **Embedded-client audio rendition via MSE.** Have a credentialless client return a manifest
   (`streamingData.hlsManifestUrl` / DASH) and attach only the audio representation through MSE.
   - Pros: could be truly audio-only; stays within our credentialless fetch model.
   - Cons: a second media pipeline, MSE lifecycle management, and the `PlayerHandle` invariant would
     need a scoped exception. Medium-to-large effort; high regression surface. **Open question:**
     does any credentialless persona return an audio-only HLS rendition for live, and does it need
     a PoToken we do not handle?
2. **Native player with video track suppressed.** Keep YouTube's own DASH playback and zero the
   video surface (CSS/`display:none`), leaving audio to decode natively.
   - Pros: no new media pipeline; reuses YouTube's proven live playback.
   - Cons: still downloads the video bandwidth, which defeats the feature's purpose on metered
     connections. Not "audio only" in the bandwidth sense.
3. **Do nothing (status quo).** Live plays natively; only the non-live path is enhanced.

## Decision for 1.1.0

Do **not** ship live audio-only. It fails the spike's "reliable / fail-open / minimal surface"
bar without a large, invariant-touching media pipeline, and the current behaviour is already safe
(native playback, never a broken page). Approach 2 (bandwidth-only) and approach 1 (true audio,
new pipeline) remain documented candidates for a later, separately specced effort with live
primary-source verification and a PoToken answer.

### Fallback messaging improvement

The one shippable, zero-risk part of the spike: make the popup explain the live case instead of
showing a bare `fallback`. This rides on the existing `live` fallback reason (SPEC-014) and adds no
new permission, client, or network egress. Tracked here rather than as shipped code because the
status wording lives in the popup's status vocabulary and should be reviewed with the UI owner.

## What would change the decision

- A credentialless client that serves a **finite** audio-only rendition of a live edge (unlikely).
- An MSE audio-only path proven across desktop + Android with the `PlayerHandle` invariant scoped.
- A native-playback-with-suppressed-video path that the product owner accepts as "audio only
  enough", paired with a bandwidth disclosure.

## References

- `src/shared/innertube.ts` (`isLiveStream`, the `contentLength` audit)
- `docs/research/04-youtube-streaming-internals.md`
- `tests/e2e/probe-*-live*.mjs` (non-gating live canaries)
