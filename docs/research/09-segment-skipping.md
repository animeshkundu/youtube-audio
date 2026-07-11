# Research 09 — Segment Skipping (SponsorBlock-style) as an Integrated Feature

**Status:** Research / design input (not yet a spec)
**Date:** 2026-07-11
**Scope sites:** youtube.com, m.youtube.com, music.youtube.com, youtube-nocookie.com (Firefox desktop + Android)
**North star:** one-stop YouTube tool — simple for the end user, powerful on demand; "ghost" posture (minimize tracking, undetectable to YouTube).

Evidence is grounded in real code that was shallow-cloned and read:

- `ajayyy/SponsorBlock` — the browser extension. HEAD commit **`4a118fb`** ("Merge pull request #2511 …"), manifest version **6.1.6**. Cloned to `/tmp/yta-research/09-segment-skipping/SponsorBlock`.
- `ajayyy/maze-utils` — shared helper submodule (hashing, video/seek helpers, request proxy). HEAD commit **`6b1ba69`**. Cloned to `/tmp/yta-research/09-segment-skipping/maze-utils`.

Citations below use `repo/path/file:line`. `SB` = SponsorBlock repo, `MU` = maze-utils repo.

---

## 1. Executive summary

**Recommended way to give low-friction segment skipping in our extension:** implement a small, self-contained SponsorBlock **client** (not a fork, not a bundled copy of the extension), talking to the **public SponsorBlock API** over the privacy-preserving **hash-prefix** endpoint, with our own minimal skip scheduler and toast. Concretely:

1. **Fetch** community segments with `GET https://sponsor.ajay.app/api/skipSegments/<prefix>` where `<prefix>` is the first few hex chars of `SHA-256(videoID)`. The server returns every video whose hash starts with that prefix; we filter locally for the exact `videoID`. This is the k-anonymity design — the server never learns which video we watched. (`SB/src/utils/segmentData.ts:57-103`.)
2. **Schedule + seek** by setting `video.currentTime = segmentEnd` on the same `<video>` element our audio-only feature already controls (`MU/src/video.ts:782-786`). Seeking composes cleanly with audio-only and background-play because both keep the media element alive.
3. **Ghost hardening — the single most important finding of this research:** SponsorBlock's own default (`trackViewCount: true`, `SB/src/config.ts:395`) sends a POST to `/api/viewedVideoSponsorTime?UUID=<segmentUUID>&videoID=<FULL videoID>` after each skip (`SB/src/content.ts` `sendTelemetryAndCount`). **That call ships the full plaintext videoID and defeats the k-anonymity of the fetch.** Our client must **never** send it, must **not** send a `userID`, and should route the fetch through the background script (no YouTube cookies / referrer). See §3.
4. **UX:** ship sensible auto-skip defaults (sponsor everywhere; `music_offtopic` on YouTube Music), a one-tap master toggle, and a compact "Skipped sponsor · Undo" toast. Advanced per-category control lives one layer deeper. See §6.

Why a client, not a bundle: SponsorBlock is ~3k lines in `content.ts` plus React options UI, submission/voting flows, DeArrow promotion, chapters, and a payments module — 90% of which is irrelevant to a "skip unwanted parts" feature and much of which (submission, voting, view-count telemetry) actively conflicts with a ghost posture. The valuable, hard part is the ~150 lines of fetch + hash + scheduling, which we reproduce and own.

**Alternative for maximum ghost:** bundle a **static, offline segment list** (periodic DB dump) so *zero* per-video requests leave the browser. Trade-off is freshness and extension size; best offered as an opt-in "offline mode" on top of the API client. See §3.4.

---

## 2. SponsorBlock mechanism (with code evidence)

### 2.1 Segment fetch

The fetch path is small and self-contained in `SB/src/utils/segmentData.ts`:

```
// SB/src/utils/segmentData.ts:62-71
const hashPrefix = (await getHash(videoID, 1)).slice(0, 5) as VideoID & HashedValue;
const hasDownvotedSegments = !!Config.local.downvotedSegments[hashPrefix.slice(0, 4)];
const response = await asyncRequestToServer('GET', "/api/skipSegments/" + hashPrefix, {
    categories: CompileConfig.categoryList,
    actionTypes: ActionTypes,
    trimUUIDs: hasDownvotedSegments ? null : 5,
    ...extraRequestData
}, {
    "X-CLIENT-NAME": extensionUserAgent(),
});
```

