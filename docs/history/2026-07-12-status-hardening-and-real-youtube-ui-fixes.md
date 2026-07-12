# Handoff: Status hardening and real-YouTube UI fixes

## Date

2026-07-12

## Summary

A correctness and hardening batch across the in-player controls, the audio-mode artwork overlay,
and the popup playback-status channel, driven by behavior seen on real YouTube (not just the
hermetic fixtures). It closes a CPU-runaway and a reconciler hot loop in the content script, makes
the per-tab status honest and hard to poison, collapses a double `<video>.src` write on the circuit
breaker, and fixes the audio-mode artwork collapsing to a black rectangle on the real player layout.
No hard invariant changed: logged-out only, credentialless `ANDROID_VR`, `PlayerHandle` as the sole
`<video>.src` writer, fail-open to native playback, and the page-world trust boundary all hold.

## Key changes

### CPU-runaway coalescing + reconciler hot-loop (`entrypoints/content.ts`)

- The two in-player `MutationObserver`s (the player-subtree observer and the document observer that
  watches for player replacement) now feed rAF-coalesced schedulers (`createCoalescedFrameScheduler`),
  so a burst of YouTube mutations does at most one reconcile and one player-relookup per frame instead
  of one per record. Both observers disconnect entirely while the tab is hidden (`visibilitychange` /
  `pagehide` / `pageshow`), and the reconcile body no-ops when the observers are inactive.
- `reconcileInPlayerControls` no longer anchors its `insertBefore` on a node it is about to move.
  The insertion anchor resolves to the native settings gear, else the first native (non-managed)
  control, else null (append). Anchoring on the status region or one of our own buttons made
  `insertBefore` throw once that node was detached into the fragment, and under the observer that
  throw became a reconcile -> throw -> mutation hot loop whenever the settings gear was absent.

### Honest per-tab status (`entrypoints/content.ts`, `entrypoints/background.ts`, `src/shared/status.ts`, `entrypoints/main-world.ts`)

- **Active-only-on-attach:** the page world emits `active` only after `PlayerHandle.attach()`
  succeeds; every unsupported or failed path emits `fallback` (with a reason) or `disabled`, so the
  stored status never claims audio-only on a video that fell back.
- **Content-owned ordering (unforgeable):** the `yta:status` DOM event is observable and forgeable by
  arbitrary page JS, so its ordering provenance is generated in the isolated content script and never
  trusted from the event. `generation` is a content-owned counter that begins a new value each time
  the forwarded `videoId` changes (a same-operation `fetching`→`active` keeps one generation; a new
  video supersedes the old), and it ignores any generation the event carries — so a hostile page
  cannot forge a huge generation to freeze the popup. Only the display fields (`status`, `reason`,
  `videoId`) come from the event; a forged `videoId` is caught by the resolver's URL cross-check, and
  a momentary forged `status` is superseded by the next genuine report. (An earlier nonce-stamping
  attempt was dropped: the nonce rides in the same page-observable event, so a page could read it from
  a legitimate event and replay it.)
- **Monotonic, poison-resistant `runStart`:** `nextStatusRunStart()` replaces `Date.now()`. It
  returns `max(Date.now(), previous + 1)` over the last epoch persisted in per-tab
  `sessionStorage['__yta_run_epoch__']`, so a full reload is always strictly later even across a
  same-millisecond collision or a system-clock rollback. The stored value is validated (a safe
  non-negative integer no more than a day past `now`) so the origin-shared page cannot freeze
  ordering with a poisoned value such as `1e308`; it falls back to `Date.now()` when `sessionStorage`
  throws.
- **Conditional staleness + strict revive:** `background.ts:tabs.onUpdated` marks an entry stale only
  when the new `shouldMarkStale(entry, changeInfo)` agrees, i.e. a `loading` reload or a URL whose
  video id differs from the entry's. A same-video URL rewrite (YouTube appending `&t=`/`list` params
  during playback) no longer stales, which previously stranded the popup on `connecting`. `supersedes`
  is strict on `generation` while an entry is stale (an equal-tuple straggler from the unloaded old
  document cannot clear the stale flag) and non-strict otherwise (a same-operation `fetching`->`active`
  transition still lands).
- **Popup pause-gate:** `popup/App.tsx:PlaybackHero` never renders `active` when the audio-only
  preference is off or the extension is paused, since both flip their signal immediately, before the
  page world's `disabled` status round-trips back.

### Circuit-breaker single-write (`src/shared/player.ts`)

