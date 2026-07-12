# UX Design Review: In-Player Controls

Holistic design review of the controls the extension injects into YouTube's own
video player: the audio-only toggle, the segment-skip affordance, and the audio
download button. Measured against the product's Jobs/Ive bar (reductive,
native-feeling, simple-by-default, instant, dark-first, accent "Live aqua"
`#22D3B4`), for desktop and the mobile player.

- Date: 2026-07-11.
- Surface: `entrypoints/content.ts` (`installPlayerControls`, `createPlayerButton`,
  `installPlayerControlStyles`), the `#yta-audio-only-toggle` / `#yta-segment-status`
  / `#yta-download-audio` buttons.
- Design source of truth: `docs/research/14-design-language-and-ux.md` (§1 principles,
  §4 in-player, §5 tokens, §6.5 in-player button contract).
- Governing rule for this surface: **R8 native, not skinned** ("in-player controls
  inherit YouTube's own control classes and font so they read as part of the player,
  not bolted on"). Almost every finding below is a deviation from R8.
- Method note: desktop and control-bar behavior read directly from source and the
  hermetic bench fixture (`tests/e2e/bench/fixture-server.mjs`). Mobile and YouTube
  Music main-bar claims are grounded in YouTube's known DOM and flagged where a real
  device is still required to confirm.

---

## 1. Verdict

The plumbing is correct and the intent is right, but the surface does not yet
clear the native-feel bar. Three separate, always-visible buttons carrying text
glyphs (`♪`, `↗`, `↓`) are injected into the **wrong control cluster** (far left,
before the Play button), sized with **custom geometry that fights `ytp-button`**,
animated with a **non-native `scale(1.06)` hover**, and explained through the
**browser's default `title` tooltip** rather than YouTube's own. The segment
"button" is a permanently disabled status glyph, not the contextual skip
affordance the design calls for. On the **mobile player the controls do not appear
at all** because the code only targets desktop `.ytp-*` classes. And when
audio-only is active, the player shows a **black rectangle** with no artwork, so
the single most important state in the product looks broken rather than
intentional.

What is genuinely good and should be preserved: real `<button>` elements with
`class="ytp-button"` (keyboard reachable, native focus), correct `aria-pressed`
on the toggle, a reduced-motion branch, a 44px minimum target, the accent token
for the active state, and a `MutationObserver` that re-attaches across SPA
navigation. The foundation is sound; the finish is not.

Scoreboard against the §1 principles:

| Rule | Intent | Status |
|---|---|---|
| R1 One obvious path | one hero affordance per surface | **Fail**: 2 to 3 competing glyphs in the bar by default |
| R6 One accent, sparingly | accent only for active/on | Pass (accent used only for active) |
| R7 Honest motion | no decorative animation | **Fail**: `scale(1.06)` hover is decorative and non-native |
| R8 Native, not skinned | inherit YouTube's controls | **Fail**: placement, geometry, hover, tooltip all diverge |
| R10 Accessibility | 44px, focus, contrast, not color-alone | Partial: good on desktop, absent on mobile; a11y gaps below |
| R11 Deference | chrome recedes, content leads | **Fail**: black screen in audio mode; clutter in the bar |

---

## 2. Current-state assessment

### 2.1 What is injected, and where

`installPlayerControls` (`content.ts:246-284`) resolves the mount target as:

```js
const controls = document.querySelector('.ytp-right-controls, .ytp-left-controls');
```

A selector list returns the **first element in document order** that matches
either selector, and YouTube's `.ytp-left-controls` precedes `.ytp-right-controls`
in the DOM. So the target is always the **left** cluster (play, next, volume,
time). Each button is then added with `controls.prepend(button)` (`:258`, `:265`,
`:274`), which inserts **before the Play button**. Because each new button is
prepended in turn, the resulting left-to-right order is:

```
[ ↓ download ] [ ↗ segment ] [ ♪ audio ]  ▶ ⏭ 🔊 0:00 / 3:35        ... ⚙ ⛶
```

With shipped defaults (`enabled: true`, `audioOnlyEnabled: true`,
`segmentSkipEnabled: true`, `downloadEnabled: false` in `config.ts:39-58`) the
default state shows **two** foreign glyphs (`♪` aqua-pressed, `↗` aqua-disabled)
crowded to the far left, ahead of Play. This is the opposite of the design intent,
which places the persistent audio-only toggle in the **right cluster next to the
settings gear** and reserves the left edge for the contextual skip affordance
(`research/14 §4.1`). The bench fixture only builds a `.ytp-left-controls` element
with the Play button first (`fixture-server.mjs:208-214`) and has no
`.ytp-right-controls`, so the intended placement is not covered by tests and the
"20/20 bench" green does not speak to it.

### 2.2 Icons

Icons are single text characters set as `textContent` (`createPlayerButton`,
`content.ts:286-295`): `♪` (audio), `↗` (segment), `↓` (download), rendered with
`font: 500 20px/44px Roboto` (`:308`). YouTube's own controls are crisp 24px SVG
paths with a consistent stroke weight and optical alignment. Text glyphs render
with font-dependent weight, baseline, and metrics that will never match the
surrounding SVGs, and the specific glyphs are weak signifiers: `↗` (north-east
arrow) does not read as "skip a segment," and `↓` reads as "scroll/expand" as
readily as "download." `research/14 §6.5` is explicit: icon `height: 60%` of the
bar, active tint `--accent`, and **no chrome tokens on in-player elements**.

### 2.3 Sizing and states

`installPlayerControlStyles` (`content.ts:297-324`) sets `min-width: 44px;
min-height: 44px; font: 500 20px/44px` on `.yta-player-button`. This overrides the
geometry `ytp-button` already provides (48px on the desktop bar) and produces a
44px line box inside a 48px bar, so the glyph is not vertically centered against
native siblings. `research/14 §4.1` says plainly: "Do not restyle padding/size
beyond what `ytp-button` gives."

- **Hover** (`:313`): `transform: scale(1.06)`. Native YouTube controls do not
  scale; they raise **opacity** (resting icons sit dimmed, hover brings full
  white). A growing control is the clearest "bolted-on" tell and violates R7/R8.
- **Active** (`:315-316`): `color: #22d3b4` via `aria-pressed="true"` /
  `data-active="true"`. Correct approach and the color is right; on the standard
  control scrim `#22D3B4` clears the 3:1 graphical-object floor comfortably. The
  residual risk is legibility over **variable video content** in the
  semi-transparent control zone, addressed by the native scrim plus a non-color
  state cue (§3, P1-3), not by a brighter aqua.
- **Focus** (`:314`): `outline: 2px solid #3fe0c4; outline-offset: -4px`. Visible
  and reasonable, but hardcoded rather than tokenized.
- **Disabled** (`:317`): `opacity: 1` on the segment button so it looks fully
  active while being non-interactive (see §2.4).
- **Reduced motion** (`:318-321`): transitions collapsed, scale removed. Good.

### 2.4 The segment surface

The segment control (`content.ts:262-267`) is created as a button, immediately set
`button.disabled = true`, and only ever reflects on/off through `data-active` and
`aria-label` (`updateSegmentStatus`, `:403-409`). It is a **permanent, disabled
status glyph**, not a control. Problems:

1. It is a dead target in a bar full of live ones. Users will click it; nothing
   happens.
2. It is always present and always consuming space for zero interaction.
3. `↗` does not signify skipping.
4. The real skip happens silently in the page world (`installSegmentSkipping`
   auto-seeks past the segment, `main-world.ts:522-562`), with **no in-player
   notice**. SponsorBlock, the cited reference, shows a small "skipped" affordance
   and a contextual button; here the user gets a mute status glyph and no feedback
   at the moment a segment is skipped.

This inverts `research/14 §4.1`, which specifies a **contextual** skip button that
"appears only during a segment" and "auto-hides with the control bar," modeled on
SponsorBlock's `skipButtonControlBar`.

### 2.5 The download surface

`#yta-download-audio` (`content.ts:269-276`) is `hidden` unless the download
feature is enabled (`updateDownloadButton`, `:398-401`; default off), so most
users never see it. When present and clicked, all feedback is written to the
`title` attribute: "Preparing audio download" then "Audio download started" or
"Audio download failed" (`requestAudioDownload`, `:326-396`). A tooltip the user
is not hovering is invisible feedback. The click briefly disables the button and
otherwise shows nothing: no progress affinity, no success or error state the eye
can catch. The URL and filename validation on this path is solid; the **feedback**
is the gap. `↓` is also an ambiguous signifier for "save this audio."

### 2.6 Audio-only active state: the black screen

When audio-only activates, `PlayerHandle.attach` rewrites the live `<video>.src`
to a bare audio URL (`player.ts:44-68`, `main-world.ts:344-350`). The audio track
plays, but the element now has **no video track**, so the player area renders
**black**. Nothing is drawn over it. This is the product's defining state and it
currently looks like a failure: a black box where the video was. `research/01
§3.6` anticipated exactly this and recommends showing album art over the audio,
and the legacy build even had an `audio_only_div`. The rebuild dropped it. There
is no artwork, no title, no now-playing signal in the player. Section 4 proposes
the fix and how it should coordinate with the toggle.

### 2.7 SPA navigation, theater, fullscreen, miniplayer

- **SPA:** `installPlayerControls` runs `attach()` once and then on every mutation
  via `new MutationObserver(attach).observe(document.documentElement, {childList,
  subtree})` (`:279-283`). Buttons are id-guarded, so they are re-added when
  YouTube rebuilds the bar. Resilient, and correct in spirit. Two costs: the
  observer fires `attach` on **every** DOM mutation across the whole document
  (YouTube mutates constantly) and it is **never disconnected**. `attach` early-outs
  cheaply, so this is a performance note, not a correctness bug, but it should be
  scoped to the player subtree and debounced.
- **Theater / fullscreen / miniplayer:** all reuse the same `#movie_player` and its
  `.ytp-*-controls`, so the buttons persist through those modes on desktop. This
  works today.

### 2.8 Mobile player (m.youtube.com)

The content script matches `m.youtube.com` (`content.ts:20-25`) and calls
`installPlayerControls` unconditionally, but that function only ever queries
`.ytp-right-controls, .ytp-left-controls`. The mobile web player does **not** use
those classes; its control bar is `.player-controls-bottom` and related mobile
markup. So on the mobile player the selector matches nothing and **no in-player
control is injected**. This directly contradicts the mandate that "the in-player
controls are the real day-to-day surface on mobile" (`research/14 §4.2`, §7.2) and
the product memory that mobile is a first-class target. The bench does not cover
mobile DOM, so this gap is invisible to the current test suite. (Confirm on a real
Firefox Android device; the class-name divergence is well established, the exact
current mobile markup should be snapshotted before implementing.)

### 2.9 YouTube Music

On `music.youtube.com` the primary transport is `<ytmusic-player-bar>`, not
`.ytp-*`; the `ytp` controls exist only inside the expanded video view. So the
audio-only toggle likely does **not** appear in the main Music control bar where
users actually live. Needs device confirmation, but plan for a Music-specific
mount target (the `ytmusic-player-bar` right-hand control group) rather than
assuming `ytp-*`.

### 2.10 Accessibility

- **Keyboard:** real `<button>` + `ytp-button` means Tab reaches the controls and
  YouTube's focus handling applies. Good. But because they are prepended before
  Play, they land **first** in the player's tab order, ahead of Play, which is an
  odd traversal.
- **Focus ring:** present (§2.3), hardcoded.
- **Contrast:** white glyph rides YouTube's bottom gradient scrim, legible. Active
  aqua `#22D3B4` clears the 3:1 graphical-object floor on that scrim; the real risk
  is variable video content behind the semi-transparent control area, mitigated by
  the scrim and solved for state by a non-color cue (§3, P1-3), not a color change.
- **Not color alone (R10):** the audio-only on/off state is conveyed **only** by
  glyph color today. A pressed toggle should also change shape or badge (for
  example a strike/slash when off), so state is not color-dependent.
- **44px:** met by the CSS where it applies (desktop). On mobile it does not apply
  because nothing mounts (§2.8).
- **Disabled status button:** a disabled `<button>` that announces
  "Segment skipping is on" is a confused a11y contract; a status should be a
  `role="img"`/`aria-label` element or a live region, not a dead button (§2.4).
- **Reduced motion:** honored.
- **Silent auto-skip is an a11y gap, not only a UX one.** A segment is skipped with
  no announcement, so a screen-reader or low-vision user gets an unexplained jump
  in playback. Auto-skip and download completion/failure should post to a
  deduplicated `role="status"` polite live region.
- **State by color alone.** On/off is signaled only by glyph color today; screen
  readers get `aria-pressed` (good) but sighted colorblind users get nothing.
  Pair with a shape/badge change (§3, P1-3).
- **Forced-colors / high contrast.** The focus ring and active tint are hardcoded
  aqua; under Windows High Contrast / `forced-colors`, use `:focus-visible` with
  system colors so focus stays visible. Also verify focus visibility while
  YouTube's control bar is autohiding.
- **SVG/text a11y hygiene (for the icon rework):** the icon must be
  `aria-hidden`/non-focusable with the accessible name on the `<button>`; the
  accessible name must be stable and localized. `hidden` on the download button
  already removes it from the tab order and a11y tree, which is correct.

### 2.11 Discoverability vs the popup

The popup surfaces audio-only as a switch and a status row (`popup/App.tsx:57-77`),
but nothing connects the two surfaces: no first-run coach tooltip on the in-player
button (planned in `research/14 §8`), and the popup does not hint that the toggle
also lives in the player. For the 90% who never open the popup, the in-player
button is the whole product, yet its own affordance quality (weak glyph, wrong
placement) undercuts discovery.

---

## 3. Recommendations

Prioritized. Each gives concrete before/after and covers desktop and mobile.

**Prioritization principle.** P0 is "the control mounts reliably on both surfaces,
survives YouTube's re-renders, states its state accessibly, and the core audio
mode does not look broken." P1 is "make it read as fully native and close the
feedback gaps." P2 is enrichment. Two current defaults shape this order:
audio-only is **ON** by default and segment auto-skip is **ON and silent**
(`config.ts:39-58`). Those are deliberate product decisions (R2, defaults over
configuration), but they mean a first-time user hits a black player and
unexplained playback jumps with no framing. Rather than flip the defaults, the
review keeps them and pays the debt where it belongs: a poster over the black
screen (P0-5), an announced/undoable skip (P0-7, P1-1), and first-run coaching
promoted into P1. Keeping powerful defaults **and** leaving them unexplained would
be the inconsistency; explaining them is the fix.

### P0: must fix (reliable, accessible, not-broken)

**P0-1. Mount as a reconciled lifecycle in the right cluster, not a one-shot
prepend.** YouTube replaces the control subtree across SPA navigation, ad breaks,
and mode changes, so placement is a *reconciliation* problem, not a single insert.

- Before: `querySelector('.ytp-right-controls, .ytp-left-controls')` then
  `prepend`, landing before Play in the left cluster.
- After: resolve `.ytp-right-controls` and insert the toggle **before the settings
  button**, with an idempotent reconciler:
  ```js
  const right = document.querySelector('.ytp-right-controls');
  const gear = right?.querySelector('.ytp-settings-button');
  if (right && !right.contains(existing)) right.insertBefore(button, gear ?? right.firstChild);
  ```
  Requirements: fall back gracefully when the gear is absent; never create
  duplicates; preserve focus if the focused control is re-parented during
  reconciliation; and re-run when the player root itself is replaced (see P1-5, the
  observer must reconnect, not permanently disconnect). Add a `.ytp-right-controls`
  cluster to the bench fixture so placement is actually tested.

**P0-2. Ship real SVG icons and drop the custom geometry.**

- Before: text glyphs `♪ ↗ ↓`; `min-width`/`min-height`/`line-height` overrides.
- After: inline `<svg viewBox="0 0 24 24" aria-hidden="true">` icons whose path
  fills the native button box the way YouTube's own icons do (SponsorBlock uses
  `height: 60%`; verify the result in fullscreen and compact layouts rather than
  hardcoding a percentage that a changing bar height can distort). Remove the size
  overrides and let `ytp-button` own the geometry. Audio-only icon: a waveform or
  a "screen-off with sound" mark that reads as "sound without video." Active state
  is an accent **fill** on the path. Highest-leverage single change for native feel.

