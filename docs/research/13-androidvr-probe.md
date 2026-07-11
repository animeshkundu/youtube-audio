# Research 13 — ANDROID_VR from Page Context: Direct Audio URL Probe

**Date:** 2026-07-11
**Status:** Settled by live experiment (Firefox 152, headless, fresh logged-out profile)
**Probe script:** `tests/e2e/probe-androidvr.mjs` (committed, reusable)
**Raw evidence:** `dist/androidvr-probe.json`

## The question

Can our extension, from **page context** inside a real `youtube.com` tab, issue an
InnerTube `/youtubei/v1/player` request impersonating the **ANDROID_VR** client and get
back a **directly-playable audio URL** usable in our own `<audio>` element? Or is it
blocked by PoToken / `n`-scrambling / CORS / User-Agent / login state?

This decides whether "re-fetch the player response as ANDROID_VR from page context" is a
viable audio-only strategy.

## The experiment

Selenium-driven Firefox 152, headless, **temporary fresh/logged-out profile** (default —
a clean, cookie-light test; `LOGGED_IN` was `false` in `ytcfg`). Prefs from the existing
harness: `media.autoplay.default=0`, `media.autoplay.allow-muted=true`.

Per video (`dQw4w9WgXcQ`, `jNQXAC9IVRw`):

1. Load `https://www.youtube.com/watch?v=<id>`, wait for `window.ytcfg.get('INNERTUBE_API_KEY')`.
2. In page context read `INNERTUBE_API_KEY`, `INNERTUBE_CONTEXT`, `visitorData`.
3. `POST /youtubei/v1/player?key=<key>&prettyPrint=false`, JSON, `credentials:'same-origin'`:
   - **CONTROL** = page's native WEB client context.
   - **TEST** = `context.client` overridden to yt-dlp's ANDROID_VR client.
4. Record `playabilityStatus`, `streamingData`, audio `adaptiveFormats` (direct `url` vs
   `signatureCipher`), `serverAbrStreamingUrl`.
5. **Decisive playability test** (media-element load is exempt from fetch/CORS read limits):
   `const a = new Audio(url); a.muted = true; a.play()`, wait 6 s, read
   `currentTime / readyState / networkState / error.code`. `currentTime > 0` = genuinely
   playable in-browser.

### Request bodies used

Common body: `{ context: { client: <CLIENT> }, videoId, contentCheckOk: true, racyCheckOk: true }`,
header `Content-Type: application/json`, `credentials:'same-origin'`. `visitorData` from
`ytcfg` was merged into `client`.

