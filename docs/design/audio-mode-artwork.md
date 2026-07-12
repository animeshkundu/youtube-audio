# Design: Audio-Mode Artwork Backdrop

Status: proposed (design only, no code in this change)
Date: 2026-07-11
Related: SPEC-002 (M1 core playback), docs/research/14 (design language), docs/research/06 (background playback / media session), docs/architecture/README.md (M1 playback flow)

## Overview

In audio-only mode the extension hijacks the page `<video>.src` to a direct audio
stream (`PlayerHandle`, `src/shared/player.ts`). The audio track plays, but the
element now has no video track, so the player paints a **black rectangle** behind
YouTube's controls. This design replaces that black screen with the video's
**thumbnail / artwork**, rendered like a music player's album art: a blurred
full-bleed backdrop with the artwork centered on top. It applies on desktop
(`www.youtube.com`), mobile (`m.youtube.com`), and YouTube Music
(`music.youtube.com`).

The feature is purely additive and cosmetic. It never touches the media element,
the hijack, or the network path. Every failure mode falls open to "no artwork"
(the current black screen), never to a broken player.

## Goals

- Show the video's artwork behind the player controls **during playback**, not
  just before it starts.
- Source the image from data we already have (`videoDetails.thumbnail.thumbnails`
  in the player response we already fetched) so no new host permission is needed.
- Tie the overlay lifecycle to the exact hijack lifecycle so it can never leak,
  linger on the wrong video, or survive a fallback / circuit-break / disable.
- Survive theater, fullscreen, and miniplayer without special-casing each.
- Never block the ytp controls, the scrubber, right-click, or double-click.
- Deterministic, no-human test signal on the hermetic bench, plus pure unit tests.

## Non-Goals

- Changing the audio hijack, the ANDROID_VR fetch, or media selection.
- Canvas pixel readback / dominant-color extraction (that would need CORS + a
  host permission; out of scope, see Manifest section).
- Re-implementing YouTube's `mediaSession`. We preserve it and only optionally
  repair missing Android artwork behind a flag (see Media Session section).
- A popup control. Artwork is set-and-forget; any toggle lives in Settings only.

## Reasoning

### Problem understanding

The black screen is a direct, unavoidable consequence of a working audio-only
hijack: a progressive audio URL has no video track, so the `<video>` renders
black. Users perceive this as "the extension broke the video." A music-player
backdrop reframes the same state as intentional and pleasant.

### Key constraints

- The thumbnail must show _while audio plays_, so the `<video>` `poster` attribute
  is disqualified (it is cleared the instant the first frame decodes, even a black
  one). Confirmed by MDN: the poster is shown only while downloading / before the
  first frame, and "once playback begins, the poster frame is no longer shown."
- The overlay must be leak-proof against **every** teardown path, including the
  circuit breaker, which restores native playback **without emitting a status
  event** (`PlayerHandle.openCircuit()` -> `restore()`, `src/shared/player.ts:136-138`).
  Any design driven only by the `yta:status` event would leak on that path.
- No new host permission is desirable (the manifest scopes hosts to
  youtube/googlevideo, `wxt.config.ts:66-91`). Displaying an `<img>` is a page
  resource load governed by the page CSP, not by extension host permissions, and
  YouTube's own CSP already permits `i.ytimg.com`.
- In-page DOM has no access to the `tokens.css` design variables (those load only
  in the popup/options documents). In-page code hardcodes values inline, exactly
  as the lyrics panel does (`entrypoints/content.ts:146-147`). The overlay mirrors
  the token values as literals.

### Approach (summary)

A dedicated **overlay element** appended inside the player's video container, fed
by the **largest `videoDetails.thumbnail.thumbnails` URL** from the player
response, with an `i.ytimg.com` `maxres -> sd -> hq` fallback chain, mounted and
torn down through a **cleanup callback bound to the successful `attach()`** so its
lifetime is identical to the hijack's. Details below.

### Risks

- YouTube DOM class churn (undocumented internals). Mitigated by mounting relative
  to the hijacked `<video>` element itself (`video.parentElement`), not a
  hardcoded selector, and by failing open.
- Stacking: sibling order alone does not _guarantee_ paint order (a positive
  `z-index`, transform, opacity, or containment on `.video-stream` or the container
  can change it). Treated as an observed, screenshot-verified arrangement across a
  mode matrix, not a contract; a small explicit local `z-index` is permitted if the
  measured stacking chain needs it (never a globally high one). See Decision 1.
