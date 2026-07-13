# Live Firefox E2E results — 2026-07-11

## Scope and method

This was a logged-out-only, non-gating wild verification against real `youtube.com`, `music.youtube.com`, Googlevideo, SponsorBlock, and LRCLIB using Firefox, geckodriver, Selenium, and the BENCH-instrumented MV2 XPI. Settings were seeded through the extension's own pinned-UUID options page and `browser.storage.local`, matching the production settings path. No Google or YouTube account was used.

The reusable runner is `tests/e2e/probe-live-features.mjs`. Full machine evidence from the final run is in the local non-source artifact `dist/live-e2e-results-final.json`; the table below preserves the review-relevant observations without signed media URLs.

Status meanings:

- **PASS**: observed working on a real public service in Firefox.
- **FAIL-PRODUCT**: a reproducible product defect.
- **FAIL-ENVIRONMENTAL**: the requested observation could not be made because the public service did not expose a stable qualifying state or response.
- **N-A**: not applicable to the scenario.

## Video IDs

| Purpose                                                      | Video ID      | Observation                                                    |
| ------------------------------------------------------------ | ------------- | -------------------------------------------------------------- |
| Stable normal playback                                       | `dQw4w9WgXcQ` | Public, logged-out, playable                                   |
| Second stable SPA target / no configured SponsorBlock ranges | `M7lc1UVf-VE` | Public, logged-out, playable                                   |
| Made for kids                                                | `XqZsoesa55w` | Public, logged-out, native fallback played                     |
| Requested live example                                       | `jfKfPfyJRdk` | Its live recording was unavailable during the run              |
| Candidate age-restricted example                             | `7E9Ed9DUQoQ` | No longer age-gated in this region/session; played normally    |
| Unavailable sentinel                                         | `___________` | YouTube reported “This video isn't available anymore”          |
| Real SponsorBlock data                                       | `0e3GPea1Tyg` | Six real `sponsor` skip ranges, including `[861.096, 869.757]` |

## Feature × scenario matrix

| Feature           | Scenario                          |                             Result | Wild evidence                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------- | ---------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio-only        | Normal video                      |                           **PASS** | `dQw4w9WgXcQ`: `ytaStatus=active`; current source was an itag 251 `googlevideo.com/videoplayback` URL; `videoWidth=0`; time advanced past 2 s with no media error.                                                                                                          |
| Audio-only        | Made for kids                     |                           **PASS** | `XqZsoesa55w`: `ytaStatus=fallback`; native blob video remained playing at 854 px width. The page was not broken.                                                                                                                                                           |
| Audio-only        | Live stream                       |             **FAIL-ENVIRONMENTAL** | `jfKfPfyJRdk` currently said “This live stream recording is not available.” The extension safely emitted `fallback`, but a currently-live native playback stream was not available to exercise.                                                                             |
| Audio-only        | Age-restricted / `LOGIN_REQUIRED` |             **FAIL-ENVIRONMENTAL** | Candidate `7E9Ed9DUQoQ` was no longer age-restricted in the observed logged-out region. It returned playable direct audio and correctly became `active`; no stable `LOGIN_REQUIRED` specimen was obtained.                                                                  |
| Audio-only        | Unavailable/deleted ID            |                           **PASS** | `___________`: `ytaStatus=fallback`, no Googlevideo hijack, YouTube's unavailable page remained intact.                                                                                                                                                                     |
| Audio-only        | SPA navigation                    |                           **PASS** | Same browser page navigated from `dQw4w9WgXcQ` to `M7lc1UVf-VE`; both ended `active` with distinct Googlevideo audio sources, `videoWidth=0`, and advancing time.                                                                                                           |
| Audio-only        | Toggle off                        |                           **PASS** | On `dQw4w9WgXcQ`, the in-player toggle read `aria-pressed=false` / “Audio-only is off”; native blob video played at 854 px width with no Googlevideo hijack.                                                                                                                |
| Background play   | On                                |                           **PASS** | Synthetic `visibilitychange` was swallowed; page observer was not called; `document.hidden=false` and `visibilityState=visible`.                                                                                                                                            |
| Background play   | Off                               |                           **PASS** | Synthetic `visibilitychange` reached the page observer.                                                                                                                                                                                                                     |
| Ghost / telemetry | Conservative on                   |                           **PASS** | Page `fetch('/api/stats/qoe…')` rejected while `/youtubei/v1/log_event…` fulfilled. Audio-only's real `/youtubei/v1/player` request and playback also succeeded.                                                                                                            |
| Ghost / telemetry | Off                               |                           **PASS** | The same qoe fetch fulfilled with HTTP 204.                                                                                                                                                                                                                                 |
| Ad block          | On, page player fetch             |             **FAIL-ENVIRONMENTAL** | A page-originated real `/youtubei/v1/player` probe returned `UNPLAYABLE` with neither streaming data nor ad fields, so there was no live ad payload to prove pruning. Playback itself remained healthy.                                                                     |
| Ad block          | Off, page player fetch            |             **FAIL-ENVIRONMENTAL** | The control request also returned `UNPLAYABLE` and no ad fields. This cannot distinguish pruning from YouTube returning an ad-free/non-playable response. Hermetic on/off payload verification remains green.                                                               |
| Segment skip      | Real video with segments          |                           **PASS** | SponsorBlock supplied six real ranges for `0e3GPea1Tyg`; `ytaSkipArmed=6`. Moving the real player into the first range and dispatching its real `timeupdate` path advanced it to `869.757`, the exact segment end.                                                          |
| Segment skip      | Video without ranges              |                           **PASS** | `M7lc1UVf-VE`: native video played, `ytaSkipArmed` remained absent, no breakage.                                                                                                                                                                                            |
| Segment skip      | Off                               |                           **PASS** | `0e3GPea1Tyg`: native video played and no skip marker armed. The absence of a SponsorBlock request is hermetic/fixture-verified because Firefox Selenium does not expose extension background request logs on this live surface.                                            |
| Quality of life   | Force max quality                 |                           **PASS** | With `forceQualityMax=1080p`, the real player's current quality was `hd1080`; the available list also included 1440p/2160p, proving the observed value was the configured cap rather than the maximum available.                                                            |
| Quality of life   | Hide Shorts                       |                           **PASS** | Real Shorts shelf matched and computed `display:none`.                                                                                                                                                                                                                      |
| Quality of life   | Hide recommendations              |                           **PASS** | Real `#secondary` matched and computed `display:none`.                                                                                                                                                                                                                      |
| Quality of life   | Hide comments                     |                           **PASS** | Real comments matched and computed `display:none`.                                                                                                                                                                                                                          |
| Quality of life   | Controls off                      |                           **PASS** | No extension distraction stylesheet; real `#secondary` and comments computed `display:block`.                                                                                                                                                                               |
| YouTube Music     | Loudness graph                    |                           **PASS** | Logged-out `music.youtube.com/watch?v=dQw4w9WgXcQ` played; `ytaAudioGraph={"gain":0.8922776401332786}`.                                                                                                                                                                     |
| YouTube Music     | Lyrics opt-in                     | **PASS with retry / flaky remote** | One final run did not receive lyrics, but an immediately preceding identical logged-out run rendered 46 LRCLIB lines and the lyrics element. The deterministic packaged bench also observed the opt-in `/api/get`. Treat live LRCLIB availability as flaky, not guaranteed. |
| Download          | Enabled                           |                           **PASS** | Real player download control was visible. Clicking it changed title to “Audio download started”; BENCH marker contained a freshly selected itag 251 Googlevideo URL and sanitized `.webm` filename.                                                                         |
| Download          | Disabled                          |                           **PASS** | The control existed for instant settings support but was hidden; no download marker appeared.                                                                                                                                                                               |
| In-player UI      | Audio-only control                |                           **PASS** | Real YouTube player controls contained `#yta-audio-only-toggle.ytp-button`; `aria-pressed` and label reflected on/off state.                                                                                                                                                |

