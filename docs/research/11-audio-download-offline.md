# Audio Download & Offline Playback — Feasibility (YouTube + YouTube Music, Firefox extension)

Research stream 11 for the **YouTube Audio** Firefox WebExtension (MV2 today). North star: a razor-focused **one-stop tool for YouTube + YouTube Music** — simple for the end user, powerful on demand. Sites in scope only: `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com`. Platforms: Firefox **desktop + Android**. Licensing is out of scope by direction; account-ban risk is treated as a real design constraint. "Ghost" posture preferred.

_Last updated: 2026-07-11. Freshness matters: YouTube's media stack (SABR / PO-token / `n`) is actively changing. Treat every "works today" claim as perishable, not permanent._

Builds directly on:
- **doc 04** (`04-youtube-streaming-internals.md`) — SABR/UMP transport, PO-token/`n`/signature gates. Assumed, not re-derived.
- **doc 01** (`01-disable-video-audio-only.md`) — the audio-only acquisition path (page-context InnerTube `ANDROID_VR` re-fetch → direct URL → `<video>.src` swap), grounded in the shipping `ytop-mv3` extension. **This is the load-bearing prior result for download**, as explained below.

---

## Executive summary

**Yes — in-browser audio download is feasible in 2026, and it is nearly a free rider on the audio-only feature we are already going to build.** The verdict is more optimistic than doc 04's framing implied, and the reason is a nuance doc 04 under-weighted:

- doc 04 said yt-dlp "only downloads by impersonating a non-browser client (`android_vr`) — an escape hatch **not** available to our in-browser extension." That is true for fetching `googlevideo` **directly out-of-band** (which needs a self-minted PO token + `n`/sig). It is **not** true for the **page-context** path. YouTube's InnerTube endpoint keys client identity off the **JSON request body** (`context.client.clientName/clientVersion`), not the (unforgeable) `User-Agent` header, and `ANDROID_VR` is currently **PO-token-exempt**. So a same-origin `fetch('/youtubei/v1/player')` from inside the YouTube tab, with an `ANDROID_VR` body, **does** return direct, un-SABR'd audio URLs — the exact thing yt-dlp gets, obtained from the browser. A real shipping Firefox extension (`ytop-mv3`) does this today for playback (doc 01).

- **Download = the same acquisition, a different sink.** Once we have that direct audio-itag URL (itag 140 AAC or 251 Opus), streaming means `<video>.src = url`; **downloading means `fetch(url)` → Blob → save.** The only new plumbing is a background-script fetch (needed because the media lives on `*.googlevideo.com`, a cross-origin host — see CORS below) plus optional trivial container handling. **A single audio-only stream concatenates into a playable `.m4a`/`.webm` with little or no remuxing.**

