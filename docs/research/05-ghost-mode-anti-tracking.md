# GHOST MODE: Anti-Tracking + Undetectable Modification for YouTube / YouTube Music on Firefox

Research doc for the "YouTube Audio" Firefox WebExtension (MV2). Scope is **strictly** `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com`. Two goals, in tension:

1. **Ghost the user** — make YouTube/Google track the user's watch/listen behavior as little as possible.
2. **Ghost the extension** — make our own modifications as undetectable to YouTube as possible.

…without breaking playback, search, sign-in, or (when signed in) the user's history/library — unless the user explicitly opts into losing those.

All code citations were read from real, shallow-cloned repos (commit hashes in References). Current month: **July 2026**. Where a claim rests on reverse-engineering rather than source, it is flagged.

---

## 1. Executive summary — what "ghost" is realistically achievable (ranked)

Client-side, inside Firefox, we ride the **genuine** YouTube web player. That is our biggest asset and our hardest ceiling.

**Realistically achievable (high confidence, ranked by value/safety):**

1. **Kill interaction & ad telemetry** — block `youtubei/v1/log_event`, `/api/stats/atr`, `/pagead/*`, `play.google.com/log`, and DoubleClick/googlesyndication beacons at the network layer. High value, low breakage risk, invisible to the page when done as a synthetic 204/empty-200. (§2, §7)
2. **Strip tracking params** — remove `si`, `pp`, `gclid`, `feature`, `kw`, `embeds_referring_euri/origin`, `source_ve_path` from URLs and outbound redirect links. Trivial, zero breakage. (§3)
3. **Suppress QoE playback telemetry** — `/api/stats/qoe` heartbeats reveal buffering/format/session detail. Blockable without breaking playback (the player adapts bitrate locally), but uBO ships it **disabled by default** (§2) — offer as an opt-in.
4. **Stay undetectable when patching the page** — use uBO's proven stealth primitives: pristine-native caching, `Function.prototype.toString` spoofing, fake-success responses instead of thrown errors. (§4)

**Partially achievable / opt-in with warnings:**

5. **Stop watch-history heartbeats** (`/api/stats/watchtime`, `/api/stats/playback`, `/ptracking`) — safe for *playback*, but **breaks resume/history/recommendations**, especially when signed in. This is a history-off feature, not a free win. (§5)

**NOT achievable client-side (honest limits):**

6. **True anonymity while signed in.** The account *is* the identity. Cookies (`SAPISID`, `__Secure-*`), server-minted `visitorData`, and IP tie everything together server-side. No client trick undoes that. (§6, §8)
7. **Removing `visitorData` / defeating session correlation** without breaking playback. `visitorData` is bound into the **PoToken / BotGuard attestation** now required for streaming (2025–2026). Strip or rotate it and playback breaks. (§8)

**Bottom line:** The strongest honest "ghost" is **signed-out + network-level telemetry/ad blocking + param stripping + stealthy page patching**. Even then the user remains a *pseudonymous* visitor (IP + fingerprint + `visitorData`). "Ghost while signed in" is a contradiction; we can only reduce *behavioral* logging, not identity.

---

## 2. YouTube / Google telemetry endpoint catalog

Legend: **Safe** = blocking does not break playback/search/sign-in. **History-risk** = safe for playback but degrades watch history / resume / recommendations. **Do-not-block** = breaks core function or attestation.

