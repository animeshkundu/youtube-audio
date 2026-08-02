# Research 20 — Live WEB player response versus ANDROID_VR

**Date:** 2026-08-01  
**Status:** Settled by live experiment (Firefox, headless, fresh logged-out temporary profile)  
**Probe:** `tests/e2e/real-youtube-capture.mjs`  
**Scope:** Two ordinary public VODs; live, age-restricted, members-only, and logged-in paths were not tested

## Question

Does the real player response already fetched by the logged-out YouTube WEB page contain a reusable direct audio URL, making the extension's separate credentialless ANDROID_VR player request unnecessary?

Earlier WEB control rows were not evidence for this question: they came from a bare, incomplete WEB InnerTube request that returned `UNPLAYABLE`, not from the page's working player. This probe instead reads the real `window.ytInitialPlayerResponse`; if that value is unavailable after SPA navigation, it can capture the page's own `/youtubei/v1/player` fetch or XHR response.

## Method

The live visual probe was extended to record, without persisting signed URLs:

- every audio-ish `streamingData.adaptiveFormats[]` entry's `itag`, `mimeType`, `bitrate`, `audioQuality`, and `contentLength`;
- whether each entry has a direct `url`, a `signatureCipher`, or neither;
- whether `streamingData.serverAbrStreamingUrl` exists;
- whether `streamingData.formats[]` exposes a progressive direct URL;
- the same fields for the extension's `ANDROID_VR` response.

The browser profile was fresh and logged out. The extension's player fetch remained `credentials: 'omit'`. Both WEB observations came directly from `window.ytInitialPlayerResponse`, so the fetch/XHR fallback was not needed in these runs.

## Live results

### `dQw4w9WgXcQ`

Page: <https://www.youtube.com/watch?v=dQw4w9WgXcQ>  
Landing title: “Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)”

Both responses had `playabilityStatus: OK` and `serverAbrStreamingUrl`.

| Response | Audio entries | Audio direct URL | Audio `signatureCipher` | Audio neither | Progressive entries | Progressive direct URL | Progressive `signatureCipher` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Real WEB page | 4 | **0** | 0 | **4** | 1 | **0** | 1 |
| ANDROID_VR | 4 | **4** | 0 | 0 | 1 | **1** | 0 |

The WEB audio entries were itags `140`, `249`, `250`, and `251`. All retained metadata including bitrate and content length, but every one lacked both `url` and `signatureCipher`. WEB exposed progressive itag `18`, but only as `signatureCipher`, not as a ready direct URL. ANDROID_VR returned direct URLs for audio itags `139`, `140`, `249`, and `251`, plus progressive itag `18`.

### `jNQXAC9IVRw`

Page: <https://www.youtube.com/watch?v=jNQXAC9IVRw>  
Landing title: “Me at the zoo”

Both responses had `playabilityStatus: OK` and `serverAbrStreamingUrl`.

| Response | Audio entries | Audio direct URL | Audio `signatureCipher` | Audio neither | Progressive entries | Progressive direct URL | Progressive `signatureCipher` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Real WEB page | 8 | **0** | 0 | **8** | 0 | **0** | 0 |
| ANDROID_VR | 4 | **4** | 0 | 0 | 1 | **1** | 0 |

The WEB response enumerated duplicated audio variants for itags `140`, `249`, `250`, and `251`; all eight entries lacked both `url` and `signatureCipher`. It exposed no progressive `formats[]`. ANDROID_VR again returned four direct audio URLs (`139`, `140`, `249`, `251`) and a direct progressive itag `18` URL.

## Verdict

**The SABR-only claim holds for audio on both live WEB responses observed on 2026-08-01.** The real, playable page responses enumerated 12 audio entries in total and supplied **zero direct audio URLs, zero audio `signatureCipher` values, and 12 entries with neither**. Both supplied `serverAbrStreamingUrl`.

By contrast, the same two runs' credentialless ANDROID_VR responses supplied **8 of 8 audio entries as direct URLs**, with no cipher and no missing locator. This is direct evidence that there is no page-owned direct audio URL for the extension to reuse on these logged-out WEB VODs, while the separate ANDROID_VR request supplies the resource needed for the extension's write-once `<video>.src` design.

One nuance matters: one WEB response exposed progressive itag `18` through `signatureCipher`. That does not contradict the audio SABR-only finding and is not a ready-to-assign URL. It would require maintaining YouTube player-JS signature deciphering and does not provide an audio-only stream. The other WEB response exposed no progressive format at all.

This is canary-grade evidence, not a permanent API guarantee. YouTube can vary responses by rollout, geography, video, and time, so the reproducible live probe should be rerun when evaluating the architecture or responding to future platform drift.

## Run outcome caveat

Both runs reached and recorded the complete WEB-versus-ANDROID_VR comparison. The enclosing visual probe still exited non-zero because concurrent hybrid-consent work left the extension's optional network features unconsented in the fresh profile, so its pre-existing `audioHijacked` and artwork visual assertions were false. That visual result is separate from the player-response capture and does not affect the raw format counts above.