**Recommended approach (ranked #1):** ship download as an extension of the doc-01 `ANDROID_VR` path — one acquisition mechanism, two outputs (play / save). Target **YouTube Music first** (audio-first, cleanest). **Robustness is medium and trending down**: it rests entirely on `ANDROID_VR` staying SABR/PO-token-exempt, and on `signatureCipher`/`n` staying tractable — both of which Google is visibly tightening.

**Robustness backstop (phase 2):** hook `SourceBuffer.appendBuffer` and **harvest the audio segments the page's own player already decodes** (approach b). This is orthogonal to `ANDROID_VR` — it keeps working even if Google kills the client-impersonation hole, because it rides the page's real player (which always has a valid PO token / `n` / sig). It is lossless but slower (needs a near-real-time playthrough) and needs light demux/remux. Build it only if/when approach (a) degrades.

**Avoid:** `captureStream` + `MediaRecorder` (approach c) — lossy re-encode, real-time-only, flaky Firefox support, and blocked outright on the rare EME/DRM title.

Bottom line for a single-dev, single-user tool: **ship approach (a) as a natural companion to audio-only, YT-Music-first; keep approach (b) designed-for but unbuilt as the strategic backstop.** Do not defer — the value/effort ratio is high precisely because the hard part (acquisition) is already being built for the audio-only feature.

---

## Why the download problem ≈ the audio-only problem

doc 01's recommended audio-only mechanism already produces the one thing a downloader needs: a **direct, playable audio URL**. Its pipeline (grounded in `ytop-mv3`, commit `5747b5719ef5e8286dd6ba380741f069e0373d29`):

1. On each new video, POST `https://www.youtube.com/youtubei/v1/player` (or `m.youtube.com`) from **page context**, `credentials:'include'`, with an `ANDROID_VR` `context.client` (pinned `clientVersion '1.65.10'`, Oculus Quest 3), falling back to `ANDROID` for restricted videos — `ytop-mv3/js/yt.js:133-244`.
2. Parse `streamingData.adaptiveFormats`, filter to audio itags, pick one (prefer 251/140; 250/249 for lowest bandwidth) — `ytop-mv3/js/yt.js:687-802`.
3. For playback: `videoElement.src = <audio itag url>` with a pause/seek/resume dance — `ytop-mv3/js/yt.js:259-303`. The element is now a **plain progressive audio stream**, no MSE, no video bytes.

For **download**, steps 1–2 are identical; step 3 becomes "fetch the URL's bytes and save them." That is the entire delta. Everything the audio-only feature must already solve (reaching page JS, `ANDROID_VR` impersonation, itag selection, cipher/`n` fallback, `ANDROID_VR` fragility) is shared; download adds only a byte sink.

This is why download maps cleanly onto the north star: **one acquisition mechanism, powering both "listen now" and "save for offline," with no second engine to maintain.**

---

## Approach evaluation

### (a) InnerTube `ANDROID_VR` re-fetch → direct URL → `fetch` + save  ⭐ RECOMMENDED (#1)

**Mechanism.** As above: same-origin page-context POST to `/youtubei/v1/player` with an `ANDROID_VR` client body; read `adaptiveFormats[i].url` for an audio itag; hand the URL to the extension **background** script; background `fetch`es it (range GETs) and assembles a Blob; save to disk (`downloads` API) or into an in-extension library (IndexedDB/OPFS).

**Evidence it works in-browser (2026):**
- `ANDROID_VR` returns direct URLs where the web client is SABR-only. yt-dlp ships it as a **default** and the **only JS-less default** client precisely because it still yields un-SABR'd, un-signed, no-PO-token streams: `_DEFAULT_CLIENTS = ('android_vr', 'web_safari')`, `_DEFAULT_JSLESS_CLIENTS = ('android_vr',)` — `yt-dlp/yt_dlp/extractor/youtube/_video.py:142-143`. Persona defined at `_base.py:226-241` (clientVersion pinned `1.65.10`, with the comment that `>1.65` "may return SABR streams only").
- `ANDROID_VR` needs **no PO token**: yt-dlp's PO Token Guide lists it as "Not required" (whereas `web/mweb/web_music/android/ios` all require a GVS PO token). Corroborated by the itag exemption below.
- **itag 18 is hard-coded PO-token-exempt for all clients**: `require_po_token = (stream_id[0] not in ['18'] and gvs_pot_required(...))` — `yt-dlp/yt_dlp/extractor/youtube/_video.py:3505`.
- A **real, shipping Firefox extension does the page-context `ANDROID_VR` re-fetch today** — `ytop-mv3` (doc 01, `js/yt.js:133-244`, `:687-802`). It is proof-of-existence that this is not hypothetical.
- Downloading a direct format URL is exactly what mature clients do: YouTube.js's `download()` is just a `GET` on a deciphered `format_url` (`LuanRT/YouTube.js` `src/utils/FormatUtils.ts:10,38,83`, chunked range GETs at `:56-113`). It presupposes you already have a real URL — which the web client doesn't give, but `ANDROID_VR` does.

**What works / what breaks in-browser:**
- **CORS (the one real plumbing wrinkle).** The InnerTube POST is **same-origin** (`youtube.com`→`youtube.com`) so it is not CORS-blocked — this is the whole advantage of being in-page. But the media bytes live on `*.googlevideo.com`, a **cross-origin** host. A **content script cannot** read a cross-origin response body; a **background script with a `*://*.googlevideo.com/*` host permission can** (host permissions grant the background context a CORS bypass and let it read the body). Pattern: content script obtains the URL → `runtime.sendMessage` → background fetches + assembles → saves. (MDN: `host_permissions`; the LuanRT localhost demo needs a whole separate extension, `ytc-bridge`, purely to get this cross-origin access from a third-party origin — `googlevideo/examples/sabr-shaka-example/src/main.ts:48`. We get it for free with one host permission because we run in-page + background.)
- **The forbidden `User-Agent` header does *not* block this.** `fetch`/XHR cannot set `User-Agent` (forbidden header; confirmed against the Fetch spec and browser behavior), so we cannot literally masquerade as the Oculus app at the HTTP layer. It does not matter: InnerTube identifies the client from the **JSON body**, not the UA. yt-dlp sends a matching UA out of consistency (`_base.py:950`), but the page-context POST works with the real Firefox UA + an `ANDROID_VR` body (as `ytop-mv3` demonstrates). **Caveat, honestly:** desktop-Firefox-UA + `ANDROID_VR`-body + logged-in-WEB-session-cookies is an internally inconsistent fingerprint. It works now; it is exactly the kind of anomaly YouTube can start flagging, and it feeds the account-risk note below.
- **`signatureCipher` / `n` throttling — the biggest download-specific pain.** Some responses return `signatureCipher` (encrypted `s`) instead of a ready `url`, and every googlevideo URL carries an `n` throttle param. In-page you *can* solve these using the page's own `base.js`, but `ytop-mv3` shows how fragile that is: it hand-rolls a `base.js` cipher extractor and comments _"2025-01 YT completely changed the way the base.js handles the cipher, good luck figuring it out"_ (`ytop-mv3/js/yt.js:832`), and it reads but **does not descramble `n`** (`:709-717`). For **playback** an un-descrambled `n` is often survivable (low-bitrate audio still sustains real-time). For **download** it is worse: a throttled `n` caps the fetch near real-time, so a 60-minute track can take ~tens of minutes instead of seconds. Un-decipherable `signatureCipher` → `403` → the download simply fails for that title. So download success rate ≈ audio-only success rate, but with an added **speed penalty** when `n` is throttled.
- **"Made for kids" / restricted videos** are unavailable to `ANDROID_VR` (source comment, `_base.py`); fall back to `ANDROID`/`web_embedded`, or the download fails for those titles.
- **`ANDROID_VR` is an endangered hole.** yt-dlp warns newer versions get SABR-forced; Google can revoke the exemption at any time. When it dies, approach (a) dies and we fall back to (b) or to 144p-cap streaming (no download).

**Robustness:** medium, trending down (identical to the audio-only feature's, plus the `n`-throttle speed risk). **Complexity:** low **on top of the audio-only feature** — background fetch + save + minimal container handling. Standalone it would be medium (cipher/`n`), but that cost is already paid by audio-only.

**Container handling for (a):** an audio-only itag is a single consistent stream, so the "remux" burden is minimal:
- **itag 140** (AAC in MP4): the URL is effectively a progressive `.m4a`; range-GET the whole `contentLength` and write bytes → a file that plays. No remux.
- **itag 251** (Opus in WebM): same — save the bytes as `.webm`; Firefox/VLC play it. Repackaging Opus into `.opus`/`.ogg` is optional polish (ffmpeg.wasm, below), not required.
- If a stream ever arrives as init + fMP4 fragments, raw ordered concatenation of `init + moof/mdat…` is a valid playable file when there is a **single** init and one consistent codec (`cat init seg1 seg2 … > out.m4a`) — no encryption, no bitrate switching. Audio-only satisfies all three.

---

### (b) Harvest MSE segments via `SourceBuffer.appendBuffer` hook (robustness backstop, phase 2)

**Mechanism.** Page-context monkey-patch of `SourceBuffer.prototype.appendBuffer`. When the page's own SABR/MSE player feeds audio segments to its audio `SourceBuffer`, capture the exact bytes (distinguish the audio buffer by the codec string passed to `addSourceBuffer`), collect init + media segments, then assemble/remux to a file. This **rides the page's real player**, so it inherits a valid PO token, `n`, and signature "for free" (doc 04's core insight) and is **immune to `ANDROID_VR` revocation** — it works on the plain SABR web client.

**Evidence / feasibility:**
- The audio the page decodes is clear (unencrypted) fMP4 (mp4a) or WebM (Opus) for all in-scope content — YouTube applies **EME/Widevine only to movies/rentals**, not to normal videos or Music (MDN MSE; W3C EME; the LuanRT shaka demo routes only `get_drm_license` through DRM, `ShakaPlayerAdapter.ts:303`). So the captured bytes are usable, not protected.
- Concatenated init + audio segments = a playable file (see (a) container note; general fMP4 rule confirmed: single init + consistent unencrypted codec → `cat` works; MP4Box/ffmpeg optional for a clean self-contained file).
- **Remux options, honestly scoped:** `mux.js` is MPEG-2-TS→fMP4 for HLS and does **not** help arbitrary fMP4/WebM audio. `ffmpeg.wasm` can remux/repackage fully client-side; the **single-threaded** `@ffmpeg/core` needs **no** `SharedArrayBuffer`/COOP/COEP (only the `-mt` build does), and remux (`-c copy`) is stream-copy — fast and CPU-light even single-threaded. Cost is a multi-MB (up to ~30 MB uncompressed) wasm payload, lazy-loaded only when the user asks for a repackaged format. For the common case (140→`.m4a`, 251→`.webm`) **no ffmpeg is needed at all.**

**What breaks / limits:**
- **Real-time-ish playthrough.** YouTube buffers **segment-by-segment with a limited look-ahead** (MSE quota; `QuotaExceededError` if over-buffered), not the whole track up front. So passive harvest captures a track only as fast as it plays/buffers — roughly real-time (somewhat faster if you let it buffer ahead). Bad UX for "download this album now."
- **Quality is whatever the player chose** (ABR), not user-selectable, unless you also steer `client_abr_state`.
- **Demux complexity.** You must correctly separate the audio buffer, order segments, and keep exactly one init.

**Active variant (b2): drive our own in-page SABR client.** Adapt `LuanRT/googlevideo` (protobuf schemas + `UmpReader` + `SabrStreamingAdapter`) in page context, request the **full** audio `contentLength` ourselves at full speed and chosen quality, minting/reusing a PO token. Same-origin + in-page means we can reuse the page's token via the adapter's `onMintPoToken` callback (`googlevideo/src/core/SabrStreamingAdapter.ts:118-119,270`) instead of running BotGuard out-of-band the way the CLI downloader must (`examples/downloader/utils/webpo-helper.ts` uses `bgutils-js` + JSDOM to mint a WebPO). This fixes (b)'s speed and quality limits **but** means maintaining a SABR/UMP client that tracks YouTube's evolving protobuf fields — high complexity. Reserve for "if `ANDROID_VR` dies and we still want fast full-track downloads."

**Robustness:** high (rides the real player; survives client-impersonation clampdowns). **Complexity:** medium (b) / high (b2). **Recommendation:** design-for now, build later as the backstop.

---

### (c) `captureStream()` + `MediaRecorder` — AVOID

**Mechanism.** `video.captureStream()` (Firefox: historically `mozCaptureStream()`) → take the audio `MediaStreamTrack` → `MediaRecorder` → re-encode to WebM/Opus.

**Why it's the worst option:**
- **Lossy re-encode.** You transcode an already-lossy Opus/AAC stream to Opus again — quality loss for no reason, versus (a)/(b) which passthrough the original bytes losslessly.
- **Real-time only.** `MediaRecorder` records at 1× playback. An hour of audio takes an hour.
- **Flaky Firefox support.** `HTMLMediaElement.captureStream()` is "limited availability / not Baseline" (MDN); Firefox shipped it prefixed as `mozCaptureStream()` with known source-change limitations. Fragile relative to (a)/(b).
- **EME-blocked on DRM titles.** For the rare EME/Widevine content (movies/rentals), the output is protected/black and capture yields nothing (MDN captureStream; Bugzilla output-protection behavior). Not relevant to normal videos/Music, but a hard wall where it applies.

**Robustness:** low. **Complexity:** medium. **Verdict:** do not build. The only thing it offers over (b) is not needing a demuxer, which is not worth the lossy real-time cost.

---

### (d) Simpler paths: itag 18, and why YouTube Music is the real sweet spot

- **itag 18** (muxed 360p MP4, audio+video) is genuinely PO-token-exempt (`_video.py:3505`) and directly downloadable when present. **But it is the wrong tool for an audio downloader:** it is A+V muxed (you'd download and discard a video track — wasteful, against the north star), 360p-locked, and **increasingly absent/throttled** on YouTube's side in 2024–2026 (yt-dlp issues #11154, #14187). Use it only as a last-ditch fallback source of *some* audio when adaptive audio itags are unavailable, and strip video via ffmpeg if so. Not a primary path.
- **YouTube Music (`music.youtube.com`, `WEB_REMIX`) is where download shines.** It is audio-first: default `adaptiveFormats` selection already leans on audio itags (140/251), tracks frequently have **no meaningful video track**, and the `ANDROID_VR` direct-URL path (a) returns clean audio with the least friction. This is the highest-value, lowest-risk target and should be the **first** surface we ship download on. It also matches user intent best (people save *music* for offline, not lecture video).

---

## Storage & offline-playback design

Two sinks, both viable; offer **disk download** as the default and an **in-extension offline library** as the "powerful on demand" layer.

### Sink 1 — Save to disk (`downloads` API) — default, simplest

- Assemble the audio Blob in the background script, `URL.createObjectURL(blob)`, then `browser.downloads.download({ url, filename })`. Requires the MV2 `"downloads"` permission. Revoke the object URL only **after** completion via `downloads.onChanged` (MDN warns against early revocation).
- **Firefox desktop:** fully supported. **Firefox Android:** `downloads.download()` **is** supported on Fenix (MDN documents an Android-specific caveat: it **raises an error if `saveAs:true`** — so pass `saveAs:false`/omit it on Android). Note: raw MDN browser-compat-data still shows a stale `firefox_android: {added:48, removed:79}` (the Fennec→Fenix migration gap); the current prose note about `saveAs` confirms it is live on modern Fenix. Verify on the target Fenix version during implementation.
- Best for the common "grab this track/album to my phone/PC" flow. Once on disk, playback is the OS/user's problem (any player), which is the simplest possible offline story.

### Sink 2 — In-extension offline library (IndexedDB / OPFS) — "powerful on demand"

- Store audio Blobs in **IndexedDB** (broad support in extension pages, stores Blobs directly) or **OPFS** (`navigator.storage.getDirectory()`, better for large sequential binary; check Fenix availability at build time). **Not** `storage.local` (unsuited to large binaries).
- **Quota:** add the `"unlimitedStorage"` permission to lift the per-origin cap; the real ceiling becomes free disk space (Extension Workshop, storage-limitations). Call `navigator.storage.persist()` to request eviction protection (best-effort→persistent) and `navigator.storage.estimate()` to show usage. Hundreds of MB to a few GB of audio is realistic on desktop; be conservative on Android (less disk, more aggressive eviction).
- **Offline player UI:** a `moz-extension://` extension page with an `<audio>` element sourced from an IndexedDB/OPFS Blob URL + a simple track list. Works on desktop. On Android, verify the extension can open its own full-page UI (Fenix restricts some surfaces); a fallback is to render the library inside the browser-action popup or an options page.
- Best for a curated, in-app "my offline music" experience and for surviving the case where saving loose files to Android storage is awkward.

### Desktop vs Firefox Android capability matrix (verify per Fenix version at build time)

| Capability | Firefox desktop | Firefox Android (Fenix) |
|---|---|---|
| Page-context script / `wrappedJSObject` (approach a,b) | Yes | Yes (doc 01 uses it on `m.youtube.com`) |
| Background-script cross-origin fetch via `*.googlevideo.com` host perm | Yes | Yes |
| `downloads.download()` to disk | Yes | Yes, but `saveAs:true` throws — omit it |
| IndexedDB in extension pages | Yes | Yes |
| OPFS | Yes | Verify (newer; may lag) |
| `unlimitedStorage` | Yes | Yes (disk-bounded) |
| Own full-page `moz-extension://` UI | Yes | Partially restricted — have a popup/options fallback |
| `webRequest` blocking | Yes (MV2) | Restricted on Android (not needed for this design) |

Android reality (general): only a subset of WebExtension APIs is supported, the extension must declare Android support, and there is no persistent background page (event-driven only). The good news: **this design needs none of the Android-restricted APIs** — page script + background fetch + downloads/IndexedDB all work.

---

## Account-risk / ToS design note (design constraint, licensing ignored)

Licensing is out of scope by direction, but **account-ban risk is real** and shapes the design:

- Approach (a) issues **extra InnerTube POSTs with a spoofed `ANDROID_VR` client** on a **logged-in WEB session**, plus repeated `googlevideo` range fetches. That is more bot-like signal than passive playback, and the desktop-UA + Oculus-client + WEB-cookies combination is an internally inconsistent fingerprint YouTube can flag.
- Approach (b) is **quieter** — it only observes bytes the page already fetched, adding essentially zero anomalous requests. This is another reason to keep (b) as the backstop: it is both more robust to protocol clampdowns **and** lower account-risk.
- **Ghost-posture mitigations:** prefer the user's existing session as-is (don't spin up extra visitor sessions unnecessarily); throttle/space out download fetches; do downloads on **explicit user action only** (never bulk-auto-download); consider offering an "anonymous" mode that avoids attaching auth to the download fetch where possible; keep the feature opt-in. For a single user the practical risk is low but nonzero — worst case is a session/IP soft-block or (rarely) account action. Design so a clampdown degrades gracefully (fall back to 144p streaming) rather than hammering.

---

## Recommendation for OUR extension

**Ship approach (a) as a companion to the audio-only feature — do not defer.** Rationale mapped to the north star ("one-stop shop for YouTube; simple for the user, powerful on demand; remove friction, deliver value"):

- **Removes friction / delivers value:** offline audio is the single most-requested "power" feature for a YouTube-audio tool, and for our extension it is **cheap** — the hard part (direct-URL acquisition) is already built for audio-only. Same engine, second output.
- **Simple for the user:** one button — "Save audio" — producing a `.m4a`/`.webm` on disk, plus an optional in-app offline library. No servers, no companion native app (unlike Video DownloadHelper's coapp), no third-party downloader site (unlike the cobalt-backed userscripts, which are server-side and bot-gated).
- **Powerful on demand:** the in-extension IndexedDB/OPFS library + offline player is the "powerful" tier for users who want a curated offline collection.
- **YouTube Music first:** audio-first, cleanest, highest intent-match. Extend to `youtube.com`/`m.youtube.com` after.

**Ranked by feasibility × robustness × simplicity:**

| Rank | Approach | Feasibility now | Robustness | Simplicity (given audio-only) | Verdict |
|---|---|---|---|---|---|
| 1 | (a) `ANDROID_VR` re-fetch → `fetch`+save | High | Medium, declining | High (shares audio-only engine) | **Ship (phase 1), YT-Music first** |
| 2 | (b) `appendBuffer` harvest | High | High (rides real player) | Medium | **Design-for; build as backstop (phase 2)** |
| 2b | (b2) in-page SABR client | Medium | High | Low | Reserve — only if (a) dies and speed matters |
| 3 | (d) itag 18 fallback | Low (often absent) | Low | High | Last-ditch A+V source only |
| 4 | (c) `captureStream`+`MediaRecorder` | Medium | Low | Medium | **Avoid** (lossy, real-time, flaky) |

**Maintenance burden (honest):** approach (a) inherits the audio-only feature's treadmill — `ANDROID_VR` can lose its exemption and `base.js` cipher/`n` changes periodically (YouTube already broke the cipher scheme in 2025-01 per `ytop-mv3`). Budget for occasional breakage and a graceful fallback (144p streaming, or approach (b) if built). Download adds one durable concern of its own: the `n`-throttle speed penalty. None of this is a server to run — it is JS to occasionally patch, appropriate for a single-dev tool. **Do not defer; ship (a) for YT Music, keep (b) in your back pocket.**

---

## References

**Repos (shallow-cloned 2026-07-11; commit hashes):**
- `LuanRT/googlevideo` @ `d2fa40d761034a286cf60ee033653307a1295b0c` — SABR/UMP client + schemas; the download example (`examples/downloader/main.ts`, `utils/webpo-helper.ts` — out-of-browser WebPO minting via `bgutils-js`+JSDOM) and the **browser** SABR demo (`examples/sabr-shaka-example/src/main.ts:48` requires the separate `ytc-bridge` extension purely for CORS; `:163` `onMintPoToken`; `src/BotguardService.ts:102` `generateColdStartToken`; adapter `src/core/SabrStreamingAdapter.ts:118-119,270`).
- `LuanRT/YouTube.js` @ `14825d7712e32b208830895701973a5a934a3522` — `src/utils/FormatUtils.ts:10` `download()` (GET on deciphered `format_url` at `:38`, chunked range GETs `:56-113`), `chooseFormat`/audio filter `:138-192`; `src/utils/Constants.ts` `CLIENTS` (`ANDROID_VR` UA `:61-68`), `STREAM_HEADERS` `:124-129`.
- `yt-dlp/yt-dlp` @ `59d9ae606a24a80523da35de9fb75b71eb35b501` — `yt_dlp/extractor/youtube/_video.py:3505` (**itag 18 PO-token exemption**), `:142-143` (`_DEFAULT_CLIENTS`/`_DEFAULT_JSLESS_CLIENTS` = `android_vr`), `:3515-3536` (SABR-only web warning), `:3521-3523` (signatureCipher parse); `_base.py:226-241` (`android_vr` persona, `clientVersion 1.65.10`), `:950` (per-client `User-Agent` header).
- `ytop-mv3` ("Tube Audio Options+") @ `5747b5719ef5e8286dd6ba380741f069e0373d29` (via doc 01) — `js/yt.js:133-244` page-context `ANDROID_VR`/`ANDROID` InnerTube fetch; `:259-303` src-swap; `:687-802` `adaptiveFormats` audio extraction; `:711` `serverAbrStreamingUrl`; `:709-717` `n` read-not-descrambled; `:832` cipher-broke comment; `:100,:103` `wrappedJSObject`; `manifest.json` host perms incl. `*.googlevideo.com`.

**Internal:** `docs/research/04-youtube-streaming-internals.md` (SABR/UMP, PO-token/`n`/sig gates); `docs/research/01-disable-video-audio-only.md` (audio-only `ANDROID_VR` acquisition — the shared engine for download).

**Web (verified 2026-07-11):**
- yt-dlp PO Token Guide (client enforcement table; `android_vr` "Not required"): https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- yt-dlp #12482 (web SABR-only): https://github.com/yt-dlp/yt-dlp/issues/12482 · itag 18 scarcity/throttle: https://github.com/yt-dlp/yt-dlp/issues/11154 , https://github.com/yt-dlp/yt-dlp/issues/14187
- Forbidden header names (`User-Agent` unsettable): https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
- WebExtension cross-origin fetch via host permissions (background reads cross-origin body; content scripts cannot): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions
- `downloads.download()` (Blob URL, revoke-after-complete, Firefox Android `saveAs` caveat): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download
- Extension storage limits / `unlimitedStorage`: https://extensionworkshop.com/documentation/develop/storage-limitations/ · quota/eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- `HTMLMediaElement.captureStream()` (limited availability; taint/EME): https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream · EME: https://developer.mozilla.org/en-US/docs/Web/API/Encrypted_Media_Extensions_API
- MSE (clear fMP4/WebM segments): https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API · fMP4 init+segment concatenation: https://stackoverflow.com/questions/74470253/how-to-concatenate-multiple-init-segments-and-chunks-from-the-dash-video-stream
- ffmpeg.wasm single-threaded (no SharedArrayBuffer/COOP-COEP; remux `-c copy`; ~30 MB): https://github.com/ffmpegwasm/ffmpeg.wasm/issues/263
- cobalt (confirms server-side, not in-browser; hosted API bot-gated): https://github.com/imputnet/cobalt · Firefox Android extension development: https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
