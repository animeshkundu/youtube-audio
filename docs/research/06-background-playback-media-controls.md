# 06 - Background / Lock-Screen Audio Playback & OS Media Controls

Research for the YouTube Audio Firefox WebExtension (MV2). Scope: keeping audio
playing when the tab is backgrounded or the screen is off, and exposing native
OS / lock-screen media controls, on **Firefox desktop** and **Firefox for
Android**, for `youtube.com`, `m.youtube.com`, `music.youtube.com`,
`youtube-nocookie.com`.

This document is **complementary to, and deliberately disjoint from, the
audio-only / disable-video work** (researched elsewhere). It does not cover
stripping the video stream. It covers: *not getting paused in the background* and
*native media controls*.

Date: 2026-07-11. Grounded in code cloned to `/tmp/yta-research/06-background-playback/`
and 2026-current MDN / browser-compat-data.

---

## 1. Executive summary

**Root cause is almost entirely self-inflicted by YouTube, not the browser.**
Both Firefox desktop and Firefox for Android are perfectly happy to keep a
`<video>`/`<audio>` element's *audio* playing while the tab is hidden or the
screen is off. What stops the audio is YouTube's own JavaScript reacting to the
**Page Visibility API**: when `document.hidden` flips to `true`, the mobile
YouTube player (and, after long idle, the desktop one) calls `video.pause()` or
raises the "Video paused. Continue watching?" dialog. Mozilla says this in its
own words in the *Video Background Play Fix* README: "Firefox for Android can
continue playing video even if you switch to another tab or app. However, sites
can detect these user actions with the Page Visibility API" (`video-bg-play/README.md:3-4`).

**What it takes, concretely:**

| Surface | To keep audio playing | To get OS controls |
| --- | --- | --- |
| **FF desktop** (`www.youtube.com`, `music.youtube.com`) | Almost nothing — desktop keeps audio playing in a background tab already. Only need to defeat the periodic "Continue watching?" nag. | Nothing — YouTube already populates `navigator.mediaSession`; Firefox 82+ surfaces it to OS media hub / hardware media keys. |
| **FF Android** (`m.youtube.com`, or `www.youtube.com` in desktop mode) | **Override Page Visibility** (`document.hidden=false`, `visibilityState='visible'`, swallow `visibilitychange`) from *page context*, plus a periodic synthetic-activity ping to defeat the idle nag. This is the whole ballgame. | The Android system media notification appears automatically from GeckoView. Metadata/lock-screen fidelity is historically weaker than Chrome (`partial_implementation` in compat data); YouTube already sets `mediaSession`, we mostly need to *not break it*. |

**The single most important technique** is the Page Visibility override, and on
Firefox it has an unusually clean, stealthy implementation: the
`document.wrappedJSObject` Xray trick (Firefox 58+), which lets an *isolated
content script* redefine page-visible properties **without injecting any
`<script>` into the DOM**. This is what `mozilla/video-bg-play` ships. It is more
"ghost" than the Chrome-style script-tag injection because it leaves no DOM
footprint.

**WakeLock is not needed** for audio and would waste battery — audio survives
screen-off via the OS audio-focus / media-session path, not a screen wake lock.

**Picture-in-Picture is a fallback, not a primary strategy** — on Firefox Android
PiP is video-only (no audio-only PiP), and on desktop it is unnecessary for audio.

---

## 2. Root causes of background-pause (with evidence)

### 2.1 Page Visibility API — the dominant and usually *only* cause

The mechanism the sites use: they register a `visibilitychange` handler and read
`document.hidden` / `document.visibilityState`. When the tab is backgrounded or
the phone screen locks, `visibilityState` becomes `'hidden'` and the player
pauses. Every extension studied targets exactly this and nothing deeper, because
this is the real cause.

Evidence — all four leading extensions attack the same three primitives
(`document.hidden`, `document.visibilityState`, the `visibilitychange` event):

- `video-bg-play/video-bg-play-content.js:12-18` sets `hidden`/`visibilityState`
  and stops `visibilitychange` propagation.
- `control-panel-for-youtube/page.js:3296-3299,3301-3302` does the identical
  override inside `allowBackgroundPlay()`.

The `visibilitychange` event is swallowed in the **capture phase with
`stopImmediatePropagation()`**, so the site's own bubble/capture listeners never
fire even if it re-reads state:

```
// video-bg-play/video-bg-play-content.js:17-18
window.addEventListener('visibilitychange',
  evt => evt.stopImmediatePropagation(), true);   // capture=true
```

Note the prefixed alias: historically sites also listened for
`webkitvisibilitychange` / read `webkitHidden`. Modern YouTube uses the
unprefixed names, but a defensive override should cover both.

### 2.2 The "Video paused. Continue watching?" idle nag — the secondary cause

Independent of visibility, YouTube pops a confirmation dialog after a long span
with **no user input** (an idle/anti-AFK check). On desktop this is often the
*only* thing that stops long unattended playback. It fires on both desktop and
mobile web, and Music has its own variant ("You there?").

Evidence that this is a *distinct* code path with its own defeat:

- `youtube-nonstop/autoconfirm.js` keys off idle time (`idleTimeoutMillis = 5000`)
  and the `yt-popup-opened` event, with a Music-specific node name:
  `popupEventNodename = isYoutubeMusic ? 'YTMUSIC-YOU-THERE-RENDERER' :
  'YT-CONFIRM-DIALOG-RENDERER'`.
- `improvedtube/js&css/web-accessible/www.youtube.com/player.js:3028` matches
  `/continue watching|video paused|still watching|are you still watching/i`.

Two families of defeat exist (see §3.4).

### 2.3 Things that are *not* the cause (do not chase these)

- **requestAnimationFrame throttling / setTimeout clamping in background tabs.**
  Real, but irrelevant to *audio*: an `HTMLMediaElement` plays on its own media
  clock, not on rAF or JS timers. Throttling can only stall UI/telemetry loops.
- **Page Lifecycle API (`freeze`/`resume`, `document.wasDiscarded`).** This is a
  Chromium feature; Firefox does not fire these JS events. Firefox's "tab
  unloading" happens only under memory pressure and destroys the tab entirely
  (not a silent pause you can spoof). Not a factor for our targets.
- **Autoplay gating (`media.autoplay.*`).** Relevant only to whether playback can
  *start* without a gesture; once the user has pressed play, autoplay policy does
  not re-pause on backgrounding. Not a background-pause cause.
- **The browser itself pausing audio on screen-off.** It does not. Confirmed by
  Mozilla's own README (§1) and by the fact that the fix is purely a visibility
  spoof, with zero media-element manipulation.

**Bottom line:** on Firefox, background audio pause = Page Visibility (mobile, and
long-idle desktop) + the idle nag. Fix those two and audio persists.

---

## 3. Technique catalog

For each: mechanism, real-code evidence, robustness, stealth, and the
desktop/Android + MV2/MV3 caveats.

### 3.0 Prerequisite: how to run code in the PAGE world on Firefox

All of these techniques must affect what **YouTube's own scripts** observe, so
they must run in (or reach into) the **page/MAIN world**, not the isolated
content-script world. There are three ways on Firefox, in descending stealth:

**(A) `document.wrappedJSObject` from an isolated content script (Firefox-only, FF 58+).**
Firefox gives content scripts "Xray vision": `document` is a wrapper, and
`document.wrappedJSObject` is the *real* page object. Defining a property on it
makes the page see your value. **No `<script>` is injected into the DOM; no
`web_accessible_resources` entry is needed.** This is the stealthiest option and
works in **both MV2 and MV3** on every Firefox back to 58.

```
// video-bg-play/video-bg-play-content.js:13-14
Object.defineProperties(document.wrappedJSObject,
  { 'hidden': {value: false}, 'visibilityState': {value: 'visible'} });
```

Manifest requires nothing special — a plain content script
(`video-bg-play/manifest.json:20-28`, `strict_min_version: "58.0"`).

**(B) Declarative `world: "MAIN"` content script (Firefox 128+, MV2 *and* MV3).**
Firefox 128 added `world` to the `content_scripts` manifest key **and** to
`contentScripts.register()` (the MV2 dynamic API) — confirmed in the Firefox 128
release notes (Firefox bug 1736575) and in browser-compat-data
(`content_scripts.world` → firefox `128`, firefox_android mirrors). `control-panel-for-youtube`
ships it in an **MV2** manifest:

```
// control-panel-for-youtube/manifest.mv2.json (content_scripts[1])
{ "world": "MAIN", "matches": [...], "js": ["page.js"], "run_at": "document_start" }
```

The MAIN-world script cannot use `chrome.storage`, so it bridges to an isolated
content script via `window.postMessage` + `BroadcastChannel`
(`control-panel-for-youtube/content.js`). Caveat: needs FF ≥ 128; older Firefox
silently ignores the key.

