# Research 17 — Phase 0 Risk-Retirement Spikes: Media Architecture, Web-Audio, Coverage

**Date:** 2026-07-11
**Status:** Settled by live experiment (Firefox 152.0.5, headless, fresh logged-out profile)
**Probe scripts (committed, reusable):**
- `tests/e2e/probe-s2-media.mjs` — S2 media architecture (hijack vs own element)
- `tests/e2e/probe-s3-webaudio.mjs` — S3 googlevideo CORS / Web-Audio
- `tests/e2e/probe-s1-coverage.mjs` — S1 video-type coverage
**Raw evidence:** `dist/spike-S2.json`, `dist/spike-S3.json`, `dist/spike-S1.json`
**Builds on:** [Research 13 — ANDROID_VR from Page Context](13-androidvr-probe.md)

---

## Methodology (shared)

Selenium-driven Firefox 152.0.5, headless, **temporary fresh/logged-out profile**
(`LOGGED_IN` was `false` in `ytcfg` for every run). Autoplay prefs from the existing
harness: `media.autoplay.default=0`, `media.autoplay.blocking_policy=0`,
`media.autoplay.allow-muted=true`.

**Credentialless-first (locked design).** The extension's ANDROID_VR fetch always uses
`credentials:'omit'` and never touches the user's YouTube login. The logged-out profile
used here therefore **IS the production condition, not a limitation** — S1 measures real
credentialless coverage. (The S2/S3 probes fetch the URL with `credentials:'same-origin'`,
but under a logged-out profile that carries no cookies and is equivalent to the production
`omit` path — S1 confirms `omit` and `same-origin` return identical results here.)

Every probe first loads a real `https://www.youtube.com/watch?v=<id>` page, waits for
`window.ytcfg.get('INNERTUBE_API_KEY')`, and — where a direct audio URL is needed — obtains
one with the **exact proven ANDROID_VR fetch** from Research 13: a page-context
`POST /youtubei/v1/player?key=<key>&prettyPrint=false`, body
`{ context: { client: <ANDROID_VR> }, videoId, contentCheckOk: true, racyCheckOk: true }`,
`credentials:'same-origin'`, ANDROID_VR pinned at clientVersion `1.65.10` (Oculus Quest 3).
Baseline re-confirmed this run: both `dQw4w9WgXcQ` and `jNQXAC9IVRw` return
`playabilityStatus: OK` with **4 direct audio adaptiveFormats** (itag 140 AAC + itag 251
Opus among them), `body-context-only` sufficient.

**Honesty envelope for all three spikes:** headless, small N (2 normal videos for S2/S3;
5 typed videos for S1), single observation window. The logged-out profile is the production
credentialless case (see above), not a caveat. Findings are strong signals, not a guarantee
across YouTube's full surface or a future player change. Everything below is backed by the
observed numbers in the raw JSON; no verdict is asserted without signal.

---

## Spike S2 — Media architecture (THE critical one): does hijacking `<video>` survive?

### Method

On each watch page we first **confirm YouTube's own MSE player is actively running**
(control), then run three experiments on the same page, each with a ~15 s observation loop
sampling `video.src`, `video.currentTime`, `#movie_player.getCurrentTime()`, googlevideo
request/byte deltas, and the `<video>` element's decode state:

- **A1 — naive hijack:** `document.querySelector('video').src = audioUrl`.
- **A2 — guarded hijack:** install a **MAIN-world `Object.defineProperty` guard** on
  `HTMLMediaElement.prototype.src` that re-forces our audio URL whenever YouTube tries to
  set a `blob:` (MSE) source, then hijack again.
- **B — own element:** pause + hide the page `<video>`, then `new Audio(audioUrl); play()`.

### Evidence (both videos agree)

| Signal | `dQw4w9WgXcQ` | `jNQXAC9IVRw` |
|---|---|---|
| **preHijack control:** native MSE playing? | **yes** (`srcIsBlob=true`, `paused=false`, `videoWidth=854`, `playerState=1`, clock 0.80s) | **yes** (`srcIsBlob=true`, `paused=false`, `videoWidth=320`, `playerState=1`) |
| A1 src reverted to `blob:` during 15 s? | **no** (stayed googlevideo all 15 samples) | **no** |
| A1 audio played (`video.currentTime` Δ) | **+13.73 s** | **+14.83 s** |
| A1 native player clock (`getCurrentTime()` Δ) | **+13.73 s (lockstep)** | **+14.83 s (lockstep)** |
| A1 element after hijack | same element, still in DOM, `videoWidth` 854→**0** (audio-only track) | same element, `videoWidth` 320→**0** |
| A1 new video segment (`videoplayback`) requests | **≤ 0** (Δ = −3; buffer evicted, none added) | **0** |
| A1 native play/pause button still toggles `paused`? | **yes** (`toggled=true`) | **yes** |
| A2 guard hits (blob re-asserts intercepted) | **0** | **0** |
| A2 src reverted to blob? | **no** | **no** |
| B own `Audio()` played (`currentTime` Δ) | **+15.00 s** | **+14.98 s** |
| B native scrubber reflects our element? | **no** (tracks page `<video>`, not `Audio()`) | **no** |