Key facts:

- The request path carries a **hash prefix**, never the videoID. `getHash(videoID, 1)` computes SHA-256 **once** and `.slice(0, 5)` keeps the first **5 hex chars** (`SB/src/utils/segmentData.ts:62`). (Note: SponsorBlock's own K-anonymity wiki documents *4* chars; the current extension code sends *5* for `/api/skipSegments` — a larger prefix means a *smaller* anonymity bucket. Other endpoints such as videoLabels/DeArrow still use 4: `SB/src/utils/videoLabels.ts:72,88`, `SB/src/dearrowPromotion.ts:27`.)
- Query params: the full `categories` list, the `actionTypes` list (`["skip","mute","chapter","full","poi"]`, `SB/src/types.ts:60-66`), and `trimUUIDs=5` (asks the server to truncate returned UUIDs to 5 chars to reduce data, unless the user has downvoted segments for this hash-prefix).
- One header, `X-CLIENT-NAME`, whose value is `extensionUserAgent()` = `` `${chrome.runtime.id}/v${manifestVersion}` `` (`MU/src/index.ts:71-74`) — i.e., the extension's ID and version. This is a fingerprintable client tag.
- Server address default: `https://sponsor.ajay.app` (`SB/config.json.example:2`, `SB/src/config.ts:411`). The request is built by `asyncRequestToServer` (`SB/src/utils/requests.ts:12-16`).

**Local filtering** — the client discards every returned video that isn't the exact one:

```
// SB/src/utils/segmentData.ts:74-81
const receivedSegments: SponsorTime[] = JSON.parse(response.responseText)
    ?.filter((video) => video.videoID === videoID)   // exact-match filter
    ?.map((video) => video.segments)?.[0]
    ?.map((segment) => ({ ...segment, source: SponsorSourceType.Server }))
    ?.sort((a, b) => a.segment[0] - b.segment[0]);
```

Results are cached (`DataCache`, 5 min) and in-flight requests deduped (`pendingList`) — `SB/src/utils/segmentData.ts:11-55`.

### 2.2 The prefix-hash privacy design

`getHash` is a generic iterated SHA-256 in maze-utils:

```
// MU/src/hash.ts
export async function getHash<T extends string>(value: T, times = 5000): Promise<T & HashedValue> {
    ...
    let hashHex: string = value;
    for (let i = 0; i < times; i++) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashHex).buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return hashHex as T & HashedValue;
}
```

- For **videoID lookups** it is called with `times = 1` → a single SHA-256 pass, then sliced to a short prefix.
- For **userID** it uses the default `times = 5000` (iterated hashing to derive the "public user ID" from the private local one), e.g. `SB/src/background.ts:141`, `SB/src/options.ts:616`.
- When `crypto.subtle` is unavailable (insecure context), it delegates to the background script via `chrome.runtime.sendMessage({message:"getHash"})` (`MU/src/hash.ts`).

**Privacy property (k-anonymity).** Per SponsorBlock's own wiki: *"Instead of sending the videoID to the server, it sends only the first 4 characters of that hash."* The server returns all videos sharing that prefix (the wiki's worked example returns 11 videos), and *"This list may or may not contain the videoID"* — so the server can't even be sure the user is watching any returned video. The client checks locally. Source: https://github.com/ajayyy/SponsorBlock/wiki/K-Anonymity.

### 2.3 Category set (verified, not invented)

The canonical list ships in `SB/config.json.example:5`:

```json
"categoryList": ["sponsor","selfpromo","exclusive_access","interaction",
  "poi_highlight","intro","outro","preview","hook","filler","chapter","music_offtopic"]
```

Per-category allowed **actions** (`SB/config.json.example` `categorySupport`):