| Endpoint | What it reports | Verdict | Evidence |
|---|---|---|---|
| `youtubei/v1/log_event` | Catch-all client telemetry: UI interactions, clicks, player events, client state, error logs. Batched JSON. | **Safe** (network-blocked in uBO privacy list) | uAssets `filters/privacy.txt:1162` → `\|\|youtube.com/youtubei/v1/log_event` (active network filter). Also in the (disabled) `no-xhr-if` at `filters/annoyances-others.txt:1522`. |
| `api/stats/qoe` | Quality-of-Experience playback heartbeat: `cpn` (client playback nonce), `docid`, formats (`fmt`/`afmt`), buffering, dropped frames, bitrate switches, bandwidth. POSTed repeatedly during watch. | **Safe for playback, but uBO ships it OFF by default** — treat as opt-in | Disabled rule: uAssets `filters/annoyances-others.txt:1522` `! youtube.com##+js(no-xhr-if, /\/youtubei\/v1\/log_event\?\|play\.google\.com\/log\|\/api\/stats\/qoe\?/)`. The leading `!` = commented out. Cites reddit "youtube tracking in on session" thread on the line above (`:1521`). |
| `api/stats/watchtime` | Periodic watch-time heartbeat: playback position, state, watched segments. Feeds **watch history, resume, retention**. | **History-risk** | Not blocked by uAssets (deliberately). Reverse-engineered params: WebSearch → Xosrov/YouTube-Playback-Metrics, StackOverflow 64900350. |
| `api/stats/playback` | Playback-start beacon (session bootstrap for stats). | **History-risk** | Same family as watchtime; not in uAssets lists. |
| `api/stats/atr` | Ad-telemetry / attribution reporting ("atr"). | **Safe** (ad tracking) | uAssets scriptlet block `filters/privacy-removeparam.txt:1134` (`no-xhr-if` on a precise `atr?...docid` regex); a broad network block was neutralized via `badfilter` in favor of the scriptlet: `filters/quick-fixes.txt:97`. |
| `api/stats/ads` | Ad impression/stat reporting. | **Safe** | ClearURLs `youtube_apiads` provider, `completeProvider: true`, pattern `youtube\.com\/api\/stats\/ads` (fully blocked). |
| `/pagead/*` | Ad serving/tracking requests. | **Safe** | ClearURLs `youtube_pagead` provider, `completeProvider: true`, pattern `youtube\.com\/pagead`. |
| `play.google.com/log` | Google-wide event logging (Play/Google telemetry, not YT-playback-critical). | **Safe** for YT context | In the disabled `no-xhr-if` group, uAssets `filters/annoyances-others.txt:1522`. |
| DoubleClick / googlesyndication / `pubads.g.doubleclick.net` / `s0.2mdn.net` / `static.doubleclick.net` beacons | Ad delivery + impression beacons. | **Safe** | Host enumeration in `trusted-prevent-fetch` list, uAssets `filters/filters.txt:557` (block set includes `googleads.g.doubleclick.net pubads.g.doubleclick.net static.doubleclick.net googlesyndication.com s0.2mdn.net youtube.com ytimg.com`). |
| `/generate_204`, `/csi_204` | 204-No-Content connectivity / CSI (client-side-instrumentation) latency probes. | **Leave alone / block only cautiously** | **Not** in uAssets YT rules. Low tracking value; used as functional connectivity/timing probes → a candidate signal for behavioral adblock detection. |
| `/ptracking` | Older playback tracking / heartbeat. | **History-risk, unverified in 2026 lists** | No active uAssets rule found. Historically tied to view-count/history. Do not block blind. |
| `youtubei/v1/att/get`, `att/esp`, `…/GenerateIT` | **BotGuard attestation** → mints the **PoToken** (proof-of-origin) now required for playback & captions. | **DO NOT BLOCK** | WebSearch 2025–2026: PoToken/BotGuard enforced for web playback; missing/invalid token → 403/empty streams (piunikaweb 2025-09-25; pytubefix PoToken docs; rustypipe-botguard). Blocking breaks playback **and** is a loud detection trigger. |
| `youtubei/v1/{player,next,browse,search,guide}` | Core InnerTube app API (the site itself). | **DO NOT BLOCK** | Blocking breaks the app. Only *prune fields* from responses (§4), never cancel the request. |

