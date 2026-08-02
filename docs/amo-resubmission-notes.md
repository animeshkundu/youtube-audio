# AMO resubmission notes

We agree with the rejection of the previous declaration. Version 1.0.3 declared `data_collection_permissions.required: ["none"]` even though the extension initiates requests that transmit website content. This resubmission corrects the declaration and adds consent before extension-initiated transmission.

## What changed

- The manifest now declares `data_collection_permissions.required: ["websiteContent"]` instead of `["none"]`.
- `strict_min_version` remains `128.0`. The `management` permission was added solely for the custom consent screen's **Decline and uninstall** action.
- Firefox 140+ on desktop and 142+ on Android use Firefox's built-in required-data consent. Firefox 128–139, where the manifest key is safely ignored, receive a custom consent screen.
- At runtime, `browser.permissions.getAll()` detects the built-in path. The extension grants that path only when `data_collection` is an array containing `websiteContent`; an absent, empty, malformed, or unreadable result denies transmission.
- The custom screen opens in a focused tab on install and update. It presents every disclosure in one page, with no collapsed disclosures; SponsorBlock is unchecked by default. Its actions are **Allow and continue** and **Decline and uninstall**. Declining calls `browser.management.uninstallSelf()`.
- Consent is revocable from the permanent **Data & consent** section in options. Revocation stops extension-originated transmission and disables dependent features while leaving the add-on installed.

## Extension-initiated data flows

| Recipient                                                                | Transmitted fields                                                                                                                                                                                                                | Trigger and default                                                                                                                  | Purpose                                                                     | Source to verify                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Current supported YouTube origin, `/youtubei/v1/player`                  | The opened watch-page `videoId`; page-owned `VISITOR_DATA` when available; an `ANDROID_VR` client descriptor; the page's `INNERTUBE_API_KEY` in the query string. The POST body also contains `contentCheckOk` and `racyCheckOk`. | Audio-only playback activation and relevant SPA navigation, after required consent.                                                  | Obtain a direct audio URL.                                                  | `entrypoints/main-world.ts:484-510`; `src/shared/innertube.ts:1-25,148-161`                                 |
| Current supported YouTube origin, `/youtubei/v1/player`                  | The same fields as above.                                                                                                                                                                                                         | User-initiated audio download only, after the separately off-by-default download setting is enabled and required consent is granted. | Obtain a direct audio format and title for the requested download.          | `entrypoints/main-world.ts:330-390`; `src/shared/config.ts:36-55`                                           |
| Direct audio URL host returned by YouTube (normally `*.googlevideo.com`) | Request for the direct audio URL returned by the player response.                                                                                                                                                                 | When the consented audio-only player assigns the URL to the page video element; also for an opted-in audio download.                 | Fetch audio bytes for playback or the user-requested download.              | `src/shared/player.ts:89-120,186-190`; `entrypoints/background.ts:280-315`                                  |
| HTTPS thumbnail host returned by YouTube (normally `i.ytimg.com`)        | Request for the selected video-thumbnail URL from the player response.                                                                                                                                                            | Audio artwork is enabled by default and a consented audio-only attachment succeeds.                                                  | Show lock-screen and media-session artwork.                                 | `entrypoints/main-world.ts:561-579`; `src/shared/artwork.ts:27-48,119-164`; `src/shared/config.ts:36-55`    |
| `sponsor.ajay.app`                                                       | Only the first four hexadecimal characters (16 bits) of `SHA-256(videoId)`. The plaintext video ID is not sent.                                                                                                                   | Explicit SponsorBlock opt-in only. New installs default off; an existing stored enabled setting is retained.                         | Fetch an anonymity bucket; the extension matches the full video ID locally. | `entrypoints/background.ts:182-205`; `src/shared/sponsorblock.ts:21-25,28-64`; `src/shared/config.ts:36-55` |

The two player POSTs and the SponsorBlock request use `credentials: "omit"`; the SponsorBlock request also uses `referrerPolicy: "no-referrer"`. The media and artwork rows are browser requests caused by assigning returned URLs to page elements, not extension `fetch` calls. These implementation details are not substitutes for the declaration and consent above.