| Category | Meaning | Allowed actions |
|---|---|---|
| `sponsor` | Paid promotion | skip, mute, full |
| `selfpromo` | Unpaid/self promo, merch, Patreon | skip, mute, full |
| `exclusive_access` | Whole video is sponsored access | full (label only) |
| `interaction` | "Like & subscribe" reminders | skip, mute |
| `intro` | Intro/intermission animation | skip, mute |
| `outro` | Endcards/credits | skip, mute |
| `preview` | Preview/recap of the same video | skip, mute |
| `hook` | Hook/greetings | skip, mute |
| `filler` | Tangents/jokes (aggressive) | skip, mute |
| `music_offtopic` | **Non-music section in a music video** | skip |
| `poi_highlight` | Highlight / point of interest | poi (jump-to) |
| `chapter` | Community chapters | chapter (label) |

Action types are the enum `ActionType { Skip, Mute, Chapter, Full, Poi }` (`SB/src/types.ts:52-58`). Skip options are `CategorySkipOption { FallbackToDefault=-2, Disabled=-1, ShowOverlay=0, ManualSkip=1, AutoSkip=2 }` (`SB/src/types.ts:32-38`).

**Default selections** out of the box (`SB/src/config.ts:470-482`): only **`sponsor` → AutoSkip**; `poi_highlight` → ManualSkip; `exclusive_access` and `chapter` → ShowOverlay. Any category **not** listed resolves to `Disabled` (`SB/src/utils/skipRule.ts:166-173`). So a fresh install auto-skips sponsors only; intros/outros/selfpromo/interaction/filler/music_offtopic are **off** until the user enables them.

### 2.4 Skip logic (schedule → seek), auto vs manual

**Ingest.** `sponsorsLookup()` calls `getSegmentsForVideo`, stores the result in the module-level `sponsorTimes`, merges local submissions / downvotes, hides too-short segments, then kicks scheduling (`SB/src/content.ts:1196-1255+`).

**Schedule.** `startSponsorSchedule()` (`SB/src/content.ts:652-782`) is the heart:
- Bails while an **ad** is playing (`getIsAdPlaying()`, `SB/src/content.ts:656-663`) — important, YouTube ads are not part of the timeline SponsorBlock skips.
- Picks the next segment via `getNextSkipIndex()` (`SB/src/content.ts:1539+`).
- Computes `timeUntilSponsor` and schedules the skip. If it's near-term it uses a `setInterval(...,0)` busy-check for frame-accurate skipping; otherwise a `setTimeout` fired slightly early. Crucially the delay is **playback-rate aware**: `delayTime = timeUntilSponsor * 1000 * (1 / video.playbackRate)` (`SB/src/content.ts:787`), with Firefox-specific precision offsets (`600ms`/`750ms` thresholds, `SB/src/content.ts:788-834`) because Firefox reports `currentTime` in coarse steps.