**Key nuance — why uBO does NOT ship the qoe/log_event scriptlet block by default:** the `no-xhr-if` line at `annoyances-others.txt:1522` is deliberately commented. The safer, shipped rule is the *network-level* `log_event` block (`privacy.txt:1162`) which drops the request pre-flight, plus the surgical `atr` scriptlet. `qoe` blocking is left to the user because it is playback-adjacent. Our extension should mirror this: **log_event/atr/ads = default on; qoe = opt-in; watchtime/playback = opt-in and clearly labeled "turns off history".**

---

## 3. Tracking-param & beacon stripping

### 3.1 URL parameters to strip (verified against real rules)

| Param | Meaning | Source rule |
|---|---|---|
| `si` | Share/source identifier (per-share tracking token) | uAssets `privacy.txt:1612–1616` (`removeparam=si` on `/shorts/`, `/@`, `/post/`, `/live/`); `privacy-removeparam.txt:1033–1034`; ClearURLs `youtube` provider `rules:[…,'si',…]` |
| `pp` | Player params blob (can carry context) | uAssets `privacy.txt:1607` `\|\|youtube.com^$removeparam=pp`; `privacy-removeparam.txt:2008`; ClearURLs `'pp'` |
| `feature` | Referral/feature source (`feature=share`, `feature=youtu.be`, …) | ClearURLs `youtube` provider `'feature'` |
| `gclid` | Google Click ID (cross-site ad attribution) | ClearURLs `youtube` provider `'gclid'` |
| `kw` | Keyword tracking | ClearURLs `youtube` provider `'kw'` |
| `embeds_referring_euri` | Encoded referring URL for embeds | uAssets `privacy-removeparam.txt:2005` (`to=youtubekids.com\|youtube-nocookie.com\|youtube.com`) |
| `embeds_referring_origin` | Referring origin for embeds | uAssets `privacy-removeparam.txt:2006` |
| `source_ve_path` | Visual-element navigation path (tells YT how you got there) | uAssets `privacy-removeparam.txt:2007` |
| `attribution_link` | Attribution redirect | uAssets `privacy.txt:2325` `.youtube.com/attribution_link?$image` |

ClearURLs `youtube` provider regex: `^https?:\/\/(?:[a-z0-9-]+\.)*?(youtube\.com|youtu\.be)`, `rules: ["feature","gclid","kw","si","pp"]`.

### 3.2 Outbound-link / redirect sanitizing (description links)

YouTube wraps external links in a tracking redirect. uBO rewrites them client-side:

- `filters/privacy.txt:1812` — `href-sanitizer, a[href^="https://www.youtube.com/redirect?event=video_description"][href*="&q=http"], ?q` (rewrite the anchor to its real `q=` target).
- `filters/privacy.txt:1813` — `\|\|youtube.com/redirect?*^q=http$urlskip=?q +https` (network-level unwrap of the redirect).

### 3.3 Beacon stripping without breaking function — the two mechanisms

1. **Network cancel / synthetic 204 (Firefox `webRequestBlocking`).** Drop the beacon before it leaves. Best for **fire-and-forget** beacons whose result the page ignores (`navigator.sendBeacon`, `fetch(..., {keepalive:true})` with an unread promise). The page never observes anything. This is the stealthiest option and is the entire reason MV2 blocking `webRequest` matters (§7).
2. **Fake-success page script (`no-fetch-if` / `no-xhr-if` style).** For beacons whose *failure is observed* (an `xhr.onerror`, a rejected `fetch().then()` that increments an error counter), return a fabricated `200/OK` instead. uBO's `prevent-fetch` does exactly this (§4.2) rather than throwing.

---

## 4. Stealth: how YT detects modification, and how to stay invisible

### 4.1 Detection surface (2025–2026, from reports + code behavior)

