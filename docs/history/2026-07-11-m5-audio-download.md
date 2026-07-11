# M5 Audio Download Handoff

## Scope

Implemented an opt-in, explicit audio download action using the existing credentialless ANDROID_VR acquisition path and the privileged Firefox downloads API.

## Behavior

- `downloadEnabled` defaults off and instantly controls a small in-player download button.
- A click performs a fresh player request, selects itag 251 before 140, and derives a bounded sanitized `.webm` or `.m4a` filename from the video title.
- MAIN-to-content download data uses nonce-authenticated JSON-string `CustomEvent` details.
- Content and background validate the selected URL and filename; production accepts only HTTPS Googlevideo hosts.
- Background prefers direct `downloads.download` and uses a credentialless Blob fallback only if direct download fails.
- Any acquisition, bridge, validation, API, or fallback error reports failure to the control and leaves playback untouched.

## Validation

Unit coverage includes filename sanitization, extension mapping, and URL allowlisting. The packaged bench includes download-disabled and download-enabled cases while retaining all earlier milestone cases. See the implementation handoff for exact gate output.