- The `<video>` node being replaced/recycled by YouTube (miniplayer, Picture-in-
  Picture, playlist advance) without a hard navigation. Mitigated by the existing
  SPA engine, which watches the physical `<video>` identity and re-navigates, and
  by the `src` guard for same-node overwrites; see Decision 3.
- A future YouTube CSP change could block `i.ytimg.com`. Mitigated because the
  primary source is the player-response thumbnail (same origin family YT itself
  uses), the primary-load-error path falls through to the canonical chain, and the
  whole feature fails open.
- Blur cost / GPU memory of a large composited layer (mobile). Mitigated by
  blurring a mid-size thumbnail (not full-res), a static one-time paint, and a
  device check (energy saving motivates audio-only, so the backdrop must not erode
  it).

### Validation

Hermetic bench asserts the overlay appears on hijack, carries the fixture
thumbnail src, is `pointer-events:none`, updates across SPA nav, and disappears on
disable and on circuit-break. Pure unit tests cover source selection, the fallback
chain, and placeholder detection. See Testing.

## Decision 1: WHERE the artwork renders

**Recommended: a dedicated overlay element appended inside the player's video
container (the `<video>`'s parent), positioned to fill it, `pointer-events:none`.**

Rationale and rejected alternatives:

| Option                                          | During playback?                                                                                                                               | Verdict                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `<video poster>`                                | No. Cleared on first decoded frame (MDN).                                                                                                      | Rejected. Insufficient.                |
| Overlay element inside `.html5-video-container` | Yes. Independent of the decode pipeline.                                                                                                       | **Recommended.**                       |
| CSS `background-image` on the container         | Yes, but mutates YouTube's own element and gives less control over the two-layer (blur backdrop + contained art) look and over clean teardown. | Rejected. Owns a foreign node instead. |

Why append **inside the video container** rather than onto `.html5-video-player`:

- The video container (the direct parent of `<video>`) holds only the `<video>`.
  Appending our node as its **last child** paints it **above the black video**
  (later sibling) while `.ytp-chrome-bottom`, `.ytp-gradient-bottom`, the big play
  button, the buffering spinner, and context menus (later siblings of the container
  inside `#movie_player`) paint above it. The fixture DOM shows this structure
  exactly (`tests/e2e/bench/fixture-server.mjs:199-217`).
- Important caveat (raised in review): sibling order does **not** by itself
  guarantee paint order. A positive `z-index`, `transform`, `opacity`, or
  containment on `.video-stream` or on the container can reorder layers. So this is
  an **observed, screenshot-verified** arrangement, not a contract. The contract we
  actually hold is narrower: _the overlay occupies a local layer just above the
  video, and the video container's stacking context stays below YouTube's chrome._
  If the measured computed stacking chain on a supported surface requires it, the
  overlay may take a **small explicit local `z-index`** (e.g. `1`) to sit above the
  video, but **never** a globally high value that could escape the container and
  cover the chrome. Paint order is verified with real-Firefox screenshots, not just
  the bench's parentage check (see Testing / Modes below).
- Mounting relative to the hijacked `<video>` (`video.parentElement`) rather than a
  hardcoded selector makes the same code work on desktop, `m.youtube.com`, and
  `music.youtube.com`, and resilient to class renames. The only claim we rely on is
  that the overlay's containing block follows the displayed video bounds; that is
  verified directly rather than assumed to be "the container moves into miniplayer."

`pointer-events:none` on the overlay root (and, defensively, re-applied to the
`<img>` and backdrop children so page CSS cannot make a descendant targetable) is
the second guard: the scrubber, play/pause, volume, settings, fullscreen, hover-to-
reveal, right-click, and double-click all live under the overlay's bounding box and
must receive every event. Note `pointer-events:none` only fixes hit-testing, not
_visual_ occlusion, which is why paint order is verified separately.

### Modes and limitations

Paint order and coverage are verified (real-Firefox screenshots) across the matrix:
normal / theater / miniplayer, desktop and mobile control DOMs, with the scrubber,
settings menu, captions, and end-screen visible. Documented limitations, all
fail-open (worst case is the current black screen, never a broken player):

- **Native element-fullscreen of the bare `<video>`** (rather than `#movie_player`)
  would promote the video to the browser top layer, above our in-DOM overlay, so
  the backdrop would not show. YouTube's own fullscreen fullscreens the player
  container (our overlay follows), so this is an edge case; in audio-only the user
  rarely fullscreens a black video.
- **Picture-in-Picture** renders the video surface outside the page DOM, so the
  overlay does not appear there. PiP of an audio-only (black) video has no purpose,
  so this is acceptable.

## DOM and CSS structure

One injected stylesheet (once), one overlay node per active hijack.

Injected `<style id="yta-artwork-style">` (mirrors `installPlayerControlStyles`,
`entrypoints/content.ts:297-324`; token values inlined as literals from
`entrypoints/ui/tokens.css`):

```css
.yta-audio-artwork {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none; /* never steal a click from the chrome below */
  background: #0f0f0f; /* --surface-0, so any gap is calm near-black */
  opacity: 0;
  transition: opacity 240ms cubic-bezier(0.2, 0, 0, 1); /* --dur-3 / --ease-standard */
  contain: strict; /* isolate paint/layout from the page */
}
.yta-audio-artwork[data-visible='true'] {
  opacity: 1;
}

.yta-audio-artwork__backdrop {
  position: absolute;
  inset: -8%; /* bleed so blurred edges never show a seam */
  background-size: cover;
  background-position: center;
  filter: blur(28px) brightness(0.5) saturate(1.1);
  transform: translateZ(0); /* promote once; static image, no ongoing cost */
}

.yta-audio-artwork__art {
  position: absolute;
  inset: 0;
  margin: auto;
  max-width: min(78%, 78vh);
  max-height: 62%;
  object-fit: contain;
  border-radius: 12px;
  box-shadow:
    0 4px 12px rgb(0 0 0 / 50%),
    0 16px 48px rgb(0 0 0 / 44%); /* --elev-2 */
  opacity: 0;
  transition: opacity 240ms cubic-bezier(0.2, 0, 0, 1);
}
.yta-audio-artwork__art[data-loaded='true'] {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .yta-audio-artwork,
  .yta-audio-artwork__art {
    transition-duration: 0.001ms;
  }
}
```

Overlay node created per activation:

```
div.yta-audio-artwork[aria-hidden="true"]
├── div.yta-audio-artwork__backdrop        (background-image: mid-size thumbnail, blurred)
└── img.yta-audio-artwork__art             (largest thumbnail; opacity 0 until onload)
```

Notes:

- `aria-hidden="true"`: the artwork is decorative; screen readers ignore it. The
  media element and controls remain the accessible surface.
- The foreground is an `<img>` (so we can read `naturalWidth` for placeholder
  detection on the fallback path) but stays `opacity:0` until `onload`, so a broken
  image never flashes; on final error the whole overlay is removed (fail open).
- The backdrop is a `background-image` div (fails silently, never a broken glyph)
  and uses a **mid-size** thumbnail so the blur processes far fewer pixels.
- No high z-index. Correct stacking comes from being the container's last child.

## Decision 2: SOURCE and fallback chain

Primary source is the player response we **already fetched** in
`activateEnhancements` (`entrypoints/main-world.ts:319-349`), so there is **no
additional metadata fetch and no new permission**. (The image itself is still 1-2
passive page-resource loads, decoded on the page; "already fetched" refers to the
metadata, not the image bytes.)

`videoDetails.thumbnail.thumbnails[]` shape (each `{ url, width, height }`; raw
order is not contractually sorted, so we sort ourselves):

- **Foreground art** = the entry with the largest `width` (`pickArtworkUrl`). A DPR
  / container-size aware choice (or `srcset`) is a possible refinement; largest is
  the simple default and looks fine blurred + contained.
- **Backdrop** = a mid-size entry (~`width` closest to 480, i.e. `hqdefault`-class)
  to keep the blur cheap; falls back to the foreground URL if only one size exists.

For YouTube Music, `videoDetails.thumbnail.thumbnails` already carries the track /
album art (square), so the same "largest entry" rule yields album art with no
special path. We deliberately do **not** scrape `ytmusic-*` DOM for art; the player
response is the stable, same-data-we-already-have source.

Resolution order (the primary URL is **not** assumed to always succeed; a valid-
looking URL can be expired or CSP-blocked, and response thumbnails are usually but
not contractually `i.ytimg.com`):

1. Try the primary `pickArtworkUrl` URL.
2. On its `load` **error**, fall through to the canonical `i.ytimg.com` chain for
   the validated `videoId`:

```
https://i.ytimg.com/vi/<id>/maxresdefault.jpg   (1280x720, often missing)
https://i.ytimg.com/vi/<id>/sddefault.jpg       (640x480, only if source >=480p)
https://i.ytimg.com/vi/<id>/hqdefault.jpg        (480x360, effectively universal)
```

3. If the player response has **no** usable thumbnail at all, start directly at the
   canonical chain.
4. If every candidate fails, remove the overlay (fail open to black).

`maxresdefault.jpg` returns **HTTP 200 with a 120x90 grey placeholder** when it
does not exist (not a 404), so status codes cannot detect it. For the **canonical
candidates only**, on `img.onload` a `naturalWidth <= 120` means placeholder, so we
advance. The `<img>` walks the chain via `onerror` plus that placeholder check;
`hqdefault.jpg` is the universal floor. The placeholder check is **not** applied to
the primary response URL (a legitimate response thumbnail can be 120px wide). To
avoid a grey-placeholder flash on the _backdrop_, resolve the backdrop URL through
the same off-DOM `Image()` probe before assigning it as `background-image`.

The serial maxres -> sd -> hq wait can add latency before art appears; an optional
refinement is to paint `hqdefault` immediately as a baseline and upgrade to maxres
opportunistically (P1, see open questions). All image `load`/`error` handlers are
**generation-guarded and cancelled on cleanup** (Decision 3), so a late event from a
previous video can never mutate a newer activation or the bench marker.

Pure helpers (new module `src/shared/artwork.ts`, unit-tested like `innertube.ts`):

- `pickArtworkUrl(playerResponse): string | null`: largest valid thumbnail URL, or
  `null`. Validates each URL with the same safe-URL rule as `player.ts`
  (`https:` or `127.0.0.1`/`localhost`, so the hermetic bench's `http://127.0.0.1`
  fixture URLs pass while arbitrary `javascript:`/`data:` are rejected).
- `pickBackdropUrl(playerResponse): string | null`: mid-size entry, else the
  largest, else `null`.
- `buildThumbnailFallbackChain(videoId): string[]`: the `maxres/sd/hq` list;
  returns `[]` for an invalid id (`/^[A-Za-z0-9_-]{6,20}$/`, matching
  `getVideoId`, `entrypoints/main-world.ts:605-612`).
- `isPlaceholderThumbnail(naturalWidth: number): boolean`: `naturalWidth <= 120`.

## Decision 3: LIFECYCLE and PlayerHandle / SPA integration

**Recommended: bind the overlay's teardown to the successful `attach()` via a
cleanup callback that `PlayerHandle.restore()` invokes.** `restore()` is the single
choke point for _every_ extension-side teardown, and the two ways YouTube can end
the hijack _without_ an extension call are each already handled by tested code
(below), so the overlay's lifetime tracks the hijack's.

`restore()` is reached from all of these (`src/shared/player.ts`):

- `navigate()` -> `restore()` (`:35`): SPA nav and settings re-apply.
- `attach()` -> `restore()` at the top (`:48`): re-attach within a generation.
- `disable()` -> `restore()` (`:71`): feature turned off.
- `openCircuit()` -> `restore()` (`:137`): the circuit breaker, **which emits no
  status event**.
- `attach()` catch -> `restore()` (`:65`): attach failure.

The two externally-driven teardowns (raised in review) and why they are covered:

- **YouTube overwrites `src` on the _same_ `<video>`** (native recovery, ad, etc.).
  The dormant setter guard (`installDormantGuard`, `src/shared/player.ts:74-107`)
  intercepts it: it reasserts the audio URL up to `maxReassertions`, then
  `openCircuit()` -> `restore()`. So either we stay the legitimate owner (video
  still black, overlay correct) or the circuit opens and the overlay is removed.
  Already tested: `tests/unit/player.test.ts:58-71`.
- **YouTube replaces or recycles the `<video>` node** (miniplayer, PiP, playlist
  advance) with no hard navigation. The existing SPA engine watches the _physical_
  `<video>` identity: its `MutationObserver` emits `reason: 'player-change'` when
  `document.querySelector('video') !== lastVideo` (`src/shared/spa.ts:36-40`), and
  the MAIN-world subscriber calls `player.navigate()` on every emit
  (`entrypoints/main-world.ts:233-247`) -> `restore()` -> overlay removed, then the
  fresh activation mounts the new video's artwork. This is exactly the "bind
  teardown to the node's existence" property, provided by an observer the code
  already runs, so no second `MutationObserver` is added. (If the old node is
  detached rather than swapped in place, the overlay is detached with its parent and
  garbage-collected, not left visible.)

Minimal `PlayerHandle` change (covered by the existing `mediaPrototype` option test
pattern in `tests/unit/player.test.ts`):

- `attach(mediaElement, audioUrl, generation, onAttached?)` gains an optional
  `onAttached: (media, generation) => (() => void) | void`. On a **successful**
  attach (end of `attach()`, at the current `return true`, `:63`), store
  `this.detachCleanup = onAttached?.(mediaElement, generation) ?? null`.
- In `restore()`, **first extract and clear** `detachCleanup` into a local, then
  invoke it in **its own** `try` (separate from the native-restoration `try` at
  `:148-163`), so cleanup is idempotent, reentrancy-safe, and a cleanup throw can
  never block native restoration (and vice versa).
- `showArtwork(...)` must **self-clean on throw**: if it appends the node and then
  throws before returning `cleanup`, it removes the partial node in its own
  `try/catch` and returns a no-op, so `attach()`'s catch path cannot leave an
  orphaned overlay (`detachCleanup` would otherwise be unset).

Wiring in `activateEnhancements` (`entrypoints/main-world.ts:344-350`), where
`responseData`, `videoId`, and `operationGeneration` are all in scope:

```ts
const artworkUrl = settings.audioArtworkEnabled ? pickArtworkUrl(responseData) : null;
const backdropUrl = artworkUrl ? pickBackdropUrl(responseData) : null;
if (
  player.attach(mediaElement, audioUrl, operationGeneration, (media, gen) =>
    settings.audioArtworkEnabled
      ? showArtwork(media, {
          artworkUrl,
          backdropUrl,
          videoId,
          generation: gen,
          bench: __BENCH__,
        })
      : undefined
  )
) {
  emitStatus('active');
} else {
  emitStatus('fallback', 'media-attach-failed');
}
```

`showArtwork(...)` (in `src/shared/artwork.ts`) creates the overlay, appends it to
`media.parentElement`, resolves the image (primary URL, then the canonical chain via
an off-DOM `Image()` whose `load`/`error` handlers are **generation-guarded** so a
late event after teardown is ignored), sets `data-visible`, sets the bench marker to
the finally-resolved `src`, and returns a `cleanup()` that removes the node, marks
the pending image load cancelled, and clears the bench marker. Because `cleanup` is
the value `PlayerHandle` stores and calls in `restore()`, the overlay's lifetime is
exactly the hijack's:

- New video via SPA (`observeYouTubeSpa`, `entrypoints/main-world.ts:233-247`):
  `player.navigate()` -> `restore()` -> old overlay removed; the new
  `activateEnhancements` re-attaches and shows the new artwork. No stale image.
- Audio-only toggled off / master off (`applySettings`,
  `entrypoints/main-world.ts:121`): `navigate()` -> removed; no re-show.
- Fallback (live/auth/no-direct-audio): `attach()` is never called, so no overlay
  is ever created; native video (a real picture) is left untouched.
- Circuit breaker fires: `openCircuit()` -> `restore()` -> removed. This is the
  path a status-driven design would miss.
- `<video>` swapped/recycled with no nav: `spa.ts` `'player-change'` -> `navigate()`
  -> `restore()` -> removed (see above).

Why not drive it from the `yta:status` event in `content.ts`
(`entrypoints/content.ts:419-430`)? Because `openCircuit()` restores native
playback silently (no status emit), so a status-driven overlay would linger over a
now-native video. The cleanup-callback binds to the real state machine and avoids
that class of bug. This is the decisive reason the overlay is owned in MAIN world
(where `PlayerHandle` and the player response both live), not in the isolated
content script.

Re-mount robustness inside a single video (no navigation): the overlay stays a
child of the persistent container across theater/fullscreen/miniplayer, so no
re-mount is needed. As optional hardening (not required for v1), `showArtwork`
could keep a lightweight `MutationObserver` on the container to re-append if
YouTube ever removes the node; v1 keeps it simple and relies on the container's
persistence, matching how the lyrics and button features mount once.

## Decision 4: Media Session artwork tie-in

Stance: **preserve, do not fight.** YouTube already sets
`navigator.mediaSession.metadata` including `artwork` (proven in
`docs/research/06 §4.3`), and audio-only keeps the _same_ media element playing, so
the OS lock-screen art keeps working through YouTube's own metadata. The visual
backdrop and the OS art are independent surfaces; v1 does **not** touch
`mediaSession` for the backdrop feature.

Firefox support note (reconciling a source conflict): a general web summary and
MDN's Baseline label say MediaSession is "not supported in Firefox." The project's
own deeper audit (`docs/research/06 §4.2`) shows that label is wrong and that BCD
is authoritative: `MediaSession` / `metadata` are supported since **Firefox 82** on
desktop and Android, with Android flagged `partial_implementation` (the API exists
but the user-facing control fidelity is weaker). We follow the project's
BCD-grounded finding.

Optional, gated repair (not default, matches `docs/research/06 §4.4 step 2`): on
Firefox Android, if the notification shows blank/stale art, re-assert
`navigator.mediaSession.metadata.artwork` on track change from MAIN world, mirroring
the same thumbnails, using the standard `MediaImage` array (`{ src, sizes, type }`)
at 96/128/192/256/384/512 px. To minimize a tug-of-war with YouTube's own updates,
mutate the existing `MediaMetadata.artwork` in place rather than replacing the
object, apply after YouTube's script runs, and re-apply if observed reset. This is
opt-in and evidence-driven; recommend deferring it until Android device
verification (S4), tracked as an open question below.

## Manifest / permission check

**No manifest change is required.**

- The primary source (`videoDetails.thumbnail.thumbnails`) is read from a response
  we already fetched; rendering it as an `<img>` / CSS `background-image` is a page
  resource load, not an extension `fetch`, so it is not gated by extension host
  permissions.
- The `i.ytimg.com` fallback is likewise a plain `<img>` load. It is governed by
  the **page** CSP, and YouTube's `img-src` already allows `i.ytimg.com` (YT loads
  all its own thumbnails from there). The fixture page sets no CSP, so the bench is
  unaffected.