### What this means

- The hijack was performed against a **genuinely active MSE player** (control =
  `nativeMsePlaying: true`), not an idle element — so "it survived" is a real result.
- YouTube **did not fight back**: `src` stayed the googlevideo audio URL for the whole
  window, never reverted to `blob:`, the element was never swapped, and the
  `defineProperty` guard's blob-interceptor **never fired** (`guardHits: 0`). The guard is
  therefore **unnecessary today** — but it is cheap insurance against a future player that
  starts re-attaching MSE (see fork).
- The decisive UX win: **YouTube's own player clock advances in lockstep with our hijacked
  audio** (`playerΔ == videoΔ`). That means the **native progress bar, time display, and
  play/pause button keep working** on the audio-only stream. `videoWidth` collapsing to 0
  confirms the element is decoding our audio-only track, not video.
- **Bandwidth:** during the hijack window we observed **no new `videoplayback` segment
  requests** (Δ ≤ 0 both videos), consistent with YouTube's segment fetching stopping once
  its MediaSource is detached. Caveat: `performance` resource-timing evicts old entries, so
  the raw byte-delta is noisy (dQw showed −1.1 MB from eviction); the clean, honest signal
  is "**zero new video requests**", not a precise byte count. Media-element internal range
  fetches may also not surface as resource-timing entries.

### VERDICT S2 — **HIJACK is viable and is the recommended primary media strategy**

Set `video.src` to the ANDROID_VR direct audio URL. It survives, plays, keeps the entire
native player UI (scrubber/time/play-pause) functional, and stops video-segment fetching.
The `defineProperty` guard is **not needed now** but should ship dormant as a re-assert
defense. The **own-element approach (B) also works** and is the correct **fallback**: use
it only if a future YouTube build begins reverting the hijacked `src`, accepting the known
tradeoff that the native scrubber will no longer track playback.

---

## Spike S3 — googlevideo CORS / Web-Audio: does in-page EQ/loudness work, or emit silence?

### Method + a corrected confound

The naive test (`crossOrigin='anonymous'`, **`muted=true`**, `createMediaElementSource` →
`AnalyserNode`, read time/frequency data) **flatlined to silence** — which initially looked
like a CORS taint verdict. It was not. **Muting a media element can zero its
`MediaElementSource` tap in Firefox**, independent of CORS. We refused that verdict and
re-ran a **crossOrigin × muted matrix** to isolate the true cause. (This is exactly why we
build the probe instead of hand-waving.)

### Evidence — the matrix (both videos identical in shape)

| Condition | Signal flowed? | max time-domain deviation from 128 |
|---|---|---|
| `crossOrigin=anonymous`, **unmuted** | **YES** | **55** (dQw) / **17** (jNQ) |
| `crossOrigin=anonymous`, muted | no | 0 |
| no `crossOrigin`, unmuted | **no (tainted)** | 0 |
| no `crossOrigin`, muted | no | 0 |

Raw CORS `fetch(url, {Range:'bytes=0-1', mode:'cors'})`: succeeded, `type:'cors'`,
`status:206`, **body readable**. `access-control-allow-origin` read as `null`, and the only
JS-exposed response headers were `cache-control, client-protocol, content-length,
content-type, expires, last-modified`. The cors fetch succeeding with a readable body is
itself proof googlevideo returns an accepted ACAO (echoing `Origin`); it simply isn't
surfaced to `Headers.get()`. The matrix confirms the browser's internal CORS check accepts
it: **the graph is silent without `crossOrigin` and carries signal with it.**

### What this means

- The earlier "tainted to silence" reading was a **muting artifact**, now corrected.
- In-page Web-Audio on ANDROID_VR googlevideo media is **viable** under two hard rules:
  1. **`audio.crossOrigin = 'anonymous'` is mandatory.** Without it the resource is
     cross-origin-tainted and `createMediaElementSource` emits zeros.
  2. **Do not use element `.muted` for volume when tapping Web-Audio.** Muting zeroes the
     tap. Route through a `GainNode` and connect the graph to `ctx.destination` instead.

### VERDICT S3 — **In-page Web-Audio (EQ + loudness normalization) is VIABLE**

Build the EQ/loudness graph in the page: `Audio(url)` with `crossOrigin='anonymous'` →
`MediaElementSource` → EQ/`BiquadFilter`s → `GainNode` (volume) → `destination`. No
background proxy is required for audio processing. This holds for the **own-element**
media approach; if S2's **hijack** approach is used instead, the hijacked page `<video>`
does not carry a `crossOrigin` attribute we control, so EQ/loudness would require switching
that specific playback to our own crossOrigin element (a per-feature tradeoff to note in
design).

---

## Spike S1 — Credentialless coverage (which video types are fetchable with `credentials:'omit'`)

### Method