The reviewer-cited downloader path is the second player POST, at `entrypoints/main-world.ts:358-365` in this submission (line numbers shifted from the cited 372 during the consent changes). It is opt-in and default off. The playback player POST is the separate call at `entrypoints/main-world.ts:503-510`, reached only when consented effective settings enable audio-only playback, loudness normalization, or equalization.

## Removed data paths

- The retired `lrclib.net` lyrics path was deleted: endpoint, request handling, renderer, parser, setting, and related bridge code no longer ship. The production manifest has no LRCLIB host permission.
- The GitHub issue reporter was removed. Diagnostics are now local only: the user can view, copy, export to a local Markdown file, refresh, or clear the log. No diagnostics delivery endpoint remains.
- SponsorBlock is now explicit opt-in. New installations do not request `sponsor.ajay.app`; existing stored choices are retained on upgrade.

## Why the extension issues its own player request

We tested this on 2026-08-01 in real Firefox with a fresh logged-out temporary profile, using two ordinary public VODs. The reproducible harness is `tests/e2e/real-youtube-capture.mjs`; the captured results are in `docs/research/20-live-web-player-response.md`.

Across the two page-owned WEB player responses, 0 of 12 audio formats had a direct `url`, 0 had `signatureCipher`, and 12 had neither. Both responses exposed `serverAbrStreamingUrl` (SABR). In the same runs, the separate `ANDROID_VR` responses had a direct `url` for 8 of 8 audio formats. The page response therefore did not provide an assignable direct audio URL to reuse in these logged-out VOD observations.

One WEB response had a progressive video format through `signatureCipher`, not a ready URL and not an audio-only stream. These results are live evidence for the observed videos, not a permanent guarantee about YouTube responses.

## Consent enforcement

The content script resolves consent before injecting the MAIN-world script. Until consent is granted, it applies an all-disabled effective settings snapshot. When consent storage changes, it synchronously applies denied settings before asynchronously re-resolving consent. The background starts denied and independently gates SponsorBlock requests.

- Startup gate: `entrypoints/content.ts:91-125`; `src/shared/consent.ts:80-100`
- Built-in/custom resolution and fail-closed validation: `src/shared/consent.ts:24-60`
- Install and update consent-tab handling: `entrypoints/background.ts:84-109`
- Custom screen and decline/uninstall action: `entrypoints/consent/App.tsx:20-145`
- Background SponsorBlock boundary: `entrypoints/background.ts:182-205,447-468`

## `web-ext lint` warnings

`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` is expected under this hybrid design. Android's `strict_min_version` is 128.0, which predates Android 142 support for `data_collection_permissions`. Firefox 128–141 Android safely ignores the manifest key and uses the custom consent tab; before any extension transmission, the runtime `permissions.getAll()` check requires explicit custom consent and fails closed otherwise.

The remaining `UNSAFE_VAR_ASSIGNMENT` / `innerHTML` warning is in a generated Preact runtime chunk. Application code does not assign untrusted input to that runtime path. The same generated-runtime warning existed in previously approved releases.

## How to verify in the submitted source

1. Inspect `wxt.config.ts:95-130` for the `websiteContent` declaration, Firefox 128 minimum, and `management` permission.
2. Inspect `src/shared/consent.ts:24-100`, `entrypoints/content.ts:91-125`, and `entrypoints/background.ts:84-109,447-468` for capability detection, custom-consent handling, and fail-closed startup.
3. Inspect `entrypoints/consent/App.tsx:49-141` and `entrypoints/options/App.tsx:210-217` for visible disclosure, choice, decline/uninstall, and revocation controls.
4. Inspect the data-flow locations in the table, especially the two player POSTs in `entrypoints/main-world.ts`.
5. Inspect `src/shared/report.ts:157-213` and `entrypoints/ui/IssueReporter.tsx:13-25,95-140` to confirm diagnostics remain local.
6. Run `tests/e2e/real-youtube-capture.mjs` and compare its captured format counts with `docs/research/20-live-web-player-response.md`.
