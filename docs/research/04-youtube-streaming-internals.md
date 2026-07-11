# Modern YouTube Streaming & Player Internals

Research stream 04 — the shared foundation for why audio-only and ad-blocking are hard on YouTube today (July 2026), and which interception points still exist for a browser extension.

Scope of our extension: `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com`. This document notes YouTube Music (`WEB_REMIX`) differences where they affect interception.

Primary sources cloned and read (commit hashes in References):
- `LuanRT/googlevideo` — the clearest primary source for the SABR/UMP wire format (protobuf schemas + a working TS client).
- `LuanRT/YouTube.js` — an InnerTube client in JS (player-response request + format parsing + decipher).
- `yt-dlp/yt-dlp` — the YouTube extractor (player request, SABR handling, `n`/sig decipher, PO Token framework).

Citations are `repo/path:line` against those commits.

---

## Executive summary

The old approach broke because **the media URL the extension used to intercept no longer exists as a request the browser makes.** Historically the web player fetched each audio/video segment with a plain `GET https://…googlevideo.com/videoplayback?itag=…&mime=audio%2Fmp4&range=…`, so a `chrome.webRequest` listener could see a request whose query string literally contained `mime=audio` and swap `<video>.src` to that direct URL. Today the desktop/mobile **web** client is on **SABR (Server-side Adaptive BitRate)** delivered over **UMP (Unified Media Protocol)**: the player sends a **single `POST` to a `serverAbrStreamingUrl`** (a `…/videoplayback` endpoint) whose body is a binary **protobuf `VideoPlaybackAbrRequest`**, and the server replies with a **UMP-framed** stream that multiplexes media headers and media bytes for the itags the *server* decides to send. The discriminating parameters (`itag`, `mime`, `range`, format IDs, the PO token) have moved **out of the query string and into the protobuf POST body**; the response is an opaque binary framing, not a media file. yt-dlp confirms this in its own source: for the `web`/`web_safari` clients the `adaptiveFormats` entries now arrive **without a `url`**, and it logs "YouTube is forcing SABR streaming for this client" (`yt-dlp/yt_dlp/extractor/youtube/_video.py:3524-3531`).

What still works client-side: an extension running in the **page context** can hook `window.fetch`/`XMLHttpRequest` and `Response`/`MediaSource`. It can (a) **read and rewrite the InnerTube player-response JSON** (`/youtubei/v1/player`) before the page's player parses it, and (b) **see the SABR `POST` and its UMP response bytes**. `webRequest` alone (background/service-worker, no body access on POST in a useful form) can no longer do the job. So the viable strategy is page-context interception of the player response and/or the UMP stream, not URL matching. Details, ranked, in the interception section.

---

## InnerTube player-response anatomy

### How the web client gets a player response

Every YouTube surface (watch page, Shorts, YouTube Music, embeds) obtains playback data from **InnerTube**, YouTube's internal RPC API, by POSTing to:

```
POST https://www.youtube.com/youtubei/v1/player?key=…&prettyPrint=false
Content-Type: application/json
```

The JSON body carries a `context.client` block that identifies the client (name + version) plus the `videoId`, and returns the **player response** object. YouTube.js issues exactly this call (its `Player`/`actions` layer), and yt-dlp builds it per-client in the YouTube extractor. The InnerTube client identity is what determines whether you get SABR-only formats or direct URLs, so the `context.client.clientName`/`clientVersion` pair is load-bearing.

Client name → numeric ID mapping (from `YouTube.js/src/utils/Constants.ts` `CLIENT_NAME_IDS`):

| Client | `clientName` string | numeric `client_name` |
|---|---|---|
| Desktop web | `WEB` | `1` |
| Mobile web (`m.youtube.com`) | `MWEB` | `2` |
| **YouTube Music web** (`music.youtube.com`) | `WEB_REMIX` | `67` |
| Android | `ANDROID` | `3` |
| Android Music | `ANDROID_MUSIC` | `21` |
| iOS | `iOS` | `5` |
| TV HTML5 | `TVHTML5` | `7` |
| TV embedded | `TVHTML5_SIMPLY_EMBEDDED_PLAYER` | `85` |
| Web embedded | `WEB_EMBEDDED_PLAYER` | `56` |