**P0-3. Replace the scale hover with native opacity behavior.**

- Before: `.yta-player-button:hover { transform: scale(1.06); }`.
- After: remove the transform. Inherit `ytp-button`'s opacity behavior (resting
  dimmed, hover full white). Do not codify "YouTube always uses opacity" as a
  constant; inherit or sample the sibling controls' computed style so we track
  whatever the current player does. A growing control is the clearest bolted-on
  tell (R7/R8).

**P0-4. Stop using `title` as the feedback and primary-tooltip channel; guarantee
an accessible name.** The `<button>` already carries `aria-label`, so the
accessible name is covered; keep it stable and localized. The problems with
`title` are that it is mouse-only, delayed, useless on touch, and currently the
**only** channel for download status (§2.5). P0 is: never rely on `title` for
state; route status to a live region and visible affordance instead. A pixel-native
YouTube-style visual tooltip is desirable but is **P1** (P1-6), not P0.

**P0-5. Kill the audio-mode black screen with the least-invasive poster first.**
The full now-playing treatment is an enhancement (§4); the P0 obligation is simply
that audio mode never renders a bare black rectangle. Cheapest sound options, in
order of preference to evaluate on a live player:

1. A minimal, **non-interactive** poster layer using YouTube's already-resolved
   thumbnail (`pointer-events: none`, below the chrome; see §4 for the safety
   spec), or