**Seek.** `skipToTime()` (`SB/src/content.ts:1760-1853`) performs the actual jump. For a `Skip`/`Poi`/`Chapter` action it calls `setCurrentTime(skipTime[1])` (the segment's end), with edge-case handling for looped videos, end-of-video, and macOS/playlist looping (`SB/src/content.ts:1769-1804`). For a `Mute` action it sets `v.muted = true` instead of seeking. `setCurrentTime` is the one-liner that matters for us:

```
// MU/src/video.ts:782-786
export function setCurrentTime(time: number): void {
    if (getVideo()) {
        getVideo()!.currentTime = time + adDuration;
    }
}
```

**Auto vs manual.** `shouldAutoSkip(segment)` (`SB/src/content.ts:1959-1972`) returns true when the category's option is `AutoSkip` (or when the music-video auto-skip profile applies — see §4). `shouldSkip()` (`SB/src/content.ts:1974-1981`) gates whether a skip happens at all (option `> ShowOverlay`, i.e. ManualSkip or AutoSkip, and segment visible). Manual/overlay segments don't seek automatically; they surface UI.

### 2.5 Skip UI / notice

- **Auto-skip toast:** `createSkipNotice` → `SkipNotice` React component (`SB/src/content.ts:1855-1874`, `SB/src/components/SkipNoticeComponent.tsx`), an unobtrusive corner notice with an **Undo/re-skip** control; auto-dismisses after `skipNoticeDuration` (default 4s, `SB/src/config.ts:413`). If `dontShowNotice` is set and it was an auto-skip, no notice is shown but an "undo" keybind element is still wired (`SB/src/content.ts:1835-1847`).
- **Manual skip button:** `skipButtonControlBar` (`SB/src/js-components/skipButtonControlBar.ts`) renders an in-player "Skip" button for POI/manual segments.
- **Seek-bar overlay:** `previewBar` (`SB/src/js-components/previewBar.ts`, driven by `updatePreviewBar`, `SB/src/content.ts:1417-1452`) colors each segment on the scrub bar.
- Optional **beep** before an auto-skip when `audioNotificationOnSkip` is on (default off, `SB/src/config.ts:414`, played in `skipToTime` `SB/src/content.ts:1807-1820`).

---

## 3. Privacy / ghost analysis

### 3.1 What actually leaves the browser (public API path)

Per fetched request (`SB/src/utils/segmentData.ts`, `MU/src/background-request-proxy.ts:27-47`):

- **URL:** `GET /api/skipSegments/<5-hex-prefix>?categories=[…]&actionTypes=[…]&trimUUIDs=5`. The prefix is `SHA-256(videoID)` truncated — the exact videoID is **not** sent.
- **Header:** `X-CLIENT-NAME: <extensionId>/v<version>` — reveals which extension/version is asking (fingerprint surface). `Content-Type: application/json` is added by the proxy.
- **Network layer:** the server sees your **IP address** and TLS metadata. The hash-prefix protects *which video*, not *that you use SponsorBlock from IP X at time T*.
- **Cookies/referrer:** the request is dispatched by a plain `fetch()` (`MU/src/background-request-proxy.ts:36-44`) that is **proxied through the background script** (`setupBackgroundRequestProxy`, `MU/src/background-request-proxy.ts:86+`). `fetch` defaults to `credentials: 'same-origin'`, so this cross-origin call to `sponsor.ajay.app` sends **no cookies**, and running from the extension background means **no YouTube referrer/Origin** leaks. Good baseline for ghost.

### 3.2 The k-anonymity mitigation — and its big hole

The prefix hash means: for a bucket of videos sharing a 4–5 char SHA-256 prefix, the server can't tell which one you fetched, or even that you watched any of them. That's the intended protection.

**But the default telemetry breaks it.** With `trackViewCount` (default **true**, `SB/src/config.ts:395`), after every full auto-skip the extension fires:

```
// SB/src/content.ts  (sendTelemetryAndCount)
if (fullSkip) asyncRequestToServer("POST",
    "/api/viewedVideoSponsorTime?UUID=" + segment.UUID + "&videoID=" + getVideoID())
```

This sends the **full plaintext `videoID`** plus the segment `UUID` — directly linking your IP to the exact video. SponsorBlock's own wiki flags this: *"if you … do skip a segment, then the server does get access [to] that segment ID, which is directly linked to the video."* (https://github.com/ajayyy/SponsorBlock/wiki/K-Anonymity). **For a ghost posture this call must be removed entirely** — it is the difference between "server sees a hash bucket" and "server sees exactly what you watched."

Similarly, submission/voting endpoints (`POST /api/skipSegments`, `SB/src/content.ts:2510`) send full videoIDs and the public `userID`; a ghost client should not implement them at all.

### 3.3 Public API vs self-host vs static list

| Option | What leaves the browser | Freshness | Effort / cost | Ghost fit |
|---|---|---|---|---|
| **Public API** (`sponsor.ajay.app`) | IP + hash-prefix + categories + client tag per video (no telemetry if we disable it) | Real-time community DB | None (just HTTP) | **Good** if telemetry disabled, `userID` never sent, request proxied. IP still visible to a third party. |
| **Self-host / mirror** (`sb-mirror`, TeamPiped) | Same shape, but to *our* server | Near real-time (rsync) | High (infra, sync, uptime) | Best for org control, but the IP now goes to a server *we* run — for a single-dev tool this mostly moves the trust, adds ops. |
| **Static bundled dump** (periodic DB export) | **Nothing per-video** | Stale between updates; large | Medium (ship + refresh a DB) | **Strongest ghost** — zero per-video network calls; extension size + freshness cost. |

Sources: DB dumps & mirrors — https://sponsor.ajay.app/database.json, `mchangrh/sb-mirror` (rsync → SQLite), `TeamPiped/sponsorblock-mirror` (Rust mirror API). Data is CC BY-NC-SA 4.0 (non-commercial; fine for a single-dev tool per our licensing-agnostic scope, but attribution/share-alike apply if redistributed).

### 3.4 Recommendation

Default to the **public API client, telemetry-stripped**, and offer an opt-in **offline mode** for privacy maximalists:

1. **Never** call `/api/viewedVideoSponsorTime` (no view-count ping). Hard-code off; don't even ship the code path.
2. **Never** generate or send a `userID`; don't implement submission/voting.
3. Route fetches through the **background script** (no cookies/referrer), keep `credentials: 'omit'` explicitly.
4. Send the **shortest reasonable prefix** (4 hex chars, matching the documented k-anonymity, not 5) and only the categories the user actually enabled — smaller category list = less to correlate.
5. Consider dropping or genericizing `X-CLIENT-NAME` (it's optional; a static string avoids version fingerprinting).
6. Optional **offline mode**: bundle/refresh a pruned DB dump (only skip/mute action types, only enabled categories) so nothing leaves the browser. This is the true "undetectable" tier.

None of these calls touch YouTube's own servers, so **YouTube cannot see** that we use SponsorBlock — the only third party is the SponsorBlock server (or none, in offline mode). This aligns with the ghost goal: YouTube-undetectable by construction; SponsorBlock-server exposure minimized to a hash bucket + IP.

---

## 4. YouTube Music & non-music skipping

**Yes, SponsorBlock supports `music.youtube.com`.** The domain is first-class:

```
// MU/src/const.ts
export const YT_DOMAINS = [
  "m.youtube.com", "www.youtube.com", "www.youtube-nocookie.com",
  "music.youtube.com", "www.youtubekids.com", "tv.youtube.com"
]
```

Detection sets `onYouTubeMusic` when `urlObject.host === "music.youtube.com"` (`MU/src/video.ts:329`), exposed via `isOnYouTubeMusic()` (`MU/src/video.ts:796-798`).

**The `music_offtopic` category** marks non-music sections *inside* a music video (talking intros, outros, credits). It only supports the **skip** action (`SB/config.json.example` `categorySupport.music_offtopic: ["skip"]`) — no mute, no chapter.

**Two config flags govern music behavior** (`SB/src/config.ts`):
- `autoSkipOnMusicVideos` (default **false**, `SB/src/config.ts:425`) — when on, treats `music_offtopic` (and, per `shouldAutoSkip`/`shouldSkip`, the surrounding skip segments) as auto-skip even on regular YouTube.
- `skipNonMusicOnlyOnYoutubeMusic` (default **false**, `SB/src/config.ts:426`) — when on, `music_offtopic` is only skipped on `music.youtube.com`, not on regular youtube.com.

The gating lives in `shouldAutoSkip` (`SB/src/content.ts:1959-1972`):

```
const canSkipNonMusic = !Config.config.skipNonMusicOnlyOnYoutubeMusic || isOnYouTubeMusic();
if (segment.category === "music_offtopic" && !canSkipNonMusic) return false;
```

So on YouTube Music, enabling `music_offtopic` gives you "jump straight to the music" — the intro chatter/outro of a track is skipped. **DOM/time differences:** YT Music uses the same underlying `<video>` element and `video.currentTime` seek (the whole `MU/src/video.ts` seek path is host-agnostic); the practical differences are UI-chrome selectors (player controls, where the toast/preview-bar attach), not the skip mechanism. For our integration, `music_offtopic` on YT Music is the single highest-value "one-stop" win and should be a default-on auto-skip *on music.youtube.com*.

---

## 5. Firefox desktop + Android notes

**Manifest (MV2, gecko):**

```
// SB/manifest/firefox-manifest-extra.json
"browser_specific_settings": {
  "gecko":         { "id": "sponsorBlocker@ajay.app", "strict_min_version": "102.0" },
  "gecko_android": { "strict_min_version": "113.0" }
},
"background": { "persistent": false }
```

- **Firefox Android is officially supported** as a native add-on from Fenix **113+** (`gecko_android.strict_min_version: "113.0"`). Confirmed externally: SponsorBlock installs from AMO on Firefox for Android and works on the YouTube *website* in the browser (not the native YouTube app). Sources: https://addons.mozilla.org/en-US/firefox/addon/sponsorblock/ .
- **Content-script registration** (`SB/manifest/manifest-v2-extra.json`): `run_at: "document_start"`, `all_frames: true`, matches `https://*.youtube.com/*` and `https://www.youtube-nocookie.com/embed/*`, excludes the cookie-rotate page. Host permission is `https://sponsor.ajay.app/*` with `optional_permissions: ["*://*/*"]` (for self-host/Invidious).
- **Mobile specifics in code:** `isOnMobileYouTube()` (`MU/src/video.ts:792`) drives small behavioral differences — e.g. skip notices suppress keybind hints on mobile (`SB/src/content.ts:1827,1870`), and `getVideo()` has an `m.youtube.com` re-attach path for when `video.duration` is `NaN` (`MU/src/video.ts:738-744`). The skip mechanism itself is identical across desktop/Android.
- **Our extension already targets Firefox desktop + Android**, so we inherit this model directly: one MV2 content script, `document_start`, same host matches, plus a `https://sponsor.ajay.app/*` host permission (or none, in offline mode).

---

## 6. Integration design for OUR extension

### 6.1 Reuse vs bundle vs API — decision

**Reuse the client *approach*; call the public *API*; do not bundle the extension.** Write ~150–250 lines we own:
- a `hashVideoId(videoID)` helper (SHA-256 once via `crypto.subtle`, take 4 hex chars — mirrors `MU/src/hash.ts` with `times=1`),
- a `fetchSegments(videoID, enabledCategories)` that GETs `/api/skipSegments/<prefix>` and filters locally (mirrors `SB/src/utils/segmentData.ts`), telemetry-free,
- a `SkipScheduler` that watches the shared `<video>` and seeks (mirrors the safe subset of `startSponsorSchedule`/`skipToTime`).

Rejected: **forking** SponsorBlock (drags in submission UI, voting, DeArrow, chapters, payments, React options — huge surface, conflicting telemetry defaults). Rejected as *default*: **bundling a full DB** (size + staleness) — offer as opt-in offline mode instead (§3.4).

### 6.2 Composition with audio-only + background play

This is where our one-stop story is actually *better* than a standalone SponsorBlock, because we already own the media element:

- **Seeking is just `video.currentTime = end`** (`MU/src/video.ts:782`). Our audio-only feature must keep the `<video>` element attached (audio-only should *disable the video track / hide the surface*, not remove the element). If audio-only detaches or replaces the element, the scheduler needs the same live reference — so expose one shared `getMediaElement()` both features use. **Design rule: audio-only and segment-skip must operate on the same media element handle.**
- **Ads:** skip only when no ad is playing (mirror `getIsAdPlaying()` bail, `SB/src/content.ts:656`). Ad time also offsets `currentTime` in SponsorBlock via `adDuration` (`MU/src/video.ts:761-786`); if our audio-only path affects ad handling, account for the same offset.
- **Background play / hidden tabs:** browsers throttle `setTimeout`/`setInterval` in background tabs, and SponsorBlock's near-skip logic leans on tight timers (`SB/src/content.ts:805-834`). If our "keep playing in background" feature is active, prefer scheduling the *next* skip off the `timeupdate` event (fires while audio plays) or a coarse interval, and re-arm on `seeked`/`ratechange`, so skips still fire when the tab is hidden. Respect `video.playbackRate` in the delay math (`SB/src/content.ts:787`).
- **Mute-action segments** just set `video.muted` — coexists trivially with audio-only.

### 6.3 UX — simple yet powerful

Default profile (low-friction, ghost-safe):
- **On by default, auto-skip:** `sponsor`. On `music.youtube.com` also `music_offtopic` (the "jump to the music" win). Everything else **off** by default (matches SponsorBlock's conservative default, `SB/src/config.ts:470`, and avoids over-skipping complaints).
- **Master toggle** in the popup: "Skip sponsors & intros" on/off — one tap.
- **One expandable section** with per-category chips (Sponsor / Self-promo / Intro / Outro / Interaction / Filler / Non-music) each cycling Off → Auto-skip (we can collapse ShowOverlay/ManualSkip into just "Auto-skip / Off" for simplicity; power users get manual later).
- **Feedback toast:** compact "Skipped sponsor · Undo" that auto-dismisses (~4s, like `skipNoticeDuration`), with an Undo that seeks back to the segment start (mirror `unskipSponsorTime`). Make it silent by default (`audioNotificationOnSkip` off).
- **Seek-bar tint** (optional, desktop): color enabled segments on the scrub bar so users see what will be skipped (mirror `previewBar`). Cheap trust-builder.
- **Privacy switch:** an "Offline segment list (no network)" toggle that flips to the bundled DB (§3.4) for ghost maximalists, plus a always-on guarantee in copy: "we never tell any server which exact video you watch."

### 6.4 Minimal data model to adopt

Reuse the segment shape (`SB/src/types.ts:78-93`): `{ segment: [start,end], category, actionType, UUID }`. Our scheduler only needs `segment` + `category` + `actionType`; drop `UUID` unless we do local downvote/hide. Keep `CategorySkipOption`/`ActionType` semantics but we can expose only `Off`/`AutoSkip` in UI.

---

## 7. Risks & honest caveats

- **IP exposure remains** on the public-API path — k-anonymity hides *which video*, not *that you queried from your IP*. Only offline mode removes this. State it plainly to users.
- **Prefix length nuance:** the live extension sends 5 hex chars for skipSegments (smaller anonymity set than the documented 4). We should use 4.
- **Over-skipping / bad segments** exist in community data; conservative defaults + an easy Undo mitigate complaints. Consider honoring `locked`/vote fields if we later ingest them.
- **YouTube DOM churn:** toast/preview-bar attachment selectors break periodically; the *seek* mechanism (`video.currentTime`) is stable, so degrade gracefully (skips keep working even if the toast fails to render).
- **CC BY-NC-SA data:** fine to consume for a private single-dev tool; if we ever redistribute a bundled dump, attribution + share-alike apply.

---

## 8. References

**Repositories (read locally):**
- `ajayyy/SponsorBlock` @ `4a118fb` (manifest v6.1.6) — client fetch/hash/skip/UI. https://github.com/ajayyy/SponsorBlock
- `ajayyy/maze-utils` @ `6b1ba69` — hashing, video/seek helpers, request proxy. https://github.com/ajayyy/maze-utils

**Key file:line evidence:**
- Fetch + local filter: `SB/src/utils/segmentData.ts:57-103`
- Iterated SHA-256 hash: `MU/src/hash.ts` (whole file)
- Request builder / server address: `SB/src/utils/requests.ts:12-16`; `SB/config.json.example:2`
- Raw fetch (cookies/referrer/creds): `MU/src/background-request-proxy.ts:27-47,86+`
- Categories + actions: `SB/config.json.example:5-24`; `SB/src/types.ts:32-66`
- Default selections: `SB/src/config.ts:470-482`; fallback→Disabled `SB/src/utils/skipRule.ts:166-173`
- Schedule (playback-rate aware, Firefox precision): `SB/src/content.ts:652-834`
- Seek: `SB/src/content.ts:1760-1853`; `MU/src/video.ts:782-786`
- Auto/manual decision: `SB/src/content.ts:1959-1981`
- **View-count telemetry leak:** `SB/src/content.ts` `sendTelemetryAndCount`; default `SB/src/config.ts:395`
- YouTube Music detection + gating: `MU/src/const.ts` `YT_DOMAINS`; `MU/src/video.ts:329,796`; `SB/src/content.ts:1959-1972`; flags `SB/src/config.ts:425-426`
- Firefox/Android manifest: `SB/manifest/firefox-manifest-extra.json`; content script `SB/manifest/manifest-v2-extra.json`

**Web sources:**
- K-Anonymity design: https://github.com/ajayyy/SponsorBlock/wiki/K-Anonymity
- API docs: https://wiki.sponsor.ajay.app/w/API_Docs , https://sponsor.ajay.app/apiDocs/
- Category types: https://wiki.sponsor.ajay.app/w/Types
- Firefox Android install: https://addons.mozilla.org/en-US/firefox/addon/sponsorblock/
- DB dumps / self-host: https://sponsor.ajay.app/database.json , https://github.com/mchangrh/sb-mirror , https://github.com/TeamPiped/sponsorblock-mirror