The same numeric ID is echoed on the wire inside SABR requests as `StreamerContext.ClientInfo.client_name` (field 16 — see below). For **our extension**, the browser is one of `WEB` (youtube.com), `MWEB` (m.youtube.com), or `WEB_REMIX` (music.youtube.com); `youtube-nocookie.com` embeds use the web/embedded player. All of these are on the SABR-only path today.

### Where the important things live in the response

The response is a large JSON object. The parts that matter for us:

- `streamingData.adaptiveFormats[]` — the per-stream, single-track (audio-only OR video-only) formats. Each entry has (field names verbatim as YouTube.js/yt-dlp read them): `itag`, `mimeType` (e.g. `audio/mp4; codecs="mp4a.40.2"` or `audio/webm; codecs="opus"`), `bitrate`, `averageBitrate`, `width`/`height`/`fps` (video), `audioQuality` (e.g. `AUDIO_QUALITY_MEDIUM`), `audioSampleRate`, `audioChannels`, `contentLength`, `approxDurationMs`, `lastModified`, and **either** a ready-to-use `url` **or** a `signatureCipher` (URL-encoded `url` + `s` + `sp`). Audio itags of interest: `140` (m4a/AAC 128k), `139`/`141` (AAC 48k/256k), `251` (opus/webm ~160k), `250`/`249` (opus lower), `18` (legacy muxed mp4 A+V — notably the one itag yt-dlp still treats as directly available; see below).
- `streamingData.formats[]` — the legacy **muxed** (audio+video together) progressive formats (mainly itag `18`, `22`). These are the closest to "just play this single URL," but they are limited quality and increasingly withheld.
- `streamingData.serverAbrStreamingUrl` — the SABR endpoint. **When present, this is the signal that playback is SABR.** The player POSTs its `VideoPlaybackAbrRequest` here. (YouTube.js reads it at `src/parser/parser.ts:414` but only as an opaque string — it has **no** UMP/SABR transport at all, `"ump"` has zero matches in its source, which is why `googlevideo` is the real reference implementation for the wire format.)
- `streamingData.hlsManifestUrl` / `streamingData.dashManifestUrl` — manifest URLs for HLS/DASH. Live streams and some clients surface these; when available they are a far simpler interception target than SABR because segments are ordinary GETs. The web VOD player generally does **not** use these (it uses SABR/MSE), but they are sometimes present and are a useful fallback/alternate-client trick.
- **PO-token / ustreamer glue:** `streamingData` (and `playerConfig`) carries the `videoPlaybackUstreamerConfig` blob that must be echoed back in the SABR request body (`VideoPlaybackAbrRequest.video_playback_ustreamer_config`, field 5). Playback also references a **PO token** (proof-of-origin) that must be attached to the GVS/SABR request.
- **Ads** live in the player response too:
  - `adPlacements[]` / `adSlots[]` / `playerAds` — the ad scheduling/placement metadata delivered alongside `streamingData`.
  - In SABR itself, ads are injected via `SabrContextUpdate` parts with `scope = CONTENT_ADS (4)` (`googlevideo/protos/video_streaming/sabr_context_update.proto:10`) — i.e., mid-stream the server can push an ad context that redirects which media the SABR stream serves. This is why naive URL blocking cannot remove SABR-era ads: the ad is part of the same multiplexed media stream, gated server-side.

For **audio-only**, the key realization: `adaptiveFormats` still *enumerates* the audio itags (e.g. `140`, `251`) with all their metadata even on the web client — but on the web client those entries now come **without a usable `url`** (SABR-only), so you cannot just read `adaptiveFormats[i].url` and assign it to `<audio>.src`. You must either (a) get a client/context that returns real URLs, or (b) drive the SABR stream yourself, or (c) leave playback to the page and only steer/strip the video track. See implications section.

---

## Media delivery: legacy range-GET vs SABR/UMP

### Legacy (the model the old extension assumed)

Each segment was an independent HTTP `GET`:

```
GET …googlevideo.com/videoplayback?expire=…&itag=140&mime=audio%2Fmp4&…&range=0-65535&…
```

Interceptable by URL: `mime`, `itag`, `range` are all in the query string; the response body is raw media bytes you can hand to a `<video>`/`<audio>` element or MSE. This is the world the current extension's `webRequest` + `<video>.src` swap was built for, and it is gone for the web client.