**(C) Inject a `<script src=getURL(...)>` web-accessible resource (all browsers, MV2+MV3).**
The classic Chrome-compatible method: create a `<script>` element pointing at a
`web_accessible_resources` file and append it. Runs in MAIN world.

```
// improvedtube/js&css/extension/core.js:131,142
element = document.createElement('script');
...
document.documentElement.appendChild(element);
```

`youtube-nonstop` uses the same pattern (`autoconfirm.js` listed under
`web_accessible_resources`, injected by its isolated `content.js`). **Least
stealthy**: leaves a `<script>` node (removable after `onload`, but a page-side
`MutationObserver` can still catch it) and exposes a `moz-extension://<id>/...`
URL. On Firefox the extension UUID is randomized per-install, which blunts
enumeration, but the injection is still observable.

**Recommendation for stealth:** prefer **(A)** wherever it suffices (pure
property/event overrides), because YouTube cannot see a DOM change. Use **(C)**
only when you must replace *functions the page calls* (e.g. overriding
`video.pause` or `mediaSession.setActionHandler`, which (A) cannot do cleanly for
prototype methods) and you want Chrome parity; use **(B)** if we ever drop
support for Firefox < 128 and want a declarative MAIN-world script with no DOM
node.

---

### 3.1 Page Visibility override (THE core technique)

**Mechanism.** Force `document.hidden === false` and
`document.visibilityState === 'visible'` permanently, and swallow
`visibilitychange` in the capture phase so the site never re-evaluates.

**Real code.**
- `video-bg-play/video-bg-play-content.js:11-18` — the canonical minimal form,
  via `wrappedJSObject` (method A). Crucially it is **gated to where it is
  needed**: `if (IS_ANDROID || !IS_DESKTOP_YOUTUBE)` (line 12). It is *not*
  applied to desktop `www.youtube.com`, because desktop already keeps audio
  playing; over-spoofing there would be a needless, detectable footprint.
- `control-panel-for-youtube/page.js:3294-3299,3301-3302` — same override in MAIN
  world (method B), gated `if (mobile && config.allowBackgroundPlay)` at
  `page.js:6112-6113` (mobile `m.youtube.com` only).

**Robustness.** Very high; this is the load-bearing fix and both leading
extensions rely on it. Failure modes are minor: YouTube could in principle read
`visibilityState` via a getter it captured at load, but registering at
`run_at: "document_start"` wins the race.

**Stealth.** With method (A) there is *no DOM footprint*. Residual detection
vector: defining `hidden`/`visibilityState` as **own value properties** on
`document` changes the shape — natively they are getters on `Document.prototype`,
so `document.hasOwnProperty('hidden')` returns `true` (native: `false`), and
`Object.getOwnPropertyDescriptor(document,'hidden')` reveals a `value` descriptor
instead of inheriting a getter. YouTube does **not** currently probe for this,
but for maximum ghosting we can instead redefine the **getter on
`Document.prototype`** (`Object.defineProperty(Document.prototype, 'hidden', {get:
() => false, configurable: true})`), which keeps `document` looking pristine. The
`visibilitychange` capture-swallow is essentially invisible (a page cannot
enumerate other listeners).