- **Error beacons / ad-error counters.** The player expects ad requests; when they fail or ad slots are missing, it can increment an error counter and beacon home. → **Never let a blocked request surface as an error.** Return fake success.
- **Integrity / tamper checks.** Pages re-read native functions and compare `fn.toString()` to `"[native code]"`, or re-fetch pristine `fetch`/`XMLHttpRequest` from an `<iframe>`. → **Spoof `toString`; cache and use pristine natives; don't rely on your patch surviving a re-read.**
- **Timing / behavioral correlation.** "Video plays perfectly but ad/stats endpoints were never requested" is itself a signal. → Blocking *ads* is inherently detectable in principle; blocking *stats* less so. Prefer synthetic-success over hard-cancel where a response is read.
- **DOM-mutation observation.** Heavy DOM ripping (removing player-ad containers, reordering nodes) is observable via `MutationObserver`. → Prefer **data-layer** edits (mutate `ytInitialPlayerResponse` / prune JSON responses) over DOM surgery, and do them **before** the player reads them (`document_start`).

> Caveat: some circulating "detection endpoints" (e.g. `youtubei/v1/player/ad_*`) surfaced in a WebSearch summary are **not** verifiable in real traffic and look confabulated — do not code against them. The verifiable detection levers are the four above.

### 4.2 uBO's real stealth primitives (read these; they are the state of the art)

**(a) `Function.prototype.toString` spoofing so a wrapped native still looks native.**
`uBlock/src/js/resources/proxy-apply.js:90–103` installs a proxied `Function.prototype.toString`. When the page calls `fetch.toString()` (where `fetch` is our `Proxy`), the trap walks a `WeakMap` of proxy→original and returns the **original native's** string (`function fetch() { [native code] }`), defeating the `.includes('[native code]')` tamper check. The wrapped target itself is installed at `:118–120` as `new Proxy(fn, …)` so behavior is intercepted while identity looks pristine.

```
proxyApplyFn.nativeToString = Function.prototype.toString;                 // :90
const proxiedToString = new Proxy(Function.prototype.toString, {           // :91
  apply(target, thisArg) {
    let proxied = thisArg;
    for(;;){ const fn = proxyApplyFn.proxies.get(proxied);                 // unwrap chain
             if (fn === undefined) break; proxied = fn; }
    return proxyApplyFn.nativeToString.call(proxied);                      // native string
  }
});
Function.prototype.toString = proxiedToString;                            // :103
```

**(b) Fake-success instead of thrown error.**
`uBlock/src/js/resources/prevent-fetch.js:94–112`: a matched (blocked) `fetch` resolves with a fabricated `new Response(text, {headers})` carrying a real `content-length`, `url`, `statusText:'OK'`, and a valid `type` (`prevent-fetch.js:52–60`, `:100–105`). The caller's `.then()` runs normally; no rejection, no `onerror`, no error counter. This is the single most important stealth behavior for telemetry suppression.

**(c) Native-looking constant/function cloaking.**
`uBlock/src/js/resources/set-constant.js:104–128` `cloakFunc`: wraps noop/true/false stubs in a `Proxy` whose `get` trap returns `function <name>() { [native code] }` for `toString` (`:120–123`), sets `.name` to the real property (`:105`), and blocks redefinition/deletion of `toString` (`:107–118`). So `stub.toString()` and `stub.name` both look genuine.

**(d) Pristine-native caching (`safeSelf`).**
`uBlock/src/js/resources/safe-self.js:30–66` snapshots `fetch`, `XMLHttpRequest`, `JSON.parse/stringify`, `Object.defineProperty`, `Response.clone`, `RegExp.test`, etc. **at injection time**. Even if the page later overwrites these (to sabotage or detect blockers), our scriptlet keeps using the originals. Robustness **and** stealth.

**(e) Data-layer ad/field removal (mutate before read).**
uBO strips ads by editing the response data, not the DOM: `set` on the parsed object at `document_start` — `filters/filters.txt:35–38` (`##+js(set, ytInitialPlayerResponse.playerAds, undefined)`, `.adPlacements`, `.adSlots`), and `json-prune` / `json-prune-fetch-response` / `json-prune-xhr-response` on live InnerTube responses — `filters/filters.txt:40, 46–56`. Same technique applies to telemetry-relevant fields.