- When the dormant `src` guard trips the breaker (a third-party write exceeds `maxReassertions`),
  `openCircuit({ skipSrc: true })` restores the original `src` descriptor without writing the
  snapshot back, and the guarded setter then performs the page's own write once. This avoids the
  double write (extension snapshot, then the page value) that could fight native playback on teardown.

### Audio artwork real-YouTube mount (`src/shared/artwork.ts`)

- The overlay now mounts into the player root (`.html5-video-player`/`#movie_player`) and is inserted
  directly after the video container, so it paints above the video but below the control chrome. It
  is no longer appended as the media container's last child. On real YouTube the `<video>`'s immediate
  `.html5-video-container` wrapper is a zero-height positioning box, so an `inset:0` overlay mounted
  there collapsed to nothing, which was the audio-mode black rectangle. It falls back to the
  `<video>`'s direct parent on other layouts (fixtures). The mount is not gated on a non-zero
  `clientHeight`, because the wrapper is often zero-height at attach time and `inset:0` on the player
  root resolves once layout settles.

### Native in-player control styling (`entrypoints/content.ts`)

- The audio-only glyph is a headphones icon rendered white (the previous teal fill is gone; teal
  survives only on the focus-visible outline and the active state). Buttons use a padded SVG viewBox
  `-12 -12 48 48` with a full-size SVG so the glyph sits at native icon weight (~24px in a 48px
  button) and scales cleanly in theater and fullscreen, where YouTube enlarges its controls. Verified
  on real YouTube in default and theater layouts.

### Artwork localhost DCE (`src/shared/artwork.ts`)

- The bench-only `http://127.0.0.1` / `http://localhost` thumbnail allowance in `isSafeArtworkUrl`
  is now `__BENCH__`-gated, so a production build only ever loads `https:` artwork and the fixture
  host strings are dead-code-eliminated. This mirrors the same guard in `player.ts:isSafeMediaUrl`.

## Docs updated

- `docs/specs/SPEC-012-holistic-ux-foundations.md`: corrected the status-channel section (content-owned
  generation ordering, monotonic/poison-resistant `runStart`, display-only event trust boundary),
  documented `shouldMarkStale` and the strict-on-stale supersede, corrected the `tabs.onUpdated`
  behavior, and described the artwork player-root mount plus the `__BENCH__`-gated thumbnail
  allowance.
- `docs/adrs/0007-popup-playback-status-delivery.md`: rewrote the SPA-staleness and trust-boundary
  reasoning to match the shipped code (content-owned, videoId-driven generation — not trusted from the
  page-observable event; conditional `shouldMarkStale`; the `nextStatusRunStart` epoch).
- `docs/adrs/0008-audio-mode-artwork-and-egress.md`: corrected the overlay mount from "the media
  container's last child" to the player-root / after-video-container mount, with the zero-height
  black-rectangle explanation.

## Verification

Covered by the existing gate (`npm run validate`: typecheck, lint, format:check, unit + coverage,
build MV2, `web-ext lint`, build MV3). The relevant unit coverage for this batch:

- `tests/unit/status.test.ts`: `shouldMarkStale` (loading reload, different-video stale, same-video
  kept live) and the stale-strict `reduceStatusUpdate` / `supersedes` paths.
- `tests/unit/in-player-mount.test.ts`: `nextStatusRunStart` monotonicity and poisoned-epoch
  recovery, the rAF-coalesced reconcile scheduler, the gear-absent "no `insertBefore` hot loop"
  stability case, and `buildStatusUpdateMessage` ignoring any page-supplied generation.
- `tests/unit/artwork.test.ts`: the real-YouTube player-root / after-video mount versus the
  fixture last-child fallback.

## Follow-ups still open

- **Adblock parser gap (task #69):** `background.ts:filterPlayerResponse` prunes ads from the
  buffered `POST /youtubei/v1/player` response body, but the page world's own `fetch` +
  `Response.json()` download path (`main-world.ts:handleDownloadRequest`, `activateEnhancements`)
  parses the player response without the same ad-field pruning. Reconcile the two so both paths see a
  consistently pruned response.
- **Options UI polish (task #72):** raise the equalizer-band control contrast and fix the diagnostics
  panel scrollbars in the options surface.
- **ANDROID_VR ad-free-video finding:** the credentialless `ANDROID_VR` player response is ad-free
  and returns an itag-18 progressive stream plus adaptive video formats. That gives a possible future
  path to ad-free normal (video) playback on fallback-eligible videos, not just audio-only. Recorded
  as a finding to evaluate against the logged-out and credentialless invariants before any use.