**CONTROL client** = the page's own WEB context (`clientName: WEB`, `clientVersion:
2.20260708.00.00`, Firefox UA, etc.).

**TEST client** (exact yt-dlp `ANDROID_VR`, `yt_dlp/extractor/youtube/_base.py`, master):

```json
{
  "clientName": "ANDROID_VR",
  "clientVersion": "1.65.10",
  "deviceMake": "Oculus",
  "deviceModel": "Quest 3",
  "osName": "Android",
  "osVersion": "12L",
  "androidSdkVersion": 32,
  "userAgent": "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  "hl": "en",
  "gl": "US"
}
```

**Which fields were required:** the FIRST variant — **body `context.client` only, no
special headers** — returned HTTP 200 with `playabilityStatus: OK` and direct audio URLs
for both videos. No `X-Youtube-Client-Name/Version`, no `X-Goog-Visitor-Id`, no
`signatureTimestamp`, no PoToken were needed. (`clientVersion` is pinned to `1.65.10` on
purpose: yt-dlp warns versions > 1.65 can force SABR-only responses. `INNERTUBE_CONTEXT_CLIENT_NAME`
for this client is `28`.)

## Per-video raw results

### `dQw4w9WgXcQ` (Rick Astley) — logged out

| | CONTROL (WEB) | TEST (ANDROID_VR) |
|---|---|---|
| HTTP | 200 | 200 |
| `playabilityStatus` | **UNPLAYABLE** ("Video unavailable") | **OK** |
| `streamingData` | absent | present |
| audio adaptiveFormats | 0 | 4 (itags 139, 140, 249, 251) |
| audio with direct `url` | 0 | **4** |
| audio with `signatureCipher` | 0 | **0** |
| `n` param in url | — | **none** |
| `serverAbrStreamingUrl` | absent | present (SABR fallback also offered) |
| `<audio>` playback | not attempted (no url) | itag 140 m4a: **currentTime 5.98 s**, readyState 4, no error, `played=true` |

### `jNQXAC9IVRw` (Me at the zoo) — logged out

| | CONTROL (WEB) | TEST (ANDROID_VR) |
|---|---|---|
| HTTP | 200 | 200 |
| `playabilityStatus` | **UNPLAYABLE** ("Video unavailable") | **OK** |
| `streamingData` | absent | present |
| audio adaptiveFormats | 0 | 4 (itags 139, 140, 249, 251) |
| audio with direct `url` | 0 | **4** |
| audio with `signatureCipher` | 0 | **0** |
| `serverAbrStreamingUrl` | absent | present |
| `<audio>` playback | not attempted (no url) | itag 251 opus: **currentTime 6.00 s**, readyState 4, no error, `played=true` |

Playback event sequence for the ANDROID_VR URL (both videos):
`waiting → loadedmetadata → canplay → playing → suspend`. `currentTime` reaching ~6 s
inside a 6 s wait window is real-time streaming, not a buffered stall. A sample direct URL
contained `c=ANDROID_VR`, `mime=audio/webm`, an already-resolved `sig=…` (baked in by the
server), and **no `n=` param**.

## VERDICT

**(a) Does ANDROID_VR-from-page-context return direct audio URLs?**
**Yes.** Both videos returned `playabilityStatus: OK` with 4 audio formats, every one
carrying a direct `url` and **zero** `signatureCipher`. The URLs contain no `n` throttle
param and a server-baked `sig`, so **no client-side signature descrambling and no `n`
function is required.**

**(b) Do they actually PLAY in an in-browser audio element?**
**Yes — proven.** `new Audio(url)` (muted, autoplay) reached `readyState 4`
(HAVE_ENOUGH_DATA), fired `playing`, and advanced `currentTime` to ~6 s within the 6 s
window, with `error.code = null`, on both videos. This is the decisive evidence: the URL is
genuinely playable in our own element.

**(c) Caveats.**
- **CONTROL (naive WEB re-fetch) fails.** A raw page-context WEB player POST returned
  `UNPLAYABLE / "Video unavailable"` with no `streamingData`. The real web player relies on
  PoToken / `signatureTimestamp` / proper `playbackContext` that a naive re-fetch lacks.
  **ANDROID_VR is what sidesteps this** — that is the whole point.
- **No PoToken required** for ANDROID_VR here (logged out). This matches yt-dlp: ANDROID_VR
  is currently a PoToken-exempt client.
- **User-Agent mismatch is harmless.** JS cannot set the real HTTP `User-Agent` header, so
  the request went out with Firefox's UA while the body advertised the Oculus UA. YouTube
  did **not** block on this mismatch.
- **CORS is a non-issue.** The player POST is same-origin (`youtube.com → youtube.com`), and
  media-element loads of cross-origin `googlevideo.com` are allowed without CORS reads. We
  never need to `fetch()` the audio bytes ourselves.
- **`serverAbrStreamingUrl` is present** alongside the direct URLs. Direct URLs only remain
  available because we pinned `clientVersion` to `1.65.10`; yt-dlp warns > 1.65 can flip the
  server into **SABR-only** (no direct URLs), which would break this strategy. Treat the
  version string as load-bearing and monitor it.
- **URLs are IP- and time-bound** (`ip=…`, `expire=…` ~6 h). Fine for streaming in the same
  tab/session; they are not shareable or long-lived.
- **"Made for kids" content:** yt-dlp documents that ANDROID_VR cannot play kids videos
  (would return UNPLAYABLE). Not hit by our two test videos, but a real limitation.
- **Logged-out only.** This run used a fresh logged-out profile. Logged-in behaviour
  (web cookies sent same-origin) was not tested and should be verified before relying on it
  for signed-in users; it may change gating or trigger consent flows.

**(d) Is this a viable audio-only strategy?**
**Yes, conditionally viable — validated by advancing `currentTime`.** For logged-out
sessions (and pending a logged-in re-test), the extension can, from page context:
1. POST `/youtubei/v1/player` as `ANDROID_VR` (`clientVersion ≤ 1.65.10`, body context only,
   same-origin creds) using the page's `INNERTUBE_API_KEY`;
2. read a direct audio `url` from `streamingData.adaptiveFormats` (no descrambling needed);
3. feed it to our own `<audio>` element.

Conditions/risks to manage: pin/monitor `clientVersion` (SABR-only cutover risk), accept
that "made for kids" videos are unavailable via this client, treat URLs as IP/time-bound,
and re-run this probe for the logged-in case. The probe (`tests/e2e/probe-androidvr.mjs`)
is committed so this can be re-verified whenever YouTube changes behaviour.
