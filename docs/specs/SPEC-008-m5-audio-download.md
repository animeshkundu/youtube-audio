# Specification: M5 Audio Download

## Overview

M5 adds an opt-in, user-initiated download action for the current YouTube watch page. It reuses the credentialless ANDROID_VR direct-audio acquisition path and delegates the privileged save operation to the background context.

## Goals

- Expose an in-player download button only when `downloadEnabled` is enabled.
- Let the user choose `Auto`, `M4A (AAC)`, or `Opus (WebM)` output without transcoding.
- Let the user choose automatic, high, medium, or low source bitrate from the formats returned for
  the selected codec.
- Preserve the current default: `Auto` format plus `Auto` quality selects compatible AAC itag 140
  (`.m4a`), while in-page playback keeps preferring Opus itag 251.
- Save AAC itags as `.m4a`, Opus itags 249/250/251 as `.webm`, and unknown audio formats as `.m4a`.
- Show byte progress as a determinate ring and percentage when the validated media total is known,
  and a clearly indeterminate preparation state otherwise.
- Emit exactly one `downloads.download` call and one saved file per explicit user click.
- Sanitize and bound filenames derived from `videoDetails.title`.
- Permit only HTTPS `googlevideo.com` subdomains in production.
- Assemble one credentialless Blob and issue exactly one privileged downloads API call.
- Fail open without disrupting playback or page behavior.

## Non-Goals

- Bulk, automatic, scheduled, playlist, or offline-library downloads.
- Cipher deciphering, URL refresh retries, transcoding, remuxing, or arbitrary URL downloads.
- MP3, OGG, FLAC, or any other output that is not already supplied by YouTube as one playable
  audio-only stream.
- Credentialed media fetches.

## Technical Design

### Settings and UI

`downloadEnabled` defaults to `false`, is normalized through shared storage, and applies instantly.
Options exposes the toggle plus `downloadFormat` (`auto | m4a | opus`) and `downloadQuality` (`auto |
high | medium | low`) in the Downloads section while download is enabled. The selectors are closed
enums, apply instantly, and default to `auto`. The content
script installs a small `ytp-button` beside the existing audio-only control only while the effective
setting is enabled.

### Acquisition and bridge

A click dispatches a nonce-authenticated JSON-string `CustomEvent` from isolated content to MAIN
world. MAIN world performs a fresh credentialless ANDROID_VR player request for the current video,
selects the preferred direct audio format from the already validated settings, validates its URL,
derives a sanitized filename from the title and itag, and returns only `{url, filename}` in a
JSON-string event. The content script validates the response shape and forwards it with the
content-generated bounded request ID to the fixed background download operation.

### Download format

`pickDownloadAudioFormat` filters direct `adaptiveFormats` by the requested codec before choosing
the requested source tier. Auto quality retains each codec's normal rendition (AAC 140 or Opus
251). High and low choose the highest and lowest bitrate available for that codec. Medium prefers
the known middle rendition (AAC 140 or Opus 250), then the available bitrate nearest that codec's
middle target (128 kbps AAC or 70 kbps Opus).
Missing codec or tier variants fail open to the best compatible direct audio format. Auto format
means compatible AAC and, together with Auto quality, preserves the shipped itag-140 result.

In-page playback continues to call `pickBestAudioFormat` with compatibility off, keeping Opus itag
251 for quality. MP3, OGG, and FLAC are out of scope because they require in-browser transcoding,
whereas `.m4a` and `.webm` are the existing source containers and need no conversion.

The feature has a single privileged download call site (`entrypoints/background.ts`), so one explicit click produces exactly one `downloads.download` call and one saved file, independent of whether audio-only mode is on. Adaptive range requests made by YouTube's own player stay in memory and never reach the OS Downloads folder.

### Privileged download and progress

The background validates the message again. Production accepts only HTTPS `googlevideo.com` or
subdomains, a filename that exactly matches shared sanitization, and a bounded request ID. It range
fetches the validated URL with `credentials: "omit"`, creates a Blob URL from exactly one assembled
stream, calls `browser.downloads.download` once, and revokes that object URL after completion or
interruption.

After each validated range chunk is read, `assembleAudioMedia` invokes a progress callback with
bounded `loaded` and `total` byte counts. Background sends only
`{type: "yta:download-progress", requestId, loaded, total}` to the originating tab with
`tabs.sendMessage`. Content accepts a progress update only for its active request and only when
`0 <= loaded <= total <= MAX_ASSEMBLED_AUDIO_BYTES`. The button renders a determinate arc and
integer percentage and announces at most each new ten-percent boundary. Before a validated total
exists, including a server that answers with a single complete `200`, the button remains
indeterminate rather than displaying invented progress.

Bench builds allow only the current validated localhost fixture origin and expose the completed request through a bench-only DOM marker.

## Error Handling

Every page, bridge, acquisition, validation, fetch, and downloads API boundary catches failures. Failures return a bounded failure result to the button and never throw into the page, alter media state, or retry automatically. Expired direct URLs therefore fail safely and can be retried by another explicit click, which obtains a fresh URL.

## Testing Strategy

- Unit tests import real source helpers for settings normalization, codec and bitrate-tier selection,
  title sanitization, all Opus itag extension mappings, filename construction, URL allowlisting,
  range progress, and bounded progress-message parsing.
- UI tests verify the format and quality selectors are disclosed only while download is enabled.
- In-player tests verify indeterminate preparation, determinate ring/percentage updates, throttled
  announcements, and terminal success/failure.
- The packaged bench keeps the default `.m4a` / itag-140 assertion and adds a non-default
  Opus/medium selection with correlated byte progress.
- Release gates are strict typecheck, zero-warning lint, empty gate-weakener scan, real-source unit coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

The page cannot select a destination URL. MAIN world emits only a URL selected from the fresh player response, content validates shape and nonce, and background independently enforces the Googlevideo allowlist and canonical bounded filename. All media fetches omit credentials. Downloads require explicit user action and the feature defaults off.

## Rollout and Rollback

The feature defaults off and is instant-disableable. Disabling removes the button. Any failure leaves native YouTube playback unchanged.
