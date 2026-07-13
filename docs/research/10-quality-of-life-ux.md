# Quality-of-Life UX Features (ImprovedTube-class) for YouTube + YouTube Music

Research doc for the youtube-audio Firefox extension (MV2, desktop + Android). Scope: the
"make YouTube pleasant" features that complement our core (audio-only, background play,
ad/telemetry block, ghost). Audio-only, ad-blocking, background play, and telemetry are
covered in other research docs and are **not** re-researched here.

North star: *one-stop shop for YouTube — simple for the end user, powerful on demand; remove
friction and deliver value.* Sites in scope: `youtube.com`, `m.youtube.com`,
`music.youtube.com`, `youtube-nocookie.com`.

**Primary evidence base (cloned and read):**

- **ImprovedTube** = `code-charity/youtube` ("Improve YouTube!"), MV3, ~200+ toggles. Clone
  commit `43fa27d3ec07a5e9351d83386c0066a618036e86` (2026-07-05). Cited below as
  `improvedtube/...`. This is the gold-standard reference for QoL breadth and for staying
  robust against YouTube's churn.
- **Iridium** = `ParticleCore/Iridium`, MV2/MV3 with a Firefox source tree. Clone commit
  `9e2dcabc205affa298f62356f4a670c40cdc3236` (2026-01-31). Cited as `iridium/...`. Used as a
  contrasting architecture (network/JSON interception vs DOM/CSS).

> ⚠️ **Scope gap worth exploiting.** ImprovedTube's manifest matches
> `https://www.youtube.com/*` **only** — it does **not** run on `music.youtube.com` or
> `m.youtube.com` (`improvedtube/manifest.json:56,60,85`). A genuinely one-stop tool that
> also covers YT Music and mobile web is already differentiated against the biggest incumbent.

---

## 1. Executive summary

QoL features split cleanly into two tiers for our north star.

### Simple defaults (ship ON, no configuration, invisible when idle)

These remove friction for *everyone* and never surprise a naive user:

1. **Disable autoplay-next / "Up next"** — the single highest-value default. Stops the endless
   auto-queue that pulls users into doomscrolling. Two robust mechanisms exist (toggle the
   native autonav button, or intercept `play()`); see §3.
2. **Disable animated/hover thumbnail previews** — cuts real bandwidth (previews are WebP
   animations or short video segments) and CPU, and reduces motion/distraction. Pure win for a
   data-saving tool. See §2.
3. **Hide Shorts everywhere** — Shorts is the biggest attention sink; one toggle covering home,
   search, subscriptions, history, sidebar. CSS-only, instant. See §4.