- CORS is irrelevant: `<img>` display and CSS `background-image` never require CORS.
  CORS would only matter if we drew the image into a `<canvas>` and read pixels back
  (dominant-color extraction) - that is a non-goal. If it is ever pursued, it would
  require a `*://i.ytimg.com/*` host permission plus `crossorigin="anonymous"` plus
  the CDN returning `Access-Control-Allow-Origin`; flagged here so the trade-off is
  explicit.

## Desktop vs mobile

- **Desktop `www.youtube.com`**: `.html5-video-player` > `.html5-video-container` >
  `<video>`; controls in `.ytp-chrome-bottom`. Mount into the container.
- **`m.youtube.com`**: the mobile web player is a variant of the same player
  (`.html5-video-player` / `.html5-video-container`), with more aggressive
  auto-hide of the chrome. Because we mount relative to `video.parentElement` and
  never touch the chrome, the same code applies; verify on the bench's mobile Fenix
  probe (`tests/e2e/probe-mobile-fenix.mjs`) that the backdrop does not flash during
  the controls' show/hide transition (it will not, since it is a separate,
  chrome-independent node).
- **`music.youtube.com`**: the shell is custom `ytmusic-*` web components, but a
  `<video>` still exists and is the element we hijack, so mounting into
  `video.parentElement` keeps the same code path. The largest thumbnail is square
  album art, which suits the centered-art look. No `ytmusic-*` selector dependency.