2. retaining the last painted video frame where technically feasible.

Whatever is chosen must not intercept click-to-pause or controls autohide (§4).
This is the state a user stares at all session; it has to look deliberate.

**P0-6. Make the mobile player a real surface.**

- Before: only `.ytp-*` is queried; nothing mounts on `m.youtube.com`.
- After: branch the mount by host. On mobile, resolve the mobile control container
  (snapshot the current `.player-controls-*` markup on a Firefox Android device
  first, and account for portrait vs landscape, compact controls, ads, and the
  fact that page-injected controls may be unavailable in browser-native
  fullscreen), tag it `.mobile`, inject a 44x44 audio-only toggle, and wire
  `touchstart`. Without this the mobile-primary product has no in-player control.
  P0 by the product's own priorities, gated only on a device DOM snapshot.

**P0-7. Remove the dead disabled status button now; announce auto-skips.** Deleting
the permanently-disabled `↗` status glyph is a cheap R1 win independent of the
richer skip redesign (P1-1). In its place, at minimum, post "Skipped <category>"
to a `role="status"` live region when auto-skip fires, so the behavior-changing
default is at least perceivable to everyone.

### P1: high value (fully native, feedback, defaults framing)

**P1-1. Redesign the segment surface as a native contextual affordance.** Borrow
SponsorBlock's *pattern* (contextual, appears only during a skippable segment,
auto-hides with the control bar) but **not** its third-party green visual. Use a
YouTube-native transient toast/chip: on auto-skip, a brief "Skipped sponsor" toast
with an **Undo** action (forgiving and native-feeling); for a manual-skip mode, a
small "Skip <category>" chip that slides in on YouTube's exit curve (`--ease-exit`,
`research/14 §5.6`). No SponsorBlock palette leaks into the chrome (`research/14
§2.2`).

