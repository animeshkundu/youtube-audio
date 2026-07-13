# Disabling the Video Stream / Forcing Audio-Only Playback on Modern YouTube

Research doc for the **YouTube Audio** Firefox WebExtension. Grounded in real, cloned open-source code (commit hashes in References). Target platforms: **Firefox desktop + Firefox for Android**. Sites in scope: `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com`.

_Last updated: 2026-07-11. Freshness matters here: YouTube's media stack is actively changing (SABR/PO-token rollout), so treat any "works today" claim as perishable._

---

## 1. Executive summary

**What actually works today, ranked:**

1. **Re-fetch the InnerTube player response from page context using a client that still returns direct googlevideo URLs (currently `ANDROID_VR`), extract an audio-only itag URL, and swap `<video>.src` to it.** This is the modern, working evolution of our old idea. It is exactly what the maintained Firefox extension **Tube Audio Options+** (`ytop-mv3`) does today, and the `ANDROID_VR` client choice is corroborated by yt-dlp, which ships it as a *default* client because it still yields un-SABR'd, no-PO-token, no-signature streams. This **genuinely stops video bytes** (the media element only ever fetches the audio itag). It is the recommendation. Risk: depends on `ANDROID_VR` staying SABR-exempt; Google is visibly tightening this.

2. **Cap playback quality to `tiny` (144p) via the page-world player API (`setPlaybackQualityRange`/`setPlaybackQuality`).** This is what **ImprovedTube** does. It is far more robust and future-proof than any URL trick (it uses YouTube's own supported API), but it **only reduces** video bandwidth to the 144p stream, it does not eliminate it. Good as a fallback / "lite" mode.

3. **YouTube Music (`music.youtube.com`) is already audio-first.** Most tracks are audio-only ("Song" mode) natively; "disable video" is largely a no-op there. The extension should mostly *stay out of the way* on that host and, at most, avoid switching into "Video" mode. See §7.

**What no longer works / never worked:**

- **Our current mechanism** — `webRequest.onBeforeRequest` sniffing for a `mime=audio` GET URL and swapping it in — is **obsolete**. Modern YouTube web delivers media over **MSE + SABR/UMP** using POST-based `videoplayback`/`serverAbrStreamingUrl` traffic, not discrete `?mime=audio` GET URLs, so the listener never fires. See §6.
- **Dropping the video track on the `<video>` element** (`video.videoTracks[i].selected = false`, `removeAttribute`, etc.) does **not** stop video bytes. `videoTracks` is read-only-ish for this purpose and YouTube's MSE `SourceBuffer` pipeline keeps fetching/appending video regardless. See §5.3.
- **CSS/DOM hiding** (`display:none`, black overlay, `width:0`) saves **zero bandwidth** — bytes are still fetched and decoded. It only changes what you see. See §5.4.

---

## 2. How modern YouTube plays media (the constraint that shapes everything)

The YouTube web/mobile-web player is an **MSE (Media Source Extensions)** application:

- `<video>.src` is a `blob:` URL created from a `MediaSource` object. The player JS fetches media in segments and calls `SourceBuffer.appendBuffer()` to feed the decoder. There is no single media URL on the element — you cannot see or swap "the video URL" because there isn't one; there's a blob backed by JS-managed buffers.
- Segment delivery has moved from **discrete DASH range GETs** (`https://*.googlevideo.com/videoplayback?...&mime=video%2Fmp4&range=...`, one URL per format) toward **SABR (Server-side Adaptive BitRate) over UMP (Universal Media Playback)**: the client POSTs to a single `serverAbrStreamingUrl` and the *server* decides which video+audio chunks to push back, muxed into a UMP byte stream. The client no longer holds a stable per-format GET URL.
- Access to raw stream URLs is increasingly gated by a **PO Token (Proof-of-Origin)** and by **signature/`n` descrambling** derived from the player's `base.js`.

Evidence this is the current reality (yt-dlp, 2026):
- yt-dlp emits _"YouTube is forcing SABR streaming for this client"_ for `web`/`web_safari` when formats come back with no URL — i.e. the desktop web client is SABR-only now. `yt-dlp/yt_dlp/extractor/youtube/_video.py:3528-3536`.
- The InnerTube player response now carries `streamingData.serverAbrStreamingUrl` (the SABR endpoint), which `ytop-mv3` reads directly: `ytop-mv3/js/yt.js:711`.

**Implication for us:** On the web player you cannot cheaply "pick the audio SourceBuffer." The two viable levers are (a) bypass the web player's streaming entirely by fetching your *own* audio-only URL via InnerTube and handing it to a plain (non-MSE) `<video>.src`, or (b) steer the web player's own quality selection down. Everything below is a variant of one of those.

---

## 3. Technique catalog

For each: **mechanism -> real-code evidence -> bandwidth -> reliability/future-proofness -> Firefox desktop + Android caveats -> MV2/MV3 notes.**

### 3.1 InnerTube re-fetch + `<video>.src` swap to an audio-only itag  ⭐ RECOMMENDED

**Mechanism.** From page context, when a new video starts:
1. Read the current `video_id` from the live player object (`movie_player.getVideoData().video_id`).
2. POST to `https://www.youtube.com/youtubei/v1/player` (or `m.youtube.com` on mobile) with an InnerTube `context.client` that impersonates a client type YouTube still serves **direct, un-SABR'd adaptive URLs** to — currently `ANDROID_VR` (Oculus Quest 3), with an `ANDROID` fallback for age/"sensitive-topic" videos.
3. From `streamingData.adaptiveFormats`, filter `mimeType.startsWith('audio')`, pick a preferred audio itag (258/256/251/250/249/141/140/139/171), take its `url`.
4. Pause the real player, set `videoElement.src = <audio itag url>`, restore `currentTime`, `play()`. The element is now a **plain progressive audio stream** — no MSE, no video track, no video bytes.

**Real-code evidence (`ytop-mv3`, the maintained Firefox "Tube Audio Options+"):**
- InnerTube POST with the `ANDROID_VR` context: `ytop-mv3/js/yt.js:133-165` (client block at `:146-164`, `clientName: 'ANDROID_VR'`, `clientVersion '1.65.10'`, Oculus Quest 3).
- `ANDROID` fallback for restricted/"s&sh" topics: `ytop-mv3/js/yt.js:192-244` (client at `:203-214`, adds `racyCheckOk/contentCheckOk`, `thirdParty.embedUrl`).
- Parse `adaptiveFormats`/`formats`, filter audio, itag switch, choose URL: `ytop-mv3/js/yt.js:687-802` (audio filter at `:720-723`; itag preference list at `:801`).
- The actual src-swap with pause/seek/resume choreography: `playAudioOnly()` at `ytop-mv3/js/yt.js:259-303` (saves original blob src at `:271`, `videoElement.src = AUDIO_SOURCE` at `:276`).
- Detects new video via a `playing` listener comparing `video_id`: `ytop-mv3/js/yt.js:94-130`.

**Why `ANDROID_VR` specifically (corroboration from yt-dlp, current):**
- yt-dlp's `ANDROID_VR` client definition is byte-for-byte the same persona `ytop-mv3` uses (Oculus Quest 3, clientVersion `1.65.10`): `yt-dlp/yt_dlp/extractor/youtube/_base.py:226-241`.
- That client has `'REQUIRE_JS_PLAYER': False` (`_base.py:240`) — **no signature/`n` descrambling needed**, so the returned `url` is directly playable, and its `PLAYER_PO_TOKEN_POLICY` is `required=False` (`_base.py:222`) — **no PO token required**.
- yt-dlp uses `android_vr` as a **default** and the sole **JS-less default** client in 2026: `_DEFAULT_CLIENTS = ('android_vr', 'web_safari')`, `_DEFAULT_JSLESS_CLIENTS = ('android_vr',)` at `yt-dlp/yt_dlp/extractor/youtube/_video.py:142-143`. That is strong independent evidence that, as of this writing, `ANDROID_VR` still returns usable direct URLs where the web client does not.

**Does it save bandwidth?** **Yes, fully.** The media element fetches only the ~50–160 kbps audio itag; no video segments are ever requested (the original MSE `blob:` pipeline is abandoned when `src` is replaced). This is the only technique here that truly eliminates video bytes.

**Reliability / future-proofness.** *Medium, trending down.* It works today and is actively maintained, but it rests entirely on `ANDROID_VR` remaining SABR-exempt and PO-token-exempt:
- yt-dlp explicitly warns _"Using a clientVersion>1.65 may return SABR streams only"_ for `android_vr` (`_base.py:225`). The persona is pinned at `1.65.10` precisely because newer versions get SABR-forced. This is a cat-and-mouse surface.
- Some videos still come back **ciphered** (signatureCipher) or **throttled** (`n` param). `ytop-mv3` carries a hand-rolled `base.js` cipher extractor (`yt.js:590-645`, `:814-868`, `cipherTools` at `:1032-1044`) as a fallback, and openly comments _"2025-01 YT completely changed the way the base.js handles the cipher, good luck figuring it out"_ (`yt.js:832`). The `n` throttling param is read but **not** descrambled (`yt.js:709-717`) — audio is low-bitrate enough that a throttled stream often still sustains real-time playback, but this is a real failure mode (buffering, or eventual `403`).
- HEAD-check for `403` on ciphered URLs (`yt.js:861-867`) shows the fragility in practice.

**Firefox desktop caveats.** Works. The whole approach hinges on a same-origin `fetch` to `youtubei/v1/player` with `credentials: 'include'` — fine from a `youtube.com` page context. Reaching the player object is easy in Firefox (see §4).

**Firefox Android caveats.** This is the standout: `ytop-mv3` targets `m.youtube.com` with `gecko_android` `strict_min_version 142` and a mobile API key/host (`yt.js:77-89`). Mobile needs extra "keep playing in background" countermeasures (media-session pause interception, visibility spoofing, "Video paused. Continue watching?" auto-dismiss): `countermeasures_android()` at `yt.js:939-1006`. On mobile the src-swap must re-grab `movie_player` on each `playing` event (`yt.js:103`) due to a mobile re-render quirk.

**MV2/MV3 notes.** `ytop-mv3` is **MV3** and needs surprisingly few permissions: `["storage","cookies"]` + host perms for `*.youtube.com` and `*.googlevideo.com` (`ytop-mv3/manifest.json`). Crucially it needs **no `webRequest`/`webRequestBlocking`** — a big simplification versus our current MV2 design, and it survives MV3's loss of blocking webRequest. It exposes `js/yt.js` as a `web_accessible_resource` but in Firefox actually runs it as a content script that reaches the page via `wrappedJSObject` (see §4).

### 3.2 Force lowest quality via the page-world player API (`setPlaybackQualityRange` / `setPlaybackQuality`)

**Mechanism.** Get the `movie_player` element (which *is* the player API object), call `getAvailableQualityLevels()`, then `setPlaybackQualityRange('tiny')` + `setPlaybackQuality('tiny')` to pin 144p. Re-apply on SPA navigation and on the player's quality-change events.

**Real-code evidence (ImprovedTube / code-charity):**
- `ImprovedTube.playerQuality` core: `code-charity-youtube/js&css/web-accessible/www.youtube.com/player.js:445-497`; the actual API calls at `:493-494` (`player.setPlaybackQualityRange(quality); player.setPlaybackQuality(quality);`). Note it maps a requested level to the closest *available* level (`:487-491`) and label list `['tiny','small',...]` at `:488`.
- Battery-aware auto-downgrade to `tiny` when on/low battery: `player.js:581-605` (uses the Battery Status API, sets `quality='tiny'` at `:603`).
- Full-screen/without-focus quality variants also call the same API: `:523-574`, `:501-518`.
- The player object is captured when the DOM node `id==='movie_player'` appears: `code-charity-youtube/js&css/web-accessible/www.youtube.com/functions.js:172-176` (`ImprovedTube.elements.player = node`).

**Does it save bandwidth?** **Partially.** 144p AV1/VP9 is a few hundred kbps vs multi-Mbps at 1080p, so it's a large reduction — but video bytes are still fetched and decoded. It does **not** achieve audio-only. There is **no** public quality value that means "audio" (`setPlaybackQuality('audio')` is not a thing; the floor is `tiny`) — confirmed by the IFrame Player API docs and observable in `getAvailableQualityLevels()`.

**Reliability / future-proofness.** *High.* It uses YouTube's own long-lived, supported player methods; these survived the SABR migration because SABR still honors a client-requested quality cap. This is the most durable lever we have. Downside is it's a compromise, not true audio-only.

**Firefox desktop + Android caveats.** Works on both; the API lives on the `movie_player` element on desktop and mobile web. On Android the settings-menu DOM differs, but the *programmatic* `setPlaybackQuality*` calls are DOM-independent (unlike `ytop-mv3`'s desktop path that literally clicks the quality menu — see §3.5). Prefer the programmatic call on mobile.

**MV2/MV3 notes.** Pure page-world API; no special permissions. Works identically under MV2 and MV3. Only requirement is running in the page's JS world (§4).

### 3.3 Hook MSE in page context (intercept `MediaSource`/`SourceBuffer`) — NOT RECOMMENDED

**Mechanism (theoretical).** Inject page-world code that wraps `MediaSource.prototype.addSourceBuffer` and/or `SourceBuffer.prototype.appendBuffer`, and drop/no-op any buffer whose codec string is `video/*`, keeping only `audio/*`.

**Evidence / status.** No maintained extension in the cloned set does this against YouTube, and for good reason. YouTube's player tracks its own buffered ranges and stalls/errors when appends silently disappear; you fight the player's state machine and ad/heartbeat logic. It also does nothing about SABR's *muxed* UMP stream where audio and video arrive interleaved in one response — you'd have to demux UMP yourself in JS, which is essentially reimplementing the player. The general MSE reality (`videoTracks` is not a bandwidth control; the app decides what to fetch) is why both real extensions avoid this and instead either swap `src` (§3.1) or steer quality (§3.2).

**Bandwidth.** Could in principle stop video appends, but in the SABR/UMP world the server still *sends* the muxed bytes, so savings are unreliable. **Reliability: low. Future-proofness: low.** Skip.

### 3.4 Old `webRequest` URL sniff/rewrite (OUR CURRENT APPROACH) — OBSOLETE

Covered in full in §6. Summary: relied on discrete `?mime=audio` GET URLs that SABR/MSE no longer produces; the listener never fires on modern playback. Not salvageable as-is.

### 3.5 DOM-driven quality clicks (simulate clicking the 144p menu item)

**Mechanism.** Programmatically open the player settings menu and click the lowest quality entry.

**Real-code evidence.** `ytop-mv3`'s `playVideoWithAudio()` (its "back to video" path) does exactly this on desktop: clicks `.ytp-settings-button`, then the quality submenu, then the lowest non-auto item (`ytop-mv3/js/yt.js:317-352`, clicks at `:325-341`). The mobile branch is stubbed/hardcoded and acknowledged as brittle (`yt.js:353-369`).

**Assessment.** Same bandwidth effect as §3.2 but far more fragile (depends on menu DOM/class names, `ytp-*`/`yt-list-item-view-model`). Use §3.2's programmatic API instead; only fall back to clicks if the API is unavailable. **Reliability: low** (class-name churn). Mentioned for completeness because the reference extension uses it.

### 3.6 CSS/DOM hide the video — cosmetic only

**Mechanism.** `video { display:none }` / black overlay / zero-size.

**Bandwidth.** **None saved.** MSE keeps fetching and decoding; you've only hidden pixels. (General web result and MSE semantics.) Useful *only* as UI polish on top of a real technique (e.g. show album art while §3.1 plays audio) — which is what both extensions do with their overlay/thumbnail. Our current content script already appends an informational `audio_only_div` (`js/youtube_audio.js:18-39`); keep that idea, but never rely on CSS for savings.

---

## 4. Getting into the page's JS world (the enabling detail for §3.1 and §3.2)

Both winning techniques need the **page's** JavaScript world, because `movie_player`'s API methods (`getVideoData`, `setPlaybackQuality*`) and a credentialed same-origin `fetch` live there — not in the content-script isolated world. Two portable patterns, both present in the cloned code:

**A. Firefox `wrappedJSObject` (Xray waiver) — Firefox-only, simplest.**
A Firefox content script can reach the page object directly:
```js
let player = document.getElementById('movie_player').wrappedJSObject;
player.getVideoData().video_id;   // real page-world call
```
Evidence: `ytop-mv3/js/yt.js:100` and `:103`. This is a **Firefox-specific** capability (Gecko gives content scripts Xray vision plus a `.wrappedJSObject` escape hatch). It does **not** exist in Chrome. Since our extension is Firefox-only, this is the least-friction path and it works under both MV2 and MV3 on Gecko. (Note: a mid-2026 web summary claimed `wrappedJSObject` is "basically gone in Firefox MV3" — that is contradicted by `ytop-mv3`, a shipping MV3 add-on with `strict_min_version 140/142` that depends on it. Trust the working code; the summary is wrong/overstated. Verify against your target Firefox version during implementation.)

**B. Inject a `<script>` element into the page — cross-browser, portable.**
Append a `<script src=chrome.runtime.getURL(...)>` (or inline) to `document.documentElement`; it executes in the page world. Communicate back via `postMessage`/custom events.
Evidence: ImprovedTube's `extension.inject()` at `code-charity-youtube/js&css/extension/core.js:120-146` (creates `<script>`, sets `.src`, appends to `documentElement` at `:142`); the list of page-world files it injects incl. `player.js` at `code-charity-youtube/js&css/extension/init.js:77-91`. ImprovedTube even uses a tiny inline page-world injection for the Android background fix pattern — mirrored in `ytop-mv3/js/yt.js:957-961` (`script.textContent = ...; documentElement.appendChild(script); script.remove()`).

**MV3/Chrome note (for future portability only):** Chrome MV3 offers declarative `content_scripts` with `"world": "MAIN"`; **Firefox MV3 does not support `world:"MAIN"`**, so on Gecko you use pattern A or B. For a Firefox-only tool, pattern **A** is the pragmatic choice, with **B** as the portable fallback if Xray access ever regresses.

---

## 5. Extra reliability notes that bit the reference extensions

These are real, cited gotchas we would inherit:

- **5.1 Background/idle countermeasures are mandatory for audio-only-while-screen-off.** Once video is "hidden"/paused, YouTube throws "Video paused. Continue watching?" / "Still watching?" and pauses. `ytop-mv3` spoofs `document.hidden`/`visibilityState` and auto-dismisses these dialogs: desktop `countermeasures_desktop()` (`yt.js:871-936`, `_lact` keepalive at `:896`), Android `countermeasures_android()` (`yt.js:939-1006`, mediaSession pause no-op at `:944-947`, visibility spoof at `:951-954`). Our current extension has none of this and would stall on mobile.
- **5.2 New-video detection on an SPA.** YouTube never reloads; you must detect `video_id` changes and re-apply. `ytop-mv3` uses a `playing` event + `video_id` compare (`yt.js:102-126`); ImprovedTube re-applies quality when `video_url !== location.href` (`functions.js:457-462`, clears `dataset.defaultQuality` at `:462`).
- **5.3 `videoTracks` is not a lever.** There is no supported way to disable video decoding on a muxed MSE stream from outside the player. (General MSE/HTMLMediaElement semantics; no cloned extension attempts it.)
- **5.4 Super-resolution / auto-upscale guard** — ImprovedTube caps to `hd720` to avoid AI-upscaled "Super Resolution" being counted as available (`player.js:461-470`). Not our concern for audio, but shows how volatile `getAvailableQualityLevels()` is.

---

## 6. Why our current extension is obsolete, and whether it's salvageable

**Our current mechanism** (`js/global.js` + `js/youtube_audio.js`):
- Background `webRequest.onBeforeRequest` (blocking) over `<all_urls>` looks for `details.url.indexOf('mime=audio') !== -1` and, on match, strips `range`/`rn`/`rbuf` and messages the tab: `js/global.js:33-43`, listener registered at `:52-54`.
- Content script sets `videoElement.src = url` on receipt: `js/youtube_audio.js:13-16`, `makeSetAudioURL` at `:3-11`.

**Why it's broken (empirically, and mechanistically):**
1. **No more discrete `?mime=audio` GET URLs.** Modern web playback is MSE + **SABR/UMP**: media comes via POST to `serverAbrStreamingUrl` as a muxed byte stream, not per-format GETs with a `mime=audio` query param. The desktop web client is now **SABR-only** (yt-dlp: _"YouTube is forcing SABR streaming for this client"_, `_video.py:3528-3536`; `serverAbrStreamingUrl` is what the response actually carries, `ytop-mv3/js/yt.js:711`). So `onBeforeRequest` never sees a matching URL — matching your empirical finding that the swap never happens and `src` stays `blob:`.
2. **Even if a URL appeared, it'd be signed/throttled** (`n` param, PO token, `pot=` on `googlevideo`), so a naïvely rewritten URL would `403`.
3. **MV3 kills blocking webRequest anyway.** `webRequestBlocking` is not available to MV3 extensions in the same form; our `["webRequest","webRequestBlocking","*://*/*"]` (`manifest.json`) is an MV2-only design and a porting dead-end.

**Salvageable?** The *webRequest strategy* is not salvageable — it's the wrong layer for the SABR era. But the **core idea is 100% salvageable and, in fact, current**: "obtain an audio-only googlevideo URL and set it as `<video>.src`." The only change is **where the URL comes from**: instead of passively sniffing network traffic, **actively request it from InnerTube with an `ANDROID_VR` client from page context** (§3.1). Keep the src-swap concept; replace the acquisition path; drop `webRequest` entirely.

---

## 7. YouTube Music (`music.youtube.com`) and the other in-scope hosts

- **`music.youtube.com` is audio-first by design.** Most tracks play audio with static art; only some have an official music video, exposed via an in-app **"Song / Video" toggle**, with "Song" being the low-bandwidth audio path. So on YT Music, "disable video" is largely **native and trivial** — the user already gets audio unless they opt into "Video." Recommendation: on this host, **do not run the src-swap** (it would fight YT Music's own player and risk breaking gapless/queue behavior). At most, ensure we never select "Video" mode, or simply exclude the host from active manipulation and let it be. Its InnerTube client and layout differ (`YTMUSIC` client family in youtube-js's client list, `youtube-js/src/types/Misc.ts`), so any YT-Music-specific handling must be separate from the `youtube.com` path.
- **`m.youtube.com`** — treat as the primary mobile target: separate API host/key and countermeasures already demonstrated by `ytop-mv3` (`yt.js:77-89`, `:939-1006`). Our current content-script matches (`*://*.youtube.com/*`) already cover it, but our *mechanism* doesn't.
- **`youtube-nocookie.com`** — embed host; the same page-world player API and InnerTube approach apply, but embeds often have restricted playback and no settings menu. Lower priority; the §3.2 programmatic quality cap degrades gracefully there.

---

## 8. Concrete recommendation for OUR extension (Firefox desktop + Android)

**Primary strategy: adopt the `ytop-mv3` model, adapted.** Rebuild around a **page-aware content script** (Firefox `wrappedJSObject`, §4-A) that:

1. **On each new video** (`playing` event + `video_id` change, §5.2): if audio-only is enabled, POST `youtubei/v1/player` with an **`ANDROID_VR`** context (pin `clientVersion 1.65.10`, per `_base.py:230`), `credentials:'include'`, `X-Origin` header; on "no streams," retry with `visitorData`, then fall back to an **`ANDROID`** context for restricted videos (mirror `ytop-mv3/js/yt.js:133-244`).
2. **Pick an audio itag** from `adaptiveFormats` (prefer 251/140 for broad availability; 250/249 for lowest bandwidth) and **swap `<video>.src`** with the pause/seek/resume dance (`ytop-mv3/js/yt.js:259-303`).
3. **Ship the countermeasures** (visibility spoof + dialog auto-dismiss + mediaSession pause no-op) so screen-off/background audio survives on desktop and Android (`yt.js:871-1006`).
4. **Provide a robust fallback: quality-cap to `tiny`** via `setPlaybackQualityRange`/`setPlaybackQuality` (§3.2, `player.js:493-494`) whenever the InnerTube path fails (ciphered-only response, `403`, SABR-forced). This guarantees *some* bandwidth reduction even when true audio-only breaks. Consider making this a user-selectable "Lite mode (144p)" vs "Audio-only" toggle.
5. **Migrate to MV3**: permissions shrink to roughly `["storage"]` + host perms for `*.youtube.com`/`*.googlevideo.com`; **delete `webRequest`/`webRequestBlocking`** and `js/global.js`'s sniffing entirely.
6. **Host handling**: run the src-swap on `youtube.com`/`m.youtube.com`/`youtube-nocookie.com`; **leave `music.youtube.com` alone** (audio-first already, §7).

**Risks / honest uncertainty:**
- **`ANDROID_VR` is a moving target.** yt-dlp warns newer client versions get SABR-forced (`_base.py:225`); Google could revoke the exemption at any time, at which point true audio-only breaks and we fall back to §3.2 (144p). Design for that fallback from day one.
- **Cipher/`n` throttling.** Some responses are ciphered; the `base.js` cipher extractor is fragile and YouTube changed it in 2025 (`yt.js:832`). Undescrambled `n` can throttle even audio. Budget for occasional buffering / silent fallback to 144p.
- **PO token creep.** If PO tokens become required for `ANDROID_VR` too, the whole direct-URL approach dies and §3.2 becomes the *only* viable lever. That is the strategic backstop.
- **Legal/ToS**: out of scope per instructions (single-dev personal tool); no license analysis needed. We may freely study/adapt any repo above.

**Net:** implement §3.1 as the headline feature with §3.2 as an always-available fallback, in a single MV3 Firefox content script using `wrappedJSObject`, with mobile countermeasures. This is a proven-shipping design (`ytop-mv3`) whose critical assumption (`ANDROID_VR` direct URLs) is independently corroborated by yt-dlp's current defaults.

---

## 9. References

Repos cloned (shallow) on 2026-07-11 into `/tmp/yta-research/01-disable-video/`:

| Repo | Commit | Why |
|---|---|---|
| schdie/we_firefox_ytop_mv3 ("Tube Audio Options+") | `5747b5719ef5e8286dd6ba380741f069e0373d29` | The shipping Firefox MV3 audio-only extension. Primary model for §3.1. `js/yt.js`, `js/service.js`, `manifest.json`. |
| code-charity/youtube (ImprovedTube) | `43fa27d3ec07a5e9351d83386c0066a618036e86` | Page-world player API quality control (§3.2) + script-injection pattern (§4-B). `js&css/web-accessible/www.youtube.com/player.js`, `js&css/extension/core.js`. |
| yt-dlp/yt-dlp | `59d9ae606a24a80523da35de9fb75b71eb35b501` | Ground truth on current InnerTube clients, SABR/PO-token policy. `yt_dlp/extractor/youtube/_base.py`, `_video.py`. |
| LuanRT/YouTube.js | `14825d7712e32b208830895701973a5a934a3522` | InnerTube client list incl. `YTMUSIC` (§7). `src/types/Misc.ts`, `src/core/Player.ts`. |
| iv-org/invidious | `1111ea72947eac205ce8d3c2901da304eedab027` | (context, server-side InnerTube) not directly cited. |

Key source citations (repo/path:line):
- `ytop-mv3/js/yt.js:94-130` new-video detection; `:133-244` InnerTube `ANDROID_VR`+`ANDROID` fetch; `:259-303` src-swap; `:687-802` adaptiveFormats audio extraction; `:711` `serverAbrStreamingUrl`; `:832,:814-868,:1032-1044` cipher fallback; `:871-1006` background countermeasures; `:100,:103` `wrappedJSObject`.
- `ytop-mv3/manifest.json` — MV3, perms `storage`+`cookies`, gecko_android 142, no webRequest.
- `code-charity-youtube/js&css/web-accessible/www.youtube.com/player.js:445-497` quality API (`:493-494`), `:581-605` battery→tiny.
- `code-charity-youtube/js&css/extension/core.js:120-146` script injection; `functions.js:172-176` player capture.
- `yt-dlp/yt_dlp/extractor/youtube/_base.py:225-241` ANDROID_VR persona + SABR warning + `REQUIRE_JS_PLAYER:false`; `_video.py:142-143` default clients; `_video.py:3528-3536` "forcing SABR streaming".
- Our extension: `js/global.js:33-54` webRequest sniff; `js/youtube_audio.js:3-16` src-swap; `manifest.json` MV2 perms.

External docs / current-state (web, 2026):
- YouTube IFrame Player API (`setPlaybackQuality`, no "audio" level; floor is `tiny`) — developers.google.com/youtube/iframe_api_reference.
- MDN: HTMLMediaElement / Media Source Extensions (`videoTracks` not a bandwidth control; MSE app controls fetching) — developer.mozilla.org.
- MDN / Firefox Extension Workshop: content-script page access, `wrappedJSObject`, Firefox MV3 lacks `world:"MAIN"` — developer.mozilla.org, extensionworkshop.com.
- yt-dlp SABR/PO-token state (2026): yt-dlp wiki "YouTube" + community SABR guides (corroborating `ANDROID_VR` as a still-working direct-URL client).