- Mounting relative to the hijacked `<video>` (not a per-surface selector) is what
  makes one implementation serve all three surfaces.

## Test signal (deterministic, hermetic)

Follows the existing marker convention (`data-yta-*` on `documentElement`, set only
under `__BENCH__`, mirroring `ytaAudioGraph`/`ytaLyrics`/`ytaSkipArmed`).

Production behavior is unmarked (ghost-friendly); only the bench build emits markers.

**Marker:** the marker reflects the **finally-resolved** foreground `src`, not an
optimistic guess: `showArtwork` writes `document.documentElement.dataset.ytaArtwork
= JSON.stringify({ src })` whenever the displayed `src` settles (initial primary
load, and again if the canonical fallback chain advances), and `cleanup()` clears
it. The overlay node carries the stable class `yta-audio-artwork` for direct
inspection. Because the marker updates on the _settled_ src, the bench must **poll
to a settled state** (the existing `waitFor` helper, `run-bench.mjs:114-123`) rather
than read once, which removes any onload-vs-marker race.

**Fixture additions** (`tests/e2e/bench/fixture-server.mjs`):

1. Add to `fixturePlayerResponse` `videoDetails` a `thumbnail.thumbnails` array
   pointing at the fixture origin, e.g.
   `[{ url: ${origin}/vi/<id>/hq.jpg, width: 480, height: 360 }, { url: ${origin}/vi/<id>/maxres.jpg, width: 1280, height: 720 }]`
   so `pickArtworkUrl` returns the `maxres` URL and `pickBackdropUrl` the `hq` URL,
   both keyed by the requested `videoId` (so SPA re-nav produces a different src).
   For a special id prefix (e.g. `NOTHUMB...`, alongside the existing `LIVE`/`AUTH`
   prefixes) omit `thumbnail` so the **fallback path** is exercised deterministically.