**P1-2. Give the download honest, visible states and pull it out of the default
bar.** On click: an in-button progress ring; on success a checkmark flash in
`--accent`; on failure a short shake with a `--danger` tint and a reason; plus a
`role="status"` announcement. Because download defaults off and is a 10% feature,
surface it from the audio poster (§4) or an overflow rather than a permanent bar
slot, keeping the bar to one native toggle (R1/R3).

**P1-3. Convey audio-only state without relying on color alone.** Pair the accent
tint with a shape change: a small slash on the icon when audio-only is **off**, a
clean waveform when **on**, so state is readable without color (R10) and reinforces
`aria-pressed`.

**P1-4. Keep the active fill on the scrim; do not chase a brighter aqua for
contrast.** On YouTube's dark control gradient, `#22D3B4` already clears the 3:1
graphical-object floor comfortably (roughly 8.5:1 against `#212121`), and a lighter
aqua would only hurt on light backgrounds. The real legibility risk is the
**variable video content** behind a semi-transparent control area, which the native
scrim mitigates; solve state legibility with shape/badge + `aria-pressed` (P1-3),
not a color change. Verify the chosen fill against the actual rendered scrim rather
than assuming.

**P1-5. Reconcile the observer; never permanently disconnect it.** Once the player
is found, observe the player root (or the controls container) rather than
`document.documentElement`, coalesce/debounce `attach`, and **reconnect when that
root is replaced** by a navigation or mode change. A one-shot disconnect after the
first mount would guarantee the control vanishes after YouTube's next subtree swap.