### SABR / UMP (today)

**Endpoint & method.** The player issues a **`POST`** to the `serverAbrStreamingUrl` from the player response (a `…/videoplayback` URL, often with an `rn=<request number>` query param bumped each request). Evidence from a working SABR client:

- `googlevideo/src/core/SabrStream.ts:810-816` — the streaming request:
  ```
  method: 'POST',
  headers: {
    'content-type': 'application/x-protobuf',
    'accept-encoding': 'identity',
    'accept': 'application/vnd.yt-ump'
  },
  body: body   // the encoded VideoPlaybackAbrRequest
  ```
  and `…:801-802` sets `rn` on the URL.
- `googlevideo/src/core/SabrStreamingAdapter.ts:259` — `request.body = VideoPlaybackAbrRequest.encode(videoPlaybackAbrRequest).finish();` and `…:304` `request.method = 'POST'` with `delete request.headers.Range` (the range moves out of the header into the protobuf request state).

**The POST body: `VideoPlaybackAbrRequest`.** Schema `googlevideo/protos/video_streaming/video_playback_abr_request.proto:10-25`. Load-bearing fields:

| Field # | Name | Meaning |
|---|---|---|
| 1 | `client_abr_state` (`ClientAbrState`) | player state: viewport, bandwidth estimate, player time, enabled track types, quality caps, `data_saver_mode`, etc. |
| 2 | `selected_format_ids` (`FormatId[]`) | itags the client has already initialized/buffered |
| 3 | `buffered_ranges` (`BufferedRange[]`) | what the client already has, per format |
| 4 | `player_time_ms` | current playback position |
| 5 | `video_playback_ustreamer_config` (bytes) | the opaque config echoed from the player response |
| 16 | `preferred_audio_format_ids` (`FormatId[]`) | **the audio itags the client wants** (`pai`) |
| 17 | `preferred_video_format_ids` (`FormatId[]`) | preferred video itags (`pvi`) |
| 18 | `preferred_subtitle_format_ids` | preferred caption formats |
| 19 | `streamer_context` (`StreamerContext`) | client identity + **PO token** + playback cookie |

`FormatId` itself (`googlevideo/protos/misc/common.proto:9-13`) is `{ itag (1), last_modified (2), xtags (3) }` — so a track is identified by itag **plus** `last_modified`, both of which come from `adaptiveFormats`.

**This is the crux for interception:** `mime`/`itag`/`range`/quality are now expressed as `preferred_audio_format_ids` / `preferred_video_format_ids` / `client_abr_state` / `buffered_ranges` **inside the protobuf POST body**, not as query params. A `webRequest` URL matcher sees only `…/videoplayback?…&rn=N`.

**`StreamerContext`** (`googlevideo/protos/video_streaming/streamer_context.proto:4-66`) carries:
- `client_info` (field 1) with `client_name` (int, field 16 — the `1`/`2`/`67` above), `client_version` (17), OS, device, locale.
- `po_token` (field 2, bytes) — **the proof-of-origin token**.
- `playback_cookie` (field 3) — echoes the server's `NextRequestPolicy` cookie to maintain session affinity.
- `sabr_contexts` (field 5, repeated `SabrContext`) + `unsent_sabr_contexts` (field 6) — the ad/other server-pushed context state (see ads).

Construction of that body in a real client: `googlevideo/src/core/SabrStream.ts:705-720` (`VideoPlaybackAbrRequest.encode({ clientAbrState, preferredAudioFormatIds:[selectedAudioFormat], preferredVideoFormatIds:[selectedVideoFormat], selectedFormatIds, videoPlaybackUstreamerConfig, streamerContext:{ poToken, playbackCookie, clientInfo }, bufferedRanges })`).

**The response: UMP framing (`application/vnd.yt-ump`).** The body is a stream of **parts**, each `[varint partType][varint partSize][partSize bytes]`. Reader: `googlevideo/src/core/UmpReader.ts:15-50` (reads a varint type, a varint size, then that many bytes, repeatedly). The UMP varint is YouTube's own scheme (leading-byte thresholds `<128 / <192 / <224 / <240` select 1–5 byte lengths — `UmpReader.ts:57-118`), **not** protobuf varint.

Each part's `type` is a `UMPPartId` (`googlevideo/protos/video_streaming/ump_part_id.proto:5-60`). The media-carrying ones:

| ID | Name | Payload |
|---|---|---|
| 20 | `MEDIA_HEADER` | a `MediaHeader` protobuf (itag, `format_id`, `sequence_number`, `start_range`, `content_length`, `is_init_seg`, timing) — `googlevideo/protos/video_streaming/media_header.proto:7-24` |
| 21 | `MEDIA` | raw media bytes; **first byte is the `header_id`** tying it to a preceding `MEDIA_HEADER` (`googlevideo/src/core/SabrUmpProcessor.ts:168-176`) |
| 22 | `MEDIA_END` | end-of-segment marker (references the `header_id`) |
| 42 | `FORMAT_INITIALIZATION_METADATA` | init/index ranges + mime per format (`format_initialization_metadata.proto`) |
| 43 | `SABR_REDIRECT` | `{ url }` — switch `serverAbrStreamingUrl` to a new host (`sabr_redirect.proto:4`) |
| 44 | `SABR_ERROR` | request rejected/invalid |
| 45 | `SABR_SEEK` | server-driven seek |
| 46 | `RELOAD_PLAYER_RESPONSE` | re-fetch the player (token in `ReloadPlaybackContext`) |
| 57 | `SABR_CONTEXT_UPDATE` | push a context (ads use `scope=CONTENT_ADS`) |
| 58 | `STREAM_PROTECTION_STATUS` | `{ status, max_retries }` — signals whether attestation / a valid PO token is required (`stream_protection_status.proto:4`) |
| 35 | `NEXT_REQUEST_POLICY` | backoff + `playback_cookie` for the next POST |

The client dispatches parts through a handler map — `googlevideo/src/core/SabrUmpProcessor.ts:58-65` registers `MEDIA_HEADER`/`MEDIA`/`MEDIA_END`/`SABR_CONTEXT_UPDATE`/`STREAM_PROTECTION_STATUS` handlers; `handleMediaHeader` (`…:140-165`) records the segment keyed by `header_id`, and `handleMedia` (`…:168+`) appends bytes to the matching segment. So the audio and video tracks are **multiplexed into one UMP response** and demuxed client-side by `header_id`/`format_id`.

There is also a simpler "UMP-wrapped GET" path for some content: the adapter can convert an ordinary `/videoplayback` request into a POST with `ump=1&srfvp=1&alr=yes&pot=<token>&rn=N`, moving the byte range from the `Range` header into a `range=` param (`googlevideo/src/core/SabrStreamingAdapter.ts:273-300`). Detecting whether a URL is a googlevideo/SABR URL: `googlevideo/src/utils/shared.ts:24-42` (matches `…/videoplayback` with `source=youtube` or `sabr`/`lsig`/`expire` params).

### Rollout timeline (verified July 2026)

- **2023–2024:** SABR appears first on native mobile/TV apps and via the "onesie" prefetch path; web still primarily used direct range-GET `adaptiveFormats` URLs.
- **Late 2024 → 2025:** YouTube runs the **"SABR-only streaming experiment"** on the web client; `adaptiveFormats` on `WEB` start arriving without `url`. Tracked in yt-dlp as issue **#12482** (referenced directly in the extractor's warning text, `_video.py:3526`).
- **2025 → mid-2026:** SABR is effectively the default for `WEB`/`WEB_safari` (and the music web client). yt-dlp's own code branches on it: for `web`/`web_safari` it emits the debug line "YouTube is forcing SABR streaming for this client" and otherwise warns "YouTube may have enabled the SABR-only streaming experiment" (`_video.py:3524-3535`). Community SABR/UMP implementations (LuanRT/googlevideo, the `yt-dlp-ytse` plugin, `sabr-rs`) matured to actually play/download SABR streams. **yt-dlp itself never speaks SABR** — it does not read `serverAbrStreamingUrl` anywhere (zero hits in its tree); instead it works around SABR purely by *client selection*. As of the pinned commit its default clients are `('android_vr', 'web_safari')` (`_video.py:142`), and `android_vr`'s `clientVersion` is deliberately pinned to `1.65.10` with the comment "Using a clientVersion>1.65 may return SABR streams only" (`_base.py:225,230`) — i.e. yt-dlp fences a client off from SABR by freezing its version string. `android_vr`/`ios` are additionally chosen because they have `REQUIRE_JS_PLAYER: False` (`_base.py:240,271`), so they still hand back a real `videoplayback` URL. This "spoof a non-browser `player_client`" strategy is unavailable to us: our extension *is* the browser web client, and impersonating android_vr/ios from a real browser session would need that client's own PO-token/attestation.