2. Add a route `GET /vi/:id/:name` that returns a small valid PNG (>=121px wide, so
   `isPlaceholderThumbnail` is false), following the `FIXTURE_WAV` pattern (a static
   in-memory buffer). This lets the bench assert `img.naturalWidth > 0` and that no
   page error fired. (The canonical `i.ytimg.com` chain itself is external, so it is
   proven by unit tests, not the hermetic bench; the fixture only proves the primary
   path and, via the `NOTHUMB` id, that the resolver advances when the primary is
   absent by pointing its constructed fallback at the same `/vi/` route in the bench
   build.)

**Bench snapshot + probes** (`tests/e2e/bench/run-bench.mjs`):

- Extend `snapshotScript` with `artwork: document.documentElement.dataset.ytaArtwork
|| null` and an overlay probe returning
  `{ present, src, pointerEvents, insideVideoContainer, naturalWidth }` for
  `.yta-audio-artwork`.
- New `probeArtwork` session (audio-only on, `audioArtworkEnabled` on): poll until
  `status === 'active'` and the marker is set, then assert overlay present,
  `pointerEvents === 'none'`, overlay is a child of the hijacked `<video>`'s parent,
  `naturalWidth > 0`, and `src` includes the fixture `maxres` URL for the video id.
- Reuse/extend the **SPA** run (`probeSpaRearm`, `run-bench.mjs:242-256`) to assert
  the artwork `src` switches to the `FIXTURE0002` thumbnail after `pushState`.
