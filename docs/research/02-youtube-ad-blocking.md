# Research: How YouTube Ad Blocking Really Works Today

**Status:** Research brief (freshness-stamped)
**Date:** 2026-07-11
**Scope:** In-scope sites for our extension are `youtube.com`, `www.youtube.com`, `m.youtube.com` (Firefox Android), `music.youtube.com`, and `youtube-nocookie.com`. Target platforms: Firefox desktop + Firefox for Android, Manifest V2 (blocking `webRequest`).
**Method:** Grounded in real source cloned locally (see [References](#references)). Every technique below is cited to `repo/path:line` in code we actually read. Web sources confirm the 2025-2026 state.

---

## 1. Executive summary

**What works today (mid-2026):** Client-side YouTube ad blocking still works on Firefox, but it is *no longer a solved problem*. It is a continuous, high-frequency arms race that uBlock Origin (uBO) and AdGuard fight for their users through filter-list updates, sometimes several times a week. The core of what works is **not** network blocking. It is **JavaScript surgery on YouTube's own player-response JSON** performed inside the page, removing the `adPlacements` / `playerAds` / `adSlots` fields before YouTube's player reads them, plus a growing set of scriptlets that spoof request parameters and neutralize YouTube's adblock-detection callbacks.

**How robust:** Fragile by nature, robust in practice *only because a funded volunteer team patches it constantly*. Individual filters break within hours/days of a YouTube server change and are hot-fixed via uBO's `quick-fixes.txt` list (5-day expiry, pulled frequently). A static copy of these rules rots fast.

**The looming threat — server-side ad insertion (SSAI):** YouTube's newer streaming protocol (community-named **SABR**, "Server ABR") is essentially fully rolled out and lets the server control ad delivery. Its most aggressive form, **true server-stitched ads** (ad and content muxed into one continuous media stream), is still a rolling experiment as of mid-2026 but expanding. When a video is served that way there is *no `adPlacements` field to strip and no separate ad request to block* — client-side blocking degrades to "seek past the ad," which is skipping, not blocking. A separate, already-widespread measure — a **"fake buffering" backoff** that stalls blocked sessions for ~80% of an ad's duration — is currently dodged by client spoofing. Both of uBO's counters (spoofing the client so YouTube serves a blockable path) are inherently temporary. See [§2.3](#23-sabr-fake-buffering-and-true-server-side-ad-stitching--disentangled).

**Honest verdict for our extension: DEFER. Do not build a DIY YouTube ad blocker.** Reasons, expanded in [§6](#6-what-it-would-take-for-our-extension--recommendation):
1. The maintenance burden is a part-time job forever. uBO ships YouTube fixes continuously; a solo/personal extension cannot keep pace. A stale ad blocker is *worse than none* — it breaks playback (black screens, "video unavailable") and generates support complaints.
2. The highest-value techniques (`json-prune`, `trusted-replace-fetch-response`, the anti-adblock scriptlets) are a mature, security-reviewed engine in uBO. Reimplementing them is large and easy to get subtly wrong (they run privileged code in the page).
3. Our extension's actual niche — audio-only streaming — is **complementary** to uBO + SponsorBlock, not competitive. The one-stop-shop story is best told as "works great alongside uBO," and optionally shipping a *thin, honest* "skip ad button" convenience, not a blocker.
4. If we ever do want *some* in-house ad relief, the lowest-risk, lowest-maintenance option is a small **auto-skip** helper (click the Skip button / seek past a detected ad), clearly labeled as skipping not blocking. Even that carries ongoing DOM-selector maintenance.

---

## 2. How YouTube serves ads today, and why network blocking alone fails

### 2.1 The InnerTube player response is the center of gravity
When you open a video, the watch page and the player fetch a JSON "player response" from YouTube's InnerTube API (`/youtubei/v1/player`, `/youtubei/v1/get_watch`) or embed it inline as `ytInitialPlayerResponse`. Ads are described **inside that same JSON**, in fields such as:
- `adPlacements` — pre/mid/post-roll ad break definitions
- `playerAds` — additional ad payloads
- `adSlots` — newer ad-slot descriptors
- `adBreakHeartbeatParams` — ad-break signaling

The media itself streams from `*.googlevideo.com/videoplayback?...`. Crucially, **ad video and content video come from the same first-party-ish `googlevideo.com` CDN, over the same `videoplayback` endpoint, with opaque query params.** There is no `ad.doubleclick.net/video.mp4` to block. This is the fundamental reason network blocking fails on YouTube specifically (unlike display ads on ordinary sites, which uBO blocks trivially at the network layer).

### 2.2 Why "just block the ad requests" doesn't work
- **First-party serving:** ad metadata arrives in the same first-party InnerTube response as the video you asked for. Block that request and you block the video.
- **Same-CDN media:** ad segments and content segments are both `googlevideo.com/videoplayback`, indistinguishable by URL. uAssets keeps a few *surgical* network rules (e.g. `||googlevideo.com/initplayback?source=youtube&*c=TVHTML5&*oad=$xhr` at `uassets/filters/filters.txt:44`, and a narrow `videoplayback?expire=...` rule at `uassets/filters/quick-fixes.txt:94`), but these are edge cases, not the mechanism.
- **Legacy media network filter:** `*_ad_$media,domain=youtube.com,3p` (`uassets/filters/filters.txt:11`) catches some third-party ad media, but the *primary* pre/mid-roll ads are first-party and untouched by it.

### 2.3 SABR, "fake buffering," and true server-side ad stitching — disentangled
These three are routinely conflated in press coverage. They are distinct, and the distinction determines how blockable YouTube actually is:

1. **SABR (the streaming protocol) — "Server ABR".** YouTube's proprietary *binary* streaming protocol that replaced the old "client fetches `/videoplayback` byte-range URLs" model. Under SABR the **server** drives bitrate/format switching and timing over one continuous protocol to `sabr.googlevideo.com`. This is a *transport* change and is **effectively fully rolled out by 2025-2026** (it is why yt-dlp had to rebuild its whole extraction path — yt-dlp issue [#12482](https://github.com/yt-dlp/yt-dlp/issues/12482), "`web` only has SABR formats," Feb 2025). By itself SABR is not ad insertion, but it is the substrate that makes server-side ad control practical.

2. **"Fake buffering" (a punitive backoff) — the current, widely-deployed anti-adblock measure.** When an ad-blocking session reaches an ad break, YouTube's server returns a **backoff instruction (~80% of the ad's duration)** telling the client to wait before resuming content — *even though no ad file is delivered to the blocked client*. Documented in detail by a uBO/yt-dlp-adjacent developer's reverse-engineering write-up ([iter.ca, "YouTube's new anti-adblock measures," 2025-06-20](https://iter.ca/post/yt-adblock/)). Critically, **the ad and content streams are still separate here** — so there is still a client-side counter: a request-mutation field, **`isInlinePlaybackNoAd: true`** (found via protobuf reverse-engineering), tells InnerTube not to serve ads at all, dodging the backoff. uBO ships exactly this as a scriptlet — see the real filter at `uassets/filters/quick-fixes.txt:84`:
   ```
   www.youtube.com##+js(trusted-replace-outbound-text, JSON.stringify, contentPlaybackContext":{, contentPlaybackContext":{"isInlinePlaybackNoAd":true,, condition, contentPlaybackContext)
   ```
   YouTube counters this with a **"locker script"** that freezes `JSON.stringify` / `Object.assign` so extensions can't hook them; uBO counters *that* with `trusted-prevent-dom-bypass` (`quick-fixes.txt:76-78`). This is the live front line.

3. **True server-side ad stitching (SSAI) — the existential threat, still a rolling experiment.** Ad bytes **muxed into the one continuous media stream** the client requests. First reported [June 2024](https://9to5google.com/2024/06/12/youtube-ad-injection/) (via the SponsorBlock developer, who noticed it shifts stored segment timestamps). When a video is served this way:
   - The ad is part of the same media timeline; **no separate `adPlacements` block to prune, no separate ad request to block.** JSON surgery has nothing to grab.
   - The only client-side lever left is **detect the stitched region and seek past it** — *skip*, not block, and only if boundaries are exposed. Degraded, lossy, detectable.
   - As of mid-2026 this is **actively expanding but not confirmed universal** — reporting describes ongoing A/B testing / test cohorts, not a single global launch. (A session flag `EXPERIMENT_FLAGS.html5_enable_ssap_entity_id` has been reported as the SSAP-cohort marker. The player's `getStatsForNerds().debug_info` string `"SSAP, AD"` is **code-verified**: uBO's scriptlet literally branches on `debug_info?.startsWith?.("SSAP, AD")` at `uassets/filters/quick-fixes.txt:24`. But the *expansion* of "SSAP" to "Server-Side Ad Playback/Placement" is a **community interpretation, not Google-confirmed** — treat the acronym's meaning as folklore, the string itself as real.)

**Bottom line:** today's blocking survives because ads are still *mostly* delivered as either (a) client-side `adPlacements` JSON, or (b) fake-buffering backoffs that `isInlinePlaybackNoAd` / client-spoofing can dodge. uBO's live counters (see [§3.7](#37-the-2025-2026-front-line-request-spoofing--anti-detection)) **spoof the client identity** so YouTube's server chooses a blockable path. **These are temporary levers.** If YouTube forces true SSAI universally and stops honoring the client hints uBO exploits, client-side blocking as we know it ends and only skipping-style approaches remain viable. Note SSAI is also **collateral damage to SponsorBlock** (stitched ads offset its timestamps), underscoring that these are separate problems.

### 2.4 PO Tokens and the "just spoof Premium" dead end
Running parallel to the ad war, YouTube now requires **PO Tokens** (Proof-of-Origin, minted by BotGuard/DroidGuard attestation) for GVS/player/subtitle requests on most clients (yt-dlp [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide), edited Mar 2026). This is anti-scraping infrastructure, but it reflects YouTube's general direction: **cryptographic, server-verified client attestation** rather than easily-spoofable client-side flags. Consequence for us: the "just spoof YouTube Premium to get an ad-free session" idea is a dead end — entitlement is validated server-side against account state, spoofing risks account penalties, and real Premium is the only path that bypasses every enforcement layer (including PO-Token gating). (Reporting on Premium-spoof detection is directionally consistent but mechanistically thin; treat specifics as unconfirmed.)

---

## 3. Technique catalog (each layer, real-code evidence, robustness, maintenance, Firefox caveats)

The layers below are ordered from "what does the real work" to "supporting cast." Note the pattern: **the load-bearing techniques are all in-page JavaScript (scriptlets), not network rules.**

### 3.1 Player-response JSON pruning — `json-prune` / `set-constant`  ⭐ core mechanism
**Mechanism:** Inject a scriptlet at `document_start` that intercepts `JSON.parse` (and inline data) and *deletes* the ad fields before YouTube's code sees them. The player then behaves as if the video simply has no ads.

**Real code:**
- Core scriptlet: `jsonPrune()` proxies `JSON.parse` — `ublock/src/js/resources/json-prune.js:35`; registered as `json-prune.js` at `:66`.
- The actual delete logic (path walking, wildcard tokens `[-]` remove-array-item, `{-}` remove-object-key, `[]`) lives in `objectPruneFn` — `ublock/src/js/resources/object-prune.js:110` (token handling at `object-prune.js:61,70,79`).
- `set-constant` (alias `set`) forces a property to a constant (e.g. `undefined`) — `ublock/src/js/resources/set-constant.js:255` (alias `set.js` at `:256`).

**Real filter invocations (uAssets):**
```
# uassets/filters/quick-fixes.txt:20
youtube.com##+js(json-prune, playerResponse.adPlacements playerResponse.playerAds playerResponse.adSlots adPlacements playerAds adSlots legacyImportant)

# uassets/filters/filters.txt:35-38  (note: applies to music.youtube.com, m.youtube.com, youtube-nocookie.com too)
m.youtube.com,music.youtube.com,tv.youtube.com,www.youtube.com,youtubekids.com,youtube-nocookie.com##+js(set, ytInitialPlayerResponse.playerAds, undefined)
m.youtube.com,music.youtube.com,tv.youtube.com,www.youtube.com,youtubekids.com,youtube-nocookie.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)
m.youtube.com,music.youtube.com,tv.youtube.com,www.youtube.com,youtubekids.com,youtube-nocookie.com##+js(set, ytInitialPlayerResponse.adSlots, undefined)

# uassets/filters/filters.txt:40  (m.youtube.com / music / kids / nocookie variant, "important" flag)
m.youtube.com,music.youtube.com,youtubekids.com,youtube-nocookie.com##+js(json-prune, playerResponse.adPlacements playerResponse.playerAds playerResponse.adSlots adPlacements playerAds adSlots important)
```
The `set(ytInitialPlayerResponse.adPlacements, undefined)` rules handle the **inline** first paint; the `json-prune` rules handle **dynamically-fetched** navigations (SPA route changes). YouTube Music (`music.youtube.com`) is explicitly covered by the same rule domains — it uses the same InnerTube player response, so the same field-stripping applies.

**Robustness:** High *while ads remain in `adPlacements`/`adSlots`*. Zero once SABR stitches ads into the stream (nothing to prune).
**Maintenance:** Field names drift (`playerAds` and `adSlots` were added over time; `no_ads`, `adBreakHeartbeatParams` appear in newer rules). Medium-to-high churn.
**Firefox desktop/Android:** Works identically; it's page-context JS injected by the content script, no MV2-specific API required for the *injection* itself (uBO uses its scriptlet-injection pipeline). Firefox Android (Fenix) supports uBO and this path works there.

### 3.2 Network-response rewriting — `trusted-replace-fetch-response` / `-xhr-response`, `json-prune-fetch/xhr-response`, `$replace=`
**Mechanism:** Instead of deleting a parsed field, intercept the `fetch`/`XHR` **response body of the InnerTube call** and rewrite the raw JSON text — e.g. rename `"adPlacements"` to `"no_ads"` so the player never finds it. Two flavors: scriptlet-based (runs in page) and network-filter `$replace=` (rewrites the response bytes at the request layer — **requires Firefox's MV2 blocking webRequest / uBO's response-body rewriting**).

**Real code:**
- Scriptlet `trusted-replace-fetch-response.js` — `ublock/src/js/resources/scriptlets.js:1713`; `trusted-replace-xhr-response.js` — `:1730`; shared fetch-collate helper `replace-fetch-response.fn` — `:321`.
- `json-prune-fetch-response.js` — `ublock/src/js/resources/json-prune.js:139`; `json-prune-xhr-response.js` — `:233`.

**Real filter invocations (uAssets):**
```
# uassets/filters/filters.txt:22-23  (scriptlet path, HTML-filtering-capable engines)
www.youtube.com##+js(trusted-replace-fetch-response, '"adPlacements"', '"no_ads"', player?)
www.youtube.com##+js(trusted-replace-fetch-response, '"adSlots"', '"no_ads"', player?)

# uassets/filters/filters.txt:25-30  (network $replace= fallback, gated by !#if !cap_html_filtering / !#else)
||www.youtube.com/youtubei/v1/player?$xhr,1p,replace=/"adPlacements"/"no_ads"/
||www.youtube.com/youtubei/v1/player?$xhr,1p,replace=/"adSlots"/"no_ads"/
||youtube.com/youtubei/v1/get_watch?$xhr,1p,replace=/"adPlacements"/"no_ads"/   # quick-fixes.txt

# uassets/filters/quick-fixes.txt:56-63  (xhr/fetch response prune + replace variants)
www.youtube.com##+js(json-prune-xhr-response, adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots ..., , propsToMatch, /\/player(?:\?.+)?$/)
tv.youtube.com##+js(trusted-replace-xhr-response, '"adPlacements"', '"no_ads"', /playlist\?list=|\/player(?:\?.+)?$|watch\?[tv]=/)
```
The uAssets source literally forks on engine capability: `!#if !cap_html_filtering` uses the scriptlet, `!#else` uses the `$replace=` network filter (`uassets/filters/filters.txt:19,24,31`). **Firefox desktop supports both; the `$replace=` network-response rewrite depends on MV2 blocking webRequest — a Firefox advantage that Chrome MV3 removed.**

**Robustness:** High for client-side-ad JSON. **Firefox-favored** because `$replace=` needs blocking webRequest.
**Maintenance:** High — the regexes (`/"adPlacements.*?("adSlots"|"adBreakHeartbeatParams")/gms` at `filters.txt:21`) are tuned to exact response shapes and break when YouTube reshuffles the JSON.
**Android caveat:** Works via uBO on Firefox Android. YouTube Music: same InnerTube endpoint, same rewrite applies.

### 3.3 Outgoing-request mutation — `trusted-json-edit-xhr-request`, `trusted-replace-outbound-text`, `trusted-edit-inbound-object`
**Mechanism:** The newest and most sophisticated layer. Rather than clean the *response*, **mutate the outgoing InnerTube request** so YouTube's server returns an ad-free (or old-format, blockable) response. Tricks observed in current filters:
- Set `clientScreen: "CHANNEL"` / `"ADUNIT"` in the request context, which makes YouTube treat the request as a context where ads aren't inserted.
- Inject `params` values (`"8AUB"`, `"yAEB"`) and `lactMilliseconds` timing to influence server ad decisions.
- Append `#reloadxhr` referer markers to drive retry logic.

**Real code:** `json-edit.js` implements the whole `edit-*-object` / `json-edit-*-request` family — `trusted-json-edit-xhr-request.js` at `ublock/src/js/resources/json-edit.js:978`, `trusted-edit-inbound-object.js` at `:297`, plus `trusted-replace-outbound-text` in `scriptlets.js`.

**Real filter invocations (uAssets):**
```
# uassets/filters/quick-fixes.txt:25-28
www.youtube.com##+js(trusted-json-edit-xhr-request, [?..userAgent*="channel"]..client[?.clientName=="WEB"]+={"clientScreen":"CHANNEL"}, propsToMatch, /player?)
www.youtube.com##+js(trusted-json-edit-xhr-request, [?..userAgent*="lactmilli"]+={"params":"8AUB"}, propsToMatch, /player?)
www.youtube.com##+js(trusted-json-edit-xhr-request, [?..userAgent*="lactmilli"]..playbackContext.contentPlaybackContext.lactMilliseconds="${now}", propsToMatch, /player?)
```
**Robustness:** This is the *current* mechanism that keeps working against YouTube's server-side ad decisions, but it is exactly the lever SABR threatens to remove.
**Maintenance:** Very high — these are reverse-engineered against undocumented server behavior and rotate frequently (they live in `quick-fixes.txt`, 5-day expiry).

### 3.4 Neutered ad SDK shims (redirect / web-accessible resources)
**Mechanism:** When a page requests Google's IMA (Interactive Media Ads) SDK or DoubleClick's ad-status script, uBO **redirects the request to a stub** that satisfies the API surface but plays no ads and reports "no ad." Prevents player breakage (black boxes) while killing ads.

**Real code:**
- Neutered IMA SDK: `ublock/src/web_accessible_resources/google-ima.js` (a stubbed `google.ima` — `AdDisplayContainer` inserts a hidden `<div>`, `requestAds` always behaves as no ad; VERSION `3.764.0`). Based on Mozilla's webcompat shim.
- Redirect mapping: `google-ima.js` (alias `google-ima3`) — `ublock/src/js/redirect-resources.js:98`; `doubleclick_instream_ad_status.js` (alias `doubleclick.net/instream/ad_status.js`) — `:67`.

**Robustness:** Stable — this is more about *unbreaking* the player than blocking YouTube's own first-party ads. More relevant to embedded/3rd-party players than YouTube.com pre-rolls.
**Maintenance:** Low. **Firefox:** works on desktop + Android.

### 3.5 Shorts / feed / living-room ad pruning
**Mechanism:** Ads also appear in Shorts sequences and feed/list responses; separate prune rules target those payloads.
```
# uassets/filters/filters.txt:46-47  (Shorts ad flag)
m.youtube.com,music.youtube.com,tv.youtube.com,www.youtube.com,youtubekids.com,youtube-nocookie.com##+js(json-prune-fetch-response, reelWatchSequenceResponse.entries.[-].command.reelWatchEndpoint.adClientParams.isAd ..., , propsToMatch, url:/reel_watch_sequence?)
m.youtube.com,...##+js(json-prune, entries.[-].command.reelWatchEndpoint.adClientParams.isAd)

# uassets/filters/filters.txt:42  (TV / living-room "Ad" list item)
youtube.com##.ytlr-horizontal-list-renderer__items ... .yt-virtual-list__item:has-text(Ad)
```
Note `m.youtube.com` (Firefox Android mobile web) is explicitly in-scope of these rules.
**Maintenance:** Medium; feed schema churns.

### 3.6 Cosmetic filtering (banners, in-feed promoted, "player-ads")
**Mechanism:** Standard CSS/`##` cosmetic rules hide display-style ad elements (masthead, promoted feed items). This is the *easy* part and is generic uBO cosmetic filtering, not YouTube-specific magic. Example unhide: `youtube.com#@##player-ads` (`uassets/filters/quick-fixes.txt:82`, an *exception* that re-shows a container in some cases). Cosmetic filtering does **not** stop video pre/mid-rolls; those are the player-response layer above.
**Robustness/Maintenance:** Low effort, low value against video ads.

### 3.7 The 2025-2026 front line: request spoofing + anti-detection
**Mechanism:** YouTube deploys **adblock detection** — it stops playback, shows "Ad blockers violate YouTube's Terms of Service," or serves a fake "unplayable" error, and it has an `onAbnormalityDetected` callback that flags blocked clients. Since 2023 this escalated to the 3-strikes "you appear to have an ad blocker" prompts. uBO's current flagship counter is a large inline scriptlet (`trusted-rpnt` / `replace-node-text`) that:
- Detects stitched-ad playback via `getStatsForNerds().debug_info` starting `"SSAP, AD"` and, when an ad is detected, **seeks to the end of the ad region** (`e.seekTo(duration)`).
- **Spoofs the InnerTube client user-agent** with rotating tokens (`"channel"`, `"lactmilli"`, `"premium"`) so YouTube serves the blockable client-side ad format.
- **Neutralizes `onAbnormalityDetected`** by proxying `Promise.prototype.then` and replacing the callback with a no-op.
- Handles the fake `UNPLAYABLE` / captcha error screen by reloading the video with adjusted params.

**Real filter (uAssets), the exact current scriptlet:**
```
# uassets/filters/quick-fixes.txt:24  (abbreviated — a ~2KB inline function)
www.youtube.com##+js(trusted-rpnt, script, (function serverContract(), (()=>{ ... if(!i?.debug_info?.startsWith?.("SSAP, AD")){ ... } s.duration>0&&e.seekTo?.(s.duration) ... onAbnormalityDetected ... }), (function serverContract(), sedCount, 1)
```
The scriptlet primitive is `replace-node-text` / `trusted-replace-node-text` (`rpnt`) — `ublock/src/js/resources/scriptlets.js:1678`. There is also a JS-file surgery network rule that rewrites `onAbnormalityDetected` in YouTube's bundle (`uassets/filters/quick-fixes.txt:46`, currently commented).

**Robustness:** This is where the whole thing is most brittle — it lives in `quick-fixes.txt` (5-day expiry) and changes constantly. **This scriptlet is effectively the reason YouTube ad blocking still works at all in mid-2026.**
**Maintenance:** Extreme. This is a near-continuous reverse-engineering effort. **A static fork of this rots within days.**

### 3.8 Supporting scriptlets seen in current YouTube rules
- `nano-stb` (setTimeout booster) — throttles anti-adblock timers: `uassets/filters/quick-fixes.txt:44`; registered in `ublock/src/js/resources/scriptlets.js` (`nano-setTimeout-booster.js` / `nano-stb.js`, ~line 576).
- `no-fetch-if` / `prevent-fetch` (alias) — blocks specific `fetch()` calls: `ublock/src/js/resources/prevent-fetch.js:154` (alias `no-fetch-if.js` at `:155`).
- `trusted-prevent-dom-bypass` — stops YouTube re-fetching via detached DOM nodes: `uassets/filters/quick-fixes.txt:76-78`.

---

## 4. SponsorBlock — complementary, NOT ad blocking

**Clarify up front: SponsorBlock does not block or skip YouTube's injected ads.** It skips **in-video segments that creators themselves insert** — paid sponsor reads, self-promotion, intros/outros, interaction reminders ("like and subscribe"), and (for Music) non-music sections. It is crowd-sourced, not filter-based.

**How it works (real code, `sponsorblock` repo):**
- Central community API: `https://sponsor.ajay.app` (`sponsorblock/config.json.example:2`).
- Segment categories: `sponsor`, `selfpromo`, `exclusive_access`, `interaction`, `intro`, `outro`, `preview`, `music_offtopic`, `filler`, `poi_highlight`, `chapter` (`sponsorblock/config.json.example:21-27`, `sponsorblock/src/config.ts:471-480`). `music_offtopic` is the YouTube Music-relevant one (skips non-music intros/outros in songs).
- **Privacy via k-anonymity hash prefix:** the client computes `sha256(videoID)`, sends only a **short prefix** of that hash, and queries `GET /api/skipSegments/<prefix>` — the server returns segments for *all* videos whose hash starts with that prefix, so it never learns which exact video you watched. In the real extension the prefix is 5 hex chars — see `sponsorblock/src/utils/segmentData.ts:62-64`:
  ```
  const hashPrefix = (await getHash(videoID, 1)).slice(0, 5) ...
  const response = await asyncRequestToServer('GET', "/api/skipSegments/" + hashPrefix, ...)
  ```
  (The public [API docs](https://wiki.sponsor.ajay.app/w/API_Docs) accept a 4-32 char prefix, 4 recommended; the user's own ID is stored server-side as the local random ID SHA-256-hashed 5,000 times.)
- The extension watches `video.currentTime` and seeks past segments whose category the user enabled.
- **Firefox Android:** SponsorBlock is natively installable from AMO since Mozilla opened the Android add-on ecosystem (450+ extensions, [Dec 14 2023](https://blog.mozilla.org/en/mozilla/new-extensions-youll-love-now-available-on-firefox-for-android/)). It was *not* on the earlier curated list; it is now. Confirmed not-ad-blocking by the project's own [FAQ](https://wiki.sponsor.ajay.app/w/FAQ) ("Can't it just skip YouTube's ads?" — no, YouTube's ads are out of scope by design).

**Relationship to us:** SponsorBlock is the model of the *right* kind of feature for a small extension — a well-defined, community-backed, privacy-respecting enhancement that composes cleanly with everything else. It is orthogonal to ad blocking and to our audio-only feature. **A user running our extension + uBO + SponsorBlock gets: audio-only + no ads + no sponsor segments.** That is the "one-stop-shop" story, achieved by coexistence, not reimplementation. SABR does degrade SponsorBlock too (stitched ads shift timestamps), but the project adjusts.

---

## 5. Firefox-specific advantages and mobile caveats

| Factor | Firefox desktop | Firefox for Android | Chrome (contrast) |
|---|---|---|---|
| MV2 + blocking `webRequest` | **Yes**, Mozilla has publicly committed (Mozilla Add-ons blog, [Mar 2024](https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/)) to keep MV2 + blocking webRequest "for the foreseeable future," with 12-months' notice before any change. No deprecation date. | **Yes**, same Gecko engine. | **Removed.** MV2 disabled by default Mar 31 2025; Chrome 138 (Jul 24 2025) is the last MV2-capable version; Web Store MV2 purge Aug 31 2026 ([Chrome docs](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline)). |
| Response-body rewrite (`$replace=`, `trusted-replace-*-response`) | **Yes** (`webRequest.filterResponseData`) | **Yes** (via uBO) | No (declarativeNetRequest can't read/modify bodies) |
| Scriptlet injection (`json-prune`, etc.) | Yes | Yes | Limited under MV3 (uBO Lite) |
| uBlock Origin availability | Full | **Full** (natively installable from AMO since Dec 2023) | uBO **Lite** only |
| SponsorBlock | Full | **Full** (AMO, since Dec 2023) | Full |

**Firefox is the single best platform for YouTube ad blocking in 2026** precisely because it retained the MV2 blocking webRequest / response-rewriting capabilities that the `$replace=` filters and uBO's engine rely on. This is a genuine differentiator and supports the strategic point: our extension's users are already on the one browser where uBO works best — so lean on uBO, don't duplicate it.

**Mobile caveats:**
- `m.youtube.com` (mobile web) is a distinct surface with its own DOM and is explicitly targeted by uAssets rules (see the `m.youtube.com,...` domain lists in `filters.txt:35-47`). Our own content-script matches would need `*://m.youtube.com/*` if we ever touched mobile.
- The YouTube **Android app** is out of scope for any browser extension. App-level ad removal (ReVanced/SmartTube) is a separate ecosystem and not something we can or should touch.
- Firefox Android performance: heavy per-request scriptlet work has more overhead on mobile; another reason to defer to the optimized uBO engine.

---

## 6. What it would take for our extension — recommendation

### 6.1 Where our extension stands today
- MV2, background page `js/global.js`, `permissions: ["tabs","webRequest","*://*/*","webRequestBlocking","storage"]` (`manifest.json:14`).
- It already uses blocking `webRequest.onBeforeRequest` — but only to **strip the video track** for audio-only mode: `processRequest` matches `mime=audio` URLs and messages the content script (`js/global.js:33-43,52-54`). It does **not** touch ads at all (confirmed: an ad plays untouched).
- Content script runs at `document_start` on `*.youtube.com` and `*.youtube-nocookie.com` (`manifest.json:18-26`). Note: `music.youtube.com` and `m.youtube.com` match `*.youtube.com`, so we already inject there.

### 6.2 What a DIY ad blocker would actually require
To replicate even the *core* of what works, we would need to build and then **forever maintain**:
1. A **scriptlet-injection pipeline** that runs privileged JS in the page context at `document_start` (uBO uses a dedicated, security-hardened mechanism; naive `<script>` injection has CSP and timing pitfalls).
2. A `json-prune`-equivalent that proxies `JSON.parse` and walks/deletes `adPlacements`/`playerAds`/`adSlots` (port of `object-prune.js` + `json-prune.js`).
3. A `set-constant`-equivalent for `ytInitialPlayerResponse.*` inline stripping.
4. Response-body rewriting for `/youtubei/v1/player` and `/get_watch` (fetch/XHR proxy or `webRequest` filterResponseData — Firefox-only API).
5. The **anti-adblock/SABR counter-scriptlet** — the `serverContract` monster (`quick-fixes.txt:24`) — including user-agent spoofing, `onAbnormalityDetected` neutralization, and SSAP seek-past. **This alone changes every few days.**
6. Outgoing-request mutation (`clientScreen`, `params`) tuned to undocumented server behavior.
7. A **filter-update delivery channel** so we can hot-fix without shipping a new signed extension version each time (uBO downloads `quick-fixes.txt` every few hours; we would need equivalent remote-config infrastructure, itself a liability).

Every one of these items is a moving target maintained today by a team with deep YouTube reverse-engineering expertise and a rapid release cadence. **A personal/solo extension cannot match that cadence, and a stale copy actively breaks playback** (black screens, "video unavailable," detection-loop reloads) — which is a far worse user experience than simply showing ads.

### 6.3 Recommendation: DEFER (coexist), with an optional thin "skip" convenience

**Primary recommendation — do NOT build a blocker; position as complementary to uBO + SponsorBlock.**
- The extension's differentiated value is **audio-only YouTube/YouTube Music streaming** (battery/bandwidth). That is a clean, defensible niche uBO does not cover.
- Document and encourage the pairing: *"For ad-free playback, install uBlock Origin; for sponsor-segment skipping, install SponsorBlock. YouTube Audio works alongside both."* This delivers the "one-stop-shop" outcome via composition, on Firefox where those tools work best, with **zero ongoing ad-arms-race maintenance for us**.
- Verify we don't *interfere* with uBO (our audio-only URL rewriting should be checked for conflicts with uBO's response rewriting — a concrete, bounded QA task).

**If product still wants some in-house ad relief, the only defensible option is a small, clearly-labeled auto-skip helper — not a blocker:**
- A content-script that clicks YouTube's native **"Skip Ad"** button when it appears, and/or seeks a detected skippable ad region. This is *skipping*, honestly labeled, not blocking. It degrades gracefully (if the selector changes, it just does nothing — it does **not** break playback).
- Maintenance is limited to a couple of DOM selectors/ARIA labels, not the full JSON-surgery + anti-detection stack. Still non-zero (YouTube renames classes), but bounded and low-risk.
- It will **not** remove unskippable pre-rolls or SABR-stitched ads, and it will not stop the "you're using an ad blocker" prompts (it isn't detected as a blocker because it doesn't strip anything). Be honest about that in the UI.

**Do not** attempt to fork/vendor uBO's YouTube rules into our extension. They are engine-coupled (they call uBO scriptlet names and rely on uBO's injection/response-rewrite plumbing), and detached from uBO's update channel they will rot within days.

### 6.4 If we ever revisit blocking
Only reconsider a real blocker if (a) we are prepared to staff continuous maintenance, and (b) we build the remote filter-update channel first. Even then, SABR's trajectory means the ceiling on client-side blocking is falling. The rational long-term bet is **coexistence + audio-only excellence**, not entering the ad arms race.

---

## References

### Repositories cloned and read (commit hashes)
- **gorhill/uBlock** (uBlock Origin) — `697b2f1099a97f7ffb5bf1ccd346822509f51527`
  - `src/js/resources/json-prune.js`, `object-prune.js`, `set-constant.js`, `prevent-fetch.js`, `json-edit.js`, `scriptlets.js`
  - `src/js/redirect-resources.js`; `src/web_accessible_resources/google-ima.js`
- **uBlockOrigin/uAssets** (filter lists) — `cccd0e0067154c46b346b1243aeddc2f99210ba6`
  - `filters/filters.txt` (canonical YouTube section, lines 11-47)
  - `filters/quick-fixes.txt` (live front-line YouTube rules, lines 20-94)
- **ajayyy/SponsorBlock** — `4a118fb45d3476d681fba5c44d40a5c911107975`
  - `config.json.example`, `src/config.ts`, `src/utils/segmentData.ts`

### Web sources (2025-2026 state; accessed 2026-07-11)
**SABR / server-side ads / arms race (primary-ish, reverse-engineering):**
- iter.ca, "YouTube's new anti-adblock measures" (SABR, fake-buffering backoff, `isInlinePlaybackNoAd`), 2025-06-20 — https://iter.ca/post/yt-adblock/
- 9to5Google, "YouTube looks to be testing server-side ad injection to counter ad blockers," 2024-06-12 — https://9to5google.com/2024/06/12/youtube-ad-injection/
- ghacks.net, "Google is testing server-side ads that break ad blockers," 2024-06-13 — https://www.ghacks.net/2024/06/13/seeing-ads-on-youtube-google-is-testing-server-side-ads-that-break-adblockers/
- yt-dlp issue #12482, "[youtube] `web` only has SABR formats," 2025-02-26 — https://github.com/yt-dlp/yt-dlp/issues/12482
- yt-dlp Wiki, "PO Token Guide" (edited 2026-03-10) — https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- uBlockOrigin/uBlock-issues Discussion #3322, "YouTube new Ad Policy" — https://github.com/uBlockOrigin/uBlock-issues/discussions/3322

**Anti-adblock timeline (three-strikes, 2023):**
- Android Authority, "YouTube confirms three-strikes test" (2023) — https://www.androidauthority.com/youtube-confirm-three-strikes-policy-ad-blocking-test-3340826/
- XDA, "YouTube begins cracking down on ad blockers" (2023) — https://www.xda-developers.com/youtube-adblocker-crackdown/

**Manifest V2/V3 + Firefox commitment + Android extensions:**
- Mozilla Add-ons blog, "Manifest V3 & Manifest V2 (March 2024 update)" — https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/
- Mozilla, "Firefox's approach to Manifest V3 / ad blockers" — https://blog.mozilla.org/en/products/firefox/firefox-manifest-v3-adblockers/
- Chrome for Developers, "Manifest V2 support timeline" (official, updated 2026-07-08) — https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- BleepingComputer, "Firefox continues Manifest V2 support as Chrome disables MV2 ad blockers" — https://www.bleepingcomputer.com/news/security/firefox-continues-manifest-v2-support-as-chrome-disables-mv2-ad-blockers/
- Mozilla blog, "New extensions now available on Firefox for Android" (450+, 2023-12-14) — https://blog.mozilla.org/en/mozilla/new-extensions-youll-love-now-available-on-firefox-for-android/
- uBlock Origin on Firefox Android (AMO) — https://addons.mozilla.org/en-US/android/addon/ublock-origin/

**SponsorBlock:**
- API docs — https://wiki.sponsor.ajay.app/w/API_Docs ; FAQ ("Can't it just skip YouTube's ads?") — https://wiki.sponsor.ajay.app/w/FAQ ; public API base — https://sponsor.ajay.app

### Lowest-confidence claims (flagged honestly)
- Exact meaning/format of the `"SSAP, AD"` debug_info token: the **string is code-verified** in uBO's scriptlet; the "Server-Side Ad Playback" expansion is community folklore, unconfirmed by Google.
- Whether true server-side ad *stitching* is universally deployed by mid-2026: reporting says "expanding / test cohorts," not confirmed 100% global.
- Any numeric "uBO vs uBO-Lite effectiveness" figures and Premium-spoof detection mechanics: secondary-source, directional only.

### Our extension (for §6)
- `/Users/kundus/Software/youtube-audio/manifest.json`
- `/Users/kundus/Software/youtube-audio/js/global.js`
