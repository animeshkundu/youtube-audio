# 12 - YouTube Music Power Features (`music.youtube.com`)

Research brief for making **YouTube Audio** a first-class tool on **YouTube Music**
(`music.youtube.com`) on **Firefox desktop + Android**. YT Music is audio-first, so
audio-only is moot here; this doc is about the *value-adds* that make YT Music
genuinely better: synced lyrics, queue/autoplay control, an equalizer + loudness
normalization, playback quality-of-life, OS media controls, and optional scrobbling.

Every mechanism below is grounded in real open-source code that was cloned and read.
Citations are `repo/path/file:line`. Cross-references to our other briefs:
audio-only (§01), streaming/player internals (§04), ghost/anti-tracking (§05),
background playback + media controls (§06), segment skipping (§09).

Repos read (shallow clones, July 2026):

| Repo | Kind | Commit |
| --- | --- | --- |
| `th-ch/youtube-music` | Electron desktop app, plugin system | `7ac63006cf35a802a7ec5bc8c00cfb8b794e5e6f` |
| `boidushya/better-lyrics` | **Firefox/Chrome MV3 extension** (YT Music lyrics) | `510d1e6e42ba324bc9b83932f45a2c1c8e141b43` |
| `web-scrobbler/web-scrobbler` | **Browser extension** (scrobbler, YT Music connector) | `577ed01dd6dbe3eb34db0e2835b31cff99bfa4c9` |

`th-ch` is Electron, not an extension, but its plugin mechanisms (player hooks, the
shared Web Audio graph, lyrics providers) are the best worked examples of *how* each
feature is built. `better-lyrics` and `web-scrobbler` prove what actually works from a
real browser-extension content-script context, which is what we ship.

---

## 1. Executive summary

**Highest-value YT Music features for OUR extension, ranked by (value / effort / ghost-fit):**

1. **Synced lyrics from LRCLIB** (opt-in-quality, default-on is defensible). LRCLIB is a
   free, anonymous, no-account, no-tracking GET API returning LRC-timed + plain lyrics.
   A content script polls the player's `currentTime`, highlights the current line,
   click-to-seek. This is the single biggest "delight" feature and the most ghost-friendly
   third-party source. **Do not** rely on YT Music's own timed lyrics: they are mostly a
   mobile feature, were gutted across platforms in Sept 2024 (Musixmatch→LyricFind
   backend switch), and Google began paywalling lyrics behind Premium in late 2025.
2. **Now-playing via `navigator.mediaSession`** (page-world read) — one robust, low-maintenance
   source of truth for title/artist/album/art + play state, which then powers lyrics,
   scrobbling, and any custom UI. YT Music populates `mediaSession` itself; we just read it.
3. **Disable endless autoplay / radio** — pause on each new track load. One tiny, pure-player
   toggle. High demand ("stop it from auto-playing a mix forever").
4. **Skip disliked songs** — observe the like-button state, click Next. ~15 lines, pure DOM.
5. **Remember volume + finer volume control** — persist the player volume, restore on load;
   optionally remap the slider to a perceptual (exponential) curve.
6. **Equalizer + loudness normalization** (power toggle). A single shared `AudioContext` +
   `createMediaElementSource(video)` feeding `BiquadFilterNode`s (EQ) and a `GainNode`
   driven by the per-track `loudnessDb` YouTube already ships in the player response
   (nobody in the surveyed projects consumes it yet — a genuine differentiator).
7. **Optional scrobbling to Last.fm / ListenBrainz** — explicitly opt-in, off by default,
   flagged as privacy-relevant (it sends what you listen to, to a third party). Conflicts
   with "ghost" unless the user turns it on.

**Simple defaults vs power toggles.** Ship with a *simple* face: synced lyrics on, endless
autoplay off (optional), remember volume on. Everything with a privacy or CPU cost —
equalizer, normalization, scrobbling, third-party lyrics beyond LRCLIB — is a **power
toggle**, off by default, one click away. This matches the north star: "simple for the end
user, powerful on demand."

**Firefox specifics that shape everything (details in §2.4, §4):** reading the page's
`navigator.mediaSession`, the YT Music player API object, `HTMLMediaElement.prototype`, and
building a Web Audio graph on the page's `<video>` all require **page/MAIN-world** execution.
In MV2 Firefox that means injecting a `<script>` element from the content script (our §01
brief already documents this "page world" bridge); Firefox 128+ also supports
`content_scripts` `world: "MAIN"`. YT Music streams via **MSE `blob:` URLs (same-origin)**, so
`createMediaElementSource` does **not** hit the cross-origin "silence" trap that CORS media
would (§04).

---

## 2. YT Music web app internals (`WEB_REMIX`, DOM/player, SPA navigation)

### 2.1 The InnerTube `WEB_REMIX` client

YT Music's web app talks to Google's private **InnerTube** API (`/youtubei/v1/...`) as client
**`WEB_REMIX`**, numeric `clientName` **67**. The `clientVersion` is time-sensitive
(format `1.YYYYMMDD.XX.XX`) and must be read from live traffic, not hardcoded; the page
exposes the full client context via `ytcfg` (`INNERTUBE_CONTEXT`) and reuses it on every
call. Sources: the InnerTube client reference projects (yt-dlp `INNERTUBE_CLIENTS`,
LuanRT/YouTube.js) enumerate the enum; `67 → WEB_REMIX` is stable.

The most important practical fact: **you do not need to reconstruct InnerTube headers.** The
page's own custom element `<ytmusic-app>` carries a `networkManager` that issues authenticated
InnerTube calls with the page's cookies/context already attached. th-ch calls it directly:

```txt
# youtube-music/src/plugins/synced-lyrics/providers/YTMusic.ts:111-123
document.querySelector('ytmusic-app')
        .networkManager.fetch('/next?prettyPrint=false', { videoId })
# same pattern for /search:
# youtube-music/src/renderer.ts:287-306   app.networkManager.fetch('/search', {...})
```

So from **page world**, `document.querySelector('ytmusic-app').networkManager.fetch('/next', {videoId})`
returns the InnerTube "watch next" payload (queue, up-next, lyrics-tab pointer) as the
first-party client, no key/PO-token juggling.

**Key differences from `youtube.com`:**

- The player is still a `<video>` element playing an **MSE `blob:`** stream (audio-only for
  "Art Track" songs, real video for "music videos"). `musicVideoType` in the player response
  distinguishes them: `MUSIC_VIDEO_TYPE_ATV` = audio track, otherwise a video
  (`youtube-music/src/plugins/precise-volume/renderer.ts:72-73`,
  `youtube-music/src/providers/song-info.ts:119`). A song can have a **counterpart** (audio
  version ↔ music-video version) with a `segmentMap` to re-align timing when you switch
  (`better-lyrics/src/modules/lyrics/requestSniffer/requestSniffer.ts:280-342`).
- Metadata source of truth is the **player response** (`videoDetails` +
  `microformatDataRenderer`), not the DOM (§2.3).
- The app is a persistent Polymer SPA: the player bar (`<ytmusic-player-bar>`), player
  (`#movie_player`), and app shell (`<ytmusic-app>`, `<ytmusic-app-layout>`) survive
  navigation. Song changes fire in-app events, not full page loads (§2.4).
- YT Music exposes richer per-song controls in the DOM than youtube.com: like/dislike
  renderer, a queue object on the player bar with a `shuffle()` method, a lyrics tab, etc.
  (§2.2).

### 2.2 DOM structure the projects rely on (real selectors)

These are the actual selector strings used by the surveyed code — the practical "DOM map"
for a content script:

| Purpose | Selector / access | Evidence |
| --- | --- | --- |
| App shell / InnerTube bridge | `ytmusic-app` (`.networkManager`) | `YTMusic.ts:111`, `renderer.ts:287` |
| App layout (fullscreen state) | `ytmusic-app-layout` (`player-fullscreened` attr) | `better-lyrics/src/modules/ui/observer.ts:103-133` |
| Player element (JS API) | `#movie_player` (`getCurrentTime`, `getDuration`, `getVideoData`, `getPlayerStateObject`, `seekTo`, `playVideo`) | `renderer.ts:41,509`; `better-lyrics/public/script.js:113-138,191-197` |
| Player bar | `ytmusic-player-bar` | `renderer.ts:73-104`; `web-scrobbler/src/connectors/youtube-music.ts:45` |
| Previous / Next | `.previous-button.ytmusic-player-bar` / `.next-button.ytmusic-player-bar` | `renderer.ts:73,78` |
| Skip-disliked next | `yt-icon-button.next-button` | `skip-disliked-songs/index.ts:24` |
| Shuffle (call + state) | `document.querySelector('ytmusic-player-bar').queue.shuffle()`; `shuffle-on` attr | `renderer.ts:93-107` |
| Like / dislike | `#like-button-renderer` (`like-status` attr; `updateLikeStatus(status)` method) | `renderer.ts:114-120`, `skip-disliked-songs/index.ts:19-24` |
| Like button (extension) | `ytmusic-like-button-renderer #button-shape-like button[aria-pressed]` | `web-scrobbler/src/connectors/youtube-music.ts:80-84` |
| Play/pause button (change signal) | `#play-pause-button` | `web-scrobbler/src/connectors/youtube-music-dom-inject.ts:35` |
| Song info wrapper (change signal) | `.content-info-wrapper` | `web-scrobbler/src/connectors/youtube-music-dom-inject.ts:36` |
| Time info (elapsed/duration) | `.ytmusic-player-bar.time-info` | `web-scrobbler/src/connectors/youtube-music.ts:76` |
| Progress bar (elapsed observer) | `#progress-bar` | `youtube-music/src/providers/song-info-front.ts:34-46` |
| Lyrics tab header / container | `.tab-header...ytmusic-player-page` (index 1); `#tab-renderer` | `better-lyrics/src/core/constants.ts:28-29`, `observer.ts:159-179` |
| Ad in player bar | `.ytmusic-player-bar.advertisement` | `web-scrobbler/src/connectors/youtube-music.ts:23,98` |

### 2.3 Now-playing metadata: the player response is the source of truth

th-ch reads song metadata from the **InnerTube player response**, not by scraping DOM text:

```txt
# youtube-music/src/providers/song-info.ts:108-146   (handleData)
const { videoDetails } = data;              // from api.getPlayerResponse()
songInfo.title       = cleanupName(videoDetails.title);
songInfo.artist      = cleanupName(videoDetails.author);
songInfo.songDuration= Number(videoDetails.lengthSeconds);
songInfo.videoId     = videoDetails.videoId;
songInfo.album       = videoDetails.album;
switch (videoDetails.musicVideoType) { ... }     // ATV vs music video
# album/extra fields come from microformatDataRenderer + playerOverlays.browserMediaSession
# youtube-music/src/providers/song-info-front.ts:334-349
```

`api.getPlayerResponse()` is the player API method (`youtube-music/src/types/music-player.ts:155`).
For a browser extension there are three viable ways to get the same data, in increasing order
of fragility-vs-power (all corroborated by real extensions):