- Reuse/extend the **circuit breaker** run (`probeCircuitBreaker`,
  `run-bench.mjs:258-271`) with artwork on: after the circuit opens, assert the
  overlay is **removed** and `ytaArtwork` is `null` (the leak-proofing test).
- The `disabled` run (`run-bench.mjs:774-801`) asserts `artwork === null` and no
  overlay.

**Unit tests** (`tests/unit/artwork.test.ts`): `pickArtworkUrl` picks the largest
and rejects malformed/unsafe entries and empty input; `pickBackdropUrl` picks
mid-size and degrades to largest; `buildThumbnailFallbackChain` returns the three
URLs for a valid id and `[]` for an invalid id; `isPlaceholderThumbnail` is true at
<=120 and false at 1280. The async image resolver (chain advance on error,
placeholder-skip on `naturalWidth<=120`, generation-guard so a late event after
cleanup is a no-op, self-clean on a mount throw) is unit-tested with a fake `Image`
and a jsdom container. Targets the 90% floor (`vitest.config.ts` thresholds).

## Settings integration

New boolean `audioArtworkEnabled`, default `true`, only effective while
`audioOnlyEnabled` is on. Wiring points (all following the existing pattern of an
adjacent boolean setting):

- `src/shared/config.ts`: add to `ExtensionSettings` (`:7-26`), `DEFAULT_SETTINGS`
  (`:39-58`, default `true`), a signal (`:60-79`), `applySettings` (`:203-224`),
  and `normalizeSettings` (`:226-293`).