### 4.3 Applying this to *our* page script

- Inject into the **page world** (not the isolated content-script world) at `document_start`, because YT's own JS is what reads `ytInitialPlayerResponse` and calls `fetch`.
- Wrap `fetch` / `XMLHttpRequest` / `navigator.sendBeacon` with the **proxy-apply pattern** (toString-spoofed), and for matched telemetry URLs return **synthetic success**, never throw.
- Cache pristine natives à la `safeSelf` before wrapping.
- For audio-only, drive playback via the **player/media element API**, not DOM removal, to minimize `MutationObserver`-visible churn (§8).

---

## 5. Signed-in safety: safe vs risky to block

**Safe to block even when signed in** (no auth cookies, no library APIs touched; purely behavioral/ad telemetry):
- `youtubei/v1/log_event`, `/api/stats/atr`, `/api/stats/ads`, `/pagead/*`, `play.google.com/log`, DoubleClick/googlesyndication beacons.
- Param stripping (`si`, `pp`, `gclid`, `feature`, `kw`, `embeds_referring_*`, `source_ve_path`).
- `/api/stats/qoe` (opt-in): playback still works; you lose only YT's QoE diagnostics.

**Risky when signed in — this is a "turn off history" feature, not a free win:**
- `/api/stats/watchtime`, `/api/stats/playback`, `/ptracking`. Blocking these **stops watch history from recording**, breaks *resume where you left off* and "watched" progress bars, and starves history-based recommendations and **YT Music listening history / automixes**. Only enable behind an explicit toggle that says so. (Alternatively, point the user at YouTube's own *Pause watch history* — same privacy effect, zero breakage, and no detectable client tampering.)

**Dangerous — do not touch when signed in (or ever):**
- `youtubei/v1/att/*` / `GenerateIT` (BotGuard/PoToken) → breaks playback + attestation.
- Core `youtubei/v1/{player,next,browse,search}` requests → breaks the app.
- Auth cookies (`SAPISID`, `__Secure-3PAPISID`, `LOGIN_INFO`, `HSID/SSID`) and the `Authorization`/`X-Goog-*`/`Origin` headers on InnerTube POSTs → breaks sign-in and library writes. **Never strip `Origin` on `youtubei` POSTs; YT validates it.**
- `visitorData` → bound into PoToken; removing/rotating breaks playback (§8).

**Design rule:** ghost features must be **request-scoped to telemetry/ad endpoints**, never applied to auth-bearing app requests. A blanket "strip cookies/headers on `*.youtube.com`" would nuke the account.

---

## 6. Firefox desktop + Android specifics

- **MV2 blocking `webRequest` is fully supported in Firefox in 2026** (Mozilla commits to ≥12 months' notice before any change), while Chrome has completed the MV3/`declarativeNetRequest` transition and dropped MV2 blocking. Confirmed via WebSearch (blog.mozilla.org MV3 posts; 2026 ecosystem write-ups). **This is our platform advantage: we can drop telemetry pre-flight, which the page cannot observe** — a stealth level MV3 DNR can't match for synthetic-response behavior. Our `manifest.json` already declares `webRequest`, `webRequestBlocking`, `storage`, `tabs`, `*://*/*` — everything ghost mode needs.
- **Scope host permissions down.** For a razor-focused tool, narrow `*://*/*` toward `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*`, `*://music.youtube.com/*`, `*://m.youtube.com/*` (plus the beacon hosts you must see: `play.google.com`, `*.doubleclick.net`, `*.googlesyndication.com`). Smaller surface = fewer AMO review flags and less user-facing scariness.
- **Firefox for Android runs content scripts and blocking `webRequest`** (unlike Chrome Android, which has no extensions on stable). So `m.youtube.com` and `music.youtube.com` mobile are in reach.
- **Mobile background/visibility trick (directly relevant to audio-only + ghost):** m.youtube pauses on tab-hide. uBO neutralizes it: `filters/annoyances-others.txt:1527` `m.youtube.com##+js(aeld, visibilitychange, /bgmobile|…/)` (swallow the `visibilitychange` listener) and `:1528` `m.youtube.com##+js(trusted-set, document.visibilityState, json:"visible")` (force `visibilityState`). Use the same to keep audio alive on Android without a Premium signal. Note m.youtube uses a different player (`ytm-`) and DOM than desktop — separate selectors/logic.
- **`resistFingerprinting` (arkenfox context):** RFP reduces entropy (canvas, timezone, screen), which *helps* ghosting but **can break YouTube** (spoofed timezone, letterboxing, canvas readback). Do **not** force RFP from the extension; at most document it as a user-level Firefox hardening tip. Same for `network.cookie.cookieBehavior`/dFPI — beneficial but out of extension scope and can break sign-in if over-tightened.
- **`youtube-nocookie.com`:** privacy-embed host; fewer cookies but still emits `log_event`/`qoe`. Our rules must include it (uAssets consistently lists it alongside the others, e.g. `filters.txt:35–47`).

---

## 7. Why network-layer blocking is the stealth core (and its limit)

- **Strength:** a request dropped in `webRequest.onBeforeRequest` never reaches page JS as a *patched function*. `window.fetch` stays pristine — `fetch.toString()` is genuinely native, no proxy, nothing to detect. For fire-and-forget beacons (`sendBeacon`, unread `keepalive` fetch), the page observes **nothing**.
- **Limit:** if the page *reads the result* of a request we cancel, cancellation surfaces as a network error the page can see (rejected promise / `xhr.status===0`). So for observed telemetry, don't hard-cancel — either `redirect` to a `data:`/synthetic 204, or let the page script return fake-200 (§4.2b). Best practice: **hard-cancel the fire-and-forget beacons at the network layer; fake-success the observed ones in the page script.** Belt and suspenders.
- `navigator.sendBeacon` and `fetch({keepalive:true})` are both interceptable by Firefox `webRequest`.

---

## 8. Honest trade-offs & the client-side ceiling

- **Signed in = identified. Full stop.** The account cookie *is* the identity; server-side, YT correlates every request by it regardless of what beacons we drop. Client-side ghosting while logged in only reduces *behavioral granularity* (which clicks/how long), not *who*. Be honest in the UI: "reduces tracking," not "anonymous."
- **`visitorData` is server-minted and load-bearing.** It arrives in `ytcfg`/`ytInitialData` and is **bound into the PoToken** that playback now requires (BotGuard, 2025–2026). We cannot forge, blank, or rotate it without breaking streaming. So the pseudonymous signed-*out* identifier is effectively unremovable if you want video/audio to play. This is the hard ceiling on "session correlation" defeat.
- **PoToken/BotGuard means we must ride the real player.** Downloaders (yt-dlp et al.) must reverse-engineer and mint PoTokens; **we don't** — the genuine in-page player mints them for us. That's a stealth *advantage* (we look 100% like the real client) but also a *constraint*: we can't strip the attestation flow or spoof the client, or we lose the very thing that makes us undetectable.
- **Ads vs stats detectability asymmetry.** Never requesting ads while playing video is intrinsically detectable in principle (behavioral). Suppressing *stats/telemetry* is far less detectable because stats have no visible product effect. If the product is audio-only + privacy (not necessarily ad-blocking), we sit in the *lower-detection* zone by design.
- **Audio-only is itself observable.** Pausing/disabling the video track or forcing lowest video quality is visible to page JS (media element state, quality API). Minimize by using the player API rather than DOM removal, but accept it can't be perfectly hidden. Fortunately it isn't something YT actively hunts for (it's not ad-blocking).
- **IP + fingerprint remain.** No client extension changes the source IP or the TLS/HTTP/browser fingerprint. Network-level ghosting (VPN/Tor) and browser hardening (RFP) are *out of our scope* and belong to the user. Say so.
- **Cat-and-mouse.** Any page-script patch or filter can be broken by a YT update. Network-level telemetry blocks (endpoint URLs) are the **most durable** because the endpoints change rarely; DOM/JSON-shape patches are the **most fragile**. Bias ghost mode toward endpoint-level rules.
- **k-anonymity is the gold standard for any *own* server calls** — but we have none. SponsorBlock, when it must query a server, sends only a **4-char SHA-256 prefix** of the video ID so the server never learns the exact video: `SponsorBlock/src/utils/segmentData.ts:62–64` (`getHash(videoID,1).slice(0,5)` → `/api/skipSegments/<prefix>`). Design principle to keep: **our extension should make zero outbound calls of its own.** Ghosting is worthless if we become the tracker. Keep everything local.

---

## 9. Concrete recommendation for OUR extension — a prioritized "Ghost" feature set

Ghost mode should be a small, mostly-network, **YouTube-scoped** subsystem layered on our existing MV2 blocking `webRequest`. All state local; zero outbound calls of our own.

### Tier 1 — Default ON (safe, high value, near-zero breakage)
1. **Telemetry/ad network blocker** (`onBeforeRequest`, YT tabs only): cancel or synthetic-204
   `youtubei/v1/log_event`, `/api/stats/atr`, `/api/stats/ads`, `/pagead/`, `play.google.com/log`, and the DoubleClick/googlesyndication beacon hosts. Prefer redirect-to-204 over `{cancel:true}` so nothing surfaces as an error.
   *Risk:* negligible. Mirrors uBO's shipped `privacy.txt:1162` + ClearURLs `completeProvider` blocks.
2. **Tracking-param stripper**: on YT navigations strip `si, pp, gclid, feature, kw, embeds_referring_euri, embeds_referring_origin, source_ve_path` (webRequest redirect); rewrite `youtube.com/redirect?…q=http…` outbound links to their real target in the content script (`href-sanitizer` pattern).
   *Risk:* none.

### Tier 2 — Opt-in (labeled, medium)
3. **QoE suppression** toggle (`/api/stats/qoe`): default OFF, matching uBO. Playback unaffected; kills the richest playback heartbeat.
4. **"Don't record history" mode** (`/api/stats/watchtime`, `/api/stats/playback`, `/ptracking`): default OFF, labeled *"Stops YouTube from saving what you watch — also disables resume & history-based recommendations."* Recommend YT's native *Pause history* as the zero-breakage alternative.
5. **Page-world fake-success shield** for any of the above that the page *reads*: inject at `document_start` into the page world, wrap `fetch`/`XHR`/`sendBeacon` with the **proxy-apply toString-spoof** pattern and return fabricated `200/OK` for matched telemetry URLs (never throw). Cache pristine natives first (`safeSelf` pattern).

### Tier 3 — Stealth polish (low, but this is the "undetectable" half of the mandate)
6. **Undetectable player control:** implement audio-only via the player/media API, not DOM ripping; cache pristine natives; spoof `toString`/`name` on anything we patch; never let a patch throw an observable error.
7. **Signed-out "incognito-ish" toggle:** optionally open YT in a way that avoids sending the account cookie for pure-listening sessions (e.g., a container-style separation) — document that this is the *only* real path to non-identified use, and that it disables the user's library by definition.
8. **Scope down host permissions** in `manifest.json` from `*://*/*` to the YT hosts + required beacon hosts.

### Risk register
| Feature | Breakage risk | Detection risk | Mitigation |
|---|---|---|---|
| log_event/atr/ads/pagead block | Very low | Low (stats have no visible effect) | synthetic-204, YT-scope only |
| param stripping | None | None | — |
| qoe block | Low (playback fine) | Low | opt-in |
| watchtime/playback block | **Medium** (history/resume/recos) | Low | opt-in, clear label, suggest native Pause-history |
| page-world fetch patch | Low | **Medium** if naïve | proxy-apply toString spoof + fake-200 + pristine natives |
| audio-only control | Low | Low–Medium (observable state) | use player API, minimize DOM churn |
| touching att/PoToken/auth | **Breaks playback/sign-in** | High | **never do it** |

---

## 10. References

**Cloned repos (shallow, July 2026):**
- uBlockOrigin/uAssets — commit `cccd0e0067154c46b346b1243aeddc2f99210ba6`
  - `filters/privacy.txt:1162` (log_event network block), `:1607/:1612–1616` (si/pp removeparam), `:1812–1813` (redirect href-sanitizer/urlskip), `:2325` (attribution_link)
  - `filters/privacy-removeparam.txt:1033–1034` (si), `:1134` (atr no-xhr-if), `:2004–2008` (embeds_referring_*/source_ve_path/pp)
  - `filters/annoyances-others.txt:1521–1522` (disabled qoe/log_event/play.google.com/log no-xhr-if + reddit cite), `:1527–1528` (m.youtube visibilitychange/visibilityState)
  - `filters/quick-fixes.txt:97` (atr network block `badfilter`)
  - `filters/filters.txt:35–56` (ytInitialPlayerResponse `set`/`json-prune` ad-field removal), `:557` (trusted-prevent-fetch ad-host set)
- gorhill/uBlock — commit `697b2f1099a97f7ffb5bf1ccd346822509f51527`
  - `src/js/resources/proxy-apply.js:90–103` (Function.prototype.toString spoof), `:118–120` (Proxy install)
  - `src/js/resources/prevent-fetch.js:52–60, 94–112` (fake-success Response instead of throw; `no-fetch-if` alias `:156`)
  - `src/js/resources/set-constant.js:104–128` (cloakFunc native-looking stub)
  - `src/js/resources/safe-self.js:30–66` (pristine-native caching)
- ClearURLs/Rules — commit `11086f40512774dcadef54079f1ba023bfacf940`
  - `data.min.json` providers: `youtube` (`rules:["feature","gclid","kw","si","pp"]`), `youtube_pagead` (`completeProvider:true`, `youtube\.com\/pagead`), `youtube_apiads` (`completeProvider:true`, `youtube\.com\/api\/stats\/ads`)
- ajayyy/SponsorBlock — commit `4a118fb45d3476d681fba5c44d40a5c911107975`
  - `src/utils/segmentData.ts:62–64` (4-char SHA-256 hash-prefix k-anonymity, local-only privacy design)

**Web sources (2025–2026 verification):**
- PoToken / BotGuard playback requirement: https://piunikaweb.com/2025/09/25/youtube-token-checks-third-party-issues/ ; https://pytubefix.readthedocs.io/en/latest/user/po_token.html ; https://docs.rs/rustypipe-botguard ; https://dev.to/jamhimself/why-your-youtube-transcript-scraper-started-returning-empty-strings-and-how-to-fix-it-in-2026-20ed
- Firefox MV2 blocking webRequest retained in 2026: https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/ ; https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/
- qoe/watchtime param reverse-engineering: https://stackoverflow.com/questions/64900350/youtube-api-stats-qoe-metrics ; https://github.com/Xosrov/YouTube-Playback-Metrics
- Session tracking discussion behind uBO's disabled rule: https://www.reddit.com/r/uBlockOrigin/comments/1e6wrjx/youtube_tracking_in_on_session/

**Our extension:** `/Users/kundus/Software/youtube-audio/manifest.json` (MV2; `webRequest`+`webRequestBlocking`+`storage`+`tabs` already present; content script `js/youtube_audio.js` at `document_start` on youtube.com/youtube-nocookie.com).

_Note on honesty: some circulating "YouTube detection endpoint" names from generic web summaries could not be verified in real code/traffic and were excluded. Every endpoint and filter-syntax claim above is grounded in cited source or flagged as reverse-engineered._