**Desktop caveat.** Not needed and should be skipped on desktop YouTube (mirror
video-bg-play's gate) to minimize footprint. Music desktop likewise plays in
background already.

**Android caveat.** This is exactly where it *is* required, including
`www.youtube.com` opened in Android "Desktop site" mode (hence video-bg-play's
`IS_ANDROID` branch). Applies to `m.youtube.com` and `music.youtube.com`.

**MV2/MV3.** Method (A) works in both. Our extension is MV2 → use (A).

---

### 3.2 Synthetic user-activity ping (idle-nag defeat, family 1)

**Mechanism.** Periodically dispatch a harmless keyboard event so YouTube's idle
timer never elapses and the "Continue watching?" dialog never appears. Both
Mozilla's and Control Panel's extensions use modifier keys (no visible effect).

**Real code.**
- `video-bg-play/video-bg-play-content.js:27-45` — dispatches Alt (`keyCode 18`)
  keydown+keyup on a jittered ~60s loop (`loop(pressKey, 60_000, 10_000)`).
- `control-panel-for-youtube/page.js:3318-3332` — dispatches a random modifier
  (`[16,17,18]` = Shift/Ctrl/Alt) keydown+keyup every `45_000 + rand*25_000` ms,
  but **only while the real document is hidden AND a video is actually playing**
  (`page.js:3312-3317` checks `isVideoPage()` and
  `movie_player.getPlayerState()`). This gating is smart: it minimizes synthetic
  events to exactly when needed.

**Robustness.** High and low-maintenance — it resets an *idle timer*, so it does
not depend on YouTube's DOM structure.

**Stealth.** Moderate. The dispatched `KeyboardEvent` has `isTrusted === false`.
YouTube does not currently filter idle-reset input on `isTrusted`, but it *could*.
Control Panel's "only when hidden + playing" gate reduces the synthetic-event rate
(and thus the observable footprint) versus video-bg-play's unconditional ping.

**Desktop/Android.** Applies to both; the nag is cross-surface. Recommend the
Control Panel gating (fire only when hidden + playing).

**MV2/MV3.** Must run in page context (dispatch on the page's `document`). Same
world requirement as §3.1.

---

### 3.3 Idle-nag defeat, family 2 — intercept the pause / auto-dismiss the dialog

A more surgical alternative (or complement) to the activity ping. Two real
variants:

**(a) Override `video.pause` + gate on idle (`youtube-nonstop`).**
`youtube-nonstop/autoconfirm.js` replaces `videoElement.pause` so a *programmatic*
pause that happens while idle is intercepted (playback continues), while genuine
user pauses (non-idle) pass through. It also intercepts the popup:
`listenForPopupEvent()` closes `YT-CONFIRM-DIALOG-RENDERER` /
`YTMUSIC-YOU-THERE-RENDERER` and resumes. Requires MAIN world (it monkey-patches a
function the page calls) — injected via `web_accessible_resources` (method C).

**(b) Auto-click the confirm button (`ImprovedTube`).**
`improvedtube/.../player.js:3016-3073` (`playerAutoContinueWatching`) runs a
`MutationObserver` on `document.documentElement`, and when a dialog matching the
"continue watching" text regex appears, finds and `.click()`s the confirm button,
then calls `player.playVideo()` if needed.

**Robustness.** (a) is robust to copy changes (it does not parse dialog text) but
depends on `video.pause` semantics. (b) is simplest but brittle to DOM/class/copy
changes (selectors like `#confirm-button tp-yt-paper-button`) and to i18n (the
text regex is English-only).

**Stealth.** (a)'s `video.pause` override is a function-identity change on the
media element — detectable if YouTube checks `video.pause.toString()`
(`[native code]` vs not) or compares against `HTMLMediaElement.prototype.pause`.
(b)'s synthetic `.click()` is `isTrusted:false` and adds a `MutationObserver` over
the whole tree (CPU cost, not directly page-observable). Both are more detectable
than the activity ping's fire-and-forget.

**Recommendation.** Prefer the **activity ping (§3.2)** as primary (simplest,
i18n-proof, resets the timer before the dialog ever shows), with **auto-dismiss
(b)** as a cheap belt-and-suspenders fallback for the case where a dialog slips
through. Avoid the `video.pause` monkey-patch unless we find the ping insufficient
— it is the most detectable and can interfere with legitimate pause UX.

---

### 3.4 Picture-in-Picture as a background-audio workaround

**Desktop.** Unnecessary — desktop already plays audio in background tabs. PiP is
a UX nicety, not a background-audio enabler.

**Android.** Firefox for Android supports PiP for `<video>`, and a PiP window
keeps playing when you leave the browser. But: **PiP is video-only — there is no
audio-only PiP on Firefox Android.** So PiP conflicts directly with our
audio-only mission (it needs a visible video surface). It is at best a
compatibility fallback for users who cannot get the visibility override working,
not a strategy we build on.

**Robustness/stealth.** PiP entry generally requires a user gesture (can't be
silently forced), and it is highly visible to the user (a floating window). Low
stealth value, high UX intrusion. **Not recommended** as our mechanism.

---

## 4. Media Session integration (`navigator.mediaSession`)

### 4.1 What the API gives us

`navigator.mediaSession.metadata` (a `MediaMetadata` of title/artist/album/
artwork), `setActionHandler(...)` for `play`/`pause`/`previoustrack`/`nexttrack`/
`seekbackward`/`seekforward`/`seekto`/`stop`, and `setPositionState({duration,
position, playbackRate})` for the scrubber. These drive OS media hubs (Windows
SMTC, macOS Now Playing / Control Center), hardware/Bluetooth media keys, and the
Android notification + lock-screen controls.

### 4.2 Compat (authoritative, from mdn/browser-compat-data, 2026)

| Feature | FF desktop | FF Android | Notes |
| --- | --- | --- | --- |
| `MediaSession`, `metadata`, `setActionHandler`, `playbackState`, `setPositionState` | **82** | **82** | Android flagged **`partial_implementation`**: *"Firefox exposes the API, but does not provide a corresponding user-facing media control interface."* |
| `setCameraActive` / `setMicrophoneActive` | not supported | not supported | Not relevant to us. |

(A web summary claimed MediaSession is "not supported in Firefox" — that is
**wrong**; it conflated the API's "Limited availability / not Baseline" label with
no support. BCD is authoritative: supported since FF 82 on both, Android partial.)

### 4.3 Does YouTube already populate it? — Yes.

Direct evidence that YouTube (and YouTube Music) call `mediaSession`:
`youtube-nonstop/autoconfirm.js` has to **defend against** YouTube overwriting the
`pause` action handler — it saves the original (`yns_setActionHandler`) and blocks
re-registration of `'pause'`:

```
navigator.mediaSession.setActionHandler = (action, fn) => {
  if (action === 'pause') { /* blocked */ return; }
  navigator.mediaSession.yns_setActionHandler(action, fn);
};
```

You cannot block an override that never happens — so YouTube demonstrably sets
`setActionHandler('pause', ...)`. In practice YT also sets `metadata` (title,
channel-as-artist, thumbnail artwork), action handlers, and `setPositionState`.

### 4.4 What WE should do

**Primary stance: do not fight it — preserve it.** YouTube's mediaSession is
generally correct. Our job:

1. **Don't break it.** Our audio-only work keeps the *same* `<video>`/media
   element playing (audio track intact, video rendering/stream suppressed), so
   YouTube's `mediaSession.metadata` / `setPositionState` remain bound to a live,
   playing element and keep working. Verify at runtime that audio-only mode does
   not detach or replace the element in a way that clears the session.
2. **Fill gaps only if observed.** If, on Firefox Android, the notification shows
   stale/blank metadata (a known GeckoView weakness, §5), we *could* re-assert
   `navigator.mediaSession.metadata` after each track change from page context.
   This must run in MAIN world (same as §3.0) and should mirror what YT would set.
   Treat as opt-in and evidence-driven, not default — re-writing metadata YT just
   set is a detectable footprint and risks a tug-of-war with YT's own updates.
3. **Do not register handlers that change semantics.** Avoid hijacking `pause`
   (that is a nag hack; it can break the user's real pause and the OS pause
   button). If we ever intercept, follow youtube-nonstop's care to still allow a
   genuine OS `pause`.

**Net:** MediaSession needs little from us on desktop (YT + FF 82 handle it).
Value-add is concentrated on Android, and even there it is "repair if broken,"
not "implement from scratch."

---

## 5. Firefox Android reality check

**Does background audio work today (2026)? Yes, at the browser level — but
YouTube pauses itself.** Firefox for Android continues playing media audio when
you switch apps or turn the screen off; a **system media notification** appears
automatically (from GeckoView's media-session integration) with play/pause and,
where the site provides it, skip/seek and metadata. The *only* reason YouTube
stops is its Page Visibility self-pause (§2.1) — which our override (§3.1)
removes. This is corroborated by:

- Mozilla's own *Video Background Play Fix* README (`video-bg-play/README.md:3-5`):
  the browser continues playback; sites detect backgrounding via Page Visibility;
  the add-on's entire job is to block those APIs.
- Mozilla-recommended add-ons that do exactly this and are marketed for
  screen-off YouTube on Firefox Android: *Video Background Play Fix* and *Control
  Panel for YouTube* (the latter's `manifest.mv2.json` declares
  `gecko_android` and gates background play to `m.youtube.com`).

**What is weaker than Chrome:** the *fidelity* of the media notification /
lock-screen metadata. browser-compat-data marks Android MediaSession
`partial_implementation` ("exposes the API, but does not provide a corresponding
user-facing media control interface"), and there are long-standing reports of
`mediaSession.metadata` (title/artist/artwork) not always reflecting into the
Android notification or updating mid-playback on GeckoView. So: **controls and
audio work; the pretty title/art on the lock screen may be inconsistent.** This
is a GeckoView limitation we can only partially paper over (§4.4 step 2), not
fully fix from an extension.

**`about:config` prefs.** `media.autoplay.default` / `media.autoplay.blocking_policy`
govern whether playback can *start* without a gesture; they are not a
background-pause lever and we should not depend on flipping user prefs (a WebExt
cannot, and it is out of scope for a ghost tool). No pref is required for
background audio once playback has started — the visibility override is the fix.

**Screen wake lock is the wrong tool.** `navigator.wakeLock` (FF 126 desktop,
Android mirrors 126) keeps the *screen on*; for audio we specifically want the
screen *off* with audio continuing, which already works via the audio/media path.
Using WakeLock would drain battery for no benefit. **Do not use it.**

**Honest limitations on mobile:**
- Metadata/artwork on the Android notification may be imperfect (GeckoView).
- PiP is video-only; no audio-only PiP (§3.4).
- Behavior can vary by Android OEM notification handling and by Firefox channel.
- Everything here assumes the user has started playback with a gesture at least
  once (autoplay policy).

---

## 6. Recommendation for OUR extension

Prioritized, with rationale and risk. We are **MV2**, Firefox desktop + Android,
ghost-oriented.

### P0 — Page Visibility override (the core feature)
- **Do:** From the content script, override `document.hidden` and
  `document.visibilityState` and capture-swallow `visibilitychange` (+ the
  `webkit`-prefixed aliases defensively).
- **How:** Use **`document.wrappedJSObject`** (method A, `video-bg-play` style) —
  no DOM injection, works on all Firefox, maximal stealth. For the extra ghosting,
  prefer redefining the **getter on `Document.prototype`** over an own value
  property, to keep `document` shape-identical to native (§3.1 stealth note).
- **Gate it like video-bg-play:** apply on `m.youtube.com`, `music.youtube.com`,
  and on `www.youtube.com`/`youtube-nocookie.com` **only when on Android**
  (`navigator.userAgent` contains `Android`). Skip desktop `www`/Music — they
  already background-play, and spoofing there is a needless, detectable footprint.
- **Risk:** low. Main risk is over-application (footprint) — the gate mitigates it.

### P1 — Idle-nag defeat
- **Do:** Periodic synthetic modifier-key ping, **gated to "document actually
  hidden AND a video is playing"** (Control Panel's gate,
  `control-panel-for-youtube/page.js:3312-3332`), on a jittered ~45-70s interval.
- **Add:** a cheap `MutationObserver` auto-dismiss (ImprovedTube style) as a
  fallback for dialogs that slip through, but keep the text-match localized/robust
  or key off the dialog element node-name (`YT-CONFIRM-DIALOG-RENDERER` /
  `YTMUSIC-YOU-THERE-RENDERER`, per youtube-nonstop) rather than English copy.
- **Avoid:** monkey-patching `video.pause` (most detectable; can break real pause).
- **Risk:** moderate stealth (synthetic `isTrusted:false` events); mitigated by
  the "only when hidden+playing" gate that minimizes event volume.

### P2 — Media Session: preserve, verify, repair-if-needed
- **Do:** Verify at runtime that our audio-only mode leaves YouTube's
  `mediaSession` intact (same media element → metadata/position keep flowing).
- **Optional (evidence-driven):** On Firefox Android, if the notification shows
  blank/stale metadata, re-assert `navigator.mediaSession.metadata` on track
  change from MAIN world, mirroring YT's values. Ship behind a flag; do not
  overwrite by default.
- **Do not:** add WakeLock; add `pause` handler hijacks.
- **Risk:** low if we only preserve; the repair path risks a metadata tug-of-war
  with YT (keep it opt-in).

### P3 — Explicitly out of scope / rejected
- Picture-in-Picture as a background mechanism (video-only on Android; conflicts
  with audio-only; high UX intrusion; low stealth).
- `about:config` / autoplay-pref manipulation (can't from a WebExt; out of scope).
- Screen Wake Lock (wrong tool, battery cost).

### How it composes with audio-only + the "ghost" goal
- **Orthogonal to audio-only.** Background-playback code touches only Page
  Visibility, an idle timer, and (optionally) mediaSession metadata. It never
  manipulates the media/stream. Audio-only code suppresses video. They share only
  the **page-world injection channel** — build **one** MAIN-world reach (prefer
  `wrappedJSObject`) and hang both features off it, so there is a single injection
  footprint, not two.
- **Ghost ordering:** register at `run_at: "document_start"` so our visibility
  override is in place before YouTube reads it. Prefer `wrappedJSObject`
  (no DOM node) over script-tag injection. Redefine via prototype getter to keep
  `document` native-shaped. Minimize synthetic events (gate to hidden+playing).
  Skip all spoofing where the browser already does the right thing (desktop). The
  guiding principle: **touch the fewest observable surfaces, only where needed.**
- **Cross-surface consistency:** the visibility override is the one piece that
  differs by surface (desktop vs Android); everything else (nag defeat,
  mediaSession preservation) is identical across desktop/Android and across
  `youtube.com` / `music.youtube.com`.

---

## 7. References

### Cloned repositories (path → commit → key files)

| Repo | Local path | Commit (date) | Ver | Key evidence |
| --- | --- | --- | --- | --- |
| mozilla/video-bg-play | `/tmp/yta-research/06-background-playback/video-bg-play` | `7b034c926f3ab3174120695a59553fb83dbcd74c` (2024-11-25) | 1.8.1 | `video-bg-play-content.js:12-18` (visibility override via `wrappedJSObject` + capture-swallow), `:27-45` (Alt-key activity ping), `manifest.json:13-17` (`strict_min_version 58`), `README.md:3-5` (Android bg + Page Visibility rationale) |
| insin/control-panel-for-youtube | `/tmp/yta-research/06-background-playback/control-panel-for-youtube` | `adeedcd734ea372af33d150d422f626dc9ec0f3f` (2026-07-06) | 1.35.2 | `page.js:3294-3334` (`allowBackgroundPlay`: override + gated activity sim), `:6112-6113` (mobile-only gate), `manifest.mv2.json` (`world:"MAIN"` in MV2, `gecko_android`), `content.js` (isolated↔MAIN bridge) |
| code-charity/youtube (ImprovedTube) | `/tmp/yta-research/06-background-playback/improvedtube` | `43fa27d3ec07a5e9351d83386c0066a618036e86` (2026-07-05) | — | `js&css/web-accessible/www.youtube.com/player.js:3016-3073` (auto-continue via MutationObserver + click), `js&css/extension/core.js:131-142` (script-tag injection into MAIN world), `manifest.json` (MV3, `web_accessible_resources`) |
| lawfx/YoutubeNonStop | `/tmp/yta-research/06-background-playback/youtube-nonstop` | `f584e909dedb2514225b1aec6ad14c15bb60e337` (2023-10-29) | 0.9.2 | `autoconfirm.js` (`overrideVideoPause`, idle gating, `listenForPopupEvent`, `listenForMediaKeys` → proof YT sets `mediaSession.setActionHandler('pause')`), `manifest.json` (MV3, `autoconfirm.js` web-accessible) |

### Documentation / compat sources (2026-current)

- MediaSession compat (FF 82 desktop + Android, Android `partial_implementation`):
  `mdn/browser-compat-data` → `api/MediaSession.json`;
  https://developer.mozilla.org/en-US/docs/Web/API/MediaSession
- Screen Wake Lock compat (FF 126 desktop, Android mirror):
  `mdn/browser-compat-data` → `api/WakeLock.json`;
  https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- `content_scripts` `world` compat (FF 128, MV2+MV3, Chrome 111):
  `mdn/browser-compat-data` → `webextensions/manifest/content_scripts.json`;
  Firefox 128 release notes (Firefox bug 1736575):
  https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/128
- Page Visibility API:
  https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- Firefox for Android playback / media controls (support):
  https://support.mozilla.org/en-US/kb/playing-videos-firefox-android
- Add-on landscape (screen-off YouTube on FF Android):
  https://addons.mozilla.org/firefox/addon/video-background-play-fix/ ,
  https://addons.mozilla.org/firefox/addon/control-panel-for-youtube/

### Uncertainty / to verify at runtime
- Exact current fidelity of the Android notification metadata on the latest
  Firefox Android (GeckoView partial-implementation behavior evolves) — verify on
  a device before deciding whether the §4.4-step-2 metadata-repair path is worth
  shipping.
- Whether our specific audio-only implementation keeps the media element bound to
  YT's mediaSession (verify no detach/replace).
- Whether `world:"MAIN"` is worth adopting vs `wrappedJSObject` — only if we ever
  need declarative MAIN-world scripts and can require FF ≥ 128.