- `entrypoints/main-world.ts`: add to `PageSettings` (`:35-49`), `parseSettings`
  (`:623-663`), the default `settings` object (`:72-86`), and the enhancement gate
  so it participates like the other audio settings.
- `entrypoints/content.ts`: it is included automatically in the `settings` payload
  posted to MAIN world (`:57-62`); no bespoke handling needed.
- UI: one row in Settings > Playback (advanced disclosure), label "Show artwork in
  audio-only", description "Shows the video thumbnail instead of a black screen."
  No popup slot (respects the 6-zone budget, `docs/research/14 §3.1`).

Rationale for a setting rather than always-on: it gives the 10% an off switch
(pure-black / battery preference) and gives the bench a clean way to prove "no
overlay when off," while the 90% get it on by default. The feature code is
identical whether or not the toggle is exposed; see open questions.

## Step-by-step implementation plan

1. **Docs first** (this doc; update `docs/architecture/README.md` M1 flow to note
   the overlay is created on successful attach and removed by `restore()`; add a
   short spec section or SPEC entry per the repo's docs-first rule).
2. **Pure module** `src/shared/artwork.ts`: `pickArtworkUrl`, `pickBackdropUrl`,
   `buildThumbnailFallbackChain`, `isPlaceholderThumbnail`, and the safe-URL guard.
   Write `tests/unit/artwork.test.ts` first (TDD).
3. **Types**: extend `PlayerResponse.videoDetails` in `src/shared/innertube.ts`
   (`:42-48`) with `thumbnail?: { thumbnails?: Array<{ url?: string; width?: number;
height?: number }> }`.
4. **DOM controller** `showArtwork(...)` in `src/shared/artwork.ts` (or a sibling
   `artwork-overlay.ts`): inject the stylesheet once, build the overlay, resolve the
   image (primary, then canonical chain with placeholder detection, all via a
   generation-guarded off-DOM `Image()`), set the settled bench marker, and return a
   `cleanup()`. Must **self-clean on throw** and cancel pending image handlers.
5. **PlayerHandle hook**: add the optional `onAttached` param to `attach()`; in
   `restore()` extract-and-clear `detachCleanup` and invoke it in its own `try`,
   separate from native restoration (`src/shared/player.ts`). Extend
   `tests/unit/player.test.ts` to assert the callback fires on successful attach and
   the returned cleanup runs on navigate, disable, re-attach, circuit-open, and
   attach-failure, and that a throwing cleanup does not block native restoration.
6. **Wire main-world**: compute artwork/backdrop URLs and pass the `onAttached`
   closure at the `attach()` call (`entrypoints/main-world.ts:349`); keep the
   `__BENCH__` marker set/clear symmetric with the other features.
7. **Settings**: add `audioArtworkEnabled` across `config.ts`, `main-world.ts`
   `PageSettings`/`parseSettings`, and the options UI row.
8. **Bench**: extend the fixture (thumbnails + `NOTHUMB` prefix + `/vi/` route),
   `snapshotScript`, and add the `probeArtwork` / SPA / circuit / disabled
   assertions, polling to a settled marker.
9. **Validate**: `./scripts/validate.sh` (typecheck, lint, unit coverage >=90%,
   hermetic bench, MV2 build), plus **real-Firefox screenshots** across the mode
   matrix (normal / theater / miniplayer, desktop + mobile, scrubber + menu +
   captions + end-screen visible) to verify paint order and no control occlusion.
   Record a handoff in `docs/history/`.
10. **Canary (non-gating)**: a live probe confirming the overlay appears over a real
    audio-only video on desktop, and a manual Android check (S4) before enabling any
    optional mediaSession repair.

## Open questions for the owner

1. **Toggle or always-on?** Recommended: ship the `audioArtworkEnabled` setting
   (default on, Settings-only). Alternative for maximum reduction: no toggle at all
   (artwork is simply part of audio-only). The feature code is the same; this is a
   surface-area call. A hidden internal flag would still be wanted for the bench's
   "off" assertion even if no UI toggle is exposed.
2. **Android mediaSession repair** (optional, gated): implement the in-place
   `artwork` re-assert now behind a flag, or defer until S4 device verification
   confirms GeckoView actually drops YT's art? Recommended: defer; ship the visual
   backdrop first.
3. **maxres crispness upgrade**: v1 uses the largest player-response thumbnail
   (typically ample once blurred + contained). Optionally, attempt an
   `i.ytimg.com/maxresdefault.jpg` upgrade-and-swap for extra sharpness on the
   centered art. It adds one background image load and a placeholder check and is
   harder to keep hermetic (it hits an external host), so it is proposed as a P1
   follow-up, not v1.
4. **YouTube Music art shape**: confirm on the music canary that
   `videoDetails.thumbnail.thumbnails` yields square album art for music tracks
   (expected). If a track ever lacks it, the feature simply falls open to no
   backdrop, which is acceptable.

## References

- `src/shared/player.ts`: `attach`/`restore`/`navigate`/`openCircuit` (the single
  teardown choke point the overlay binds to).
- `entrypoints/main-world.ts:293-354`: `activateEnhancements`, the attach call, and
  the SPA observer (`:233-247`).
- `entrypoints/content.ts:297-324`: injected-stylesheet pattern; `:146-147` inline
  in-page style pattern; `:419-430` bench markers.
- `src/shared/innertube.ts:32-58`: `PlayerResponse` shape (extended here).
- `tests/e2e/bench/fixture-server.mjs`: fixture player response and watch-page DOM.
- `tests/e2e/bench/run-bench.mjs`: bench snapshot + probes.
- `wxt.config.ts:66-91`: permissions / host scope (unchanged by this feature).
- `docs/research/14`: design language (tokens, motion, reduced-motion, dark-first).
- `docs/research/06 §4`: MediaSession preserve-don't-fight; Firefox 82+ support via
  BCD; Android `partial_implementation`.
- MDN: `<video>` `poster` (cleared once playback begins);
  `HTMLImageElement.naturalWidth`; `MediaSession.metadata` / `MediaImage`;
  CORS-enabled images (only needed for canvas readback).
