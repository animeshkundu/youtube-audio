# Specification: M5 Audio Download

## Overview

M5 adds an opt-in, user-initiated download action for the current YouTube watch page. It reuses the credentialless ANDROID_VR direct-audio acquisition path and delegates the privileged save operation to the background context.

## Goals

- Expose an in-player download button only when `downloadEnabled` is enabled.
- Acquire the best direct audio format on explicit user action, preferring itag 251 then 140.
- Save itag 251 as `.webm`, itag 140 as `.m4a`, and unknown audio formats as `.m4a`.
- Sanitize and bound filenames derived from `videoDetails.title`.
- Permit only HTTPS `googlevideo.com` subdomains in production.
- Prefer `downloads.download({ url, filename })`, with a credentialless Blob fallback.
- Fail open without disrupting playback or page behavior.

## Non-Goals

- Bulk, automatic, scheduled, playlist, or offline-library downloads.
- Cipher deciphering, URL refresh retries, transcoding, remuxing, or arbitrary URL downloads.
- Credentialed media fetches.

## Technical Design

### Settings and UI

`downloadEnabled` defaults to `false`, is normalized through shared storage, and applies instantly. Options and popup expose the toggle. The content script installs a small `ytp-button` beside the existing audio-only control only while the effective setting is enabled.

### Acquisition and bridge

A click dispatches a nonce-authenticated JSON-string `CustomEvent` from isolated content to MAIN world. MAIN world performs a fresh credentialless ANDROID_VR player request for the current video, selects the preferred direct audio format, validates its URL, derives a sanitized filename from the title and itag, and returns only `{url, filename}` in a JSON-string event. The content script validates the response shape and forwards it to the fixed background download operation.

### Privileged download

The background validates the message again. Production accepts only HTTPS `googlevideo.com` or subdomains and a filename that exactly matches shared sanitization. It first passes the direct URL to `browser.downloads.download`. If that fails, it fetches the same validated URL with `credentials: "omit"`, creates a Blob URL, downloads it, and revokes that object URL after completion or interruption.

Bench builds allow only the current validated localhost fixture origin and expose the completed request through a bench-only DOM marker.

## Error Handling

Every page, bridge, acquisition, validation, fetch, and downloads API boundary catches failures. Failures return a bounded failure result to the button and never throw into the page, alter media state, or retry automatically. Expired direct URLs therefore fail safely and can be retried by another explicit click, which obtains a fresh URL.

## Testing Strategy

- Unit tests import real source helpers for title sanitization, itag extension mapping, filename construction, and URL allowlisting.
- The packaged bench verifies the button is absent while disabled and that an enabled click reaches the background with the expected selected URL and sanitized filename.
- Release gates are strict typecheck, zero-warning lint, empty gate-weakener scan, real-source unit coverage, packaged Firefox bench, production build, and manifest inspection.

## Security and Privacy Considerations

The page cannot select a destination URL. MAIN world emits only a URL selected from the fresh player response, content validates shape and nonce, and background independently enforces the Googlevideo allowlist and canonical bounded filename. All media fetches omit credentials. Downloads require explicit user action and the feature defaults off.

## Rollout and Rollback

The feature defaults off and is instant-disableable. Disabling removes the button. Any failure leaves native YouTube playback unchanged.