## Product bugs

No reproducible product bug was found, so no production code was changed.

The apparent failures were external-observability limitations:

1. The requested live ID was no longer live/playable.
2. The candidate age-restricted ID was no longer age-gated for this logged-out region.
3. Real page-originated player probes returned an `UNPLAYABLE`, ad-free shape in both ad-block states.
4. LRCLIB live lyrics were intermittent across identical sessions.

No gate was weakened and no test was relaxed.

## Wild-verified vs fixture-verified

### Wild-verified

- Audio-only direct Googlevideo hijack, advancing playback, native fallback, off state, and SPA re-arm.
- Logged-out made-for-kids fallback and unavailable-page fail-open behavior.
- Background visibility suppression on/off.
- Conservative qoe blocking, preserved `log_event`, and ghost-off behavior.
- SponsorBlock real k-anonymous result arming and real player seek to a segment end.
- Real quality cap, Shorts/recommendations/comments CSS on/off.
- YouTube Music Web Audio loudness graph.
- LRCLIB lyrics at least once live, with observed remote flakiness.
- Real in-player UI state and download initiation with fresh Googlevideo acquisition.

### Still only fixture-verified or not currently observable

- A currently-live stream that plays natively and then falls back.
- A stable logged-out `LOGIN_REQUIRED` age-restricted specimen.
- Ad-field pruning on an actual live response containing `adPlacements`/`playerAds`, including the disabled control comparison.
- Direct background-network proof that segment-skip off sends no SponsorBlock request.
- Deterministic LRCLIB availability.

## Gates after verification

Exact outcomes from the final tree:

- `npm run typecheck`: **PASS**, exit 0, no diagnostics.
- `npm run lint`: **PASS**, exit 0, zero warnings/errors.
- Gate-weakener scan for `.skip`, `.only`, todo tests, coverage ignores, `eslint-disable`, `@ts-ignore`, and `@ts-nocheck`: **PASS**, empty output.
- `npm test`: **PASS**, 11 files and 86 tests; 98.22% statements, 94.81% branches, 97.05% functions, 99.3% lines.
- `npm run test:bench`: **PASS**, 20/20 packaged Firefox cases.
- `npm run build`: **PASS**, Firefox MV2 production build completed.
- Production manifest/bundle inspection: **PASS**, exactly four YouTube matches, no localhost/127.0.0.1 match, and no `ytaBench` marker in production bundles.

## Reproduction

```bash
BENCH=1 node_modules/.bin/wxt build -b firefox --mv2
node_modules/.bin/web-ext build \
  --source-dir .output/firefox-mv2 \
  --artifacts-dir dist/bench-web-ext-artifacts \
  --overwrite-dest
cp dist/bench-web-ext-artifacts/*.zip dist/youtube-audio-bench.xpi
node tests/e2e/probe-live-features.mjs dist/youtube-audio-bench.xpi
```
