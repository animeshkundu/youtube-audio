# ADR-0008: Audio-mode artwork via overlay, and its network-egress stance

## Status

Accepted.

## Date

2026-07-12

## Context

In audio-only mode the extension points the page `<video>` at an audio-only stream, so the video area
paints nothing and shows a black rectangle. That is the product's defining state and it looks broken.
The video's thumbnail URLs already ride in the ANDROID_VR player response
(`videoDetails.thumbnail.thumbnails[]`), so we can show artwork without a new metadata request.

Two constraints shaped the design:

- **The sole-`<video>.src`-writer invariant.** `PlayerHandle` is the only writer of `<video>.src` and a
  prototype guard reasserts the audio URL if anything else writes it. Any artwork mechanism must not
  touch `.src`.
- **`data_collection_permissions.required: ['none']` and credentialless operation.** The extension
  makes no automatic data egress about the user. Loading a thumbnail image is a network request, so it
  needs an explicit, honest decision rather than being slipped in.

## Decision

**Render artwork as a mounted DOM overlay, not `video.poster`.** A `<video poster>` is cleared on the
first decoded frame and is unreliable when the element has no video track; it is also fought by
YouTube's opaque player container. Instead, `showArtworkOverlay` appends an absolutely-positioned,
`pointer-events:none`, `contain:strict` overlay (blurred backdrop + centered art) as the media
container's last child. It never reads or writes `.src`, so the guard is untouched, and it is purely
decorative (no interaction, `aria-hidden`).

**Lifecycle is bound to `PlayerHandle.restore()`.** `restore()` is the single teardown choke point for
every path, including the circuit breaker, which tears down without emitting a status event, so a
status-listener would miss it. `PlayerHandle.onRestore(cb)` lets the page world tear the overlay down
deterministically; work is also generation- and epoch-guarded and self-cleans on image error.

**The thumbnail load is accepted as a page-equivalent resource load, and hardened.** It is not data
egress _about the user_: it is the same `i.ytimg.com` image the page itself loads, requested with
`crossorigin="anonymous"` and `referrerpolicy="no-referrer"` so no referrer or credentials leak. It is
user-visible artwork, not background telemetry, so it does not change the `data_collection: none`
posture. For the fallback-edge videos whose thumbnails are blank/placeholder, we ship a bundled inline
`data:` SVG placeholder (no network at all), and detect YouTube's grey 120x90 placeholder by
`naturalWidth` and swap to it.

**Setting + default.** A new `audioArtworkEnabled` boolean (default **true**, effective only while
`audioOnlyEnabled`) gates it, with one advanced Playback row. Default-on because it fixes a
looks-broken state at essentially zero incremental privacy cost given the hardening above; users who
want the black screen can turn it off.

## Consequences

- The black rectangle is replaced by album-art-style artwork on desktop, `m.youtube.com`, and
  `music.youtube.com`; it fails open to the current black screen on any error.
- One extension-initiated image request per hijacked video (skipped when the placeholder is used). The
  bench asserts artwork causes exactly the intended thumbnail request and no other egress.
- `mediaSession` artwork is deliberately not touched in v1 (preserve YouTube's own); an Android
  re-assert is deferred to the S4 device lane.

## Related

- ADR-0007 (status delivery), SPEC-012 (holistic UX foundations), `docs/design/audio-mode-artwork.md`.