**P1-6. YouTube-style visual tooltip.** Render a dark tooltip above the control on
hover **and keyboard focus**, with proper dismissal, no hover-tooltip on touch, and
collision handling. Copy: title-cased "Audio only," with the pressed state carrying
on/off rather than a status string.

**P1-7. First-run coach tooltip** anchored to the in-player toggle: "Tap here for
audio-only anytime," auto-dismiss on first use, stored so it never repeats
(`research/14 §8`). Promoted from P2 because audio-only ships ON by default; the
coach mark is what makes that powerful default self-explaining (see the
prioritization principle above) and is the bridge from popup to in-player discovery
(§2.11).

### P2: enrichment

**P2-1. Richer now-playing artwork** (blurred cover wash, cover art, title,
channel, quiet now-playing indicator) as an enhancement over the P0 poster, only
after the interaction-safety spec in §4 is validated on a live player.

**P2-2. YouTube Music main-bar mount.** Add a `ytmusic-player-bar` mount target so
the toggle appears where Music users actually are (§2.9), after device
confirmation. Treat Music as a separate integration surface, not a reskin of the
desktop path.

**P2-3. Tokenize the in-player CSS** (focus ring, active color, durations) against
`entrypoints/ui/tokens.css` values so the player surface and the chrome stay in
lockstep, while still emitting literal values into the injected `<style>`.