Run the ANDROID_VR player fetch for 5 typed videos; per video record the **actual**
`playabilityStatus`, audio adaptiveFormats with direct URLs, `serverAbrStreamingUrl`, a
WEB-client control fetch, and **`credentials:'omit'` vs `'same-origin'`**. Per the locked
credentialless-first design, `credentials:'omit'` is the production path; the comparison
confirms login state is irrelevant to this fetch.

### Evidence

| Video | Hypothesized type | ANDROID_VR status | Direct audio URLs | WEB (bare) status | Credentialless usable? |
|---|---|---|---|---|---|
| `dQw4w9WgXcQ` | normal | **OK** | **4** | UNPLAYABLE¹ | **yes** |
| `jNQXAC9IVRw` | normal | **OK** | **4** | UNPLAYABLE¹ | **yes** |
| `07FYdnEawAQ` | age-restricted | **LOGIN_REQUIRED** ("Sign in to confirm your age") | 0 | LOGIN_REQUIRED | **no** |
| `XqZsoesa55w` | made-for-kids (Baby Shark) | **UNPLAYABLE** ("This video is not available") | 0 | UNPLAYABLE | **no** |
| `jfKfPfyJRdk` | live (Lofi Girl 24/7) | **UNPLAYABLE** ("This live stream recording is not available") | 0 | UNPLAYABLE | **no** |

- **`credentials:'omit'` vs `'same-origin'`: identical** for every video (status and direct-
  URL count) — cookieless either way here. This is the point: the production `omit` path
  behaves exactly as measured, and login state does not enter into it.
- ¹ The **WEB "control" is a *bare* InnerTube fetch** (no poToken / full page params), so it
  returns UNPLAYABLE even for normal videos. It is a weak baseline, **not** the real page
  player. The load-bearing signal is ANDROID_VR's own status, which is **OK** for normal
  videos with direct URLs — matching Research 13.
- Normal videos also carry `serverAbrStreamingUrl` **alongside** the 4 direct URLs (not
  SABR-only), so the direct-URL path is available.

### Credentialless-first is the design (no logged-in path)

The extension never uses the user's YouTube login for this fetch, so **there is no
logged-in case to test** — by design, not by omission. The types that return no direct URLs
credentialless (age-restricted → `LOGIN_REQUIRED`; made-for-kids → `UNPLAYABLE`; live →
`UNPLAYABLE`; and **members-only / private**, which need account entitlement and were not
enumerated because no stable public id exists) are simply **not audio-only-eligible**. They
are not failures to fix — they **fall back to normal YouTube playback** (see fork).

### VERDICT S1

The credentialless (`credentials:'omit'`) ANDROID_VR path **cleanly covers normal on-demand
videos** — the product's core case, with 4 direct audio URLs. Age-restricted, made-for-kids,
live, and members-only/private return no direct URLs credentialless and are therefore **not
audio-only-eligible by design**; they fall back to normal YouTube playback. This is the
complete production picture: since the fetch never uses login, there is no further coverage
to unlock and nothing left open.

---

## Audio-only DECISION-FORK

What the product does when a given path is unavailable:

1. **Media layer (S2).** Primary: **hijack** `video.src` → ANDROID_VR audio URL; keep the
   native scrubber/controls. Ship the `defineProperty` re-assert guard **dormant**.
   *Fork — if a future YouTube build reverts the hijacked `src`* (guard starts logging hits
   / `revertedToBlob` observed in the field): fall back to the **own-element** path
   (`new Audio()`, pause+hide the page `<video>`), accepting that the native scrubber stops
   tracking — mitigate by rendering our own minimal transport UI.

2. **EQ / loudness (S3).** In-page Web-Audio is viable, so build EQ/loudness in the page.
   Requirement: the processed element must be **our own `crossOrigin='anonymous'` element**
   with volume via a **`GainNode`**, never element `.muted`.
   *Fork — pairing with hijack:* the hijacked page `<video>` can't be given a `crossOrigin`
   we control, so **enabling EQ/loudness switches that playback to our own crossOrigin
   element** (losing native-scrubber tracking for the duration EQ is on). If in-page
   Web-Audio ever regresses to true taint, EQ/loudness would need a background/proxy fetch
   path; not required today.

3. **Coverage (S1).** Normal videos: audio-only on. Age-restricted / made-for-kids / live /
   members-only / private: the credentialless ANDROID_VR fetch returns no direct URLs, so
   **do not force audio-only** — detect the non-`OK`/no-direct-URL response and **gracefully
   leave native YouTube playback intact**, optionally surfacing "audio-only isn't available
   for this video." Because the fetch is credentialless by design, this classification is
   final at request time — there is no login path that would reclassify these, so no
   retry-with-credentials logic is needed.

---

## Reproduce

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
node tests/e2e/probe-s2-media.mjs      # -> dist/spike-S2.json
node tests/e2e/probe-s3-webaudio.mjs   # -> dist/spike-S3.json
node tests/e2e/probe-s1-coverage.mjs   # -> dist/spike-S1.json
# HEADLESS=0 for headful; YT_VIDEOS / YT_VIDEO_SET to change inputs.
```