---

## MSE and the `blob:` src; what substituting audio-only actually requires

The web player does **not** put a media URL in `<video>.src`. It creates a `MediaSource`, calls `URL.createObjectURL(mediaSource)` (yielding a `blob:https://www.youtube.com/…` URL), assigns that to `<video>.src`, then adds `SourceBuffer`s (one for audio, one for video) and feeds each demuxed segment via `SourceBuffer.appendBuffer(bytes)`. The bytes come from the SABR/UMP response above. Consequences:

1. **`<video>.src` is a blob handle, not a network URL.** Swapping it to a googlevideo URL (the old trick) detaches the MSE pipeline and breaks playback; there is no direct URL to swap to anyway.
2. **To "substitute audio-only" you are really choosing which `SourceBuffer`s get fed.** Three concrete tactics:
   - **Don't append video segments.** If you control/parse the UMP demux (via page-context hooks), feed only the audio `header_id`s into the audio `SourceBuffer` and drop video parts. Playback continues audio-only with no video decode. This is the cleanest "true audio-only" but requires participating in the MSE feed.
   - **Bias the request.** Set `client_abr_state` to request only audio / minimal video (e.g. only `preferred_audio_format_ids`, tiny viewport, `data_saver_mode`), so the server sends little/no video. Reduces bandwidth without fully removing the video track.
   - **Leave MSE alone, kill the video decode surface.** Let the page play normally but prevent the *video* from decoding/rendering (hide the element, or intercept so the video `SourceBuffer` receives nothing). This is closest to the extension's historical UX ("audio keeps playing, video stops") and is the least invasive, but on SABR the video bytes may still be downloaded unless you also suppress them upstream.
3. **Init segments matter.** Each track needs its init segment (`MediaHeader.is_init_seg`, and `FORMAT_INITIALIZATION_METADATA` init/index ranges) appended before media, and the `SourceBuffer` MIME must match the itag's codec string exactly.

For an extension whose product goal is "stop wasting bandwidth/battery on video, keep audio," the highest-leverage lever is **making the player request audio-only** (bias `client_abr_state`/preferred formats and/or drop video UMP parts), because it prevents the video bytes from being fetched at all — the tab-throttling problem the old extension solved.

---

## `n` / signature / PO-token obstacles to reusing direct URLs

Even when you *can* get a direct `…/videoplayback` URL (legacy formats, alternate clients, or from `signatureCipher`), you cannot just fetch it. Three gates:

1. **Signature cipher (`s` → `sig`).** Many formats ship as `signatureCipher=url=…&s=<encrypted>&sp=sig`. The `s` value must be transformed by a per-session JS function extracted from the base player JS (`player_ias.vflset/…/base.js`) and appended as the signature param. yt-dlp parses this exact shape: `sc = parse_qs(fmt_stream['signatureCipher'])`, `fmt_url = sc['url'][0]`, `encrypted_sig = sc['s'][0]` (`yt-dlp/yt_dlp/extractor/youtube/_video.py:3521-3523`), then deciphers using the player JS. Without deciphering, the URL 403s.
2. **The `n` throttling parameter.** Every googlevideo URL carries an `n=<value>` query param that must be run through another obfuscated function (`nsig`/`n` transform) from the same base.js; if you send the URL with the original `n`, YouTube **throttles** the download to a crawl (or 403s). yt-dlp maintains an entire JS-runtime subsystem for this (`yt-dlp/yt_dlp/extractor/youtube/jsc/` — it will use Deno/Node/Bun/QuickJS to execute the extracted function). The transform changes whenever YouTube ships new player JS, so it is a permanent cat-and-mouse. **In a real browser, this is actually the one gate you get "for free":** the page's own player computes `sig`/`n` for its own requests, so page-context interception that lets the player build the request avoids re-implementing decipher entirely.
3. **PO Token (proof-of-origin) / BotGuard / attestation.** YouTube requires a **PO token** (a "WebPO") minted by executing BotGuard/attestation challenges in a browser-like environment. It binds a request to a plausible client+session. Three contexts (yt-dlp models them explicitly as `PoTokenContext.GVS / .PLAYER / .SUBS`, `pot/provider.py:39-42`): the **player** context (attached to the `/youtubei/v1/player` call) and the **GVS** (Get-Video-Stream) context — attached to the streaming/SABR request. yt-dlp encodes the policy per client+protocol (`_base.py:48-94`): on web clients a GVS PO token is **required for HTTPS and DASH** but only **recommended for HLS** (`WEB_PO_TOKEN_POLICIES`, `_base.py:71-94`), and itag `18` is hard-exempted (`_video.py:3505`). It gates each format via `gvs_pot_required(...)` (`_video.py:3255-3259`, applied at `:3503-3507/3691/3729`) and, when missing, skips the format because it "may yield HTTP Error 403" (`_report_pot_format_skipped`, `_video.py:3183-3193`). A **WebPO** is cryptographically bound to `visitor_data` (unauthenticated), `data_sync_id` (authenticated), or `video_id` (when the bind-to-video-id experiment is active) — `pot/utils.py:35-61`. The token rides in `StreamerContext.po_token` (field 2) on SABR requests. Corroboration from YouTube.js: in legacy/direct mode it appends the pot to the URL query, but only when `sabr !== '1'` (`YouTube.js/src/core/Player.ts:204-206`) — under SABR the token deliberately moves out of the URL and into the protobuf body. `STREAM_PROTECTION_STATUS` (UMP part 58) tells the client whether attestation is currently required. Again, **inside a real browser session the page already holds/mints a valid PO token**, so page-context interception inherits it; an out-of-band extension request that tries to fetch googlevideo directly would have to mint its own, which is the hard part external tools struggle with.

**Net:** direct-URL reuse from a background context requires re-implementing sig + `n` + PO-token, i.e. becoming yt-dlp. From **inside the page** you sidestep all three by letting the player author the request and only steering *what* it asks for / *what* you keep.

---

## Viable client-side interception points for an extension (ranked)