1. **`navigator.mediaSession.metadata`** (read from page world) — YT Music populates it with
   `title/artist/album/artwork`; simplest and most robust. See §2.4 / §3.5.
2. **Player object** — `#movie_player.getVideoData()` → `{video_id, title, author}`,
   `getCurrentTime()`, `getDuration()`, `getPlayerStateObject()` (`better-lyrics/public/script.js:113-138`).
3. **InnerTube sniffing** — monkey-patch `window.fetch` in page world, capture
   `/youtubei/v1/next` + `/browse` responses (`better-lyrics/public/earlyInject.js:56-166`,
   parsed in `requestSniffer.ts:184-464`). Most data-rich (full queue, next video id, album,
   native lyrics pointer) but the most maintenance.

### 2.4 SPA navigation & song-change detection

Because the shell persists, "the song changed" is **not** a `popstate`/full-load event. The
patterns actually used:

- **Player event `videodatachange`** (th-ch's canonical signal). The player API emits it; th-ch
  re-broadcasts it on `document`:
  ```txt
  # youtube-music/src/providers/song-info-front.ts:270   api.addEventListener('videodatachange', ...)
  # rebroadcast to document:                    song-info-front.ts:251
  # consumers: synced-lyrics renderer/index.ts:51 ; disable-autoplay/index.ts:75 ; album-color-theme/index.ts:105
  ```
  Phases include `dataloaded` (new track ready) — used to trigger per-track logic.
- **Poll + diff** (better-lyrics). A 20 ms tick reads `getVideoData().video_id`; when it changes,
  reset and reload (`better-lyrics/src/modules/ui/observer.ts:277-311`), aborting any in-flight
  work via an `AbortController` (`src/core/appState.ts:118-127`).
- **MutationObserver on stable nodes** (web-scrobbler). Observe `#play-pause-button` and
  `.content-info-wrapper` attributes; on mutation, re-read `mediaSession`
  (`web-scrobbler/src/connectors/youtube-music-dom-inject.ts:38-47`).
- **Navigation API** for URL-level `?v=` changes (crossfade): `window.navigation.addEventListener('navigate', ...)`
  (`youtube-music/src/plugins/crossfade/index.ts:200-221`).

**Firefox note:** reading the page's `navigator.mediaSession`, the `#movie_player` API object,
or patching `window.fetch` requires **page world**. web-scrobbler states this explicitly: its
inject script "runs in non-isolated environment (youtube music itself) *for accessing navigator
variables on Firefox*" (`youtube-music-dom-inject.ts:3-5`). In MV2 we inject a `<script>` tag
from the content script (see §01 §4). The isolated content script then receives data via
`window.postMessage` / `CustomEvent`.

---

## 3. Feature catalog

Each feature: **mechanism → real-code evidence → extension feasibility → privacy/ghost →
desktop + Android.**

### 3.1 Synced (timed) lyrics

**Why this matters and what NOT to depend on.** YT Music's own **timed** lyrics are a mobile
feature that has been eroding: many songs lost sync in Sept 2024 when Google switched the
lyrics backend from Musixmatch to LyricFind, and in late 2025 Google began paywalling lyrics
(even static) behind Premium for free-tier users. The web client (`WEB_REMIX`) generally
returns only *plain* lyrics, and even those are now gated. **Conclusion: source lyrics
ourselves.** LRCLIB is the clean, ghost-friendly default.

#### 3.1.1 Provider landscape (from th-ch's `synced-lyrics` plugin)

Registered providers: `YTMusic`, `LRCLib`, `MusixMatch`, `LyricsGenius` (Megalobiz present
but disabled as "too unstable and slow")
(`youtube-music/src/plugins/synced-lyrics/providers/index.ts:5-11`).

**LRCLib — the recommended source.** Anonymous GET, no key, no account:

```txt
# youtube-music/src/plugins/synced-lyrics/providers/LRCLib.ts
baseUrl = 'https://lrclib.net'                                             # :10
GET /api/search?artist_name=<artist>&track_name=<title>&album_name=<album> # :20-30
# response items carry both syncedLyrics (LRC, timed) and plainLyrics       # :158-159,178-188
# ranking: Jaro-Winkler artist similarity > 0.9 (:100,134),
#          then sort by |duration - songDuration|, reject if > 15s (:138-152),
#          reject instrumental (:154)
# synced parsed via LRC.parse(raw)                                          # :168
```

Privacy: the only data sent is `artist / track / album` (or a free-text query) to
`lrclib.net`. No account, no cookies, no device token. Best ghost-fit of any lyrics source.

**MusixMatch — richer coverage, worse privacy.** Reverse-engineered private desktop API
requiring a rotating device token:

```txt
# youtube-music/src/plugins/synced-lyrics/providers/MusixMatch.ts
baseUrl = 'https://apic-desktop.musixmatch.com/ws/1.1/'   # :311
# endpoint macro.subtitles.get; params q_track,q_artist,q_duration,q_album,
#   namespace=lyrics_richsynced, subtitle_format=lrc, app_id=web-desktop-app-v1.0, usertoken
# token fetched from token.get, cached ~60s; needs spoofed Authority header + cookie  # :300-315
```
Sends track/artist/duration to `musixmatch.com` plus a device token → more fingerprintable.
**Power toggle only.**

**LyricsGenius — plain only.** `GET genius.com/api/search/song?q=...` then scrape the song
page's `window.__PRELOADED_STATE__` (`LyricsGenius.ts:14-19,60-77`). No timestamps. Fallback.

**YTMusic native — possible but ugly.** To get YT Music's *timed* lyrics, th-ch (a) hooks the
page's InnerTube via `ytmusic-app.networkManager.fetch('/next', {videoId})`, finds the tab with
`pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS'`, then (b) fetches `browse` **through a third-party
proxy** (`https://ytmbrowseproxy.zvz.be/`, rate-limited 2 req/s) spoofing a **mobile** YT Music
client (`clientName: '26', clientVersion: '7.01.05'`, i.e. iOS Music), because the web client
won't return `timedLyricsModel` data:

```txt
# youtube-music/src/plugins/synced-lyrics/providers/YTMusic.ts
fetchNext -> ytmusic-app.networkManager.fetch('/next', {videoId})   # :111-123
PROXIED_ENDPOINT = 'https://ytmbrowseproxy.zvz.be/'                 # :108
POST browse {browseId, context:{client:{clientName:'26',clientVersion:'7.01.05'}}}  # :125-134
# synced lines: contents...model.timedLyricsModel.lyricsData.timedLyricsData[]
#   each {cueRange.startTimeMilliseconds, endTimeMilliseconds, lyricLine}  # :50-62
```
So even the "native" path needs a proxy + client spoof — worse for ghost than LRCLIB and
fragile. better-lyrics reads only YT's *plain* native lyrics
(`musicDescriptionShelfRenderer.description.runs[0].text`,
`requestSniffer.ts:447-454`) as a fast placeholder / sanity-check baseline, not for timing.
better-lyrics also demonstrates using YouTube **caption tracks** as a lyrics/timing source
(`audioTrackData.captionTracks[].url` + `?fmt=json3`, `providers/ytCaptions.ts:44-56`).

#### 3.1.2 Time-sync (highlighting) engine

Poll playback position, classify each LRC line, highlight, click-to-seek:

```txt
# youtube-music/src/plugins/synced-lyrics
renderer/index.ts:56-60      setInterval(() => setCurrentTime(_ytAPI.getCurrentTime()*1000), 100)
renderer/renderer.tsx:236-244  status = timeInMs>=t?'upcoming' : t-timeInMs>=duration?'previous':'current'
components/SyncedLine.tsx:30-33  per-line karaoke progress = (t - timeInMs)/duration
components/SyncedLine.tsx:41,111 click line -> _ytAPI.seekTo((timeInMs+10)/1000)
```

An extension can use either `#movie_player.getCurrentTime()` (page world) or the plain
`video.currentTime` (readable from an isolated content script). better-lyrics additionally
*extrapolates* time between ticks using wall-clock deltas for smoother highlighting
(`better-lyrics/public/script.js:151-160`) and **prefetches the next song's lyrics** using the
sniffed `nextVideoId` to hide latency on track change (`src/modules/lyrics/lyrics.ts:293-345`).

#### 3.1.3 DOM injection target

better-lyrics force-enables YT Music's own Lyrics tab (removes its `disabled` attribute) and
renders into the native `#tab-renderer`, building `#blyrics-wrapper > .blyrics-container` with
one `.blyrics--line` per line and per-word `<span>`s carrying `data-time` / `data-duration`
(`better-lyrics/src/modules/ui/observer.ts:159-179`, `src/modules/lyrics/injectLyrics.ts:280-380`).
Reusing the native tab means our lyrics live exactly where users expect them.

**Feasibility (extension):** High. LRCLIB is a plain `fetch` (no CORS issue: `lrclib.net`
serves permissive CORS; and it is our own request, not tied to the media element). Time-sync is
pure JS on `video.currentTime`. Injection is DOM. **Firefox desktop + Android: works on both**
(mobile web YT Music has the same player/tab structure; on small screens, render lyrics as an
overlay if the tab layout is cramped).

**Privacy/ghost:** LRCLIB = excellent (anonymous, artist/track only). Musixmatch/Genius/YT-proxy
= power toggles with disclosure. Never send data to a lyrics provider the user didn't enable.
Cache per `videoId` to minimize repeat calls (both projects do).

### 3.2 Queue / autoplay control

#### 3.2.1 Disable endless autoplay / radio

Pause the player each time a new track loads (belt-and-suspenders with a one-shot `timeupdate`
re-pause), with an "apply once" mode:

```txt
# youtube-music/src/plugins/disable-autoplay/index.ts:50-68
on 'videodatachange' name==='dataloaded':
    api.pauseVideo();
    video.addEventListener('timeupdate', () => e.target.pause(), {once:true});
```
This does not stop the queue-continuation *fetch* (YT still lines up the radio track); it just
force-pauses the moment the new track starts. A cleaner, less aggressive alternative is to flip
YT Music's own autoplay toggle off: `.autoplay > tp-yt-paper-toggle-button`
(`song-info-front.ts:180-181`), or read the queue's autoplay flag via the `#queue` element
(`document.querySelector('#queue').queue.autoPlaying`, `renderer.ts:185-226`).
**Feasibility:** trivial. From an extension: listen for the song-change signal (§2.4), then
`video.pause()` (works from isolated world), or call `#movie_player.pauseVideo()` from page
world. **Desktop + Android: both.** Ghost: neutral (no network). Great "stop the endless mix"
toggle.

#### 3.2.2 Skip disliked songs

Observe the like-button renderer; when the user has disliked the track, click Next:

```txt
# youtube-music/src/plugins/skip-disliked-songs/index.ts:19-32
waitForElement('#like-button-renderer').then(btn =>
  new MutationObserver(() => {
    if (btn.getAttribute('like-status') === 'DISLIKE')
      document.querySelector('yt-icon-button.next-button').click();
  }).observe(btn, {attributes:true}));
```
**Feasibility:** trivial, pure DOM. **Desktop + Android: both** (mobile has the same
`like-status` attribute and a next control). Ghost: neutral.

#### 3.2.3 Shuffle & queue ergonomics

The player bar element exposes a live `queue` object; shuffle is a method call, and shuffle
state is an attribute:

```txt
# youtube-music/src/renderer.ts:93-107
document.querySelector('ytmusic-player-bar').queue.shuffle();      // trigger
document.querySelector('ytmusic-player-bar').attributes.getNamedItem('shuffle-on'); // state
```
The queue renderer is `ytmusic-player-queue` (`music-together/queue/queue.ts:543`).
"Add to queue" and reordering are exposed through the same player-bar `queue` API and native
context menus (`ytmusic-menu-popup-renderer tp-yt-paper-listbox`,
`youtube-music/src/providers/dom-elements.ts:1-4`). A well-known YT Music annoyance — "shuffle
doesn't truly randomize / re-shuffles the same order" — can be improved by driving
`queue.shuffle()` (or reordering the queue model) from page world. **Feasibility:** medium
(needs page world to reach `.queue`; the object shape can change across YT Music updates — keep
it behind a guarded, easily-disabled module). **Desktop + Android: primarily desktop**; mobile
web has shuffle in the UI already, so a custom shuffle fix is a desktop-first power feature.
Ghost: neutral.

### 3.3 Equalizer, loudness normalization, and volume (Web Audio API)

This is the flagship "power" cluster, and it is fully feasible in a Firefox extension.

#### 3.3.1 The single shared audio graph (the critical constraint)

`createMediaElementSource(el)` can be called **only once per media element**, ever. So the
extension must own exactly one `AudioContext` + one `MediaElementAudioSourceNode` and share it
with every audio effect. th-ch does precisely this and broadcasts the shared nodes via a custom
event:

```txt
# youtube-music/src/renderer.ts:312-341
const video = document.querySelector('video');
const audioContext = new AudioContext();
const audioSource  = audioContext.createMediaElementSource(video);
audioSource.connect(audioContext.destination);
// on canplaythrough, broadcast to all audio plugins:
document.dispatchEvent(new CustomEvent('peard:audio-can-play',
    { detail: { audioContext, audioSource } }));
```
Every audio plugin listens for `peard:audio-can-play` and splices its node into
`audioSource → ... → destination`. **This is the exact architecture our extension should copy**
(one shared graph module, effects register into it). Because YT plays MSE **`blob:`** streams
(same-origin, §04), `createMediaElementSource` produces audio, not silence — the CORS trap that
bites cross-origin `<audio src>` does not apply here. (The AudioContext + source must be created
in the **page world** and before anything else grabs the element.)

#### 3.3.2 Equalizer (BiquadFilterNode bands)

```txt
# youtube-music/src/plugins/equalizer/index.ts:59-78
on 'peard:audio-can-play' ({audioSource, audioContext}):
  for (filter of filters) {
    const b = audioContext.createBiquadFilter();
    b.type = filter.type; b.frequency.value = f.frequency; b.Q.value = f.Q; b.gain.value = f.gain;
    audioSource.connect(b); b.connect(audioContext.destination);
  }
# preset example (bass booster):
# youtube-music/src/plugins/equalizer/presets.ts:11-18
#   { type:'lowshelf', frequency:80, Q:100, gain:12.0 }
```
Each band is a `BiquadFilterNode` (`lowshelf/highshelf/peaking/...`). A classic 10-band graphic
EQ = ten `peaking` filters **in series** at 31/62/125/250/500/1k/2k/4k/8k/16k Hz with user gains.

**Accuracy caveat — copy the compressor, not th-ch's EQ.** th-ch's equalizer actually wires each
band *in parallel* (`audioSource → biquadN → destination`, `equalizer/index.ts:74-75`) and never
disconnects the always-on dry path from `renderer.ts:314`, so the unfiltered signal keeps summing
with the filtered bands — not a textbook EQ. For a correct EQ, chain the biquads in series and
disconnect the dry path first, exactly as `audio-compressor.ts` does
(`source.disconnect(destination); source → node → destination`, `audio-compressor.ts:55-61`).
The only built-in preset is a single bass-booster (`presets.ts:12-17`); there is no multi-band UI.

**Feasibility:** High. **Desktop + Android:** both (Web Audio is available in Firefox Android;
CPU cost of a few biquads is negligible). Ghost: neutral (all client-side, no network). Ship as
a power toggle with presets + a manual band UI.

#### 3.3.3 Dynamic range compression

```txt
# youtube-music/src/plugins/audio-compressor.ts (createCompressorNode)
const c = audioContext.createDynamicsCompressor();
c.threshold.value=-50; c.ratio.value=12; c.knee.value=40; c.attack.value=0; c.release.value=0.25;
# splice in series with WeakMap bookkeeping (source.disconnect(dest); source->c->dest)
```
Good "night mode"/"quiet listening" toggle. Same graph, one `DynamicsCompressorNode`.

#### 3.3.4 Loudness normalization — the untapped differentiator

YouTube ships **per-track loudness** data in the player response — the same data its own
"stable volume" uses — and **none of the surveyed projects consume it**:

```txt
# youtube-music/src/types/get-player-response.ts:283-294
PlayerConfig.audioConfig = { loudnessDb, perceptualLoudnessDb, enablePerFormatLoudness }
# also present at datahost-get-state.ts:1224 (loudnessDb)
```
`playerResponse.playerConfig.audioConfig.loudnessDb` is the track's integrated loudness offset
(there is also a per-format `loudnessDb`, `get-player-response.ts:420`). Confirmed: across the
entire th-ch codebase these fields are declared in the types but **never read** by any plugin —
genuinely untapped. A normalization module reads it (via the player response or InnerTube sniff,
§2.3) and sets a `GainNode` in the shared graph to `10 ** (-loudnessDb / 20)` (clamped) so every
track plays at a consistent target loudness — no more reaching for the volume knob between a loud single and a
quiet album cut. **Feasibility:** High (read a number, set a gain). **Desktop + Android:** both.
Ghost: neutral. This is a simple-yet-powerful, on-by-default-worthy feature that even th-ch and
the desktop apps don't ship.

#### 3.3.5 Volume: remember it, and make it finer

- **Remember volume:** persist `api.getVolume()` and restore on load
  (`youtube-music/src/plugins/precise-volume/renderer.ts:48-56`). One `storage` key. On/by-default.
- **Perceptual (exponential) volume:** override `HTMLMediaElement.prototype.volume` with an
  exponent so the low end of the slider has finer control (human loudness perception is
  logarithmic):
  ```txt
  # youtube-music/src/plugins/exponential-volume/index.ts:37-57
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', { get/set with lowVolume = v ** EXPONENT (=3) })
  ```
  Requires page world (prototype patch). Optional power toggle.

**Feasibility of the whole 3.3 cluster:** High; the one gotcha is single-ownership of the
`AudioContext`/source in page world. **Desktop + Android: both.** Ghost: entirely client-side.

### 3.4 Playback quality-of-life

- **Playback speed** — YT Music hides it; expose `#movie_player.setPlaybackRate(x)` (podcasts,
  study). Trivial, page world. (th-ch ships a `playback-speed` plugin.) Desktop + Android.
- **Skip silences** — detect near-silence via an `AnalyserNode` and nudge past it:
  ```txt
  # youtube-music/src/plugins/skip-silences/renderer.ts
  const analyser = audioContext.createAnalyser();     # :40
  threshold = -100  // dB                              # :10
  if (isSilent && !video.paused) video.currentTime += 0.2;  # :102-103
  ```
  Uses the shared graph (§3.3.1). Niche; power toggle. Desktop + Android.
- **Crossfade — LOW feasibility for us.** th-ch crossfades by fetching the *resolved audio
  stream URL* and playing it in a separate Howler instance to overlap the tail:
  ```txt
  # youtube-music/src/plugins/crossfade/index.ts:191-233
  getStreamURL(videoID) = ipc.invoke('audio-url', videoID)   // needs the googlevideo stream URL
  transitionAudio = new Howl({ src: url, html5:true, volume:0 })
  ```
  Getting a playable `googlevideo.com` URL requires defeating `n`-sig / signature / PO-token
  (see §04) — the exact wall our audio-only work hit. **Not worth it**; mark crossfade
  out-of-scope (or approximate with a volume fade-out only, which cannot overlap tracks).
- **Album-art color theming / ambient mode** — cosmetic; low priority (th-ch `album-color-theme`,
  `ambient-mode`). Skip unless cheap.

### 3.5 Now-playing & OS media controls / background

Cross-reference **§06 (background playback + media controls)** — do not re-derive it here. The
YT-Music-specific facts:

- **YT Music already populates `navigator.mediaSession`** (`metadata` = title/artist/album/
  artwork, plus `playbackState`). Firefox 82+ surfaces it to the OS media hub / hardware media
  keys on desktop; Android is `partial_implementation` (§06). We should **read** it, not fight
  it. The clean pattern (real extension):
  ```txt
  # web-scrobbler/src/connectors/youtube-music-dom-inject.ts:19-47   (page world)
  window.postMessage({ sender, playbackState: navigator.mediaSession.playbackState,
    metadata: { title, artist, artwork, album } from navigator.mediaSession.metadata });
  // re-emitted on MutationObserver over #play-pause-button and .content-info-wrapper
  ```
  This gives us one robust now-playing feed (for lyrics matching, scrobbling, custom UI) without
  brittle per-field DOM selectors, and it is explicitly the Firefox-safe approach
  (page world "for accessing navigator variables on Firefox").
- **Do not clobber YT Music's `mediaSession` action handlers.** If we set our own
  `setActionHandler`/`setPositionState`, mirror YT Music's semantics (next/prev/seek) or the OS
  controls break. Prefer *reading* metadata and only augment handlers if a specific control is
  missing.
- **th-ch uses OS-native controls (taskbar/touchbar), not web `mediaSession`,** because it is
  Electron (`taskbar-mediacontrol`, `touchbar` plugins). That path is irrelevant to us; the web
  `mediaSession` route (§06) is ours.

**Feasibility:** High (read-only mediaSession). **Desktop:** great. **Android:** metadata/
lock-screen fidelity is weaker in GeckoView (§06); still, reading mediaSession for our own
features works regardless of whether Android renders a rich notification.

### 3.6 Optional scrobbling (Last.fm / ListenBrainz)

**Mechanism.** th-ch's `scrobbler` plugin supports **Last.fm** and **ListenBrainz**, firing a
"now playing" update on track start and a "scrobble" at the standard threshold:

```txt
# youtube-music/src/plugins/scrobbler
main.ts:88-91   scrobbleTime = Math.min(Math.ceil(songDuration/2), 4*60)  // half duration, capped at 240s
main.ts:107-109 setNowPlaying fires immediately on each song-info change (if not paused)
services/lastfm.ts:88-116   track.updateNowPlaying / track.scrobble (scrobble backdated to start)
services/lastfm.ts:161      POST https://ws.audioscrobbler.com/2.0/  (track/artist/album/duration + sk + MD5 api_sig)
services/lastfm.ts:270-297  auth: open https://www.last.fm/api/auth/?api_key=..&token=..  -> session key
services/listenbrainz.ts:76-121  POST https://api.listenbrainz.org/1/submit-listens  Authorization: Token <token>
```
The scrobble timer resets on every track change (`main.ts:76`), so skipped songs are not
scrobbled. **ListenBrainz additionally sends `additional_info.origin_url`** — the
`music.youtube.com/watch?v=...` link — alongside artist/track/album (`listenbrainz.ts:76-99`).
web-scrobbler is an entire browser extension devoted to this and confirms it works purely from a
content-script + background context, driven off `mediaSession`/DOM
(`web-scrobbler/src/connectors/youtube-music.ts`).

**Privacy / ghost.** Scrobbling **sends your listening history (title/artist/album/timestamp) to
a third party** and requires the user's own account/API session. It is fundamentally at odds
with "ghost." Therefore: **off by default, opt-in, with an explicit consent screen**, its own
enable flag, and a clear indicator when active. ListenBrainz is the more privacy-respecting
option (open, self-hostable) and should be offered alongside Last.fm.

**Feasibility:** High (standard signed HTTP calls from the background page; needs `host` access
to `ws.audioscrobbler.com` / the ListenBrainz root; OAuth-style token flow for Last.fm).
**Desktop + Android:** both (network only). It is the one feature here that *adds* an outbound
data flow, so gate it hard.

---

## 4. Firefox desktop + Android applicability matrix

| Feature | FF desktop | FF Android (`music.youtube.com` mobile web) | World needed | Network? |
| --- | --- | --- | --- | --- |
| Synced lyrics (LRCLIB) | Yes | Yes (overlay if tab cramped) | isolated fetch + read `video.currentTime`; page world only if using `#movie_player` | lrclib.net |
| Now-playing via mediaSession | Yes | Yes (read works; Android OS UI weaker, §06) | **page** (Firefox) | none |
| Disable endless autoplay | Yes | Yes | isolated (`video.pause()`) or page | none |
| Skip disliked | Yes | Yes | isolated (DOM) | none |
| Shuffle fix / queue ergonomics | Yes | Partial (mobile UI differs) | **page** (`.queue`) | none |
| Equalizer / compressor | Yes | Yes | **page** (shared AudioContext) | none |
| Loudness normalization | Yes | Yes | **page** (read loudnessDb + GainNode) | none |
| Remember volume | Yes | Yes | isolated + storage | none |
| Exponential volume | Yes | Yes | **page** (prototype patch) | none |
| Playback speed | Yes | Yes | **page** (`setPlaybackRate`) | none |
| Skip silences | Yes | Yes | **page** (AnalyserNode) | none |
| Crossfade | No (stream URL wall) | No | page + stream URL | googlevideo (blocked, §04) |
| Scrobbling (opt-in) | Yes | Yes | background | last.fm / listenbrainz |

"page world" in MV2 Firefox = inject a `<script>` element from the content script (§01 §4);
Firefox 128+ also supports `content_scripts` `world: "MAIN"`. Our existing content-script match
`*://*.youtube.com/*` already covers `music.youtube.com` on both desktop and mobile (§03).

---

## 5. Recommendation: a curated YT Music feature set for OUR extension

Mapped to the north star ("one-stop shop for YouTube — simple for the end user, powerful on
demand; remove friction and deliver value"), with a ghost-first default posture.

**Ship as simple defaults (on, zero config):**

1. **Synced lyrics via LRCLIB**, rendered in the native lyrics tab, click-to-seek, cached per
   `videoId`. Anonymous, artist/track only. The headline delight feature.
2. **Now-playing feed from `navigator.mediaSession`** (page-world reader → `postMessage`), the
   backbone for lyrics matching and any UI. No network.
3. **Remember volume** across sessions.
4. **Loudness normalization** using YouTube's own `audioConfig.loudnessDb` + a shared-graph
   `GainNode`. Consistent volume across tracks, fully client-side — a differentiator nobody
   surveyed ships.

**Ship as power toggles (off by default, one click, disclosed):**

5. **Disable endless autoplay / radio.**
6. **Skip disliked songs.**
7. **Equalizer** (presets + 10-band manual) and **compressor** ("night mode"), sharing one
   `AudioContext`/`MediaElementSource` (§3.3.1) — the module every audio effect registers into.
8. **Playback speed**, **exponential (fine) volume**, **skip silences** — small niceties.
9. **Extra lyrics providers** (Musixmatch, Genius, YT-native-via-proxy, captions) as fallbacks
   *only when the user enables them*, with a per-provider privacy note. Default stays LRCLIB-only.
10. **Shuffle fix / queue ergonomics** (desktop-first), behind a guarded, easily-disabled module
    because it depends on the player-bar `.queue` shape.

**Explicitly opt-in, consent-gated (breaks ghost):**

11. **Scrobbling** to Last.fm / ListenBrainz. Off by default, dedicated enable + auth flow,
    clear "active" indicator, ListenBrainz offered as the privacy-preferring choice.

**Out of scope / not worth it:** crossfade (needs the resolved stream URL → `n`-sig/PO-token
wall, §04); album-art theming/ambient (cosmetic); anything Electron-native (taskbar/touchbar).

**Privacy notes (the ghost contract):**

- Nothing leaves the browser unless the user turned on a feature that needs it. The default set
  (mediaSession read, remember-volume, loudness, EQ) is **100% local**; only LRCLIB makes a
  request, and it carries just artist/track/album — no account, no cookies, no device token.
- Never fall through to a heavier provider (Musixmatch/proxy/scrobbler) silently; each is its own
  opt-in with disclosure. Avoid the th-ch YT-native pattern's third-party `browse` proxy and
  client spoof by default — LRCLIB removes the need for it.
- Keep the audio graph and player hooks in page world but touch nothing YT Music tracks on;
  reading `mediaSession`/`getPlayerResponse` and inserting audio nodes is invisible to YT's
  integrity checks (§05). Do not send synthetic events that alter what YT logs.
- Reuse §06's background-play posture for Android; do not re-implement media controls, just read
  `mediaSession`.

**Architecture fit.** Our current extension is a webRequest+`video.src` audio-only swapper
(`js/global.js`, `js/youtube_audio.js`). The YT Music feature set is best structured as a small
**plugin registry** mirroring th-ch: one page-world bootstrap that (a) owns the shared
`AudioContext`/source, (b) exposes the player object + a `videodatachange`-style song-change
event + a `mediaSession` feed over `postMessage`, and (c) lets each feature module subscribe.
That keeps "simple by default, powerful on demand" honest: features are independent toggles over
one shared, ghost-safe substrate.

---

## 6. References

**Repositories (cloned + read, July 2026):**

- `th-ch/youtube-music` @ `7ac63006cf35a802a7ec5bc8c00cfb8b794e5e6f` — Electron YT Music app;
  plugins: `synced-lyrics/` (providers `LRCLib.ts`, `MusixMatch.ts`, `LyricsGenius.ts`,
  `YTMusic.ts`, `Megalobiz.ts`; `renderer/` sync engine), `equalizer/` (`index.ts`,
  `presets.ts`), `audio-compressor.ts`, `precise-volume/`, `exponential-volume/`, `crossfade/`,
  `skip-silences/`, `skip-disliked-songs/`, `disable-autoplay/`, `scrobbler/`
  (`services/lastfm.ts`, `services/listenbrainz.ts`); shared graph `src/renderer.ts:312-341`;
  song-info `src/providers/song-info.ts`, `song-info-front.ts`; player response types
  `src/types/get-player-response.ts` (`audioConfig.loudnessDb`).
- `boidushya/better-lyrics` @ `510d1e6e42ba324bc9b83932f45a2c1c8e141b43` — **MV3 browser
  extension** for YT Music lyrics; page-world hooks `public/earlyInject.js` (fetch patch),
  `public/script.js` (player poll); `src/modules/lyrics/requestSniffer/requestSniffer.ts`
  (InnerTube `/next` + `/browse` parsing), providers `unison.ts`, `unified.ts`, `yt.ts`,
  `ytCaptions.ts`; injection `src/modules/lyrics/injectLyrics.ts`, `src/modules/ui/observer.ts`;
  `manifest.json` (`world: MAIN`/`ISOLATED` content scripts), `PRIVACY.md`.
- `web-scrobbler/web-scrobbler` @ `577ed01dd6dbe3eb34db0e2835b31cff99bfa4c9` — **browser
  extension** scrobbler; `src/connectors/youtube-music.ts` (selectors, mediaSession bridge),
  `src/connectors/youtube-music-dom-inject.ts` (page-world `navigator.mediaSession` read).

**InnerTube / client identifiers:**

- InnerTube client enum (`WEB_REMIX` = 67; mobile music clients 21/26): yt-dlp
  `INNERTUBE_CLIENTS` (`github.com/yt-dlp/yt-dlp`), LuanRT `YouTube.js`
  (`github.com/LuanRT/YouTube.js`), `tombulled/innertube` (`github.com/tombulled/innertube`).
  `clientVersion` is time-sensitive (`1.YYYYMMDD.XX.XX`); read from live traffic.

**Lyrics sources / viability:**

- LRCLIB API + docs (free, anonymous, no account, synced + plain): https://lrclib.net/docs
- YT Music timed-lyrics erosion (Sept 2024 Musixmatch→LyricFind switch):
  https://www.androidauthority.com/youtube-music-lost-time-synced-lyrics-3478527/
  and https://9to5google.com/2024/09/04/youtube-music-live-lyrics-missing/
- YT Music lyrics paywall for free tier (2025):
  https://www.ghacks.net/2025/09/11/youtube-music-google-trying-to-make-lyrics-a-premium-plan-exclusive/
  and https://alternativeto.net/news/2025/9/youtube-music-is-testing-a-lyrics-paywall-for-users-on-the-free-tier-sparking-controversy/

**Web Audio in extensions:**

- `AudioContext.createMediaElementSource` (once-per-element; CORS/tainting for cross-origin
  media): https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource
- WebExtension permissions do not bypass the CORS check (not an issue for YT's same-origin MSE
  `blob:` streams, §04):
  https://stackoverflow.com/questions/64519532/webextensions-permissions-to-bypass-the-cors-check-for-audiocontext-createmediae

**Internal cross-references:** §01 (audio-only + page-world injection), §04 (streaming/player
internals, MSE `blob:`, `n`-sig/PO-token), §05 (ghost / anti-tracking / stealth), §06
(background playback + `navigator.mediaSession`), §09 (segment skipping).