4. **Remember playback speed** across videos (and don't speed up music). See §3.
5. **Auto-dismiss "Video paused. Continue watching?"** — pure friction removal. See §5.

### Power-user toggles (OFF by default, discoverable in an "advanced" area)

1. **Force / cap default video quality** (incl. a data-saver cap and a "lower quality when on
   battery / unfocused" mode). See §2.
2. **Distraction removal**: hide comments, hide related sidebar (or "focus/titles" collapse
   modes), hide end-screen cards + info cards + annotations, cleaner masthead. See §4.
3. **Playback controls**: default playback speed, loop/repeat, screenshot, mini-player,
   picture-in-picture, custom keyboard shortcuts, skip/seek. See §5.
4. **Persistent volume** and disable loudness-normalization. See §5.

### The one thing that matters most: *how to keep it working*

The features are easy; **staying robust against YouTube's SPA + Polymer churn is the hard
part**. ImprovedTube's answer (§6) is the pattern to copy: a **declarative settings registry**,
a **two-world content-script + page-world split**, **CSS keyed off `html[it-*]` attributes** for
all cosmetic work (zero JS reflow, survives class-name churn), and a **layered SPA-navigation
model** (`yt-navigate-finish` + `yt-page-data-updated` events *plus* a global `MutationObserver`
*plus* per-feature observers). Selectors target **semantic Polymer custom-element tags**
(`ytd-reel-shelf-renderer`, `ytd-comments`) and stable player classes (`.ytp-ce-element`),
not churny inner class names, and lean on modern `:has()`.

---

## 1a. Feature catalog at a glance

Reliability: **A** = stable (semantic tag / native control / standard API), **B** = works but
needs re-apply/observers, **C** = fragile (churny selectors / undocumented internals). Bytes:
does it reduce data transfer. `?*` = works on desktop, **unverified on mobile** `#movie_player`
(feature-detect + graceful no-op). Details + `file:line` evidence in §2-§5.

| Feature | Mechanism (short) | Rel. | Bytes | Desktop | Android | YT Music |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| Force/cap quality | internal `setPlaybackQualityRange`/`setPlaybackQuality` | C | **yes (video)** | ✓ | ?* | n/a |
| Quality when unfocused / on battery | re-call quality on blur / `getBattery()` | C | yes | ✓ | ?* (battery) | n/a |
| Disable hover thumbnail previews | capture-phase `mouseenter` + `stopImmediatePropagation` | B | **yes** | ✓ | ✓ (re-author) | — |
| Disable ambient/cinematic glow | CSS hide `#cinematics` | A | no (GPU) | ✓ | ✓ | n/a |
| Disable autoplay-next | click `.ytp-autonav-toggle-button` (or intercept `play()`) | A/B | indirect | ✓ | ✓ | ✓ |
| Loop / repeat | `video.setAttribute('loop')` | A | no | ✓ | ✓ | ✓ |
| Default + remembered speed (music-aware) | `video.playbackRate` / `setPlaybackRate` + heuristics | B | no | ✓ | ✓ | ✓ (careful) |
| Skip/seek + keyboard shortcuts | `player.seekTo` + keydown | B | no | ✓ | ✕ (no keys) | partial |
| Hide Shorts (all surfaces) | CSS `ytd-reel/rich-shelf[is-shorts]` + `:has()` | A/B | minor | ✓ | ✓ (re-author) | n/a |
| Hide comments (or collapse) | CSS `ytd-comments` (+ JS for collapse) | A/B | no | ✓ | ✓ (re-author) | n/a |
| Hide related sidebar (or focus/titles) | CSS `#secondary`/`#related` | A/B | minor | ✓ | ✕ (no sidebar) | n/a |
| Hide end-screen cards / info cards / annotations | CSS `.ytp-ce-element`/`.html5-endscreen`/`.ytp-cards-button` | A | no | ✓ | ✓ | n/a |
| Cleaner masthead / home feed | CSS visibility on `#masthead`/`#content` | B | no | ✓ | ✕ (diff DOM) | n/a |
| Persistent/forced volume (+boost) | `player.setVolume` + Web Audio `GainNode` | B | no | ✓ | ✓ (no boost UI) | ✓ |
| Screenshot | `canvas.drawImage(video)` | A | no | ✓ | ✕ | ✕ |
| Mini-player / PiP | CSS class + `requestPictureInPicture()` | B | no | ✓ | PiP only | — |
| Auto-dismiss "Continue watching?" | `MutationObserver` + click | B | no | ✓ | ✓ | ✓ |

---

## 2. Data-saving / performance

### 2.1 Force / cap video quality

**Mechanism.** The real desktop watch-page player (`#movie_player`, the internal
`html5-video-player`) exposes undocumented methods beyond the public IFrame API. ImprovedTube's
`playerQuality` uses them:

```js
// improvedtube/js&css/web-accessible/www.youtube.com/player.js:445
ImprovedTube.playerQuality = function (quality = this.storage.player_quality) {
  ...
  let available_quality_levels = player.getAvailableQualityLevels();          // :459
  ...
  // cap AI "Super Resolution" upscaling to real max                          // :461-470
  if (!hasTrue1080pOrHigher && [...1080+].includes(quality)) quality = 'hd720';
  ...
  if (!available_quality_levels.includes(quality)) { /* pick closest */ }     // :474-492
  player.setPlaybackQualityRange(quality);                                    // :493
  player.setPlaybackQuality(quality);                                         // :494
  player.dataset.defaultQuality = quality;                                    // :495 (per-video guard)
};
```

Key facts (verified against the live API and community userscripts):

- **`setPlaybackQuality(label)` is deprecated to a no-op on the *public* IFrame API** (since Oct
  2019 YouTube adjusts quality by viewing conditions and documents these calls as no-ops). It still
  *functions* on the **internal `#movie_player` object** that extensions script directly — which is
  precisely why ImprovedTube/Iridium call it on `this.elements.player` (the real player), not via
  the embed API. Treat it as a *suggestion* even there.
  ([YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference),
  [SO](https://stackoverflow.com/questions/8802498/youtube-iframe-api-setplaybackquality-or-suggestedquality-not-working))
- **`setPlaybackQualityRange(min, max)` is the *internal* method** on `#movie_player` that pins
  ABR. Userscripts lock quality by passing the same label for both
  (`setPlaybackQualityRange(q, q)`), which is what actually reduces the streamed bitrate.
  ImprovedTube uses the single-arg form at player.js:493 and the two-arg form in its full-screen
  fallback (`setPlaybackQualityRange(desired, desired)`, player.js:566); Iridium calls both
  `setPlaybackQuality` and `setPlaybackQualityRange` on its player-object reference
  (`iridium/src/firefox/js/background-inject.js:1885-1886`). It is **undocumented and can change
  without notice** — and because all working quality control depends on these *internal* methods,
  their availability on the separately-built mobile player is **unverified (needs on-device
  check)**. ([gist](https://gist.github.com/calcarlson/d6c6f4042b93f688df8e77df5febc6b6),
  [Greasy Fork](https://greasyfork.org/en/scripts/374466-youtube-video-quality/code))
- **Robustness pattern:** `getAvailableQualityLevels()` first (a requested tier that isn't
  offered is ignored), pick the closest available tier, then set — and re-apply on navigation and
  via retry timers, guarding with `player.dataset.defaultQuality` so we set once per video and
  don't fight the user. ImprovedTube's full-screen variant re-applies at 300/800/1500/3000 ms
  (player.js:570-573) because the player object and its levels aren't ready immediately.

**Does it save bytes? Strong yes, by construction (not measured here).** YouTube streams DASH; a
lower resolution tier maps to a lower-bitrate video representation, so forcing `medium` (360p) vs
`hd1080` transfers materially fewer bytes on the *video* track. Two honest caveats: (a) it does not
change the *audio* bytes, so in our audio-only mode the win is only from suppressing wasted video;
(b) the *suggested-quality* method can be stepped back up by ABR on a fast connection, so the
*range* method (which pins the ceiling) saves more reliably. This is a firm architectural inference
from how DASH/ABR works — validate the exact reduction with a byte-count experiment before quoting
numbers. Even in our **audio-only fallback** (when we can't fully suppress video), capping to the
lowest tier minimizes wasted video bytes.

**Adjacent, genuinely useful variants in ImprovedTube:**

- **Quality when unfocused** — drop quality when the tab loses focus, restore on refocus
  (`playerQualityWithoutFocus`, player.js:501-519). Great for a background/audio-first tool.
- **Quality on battery** — `navigator.getBattery()` drives quality down as the battery drains
  (`batteryFeatures`, player.js:580-618). Mobile-relevant.
- **Playlist-specific and full-screen-specific quality** (player.js:446-452, 523-574).

**Desktop:** full support. **Android (m.youtube.com):** the mobile web player is a different
build; treat `setPlaybackQualityRange` as best-effort (see §7). A quality **cap** is still worth
shipping on mobile as our top data-saver.

### 2.2 Disable animated / hover thumbnail previews (bandwidth + CPU)

**Mechanism.** ImprovedTube swallows the hover event that triggers YouTube's inline preview,
using a **capture-phase** `mouseenter` listener that calls `stopImmediatePropagation()` over
thumbnail containers so YouTube's own hover handler never fires:

```js
// improvedtube/js&css/extension/www.youtube.com/general/general.js:831
extension.features.disableThumbnailPlayback = function (event) {
  if (event instanceof Event) {
    if (event.composedPath().some(elem => elem.matches?.(
        '#content.ytd-rich-item-renderer, #contents.ytd-item-section-renderer, #dismissible.ytd-compact-video-renderer'))) {
      event.stopImmediatePropagation();                                        // :836
    }
  } else if (extension.storage.get('disable_thumbnail_playback') === true) {
    window.addEventListener('mouseenter', this.disableThumbnailPlayback, true); // :840 (capture)
  }
};
```

A companion `muteThumbnailPreviews` (general.js:850+) force-mutes any preview `<video>` and
re-mutes on `volumechange`/`play` via a `MutationObserver` for the case where you want previews
silent rather than gone. A separate **CSS-only** toggle `hide_animated_thumbnails` hides the
preview surfaces outright — `html[it-hide-animated-thumbnails='true'] #mouseover-overlay,
.mouseover-play, .mouseover-img, #preview>ytd-video-preview { display:none }`
(`general.css:98-102`) — but note CSS hiding alone may not stop the fetch; the capture-phase
event-swallow above is what actually prevents the load.

**Does it save bytes? Yes for the event-swallow approach.** Hover previews are delivered as WebP
animations or short muted video segments fetched on hover; suppressing the hover suppresses the
fetch. (Merely `display:none`-ing the preview element does not reliably prevent the network load —
prefer the event interception for the data-saving claim.) Cumulative savings are significant when
scrolling feeds, and it cuts CPU/GPU for smoother scrolling.
([ChromeUnboxed](https://chromeunboxed.com/how-to-disable-youtube-inline-preview-zoom),
[Techviral](https://techviral.net/disable-youtube-auto-play-thumbnails-video-preview/))

**Desktop:** full. **Android:** the mobile web feed uses "Playback in feeds"; different DOM, but
the same capture-phase-event or CSS approach applies to whichever preview element it uses.

### 2.3 Other perf / bloat reduction

- **Disable ambient/cinematic lighting** — the animated glow behind the player is a continuous
  GPU cost. One CSS line kills it: `html[it-ambient-lighting='false'] #cinematics { display:none }`
  (`improvedtube/js&css/extension/www.youtube.com/appearance/player/player.css:15`). Cheap, and a
  good default for a battery/data-conscious tool.
- **Force lower thumbnail resolution** (`thumbnailsQuality`, general.js:709-825) — swaps
  thumbnail URLs to a lower-res variant; observed via `MutationObserver` on `documentElement`.
  Small byte savings across a feed.
- **Reduce Polymer bloat** is mostly *not* done by ImprovedTube via heavy DOM surgery — it hides
  with CSS (cheap) and lets the elements exist. Aggressively *removing* nodes risks Polymer
  re-rendering fights; CSS `display:none` is the robust, low-cost choice (see §4). This is the
  right lesson for us: **hide, don't delete.**
- **Open research gap (not yet a recommendation):** ImprovedTube has **no** generic "disable
  preloading/prefetch" feature (confirmed: zero `preload`/`prefetch`/`preconnect`/`dash`
  manipulation anywhere in the repo). It is tempting to strip YouTube's speculative
  `<link rel=preload/preconnect>` hints or set `video.preload='none'`, but neither reliably reduces
  media bytes: the watch-page player streams via MSE/`fetch`, so segment fetches are driven by
  player JS, not by `<video preload>` or `<link>` hints. A real speculative-fetch data-saver would
  need to throttle/deny the InnerTube "prefetch next" requests at the network layer — **measure the
  actual byte sources first; do not ship a `preload`-attribute tweak assuming it saves data.**

---

## 3. Autoplay & flow control

### 3.1 Disable autoplay-next ("Up next")

Two complementary mechanisms, both worth knowing:

**(a) Toggle the native autonav button** to match desired state — robust because it uses
YouTube's own control:

```js
// improvedtube/js&css/web-accessible/www.youtube.com/player.js:387
ImprovedTube.upNextAutoplay = function () {
  var toggle = document.querySelector('.ytp-autonav-toggle-button');
  if (toggle && option !== (toggle.getAttribute('aria-checked') === 'true')) toggle.click();
};
```

**(b) Intercept `play()` on load** — override `HTMLMediaElement.prototype.play` so autoplay can be
paused before it starts, unless the user actually interacted:

```js
// improvedtube/js&css/web-accessible/functions.js:397
ImprovedTube.playerOnPlay = function () {
  HTMLMediaElement.prototype.play = (function (original) {
    return function () {
      ...
      // AUTOPLAY DISABLE (player | playlist | channel trailer)               // :417-446
      if (((player_autoplay_disable && !list) || (playlist_autoplay === false && list)) && '/watch?'
          || (channel_trailer_autoplay === false && isChannel)) {
        if (player && !ImprovedTube.user_interacted && !ad-showing) {
          try { player.pauseVideo(); } catch { this.pause(); }                // :429
          return Promise.resolve();
        }
      }
      return original.apply(this, arguments);                                 // :451
    };
  })(HTMLMediaElement.prototype.play);
};
```

Separate toggles exist for **video autoplay**, **playlist up-next autoplay**, and **channel
trailer autoplay** (functions.js:419-423). For our tool, **(a) is safer and less invasive**;
**(b)** is the heavier hammer if the button toggle proves flaky. Note (b) requires page-world
injection (it overrides a prototype the page uses).

### 3.2 Loop / repeat

`video.setAttribute('loop', '')` — the simplest possible mechanism (no player API needed):

```js
// improvedtube/js&css/web-accessible/www.youtube.com/player.js:988
ImprovedTube.playerRepeat = function () {
  if (!/ad-showing/.test(player.className)) video.setAttribute('loop', '');
};
```

There's also a player-bar repeat button (`playerRepeatButton`, player.js:999).

### 3.3 Default & remembered playback speed (and don't speed music)

**Set speed** via `video.playbackRate` (preferred) with `player.setPlaybackRate` fallback:

```js
// improvedtube/js&css/web-accessible/www.youtube.com/player.js:83
ImprovedTube.playbackSpeed = function (newSpeed) {
  if (video?.playbackRate) { video.playbackRate = newSpeed; }
  else if (player?.setPlaybackRate) { player.setPlaybackRate(newSpeed); }
};
```

**Permanent speed** (`playerPlaybackSpeed`, player.js:109-253) is the interesting one: it applies
a remembered default speed to every video **but detects music** (genre, title/keyword regexes,
duration heuristics, and even a `music.youtube`-style check) and resets those to 1× so it never
makes songs sound wrong (player.js:121-187). It also skips live streams (player.js:119) and
respects a per-video manual override (player.js:116-117). This "smart default that gets out of
the way" is exactly the north-star posture — ship a remembered speed, but never at the cost of
music sounding chipmunked.

### 3.4 Skip-to-time / seek & keyboard shortcuts

`shortcuts.js` implements customizable keyboard shortcuts including seek/skip, volume step, and
speed step, plus click-to-seek on the progress bar:

- volume step: `shortcuts_volume_step` (default 5) — shortcuts.js:379
- playback-speed step: `shortcuts_playback_speed_step` (default 0.05) — shortcuts.js:421
- progress-bar seek math via `player.seekTo(...)` — shortcuts.js:330-366
- "jump to key scene" — shortcuts.js:172 / player.js:2275

`seekTo(seconds)` is the reliable seek primitive. `forcedPlayVideoFromTheBeginning`
(player.js:4-25) shows the inverse (always start at t=0), with a nice guard to avoid a "double
play" of the opening seconds.

---

## 4. Distraction removal (cosmetic filtering)

### 4.1 The core mechanism: CSS keyed off `html[it-*]` attributes

This is the single most important pattern in the whole codebase and the one we should adopt
wholesale. The content script mirrors every setting onto the `<html>` element as an
`it-<setting>` attribute; CSS then reacts instantly with **zero per-frame JS**:

```js
// improvedtube/js&css/extension/core.js:310  (on load, for every stored key)
document.documentElement.setAttribute('it-' + key.replace(/_/g, '-'), items[key]);
// improvedtube/js&css/extension/core.js:274  (on live change)
document.documentElement.setAttribute('it-' + key.replace(/_/g, '-'), value);
```

CSS consumes it (all cosmetic features are `html[it-...="..."] <selector> { display:none }`):

| Feature | Selector (evidence) |
| --- | --- |
| Hide home Shorts shelf | `html[it-pathname='/'][it-remove-home-page-shorts="true"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])` — `general.css:168` |
| Hide subscriptions Shorts | `...[it-remove-subscriptions-shorts="true"] ...:has(ytd-rich-shelf-renderer[is-shorts])` — `general.css:169` |
| Hide search Shorts | `html[it-pathname='/results'][it-remove-shorts-reel-search-results="true"] ytd-reel-shelf-renderer` — `general.css:95` |
| Hide history / trending Shorts | `general.css:171,172` |
| Hide related-sidebar Shorts remix | `html[it-hide-shorts-remixing='true'] #related ytd-reel-shelf-renderer` — `sidebar.css:150` |
| Hide related sidebar entirely | `html[it-hide-sidebar='true'] ytd-watch-flexy[flexy] #secondary` — `sidebar.css:16,27` |
| Collapse related (Focus/Titles modes) | `html[it-related-videos='Focus'] #related ...` (shrink+dim, expand on hover) — `sidebar.css:121-141` |
| Hide comments | `html[it-comments='hidden'] ytd-comments ytd-item-section-renderer#sections #contents > ytd-comment-thread-renderer` — `comments.css:12-16` |
| Hide comment avatars | `html[it-hide-author-avatars='true'] ytd-comments #author-thumbnail` — `comments.css:18` |
| Hide end-screen video wall | `html[it-player-hide-endscreen='true'] .html5-endscreen` — `player.css:259` |
| Hide info cards / end-cards | `html[it-player-hide-cards='true'] .ytp-ce-element, .ytp-cards-button, .ytp-cards-teaser` — `player.css:264-267` |
| Show cards only on hover | `html[it-player-show-cards-on-mouse-hover='true'] .html5-video-player:not(:hover) .ytp-ce-element` — `player.css:271` |
| Hide annotations | `html[it-player-hide-annotations='true'] .annotation` — `player.css:253` |
| Hide merch shelf | `html[it-hide-merch-shelf="true"] div.ytd-merch-shelf-renderer` — `styles.css:18` |

### 4.2 Why this stays robust (CSS vs DOM removal)

- **CSS, not DOM surgery.** Hiding via `display:none`/`visibility:hidden` costs nothing per frame
  and can't be undone by Polymer re-rendering; removing nodes triggers re-render fights and layout
  thrash. Distraction-*removal* toggles are ~100% CSS-only — the JS files exist only for features
  that need a click-region hit-test (e.g. the "collapsed comments/sidebar" modes toggle an
  `[it-activated]` attribute from `comments.js:11-37` / `sidebar.js:99-126`) or that must actively
  counteract YouTube's own inline styles (`sticky_navigation` runs a `MutationObserver` reverting
  YouTube's re-asserted `style.transform`/`hidden` on the guide, `sidebar.js:157-218`).
  **Lesson: hide, don't delete.**
- **Semantic custom-element selectors are the durable ones.** Selectors that target YouTube's
  Polymer element *tag names* + reflected semantic attributes (`ytd-reel-shelf-renderer`,
  `ytd-rich-shelf-renderer[is-shorts]`, `ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]`,
  `ytd-comments`) and stable player classes (`.ytp-ce-element`, `.html5-endscreen`,
  `.ytp-cards-button`) are stable **because the extension doesn't own them and YouTube renames tags
  far less often than it restyles**.
- **The fragile ones, and what breakage looks like.** Where YouTube exposes *no* semantic hook —
  icon-only buttons in the "…" overflow menu, generic view-model thumbnail wrappers — ImprovedTube
  falls back to matching **literal SVG path data** (`details.css:57`:
  `...svg path[d^="M10 3.158V7.51c"]`) or churny BEM-ish class names
  (`.yt-lockup-view-model-wiz__content-image`). The source openly documents the firefighting:
  multiple dead+live generations of the same button's path-selector kept side by side
  (`details.css:56-75`), dated attribution comments (`sidebar.css:156` "update Aug 22th 2025",
  `general.css:120` "Legacy selectors - kept as fallbacks (May 2026)"), and "is this still needed?"
  self-doubt (`general.css:167` "are the two lines above outdated?", `player.css:507` "outdated
  line?"). **Takeaway: prefer semantic-tag selectors; treat any SVG-path / view-model-class
  selector as a maintenance liability and stack fallbacks.**
- **Modern `:has()`** lets a single rule hide the *whole section* that contains a Shorts shelf,
  rather than hiding the shelf and leaving an empty container (general.css:168). ImprovedTube ships
  an `@supports not selector(:has())` fallback (general.css:205-209) for older engines — worth
  copying.
- **Pathname-scoping.** Rules are gated on `html[it-pathname='/feed/subscriptions']` etc.
  (set from `location.pathname` on every `yt-navigate-finish`, see §6) so a "hide Shorts on home"
  toggle doesn't nuke the Shorts you deliberately open.
- **Soft modes, not just hide.** Beyond `display:none`, ImprovedTube offers "collapsed"/"focus"/
  "titles" variants (`visibility:hidden` + `[it-activated]` reveal) so a user can *tuck away*
  comments/related rather than fully remove them (comments.css:56-61, sidebar.css:121-141,262-265)
  — a friendlier default than a hard hide.

### 4.3 Cleaner YT Music

ImprovedTube does **not** run on `music.youtube.com` at all (§0). YT Music uses a *different*
Polymer app (`ytmusic-*` custom elements, e.g. `ytmusic-player-bar`,
`ytmusic-carousel-shelf-renderer`) so its cosmetic rules must be authored separately. This is
greenfield for us and a clear differentiator — the same `html[it-*]` + semantic-tag CSS approach
transfers directly, just with `ytmusic-*` selectors.

---

## 5. Player enhancements

| Feature | Mechanism | Evidence |
| --- | --- | --- |
| **Screenshot** | `canvas.drawImage(video)` → `toBlob` → download or clipboard; optional subtitle burn-in | `player.js:782-823` |
| **Mini-player** (draggable overlay) | custom `it-mini-player` CSS class + drag handlers; geometry persisted in `localStorage['improvedtube-mini-player']` | `player.js:1802-1851` |
| **Picture-in-Picture** | `video.requestPictureInPicture()` / `document.exitPictureInPicture()`; optional auto-PiP on tab blur | `player.js:48-79` |
| **Persistent / forced volume** | `player.setVolume(v)`; **>100% boost** via Web Audio `AudioContext` + `GainNode` on a `MediaElementSource` | `player.js:622-663` |
| **Disable loudness normalization** | restore `video.volume` from `localStorage['yt-player-volume']`, re-assert on `volumechange` | `player.js:667-700` |
| **Auto-pause on tab switch** | pause when `document.visibilityState` hidden, resume on focus | `player.js:29-44` |
| **Auto-dismiss "Continue watching?"** | `MutationObserver` matches the dialog by text regex and clicks confirm | `player.js:3016-3073` |
| **Cinema / fit-to-window / rotate / auto-fullscreen** | CSS transforms + `player.toggleFullscreen()` | `player.js:433-441,1158-1342` |
| **Rewind/forward & speed +/- buttons** | injected player-bar buttons via `createPlayerButton` | `player.js:1933-2126` |
| **Playback-position / watched memory** | "last watched overlay" marks/annotates watched thumbnails (YouTube already resumes signed-in) | `web-accessible/www.youtube.com/last-watched-overlay.js` |

Player buttons are injected into the control bar and re-created on each `initPlayer` /
navigation, so they survive SPA transitions (functions.js:371-382).

**Desktop vs Android:** screenshot, rotate, mini-player-drag, and keyboard shortcuts are
desktop-oriented. PiP, persistent volume, auto-pause, and quality cap are the ones worth carrying
to mobile.

---

## 6. How ImprovedTube-class extensions stay robust

This section is the crux — the features are trivial; surviving YouTube's SPA + Polymer churn is
the engineering.

### 6.1 Two-world architecture (isolated content script + page world)

- **Isolated content-script world** (`core.js`, `general.js`, `sidebar.js`, `comments.js`,
  `init.js`) has `chrome.*` APIs and owns storage + CSS-attribute mirroring.
- **Page/main world** (`web-accessible/...`, injected as `<script>` tags) can touch the actual
  YouTube player object and prototypes (needed for `setPlaybackQualityRange`, `setPlaybackRate`,
  overriding `HTMLMediaElement.prototype.play`, reading `getVideoData()`).
- Injection: the content script appends the page-world files to `<html>` at `document_start`:

```js
// improvedtube/js&css/extension/init.js:76  (list) → :113 extension.inject(...)
const pageWorldFiles = ['/js&css/web-accessible/core.js', '.../player.js', ...];
extension.inject(pageWorldFiles.slice(), finishPageWorldInit);
// extension.inject: creates <script src=getURL(path)> and chains onload — core.js:120-146
```

- **Cross-world messaging** avoids `postMessage` origin noise by using **DOM text nodes +
  CustomEvents**: the content script writes JSON into a hidden `#it-messages-from-extension`
  div and dispatches an event; the page world reads it, and vice-versa via
  `it-message-from-youtube` (core.js:189-231; init.js:158-282). (For our ghost posture, a
  private event-name namespace + a hidden node is fine; just avoid leaking obvious globals.)

### 6.2 Declarative settings registry (how ~200+ toggles stay maintainable)

Settings are **data, not hand-written HTML**. Each option is an object declared in
`menu/skeleton-parts/*.js` and rendered by a homegrown 3,267-line UI framework
`menu/satus.js`:

```js
// improvedtube/menu/skeleton-parts/player.js:1251
player_quality: {
  component: 'select', text: 'quality', id: 'player_quality',
  options: [ {text:'disabled', value:'disabled'}, {text:'auto', value:'auto'},
             {text:'144p', value:'tiny'}, {text:'360p', value:'medium'}, ... ]
}
```

Component census across `menu/skeleton-parts/*.js` (verified by direct `grep` count):
**140 `switch`, 59 `shortcut`, 34 `select`, 19 `slider`, 10 `checkbox`, 9 `radio`** — ~270
declared controls backing ~223 feature functions. (An earlier automated count that swept the whole
`menu/` tree reported higher figures; the skeleton-parts numbers above are the authoritative
user-facing settings.) One universal renderer builds all of them: `menu/index.js` calls
`satus.render(extension.skeleton)` (after `satus.locale.import`), which recurses the whole tree
(`menu/satus.js:600+`). A universal storage accessor is attached to every control at render time
(`menu/satus.js:750-793`): flipping a `switch` sets `component.storage.value`, whose setter calls
`satus.storage.set(key, val)` → `chrome.storage.local.set({[key]: value})` (`menu/satus.js:959,987`).
There is **no per-option HTML and no explicit "Save" button** — the object key *is* the storage
key, the CSS attribute, and (camelized) the feature-function name, all derived mechanically so they
can't drift as options are added. Adding a feature = one object in the skeleton + one CSS rule *or*
one named function.

Localization scales the same way: `text:` holds a message *key*, resolved at paint by
`satus.locale.get` (`menu/satus.js:1023`) against `_locales/<lang>/messages.json` (**63 locales**,
571 messages in `en`), with `pt_BR → pt → en` fallback (`menu/satus.js:1042-1046`). Adding a
toggle costs one `text:` key + one message per locale, never rendering code.

**`background.js` (service worker) does NOT touch the network.** Confirmed: there is **no
`webRequest` and no `declarativeNetRequest`** anywhere in the codebase. Its jobs are: one-shot
**settings migration** on update (`background.js:30-116`, e.g. renaming `shortcut_144p` →
`shortcut_quality_144p`), fresh-install platform defaults (`background.js:110-121`), a
locale-aware context menu, **tab focus/blur tracking** for pause-on-blur / one-player-at-a-time
(`background.js:224-256`), a **message router** (`background.js:291-397`), and Safari MAIN-world
injection via `chrome.scripting.executeScript({world:'MAIN'})` (`background.js:259-283`). Defaults
are *lazy* — every feature reads `storage.get(key)` and treats `undefined` as "off", so there's no
central defaults schema to maintain.

### 6.3 The storage → feature dispatch (live apply, no reload)

`chrome.storage.local` holds flat snake_case keys. A single `onChanged` listener fans out three
ways so every kind of feature updates live:

```js
// improvedtube/js&css/extension/core.js:266
chrome.storage.onChanged.addListener(function (changes) {
  for (var key in changes) {
    var value = changes[key].newValue, camelized_key = extension.camelize(key);
    extension.storage.data[key] = value;
    document.documentElement.setAttribute('it-'+key.replace(/_/g,'-'), value);   // :274  → CSS features instant
    if (typeof extension.features[camelized_key] === 'function')
      extension.features[camelized_key](value);                                  // :276-278  → JS content features
    extension.messages.send({action:'storage-changed', camelizedKey, key, value});// :285  → page-world features
  }
});
```

So `hide_shorts` → `html[it-hide-shorts]` (CSS reacts) **and** `extension.features.hideShorts()`
if defined **and** a message to the page world. Naming convention (snake_case key →
camelCase feature function) is the glue (`camelize`, core.js:44-60).

### 6.4 SPA navigation — the layered model (verified against live YouTube)

YouTube is a Polymer SPA; `DOMContentLoaded`/URL listeners don't fire on in-app navigation. The
robust answer is **three layers, together**, which is exactly current best practice
([SO/DEV 2025](https://sqlpey.com/javascript/fixing-youtube-extension-injection/),
[GitHub](https://github.com/Zren/ResizeYoutubePlayerToWindowSize/issues/72)):

1. **YouTube's own events** — `yt-navigate-finish` and `yt-page-data-updated`:

```js
// improvedtube/js&css/web-accessible/init.js:179
window.addEventListener('yt-page-data-updated', () => { ImprovedTube.pageType(); ... });
// improvedtube/js&css/web-accessible/init.js:227
document.addEventListener('yt-navigate-finish', () => {
  ImprovedTube.pageType(); ImprovedTube.videoPageUpdate(); ImprovedTube.initPlayer(); ...
});
// content-script side also mirrors pathname + re-runs features — improvedtube/js&css/extension/init.js:8
window.addEventListener('yt-navigate-finish', () => {
  document.documentElement.setAttribute('it-pathname', location.pathname);   // updates CSS scoping
  extension.features.thumbnailsQuality(); extension.features.stickyNavigation(); ...
});
```

2. **A global `MutationObserver`** on `documentElement` (`childList:true, subtree:true`) that
   dispatches every added node through a recursive handler — the fallback for elements that
   appear late or without a nav event:

```js
// improvedtube/js&css/web-accessible/init.js:6 … .observe(document.documentElement,{childList:true,subtree:true})
new MutationObserver(list => { for (m of list) for (n of m.addedNodes) ImprovedTube.childHandler(n); });
// childHandler recurses, skipping cheap/irrelevant node types, then dispatches by tag/id/class:
// improvedtube/js&css/web-accessible/functions.js:4
ImprovedTube.childHandler = function (node) {
  if (['SCRIPT','svg','#text','#comment','DOM-IF','DOM-REPEAT','yt-icon-shape',...].includes(node.nodeName)) return; // perf skip-list
  this.ytElementsHandler(node);                                     // :10  dispatch by node.nodeName/id/class (functions.js:35+)
  for (child of node.children) ImprovedTube.childHandler(child);    // :14  recurse
};
```

3. **Per-feature dedicated observers** for specific late/volatile elements — e.g. thumbnail
   quality (general.js:764), the "continue watching" dialog (player.js:3061), channel default
   tab on `href` changes (init.js:61-74), and masthead buttons (init.js:163-174).

Plus **retry timers** where the player isn't ready synchronously (quality re-apply at
300/800/1500/3000 ms, player.js:570-573) and **per-video idempotence guards**
(`player.dataset.defaultQuality`, player.js:495) so re-runs don't fight the user.

**Takeaway for us:** implement all three layers. Events give fast, cheap transitions; the global
observer is the safety net; per-feature observers handle the stubborn cases; attribute-scoped CSS
means most cosmetic features need *no* JS on navigation at all (just the `it-pathname` update).

### 6.5 Contrast: Iridium's data/JSON-interception approach

Iridium reaches the same outcomes from the opposite direction: instead of styling and observing
the *rendered* DOM, it **intercepts YouTube's data layer before Polymer renders it**. Concrete
evidence (`iridium/src/firefox/js/background-inject.js`, injected into the page/MAIN world):

- Hooks the two globals YouTube writes on every navigation, via property setters:
  `Object.defineProperty(window, "ytInitialData", { set(data){ ... } })`
  (background-inject.js:300-306) and `..."ytInitialPlayerResponse"...`
  (background-inject.js:312-318) — so it sees (and can mutate) the page model as it arrives.
- Proxies the network: `window.fetch = new Proxy(window.fetch, { apply: override })`
  (background-inject.js:275-296) intercepts InnerTube JSON, and returns a rebuilt
  `new Response(JSON.stringify(data))` from the possibly-mutated object — so it edits the payload
  *before* YouTube's renderer consumes it. Plus a legacy `handleResponse` hook on `Object.prototype`
  (background-inject.js:220-242).
- **Cosmetic hiding happens in the JSON, not the DOM.** Shorts/ads/merch are *spliced out of the
  data tree before Polymer renders* — e.g. `delete richGridRenderer["masthead"]`, `delete
  adPlacements/adSlots/playerAds` (background-inject.js:2029-2050), and `reelShelfRenderer` /
  `shortsLockupViewModel` entries `.splice()`d from `sectionListRenderer`/`richGridRenderer`
  contents (background-inject.js:2205-2355). Nothing to hide because it never renders. Its
  own injected chrome (custom buttons, end-screen toggle) uses the same `classList`/attribute-CSS
  idiom as ImprovedTube, but only on Iridium-owned elements.
- **Autoplay is prototype-override-*only*.** Iridium overrides `HTMLVideoElement.prototype.play`
  and gates every call through an allow-list that distinguishes a user click/keypress from
  YouTube's autoplay-next machinery (background-inject.js:328-481) — no dependency on the autonav
  button's DOM state (contrast ImprovedTube's button-toggle default).
- **No generic `MutationObserver` fallback.** Iridium funnels the native events
  (`yt-navigate-start/finish`, `yt-page-data-updated`, `yt-next-continuation-data-updated`,
  `popstate`) through one bus (background-inject.js:7-22) and relies on the fetch/property hooks to
  catch data arriving outside a navigation — a *two-layer* model vs ImprovedTube's three-layer.
- **Quality forcing still converges on the same internal methods**, called on the hooked
  player API object: `api["setPlaybackQuality"](q)` + `api["setPlaybackQualityRange"](q)`
  (background-inject.js:1885-1886) — confirming `setPlaybackQualityRange` as *the* mechanism.
- Settings are a declarative registry too, but smaller and flatter — **48 entries** of shape
  `{ id, default }` with an explicit defaults map (`iridium/src/firefox/js/setting-data.js:1-198`)
  — contrast ImprovedTube's ~270 controls and *lazy* `undefined`-means-off defaults.

**Trade-off.** Data-interception is more resilient to *CSS class churn* (you mutate the model, the
view follows, so you don't chase renamed classes) and cleaner for structural changes like removing
Shorts from a feed. But it is **heavier, tightly coupled to InnerTube's JSON schema** (a shape
change breaks it), and — decisive for our **ghost posture** — it **monkeypatches `window.fetch`
and `Object.prototype`**, which is far more detectable and more fragile than CSS attribute
selectors. **Recommendation for us: default to ImprovedTube's DOM/CSS approach for cosmetics
(quiet, robust, undetectable); reserve data-interception for the rare case where CSS genuinely
cannot express the change, and even then prefer the narrowest possible hook.**

---

## 7. Firefox desktop + Android caveats

- **`m.youtube.com` is a different Polymer app — desktop selectors do NOT transfer.** It uses a
  `ytm-*` element tree (`ytm-app`, `ytm-reel-shelf-renderer`, `ytm-pivot-bar-item-renderer`,
  `ytm-rich-item-renderer`), not desktop's `ytd-*`. Real extensions branch their entire selector
  set by hostname (Control Panel for YouTube: `let mobile = location.hostname == 'm.youtube.com'`,
  then `ytm-*` selectors throughout). Cosmetic CSS/DOM must be **re-authored per site**. The
  *architecture* still transfers unchanged (attribute-mirroring + observer engine).
- **`#movie_player` IS shared desktop↔mobile** (used unconditionally by Control Panel for YouTube
  and SponsorBlock/maze-utils on both), so the *player container* is a stable anchor even though the
  surrounding chrome differs.
- **Two things need on-device verification before you rely on them** (a remote-debugged
  Firefox-Android session): (1) whether mobile fires an event literally named `yt-navigate-finish`
  with the same payload — *unconfirmed*; do not assume it. (2) whether the internal quality methods
  (`getAvailableQualityLevels`/`setPlaybackQuality`/`setPlaybackQualityRange`) exist on the mobile
  `#movie_player` build — *unconfirmed*; the public IFrame quality API is a deprecated no-op
  everywhere, so there is no fallback if the internal methods differ on mobile. Design the quality
  cap to **feature-detect and gracefully no-op.**
- **Firefox for Android runs extensions** (content scripts + manifest `"css"` injection work
  identically to desktop, per Mozilla's Extension Workshop). Chrome-Android has **no** extensions at
  all — so a Firefox-Android YouTube tool is differentiated purely by platform.
- **Android manifest/API caveats:** **stay on MV2** — MV3 background *service workers are not
  supported on Firefox for Android* (use MV2 event pages). No `commands` (no keyboard-shortcut
  registration), no `sidebarAction`, no `menus`/context menus; `browserAction`/`action` popups
  render as a **full-screen overlay**, not an anchored dropdown. Ship a `browser_specific_settings.
  gecko_android` block (SponsorBlock, uBlock Origin, Dark Reader all do). Our extension is already
  MV2, which aligns.
- **Worth shipping on mobile:** quality cap / data-saver (feature-detected), disable feed autoplay
  previews (needs a mobile-specific mechanism — no hover on touch), hide Shorts (`ytm-*` selectors),
  hide comments, playback speed (standard `video.playbackRate`, platform-independent),
  background/audio + PiP, disable autoplay-next.
- **Not worth it on mobile:** screenshot, rotate, drag-mini-player, keyboard shortcuts, and any
  hover-only interaction (no hover on touch; small viewport). Related-sidebar hiding is moot (no
  sidebar on mobile).
- **`music.youtube.com`** is its own Polymer app (`ytmusic-*` elements, e.g. `ytmusic-player-bar`,
  `ytmusic-carousel-shelf-renderer`) on both desktop and mobile web; plan a dedicated selector set.
  The incumbent (ImprovedTube) doesn't cover it at all — clear differentiation.

---

## 8. Recommendation for OUR extension (opinionated, mapped to the north star)

Adopt ImprovedTube's *architecture* wholesale; adopt only a *curated slice* of its features so we
stay razor-focused, not another 200-toggle kitchen sink.

### Architecture to copy (non-negotiable)

1. **CSS keyed off `html[<ns>-*]` attributes** for 100% of cosmetic features. Mirror settings onto
   `<html>` on load and on `storage.onChanged`. **Ghost caveat:** an `it-*`-style marker attribute,
   a hidden bridge `<div>`, a global page-world object, and any prototype/`fetch` hooks are all
   **page-visible and fingerprintable** — a private namespace is *obscurity, not invisibility*.
   To minimize surface, prefer injecting the actual `display:none` rules via an
   extension-owned stylesheet (MV3 `scripting.insertCSS` / `tabs.insertCSS`) toggled per setting,
   rather than page-visible marker attributes, where the feature allows; reserve marker attributes
   for the pathname/state scoping that genuinely needs a DOM hook. **Avoid prototype overrides and
   `fetch` proxies for cosmetics** — they are the most detectable techniques.
2. **Semantic custom-element selectors + `:has()`**, pathname-scoped via a mirrored
   `<ns>-pathname` attribute. Avoid inner class names.
3. **Three-layer SPA handling**: `yt-navigate-finish` + `yt-page-data-updated` events, one global
   `MutationObserver` → dispatch, and per-feature observers for stubborn elements. Idempotence
   guards + light retry timers for the player.
4. **Two-world split** only where needed: page world exclusively for player-API/prototype work
   (quality, speed, autoplay-intercept); everything cosmetic stays in the isolated world + CSS.
5. **Declarative settings registry** (a small data structure → renderer) so adding a toggle is
   one object + one CSS rule or one named function. Flat `storage.local` keys, snake_case →
   camelCase dispatch.
6. Extend all of the above to **`music.youtube.com` (`ytmusic-*`)** and **`m.youtube.com`** — the
   incumbent doesn't, and this is our one-stop claim.

### Default set (ON out of the box, zero config)

- Disable **autoplay-next** (button-toggle mechanism, §3.1a).
- Disable **animated/hover thumbnail previews** (bandwidth + calm feed, §2.2).
- **Hide Shorts** everywhere (single toggle spanning home/search/subs/history/sidebar, §4).
- **Remember playback speed**, with music auto-exemption (§3.3).
- **Auto-dismiss "Continue watching?"** (§5).
- On mobile / metered: default a **quality cap** (e.g. 480p) as the headline data-saver (§2.1).

### Optional power toggles (OFF, in an "Advanced" drawer)

- **Force / cap quality** with sub-options: fixed tier, cap, lower-when-unfocused,
  lower-on-battery (§2.1).
- **Distraction removal**: hide comments, hide/collapse related sidebar (offer the elegant
  Focus/Titles collapse, not just hide), hide end-screen cards + info cards + annotations,
  cleaner masthead (§4).
- **Player**: default speed value, loop, screenshot, mini-player, PiP, persistent volume,
  disable loudness normalization, custom keyboard shortcuts, skip/seek (§5).
- **Autoplay**: separate playlist / channel-trailer autoplay controls; the heavier
  `play()`-intercept as an opt-in "strict" mode (§3.1b).

### Explicitly skip (scope discipline)

Themes/skins, font swaps, subtitle restyling, per-page layout micro-tweaks, blocklists, RYD, the
200-toggle long tail. They dilute "one-stop, simple" and each is a maintenance liability.

### Sequencing

1. Build the **CSS-attribute + three-layer SPA engine** first (it de-risks everything else).
2. Land the **ON-by-default set** — it delivers the felt "calmer, lighter YouTube" immediately.
3. Add the **page-world player controls** (quality/speed/autoplay-intercept).
4. Port the default set to **`music.youtube.com`** then **`m.youtube.com`**.

---

## 9. References

**Repositories (cloned & read):**

- ImprovedTube — `code-charity/youtube`, commit
  `43fa27d3ec07a5e9351d83386c0066a618036e86` (2026-07-05).
  <https://github.com/code-charity/youtube>
- Iridium — `ParticleCore/Iridium`, commit
  `9e2dcabc205affa298f62356f4a670c40cdc3236` (2026-01-31).
  <https://github.com/ParticleCore/Iridium>

**Key files cited:** `improvedtube/manifest.json`; `improvedtube/js&css/extension/core.js`,
`.../extension/init.js`, `.../extension/www.youtube.com/general/general.js`,
`.../appearance/{sidebar,comments,player}/*.css`, `.../www.youtube.com/styles.css`;
`improvedtube/js&css/web-accessible/init.js`, `.../functions.js`,
`.../www.youtube.com/player.js`, `.../shortcuts.js`; `improvedtube/menu/satus.js`,
`.../menu/skeleton-parts/player.js`.

**Web sources (APIs / behavior, retrieved 2026-07):**

- YouTube IFrame Player API reference (quality-method deprecation to no-op, Oct 2019) —
  <https://developers.google.com/youtube/iframe_api_reference>
- `setPlaybackQuality` is only a suggestion — <https://stackoverflow.com/questions/8802498/youtube-iframe-api-setplaybackquality-or-suggestedquality-not-working>
- Internal `setPlaybackQualityRange(min,max)` lock pattern —
  <https://gist.github.com/calcarlson/d6c6f4042b93f688df8e77df5febc6b6> ·
  <https://greasyfork.org/en/scripts/374466-youtube-video-quality/code>
- SPA nav events (`yt-navigate-finish`, `yt-page-data-updated`) + MutationObserver best practice —
  <https://sqlpey.com/javascript/fixing-youtube-extension-injection/> ·
  <https://github.com/Zren/ResizeYoutubePlayerToWindowSize/issues/72>
- Hover-preview bandwidth / "Inline playback" —
  <https://chromeunboxed.com/how-to-disable-youtube-inline-preview-zoom> ·
  <https://techviral.net/disable-youtube-auto-play-thumbnails-video-preview/>
- Mobile `m.youtube.com` DOM divergence (`ytm-*`) —
  <https://github.com/ajayyy/SponsorBlock/issues/1947> ·
  <https://github.com/ajayyy/SponsorBlock/commit/3222afd8b419288fcfa2e7dd034fea7cfebc01e9> ·
  <https://github.com/nomomo/Youtube-Mobile-Userscript/>
- Firefox for Android extension support (MV2 recommended; MV3 SW unsupported; no commands/
  sidebarAction/menus; full-screen popup) —
  <https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/> ·
  <https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/>
</content>
</invoke>