An extension has three distinct powers: (A) `chrome.webRequest`/`declarativeNetRequest` in the background/service worker; (B) content scripts; and (C) a **page-context** script (injected `<script>` that runs in the page's own JS world, not the isolated content-script world) which can monkey-patch `window.fetch`, `XMLHttpRequest`, `Response`, `MediaSource`, `SourceBuffer`, `JSON.parse`, etc.

Ranked by viability + future-proofness:

### 1. Page-context rewrite of the InnerTube **player response** (best)
Hook `window.fetch`/`XHR` (or `JSON.parse`/`Response.prototype.json`) in page context; when the URL is `/youtubei/v1/player`, read the JSON and modify `streamingData` before returning it to the player. What this enables:
- **Force a simpler delivery path:** if you can get the player to use `dashManifestUrl`/`hlsManifestUrl` or muxed `formats` (e.g. by pruning SABR-only entries or preferring an audio format), you convert the problem back into ordinary segment GETs. (Effectiveness varies — the player may ignore edits or re-request; needs testing against the live 2026 player.)
- **Read the audio itag metadata** (`adaptiveFormats` still lists audio itags with `contentLength`, codecs) to drive your UI/decisions even when `url` is absent.
- **Strip ads:** delete `adPlacements`/`adSlots`/`playerAds` and ad-related `streamingData` before the player sees them — the classic SponsorBlock/adblock-for-YouTube technique. (Server-side SABR `CONTENT_ADS` context can still inject; JSON stripping handles the metadata-scheduled ads, not necessarily server-stitched ones.)
Pros: uses the page's own sig/`n`/PO-token; survives SABR because you operate above the transport. Cons: fragile to player-response schema changes; must inject into page world (MAIN world) and run before the player parses.

### 2. Page-context participation in the **MSE / UMP** feed (most powerful, most complex)
Hook `window.fetch` for the `serverAbrStreamingUrl` POST and/or `SourceBuffer.prototype.appendBuffer`. Then either:
- Parse the outgoing `VideoPlaybackAbrRequest` and/or rewrite `preferred_*_format_ids`/`client_abr_state` to request audio-only (needs protobuf encode/decode of the schemas in `googlevideo/protos/…`), and/or
- Parse the incoming UMP stream (`UmpReader` logic) and forward only audio `MEDIA`/`MEDIA_HEADER` parts to the audio `SourceBuffer`, dropping video.
Pros: true audio-only, stops video bytes at the source, inherits sig/`n`/PO-token from the page. Cons: you are re-implementing a SABR/UMP client (though `googlevideo` is directly adaptable — licensing is a non-issue for a personal tool), and you must stay in lockstep with YouTube's evolving protobuf fields.

### 3. `declarativeNetRequest` / `webRequest` header or redirect tricks (limited)
The background can still see the `POST …/videoplayback?…&rn=N` request and its headers, and can block/redirect by URL/host. Useful for: blocking known ad/tracking hosts, or forcing `Range`/header behavior. **Cannot** read or rewrite the protobuf POST body in a supported way (MV2 `webRequest` gives request bodies only as raw/formdata and cannot mutate them meaningfully for a protobuf; MV3 `declarativeNetRequest` cannot touch bodies at all). So URL-level interception is now only good for coarse blocking, **not** for the audio-only mechanism. This is exactly why the old approach died.

### 4. Old approach — match `mime=audio` in the URL and swap `<video>.src` (dead)
No such request exists on the SABR web client, and `<video>.src` is a blob. Not viable.

**Firefox / MV2 specifics for our extension.** We are MV2 on Firefox, which is *advantageous* here: Firefox keeps MV2 `webRequest` with blocking, and page-context injection is straightforward (`content_scripts` + injected `<script>` element, or `tabs.executeScript`). Firefox's `wrappedJSObject`/`exportFunction` model lets a content script reach into the page's JS to install fetch/MSE hooks reliably. The practical recipe: a content script at `document_start` injects a page-world script that installs the `fetch`/`XHR`/`MediaSource` hooks, communicating decisions back via `window.postMessage`/custom events. Nothing here depends on Chrome-only APIs.

---

## Implications for OUR extension's audio-only and (optional) ad-block goals

**Audio-only (primary goal).** The clean, future-proof design is page-context interception, not URL matching:
- Inject a MAIN-world script at `document_start` on `youtube.com`, `m.youtube.com`, `music.youtube.com`, and `youtube-nocookie.com` embeds.
- Hook the `/youtubei/v1/player` response first — it is the least fragile point and lets us both read audio itags and (attempt to) steer the player toward audio-friendly delivery / strip ads.
- For genuine "stop downloading video," hook the SABR path: either bias `VideoPlaybackAbrRequest` toward audio-only formats / minimal `client_abr_state`, or demux the UMP stream and starve the video `SourceBuffer`. Adapt `LuanRT/googlevideo` (protobuf schemas + `UmpReader`) directly — it is the reference implementation.
- Because we run inside the real browser session, we inherit the page's signature/`n`/PO-token, so we never need to reimplement decipher or BotGuard. That is the single biggest reason page-context beats any out-of-band fetch.

**YouTube Music (`music.youtube.com`, `WEB_REMIX`).** Same InnerTube `/youtubei/v1/player` endpoint and same SABR/UMP transport; the only differences are `context.client.clientName = "WEB_REMIX"` / `clientName ID 67` and that Music is **audio-first** (its default `adaptiveFormats` selection leans on audio itags like `140`/`251`, and it often has no meaningful video track for a track/album). This makes Music the *easier* target for audio-only: biasing/reading audio formats is closer to what the Music player already does, and there is frequently no video `SourceBuffer` to suppress. Same page-context hook strategy applies; just match the Music client name when reading/rewriting the player response.

**Ad-block (optional/secondary).** Two layers: (1) strip `adPlacements`/`adSlots`/`playerAds` from the player response in page context (handles scheduled/metadata ads, the SponsorBlock-style approach); (2) SABR-stitched ads arrive as `SABR_CONTEXT_UPDATE` parts with `scope=CONTENT_ADS` inside the media stream — removing those cleanly requires participating in the UMP demux (interception point #2) and is materially harder. Recommend treating player-response ad-stripping as the pragmatic scope and flagging server-stitched SABR ads as a known limitation.

**What to retire.** The `webRequest` `mime=audio` URL match + `<video>.src` swap is unrecoverable on the SABR web client and should be replaced, not patched. Keep a minimal `webRequest`/`dNR` layer only for coarse host blocking if desired.

---

## References

Repos (shallow-cloned July 11 2026):
- `LuanRT/googlevideo` @ `d2fa40d761034a286cf60ee033653307a1295b0c` — SABR/UMP protobuf schemas (`protos/video_streaming/*.proto`, `protos/misc/common.proto`) and TS client (`src/core/SabrStream.ts`, `SabrStreamingAdapter.ts`, `SabrUmpProcessor.ts`, `UmpReader.ts`). The primary wire-level source used throughout.
- `LuanRT/YouTube.js` @ `14825d7712e32b208830895701973a5a934a3522` — InnerTube client; `src/utils/Constants.ts` (`CLIENT_NAME_IDS`), `src/core/Player.ts`, `src/parser/classes/misc/Format.ts` (Format fields `itag`/`mimeType`/`bitrate`/`averageBitrate`/`contentLength`/`audioQuality`/`audioSampleRate`/`audioChannels`/`url`/`signatureCipher` at `:93-155`; combined sig+`n` decipher `player.decipher(url, signature_cipher, cipher, nsig_cache)` at `:255`), `src/parser/parser.ts` (`streamingData.adaptiveFormats` / `dashManifestUrl` / `hlsManifestUrl`).
- `yt-dlp/yt-dlp` @ `59d9ae606a24a80523da35de9fb75b71eb35b501` — `yt_dlp/extractor/youtube/_video.py` (SABR handling ~L3505-3545, signatureCipher parse L3521-3523), `jsc/` (n/sig JS runtime), `pot/README.md` + `pot/provider.py` (PO Token framework).

Key `file:line` anchors:
- SABR POST + headers: `googlevideo/src/core/SabrStream.ts:810-816`; body encode `SabrStreamingAdapter.ts:259`, method/POST `:304`.
- `VideoPlaybackAbrRequest` schema: `googlevideo/protos/video_streaming/video_playback_abr_request.proto:10-25`.
- `StreamerContext` / `po_token` (field 2) / `client_name` (field 16): `googlevideo/protos/video_streaming/streamer_context.proto:4-66`.
- `FormatId` `{itag,last_modified,xtags}`: `googlevideo/protos/misc/common.proto:9-13`.
- UMP part IDs: `googlevideo/protos/video_streaming/ump_part_id.proto:5-60`. UMP framing/varint: `googlevideo/src/core/UmpReader.ts:15-118`.
- `MediaHeader`: `googlevideo/protos/video_streaming/media_header.proto:7-24`. Ads context scope `CONTENT_ADS=4`: `sabr_context_update.proto:10`.
- Client name IDs (`WEB=1`,`MWEB=2`,`WEB_REMIX=67`): `YouTube.js/src/utils/Constants.ts` `CLIENT_NAME_IDS`.
- yt-dlp SABR-only web warning: `yt-dlp/yt_dlp/extractor/youtube/_video.py:3515-3536`; signatureCipher parse `:3521-3523`. InnerTube player call (`ep='player'`) `_video.py:2952`, endpoint build `_base.py:822`. `INNERTUBE_CLIENTS` table `_base.py:97-369`; default clients `('android_vr','web_safari')` `_video.py:142`; `android_vr` version-pin + SABR comment `_base.py:225,230`. `n`/sig challenge collect + solve `_video.py:3288-3348` (format dropped if unsolved `:3552-3567`), jsc provider framework `jsc/provider.py`,`jsc/_director.py`. PO-token policy table `_base.py:48-94`, `gvs_pot_required` `_video.py:3255-3259`, skip-on-missing `_video.py:3183-3193`, WebPO binding `pot/utils.py:35-61`. yt-dlp does **not** read `serverAbrStreamingUrl` (no SABR client).

Web (verified July 2026):
- yt-dlp issue #12482 — "web client only has SABR formats": https://github.com/yt-dlp/yt-dlp/issues/12482
- LuanRT/googlevideo (SABR/UMP reference): https://github.com/LuanRT/googlevideo
- LuanRT/YouTube.js: https://github.com/LuanRT/YouTube.js
- yt-dlp PO Token guide: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- yt-dlp-ytse (experimental SABR/UMP downloader plugin): https://pypi.org/project/yt-dlp-ytse/