**P2-4. Keyboard shortcut.** Consider a single-key shortcut for audio-only, but
only after collision analysis against YouTube's own bindings and assistive-tech
commands, suppressed in editable fields, and surfaced in the tooltip per YouTube's
convention.

---

## 4. The audio-mode surface, and how the toggle coordinates with it

The black screen (§2.6) and the weak toggle are the same problem seen from two
sides: **audio mode is invisible**. The fix is one coordinated system where the
toggle is the switch and the audio-mode surface is the receipt (R5, "state is the
confirmation"). Build it in tiers so the P0 obligation ships without betting the
core state on the most complex layer.

**Interaction-safety spec (applies to every tier, non-negotiable).** An overlay
inside the player is only safe if all of this holds, and it must be validated on a
**live** YouTube player, not just the fixture, because YouTube can discriminate on
`event.target`:

- `pointer-events: none` on the overlay so it can never become the target for
  click-to-pause, double-click-fullscreen, or the controls-autohide hit test.
- Explicit z-index **below** `.ytp-chrome-bottom`, captions, settings menus, cards,
  ads, spinner, and end screens; those layers position independently, so "below the
  chrome" must be asserted, not assumed.
- Correct behavior across theater, fullscreen, miniplayer, ad breaks, SPA
  navigation, and controls autohide (fade with the player, not over the ad).
- Decorative markup is `aria-hidden`; state is announced once via a live region,
  not duplicated or re-announced on every mutation.
- Scope note: the overlay is **cosmetic**. It masks the black frame; it does not
  prove the hijacked element still behaves natively (seeking, duration, quality
  menu, captions, autoplay, casting, PiP all depend on the `src` rewrite in
  `PlayerHandle` and must be verified separately). The poster is not a substitute
  for that verification.

**Tier A (P0): the poster.** The minimum that makes audio mode not look broken: a
single non-interactive layer over `.html5-video-container` showing the video's own
thumbnail (or a retained last frame). Thumbnail source should prefer the URL
YouTube's page/player data already resolved; if constructing one, fall through
sizes (`maxresdefault` 404s or returns a gray placeholder on many videos; fall back
to `hqdefault`). This alone converts "looks broken" to "looks intentional."

**Tier B (P1/P2): the now-playing card.** Over the poster wash, a calm card: the
cover art (rounded thumbnail on video, square art on Music), the **title** and
**channel** in `Roboto` at YouTube's type sizes, and a **quiet** now-playing
indicator. Data is already available: `main-world.ts` emits a `TRACK_EVENT` with
`{title, artist, duration}` (`main-world.ts:369-393`) and the video id yields the
thumbnail. Note "artist" is only reliable on YouTube Music; for ordinary videos use
title + channel, not a fabricated artist line. Keep the now-playing indicator
restrained: a static aqua dot by default, an optional brief pulse on state change
only, never a permanent breathing glow (which reads non-native and distracts).
Reduced motion collapses any pulse to the static dot (reuse `.now-playing`,
`components.css:191-199`).

**Coordination with the toggle (the point).**

- Toggle **on** → the audio-only active tint appears on the icon **and** the poster
  fades in over the black video (`--dur-3` opacity, `--ease-standard`). Same aqua
  language in both places, so the eye ties them together.
- Toggle **off** → poster fades out, native video returns. The toggle's press and
  the poster's fade are one gesture with one confirmation.
- The audio-mode surface is where the **10% features can live without cluttering
  the bar**: the download action (P1-2), the synced lyrics (today a separate fixed
  panel, `content.ts:140-178`, which should move into this surface for one coherent
  audio view), and, on mobile, the segment affordance.

**Fidelity across modes.** Scale to the player in theater and fullscreen. On the
mobile player, render a simpler version (cover + title + dot) sized to the mobile
stage. It reuses the chrome's tokens and type so it never looks like a third design
language, and it must not read as a Spotify/Music clone bolted onto YouTube's video
player: restraint over decoration.

**Why this matters.** It converts the product's core state from "looks broken" to
"looks deliberate and calm," gives the toggle a visible consequence, and creates a
home for secondary actions so the control bar can shrink back to a single native
affordance. It is dark-first, credentialless (public thumbnail, no login), and
buildable from data the extension already has.

---

## 5. Native-feel acceptance checklist

A change to this surface should pass all of these before it ships:

- [ ] Audio-only toggle sits in `.ytp-right-controls`, before the settings gear,
      via an idempotent reconciler that survives SPA nav, ad breaks, and mode
      changes without duplicating or dropping focus.
- [ ] Icons are SVG filling the native button box; no `min-width`/`min-height`/
      `line-height` overrides of `ytp-button` geometry; verified in fullscreen and
      compact layouts.
- [ ] Hover changes opacity (inherited/sampled from siblings), not scale.
- [ ] No reliance on `title` for state or feedback; accessible name is stable and
      localized; visual tooltip (P1) works on hover and keyboard focus, not touch.
- [ ] `aria-pressed` reflects state; state is also conveyed by shape/badge, not
      color alone; active fill verified against the actual scrim.
- [ ] The default bar carries **one** persistent affordance; the dead disabled
      status button is gone; segment skip is contextual with an announced/undoable
      auto-skip; download is out of the default bar with visible states.
- [ ] Audio-only active renders a poster (not a black screen) that fades in/out
      with the toggle, is `pointer-events: none`, sits below the chrome/captions/
      menus/ads/end-screens, and is verified on a live player not to swallow
      click-to-pause.
- [ ] An in-player control mounts on `m.youtube.com` (44x44, `.mobile`-tagged,
      portrait + landscape) and on the `music.youtube.com` transport bar.
- [ ] The observer is scoped to the player root, coalesced, and **reconnects** when
      that root is replaced (never a permanent one-shot disconnect).
- [ ] Auto-skip and download outcomes post to a deduplicated `role="status"` live
      region; focus is preserved across reconciliation; focus ring survives
      forced-colors and the control-bar autohide.
- [ ] Bench fixture includes a right-controls cluster and a mobile control
      container so placement and mobile mounting are actually tested.

---

## 6. Open questions to resolve on device

- Exact current `m.youtube.com` control markup (snapshot `.player-controls-*` on
  Firefox Android before implementing P0-6).
- Whether `music.youtube.com` exposes any stable right-hand control group in
  `ytmusic-player-bar` suitable as a mount (P2-2).
- Thumbnail availability fallback order (`maxresdefault` may 404 on some videos;
  fall back to `hqdefault`) for the backdrop.
- Whether an audio-only keyboard shortcut collides with YouTube's own bindings
  (P2-4).
</content>
</invoke>
