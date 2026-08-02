# Background-owned consent resolution

## Context

The hermetic Firefox bench exposed that the isolated content script could not call the privileged `permissions.getAll()`, `runtime.getBrowserInfo()`, or `runtime.getPlatformInfo()` APIs. Its resolver therefore caught the API failure and denied every treatment session even when Firefox had granted `websiteContent`. A separate startup regression synchronously denied consent when `permissions.onAdded` fired.

## Changes

- Made the persistent background the sole consent resolver for content-script startup.
- Added the fixed `yta:get-data-consent` request and validated `yta:data-consent-changed` push path.
- Kept `applyConsentToSettings()` as the only settings-neutering chokepoint.
- Required content to receive and validate consent before injecting MAIN world. Background errors and malformed replies fail closed.
- Moved permission listeners to background. Removal denies and pushes immediately before re-resolution; addition only re-resolves and can never synchronously revoke an initializing session.
- Added a resolution generation so an older asynchronous lookup cannot overwrite a newer permission event.
- Added unit coverage for valid, malformed, and unavailable-background replies and the fixed consent payload parser.

## Validation

Run the TypeScript, ESLint, Prettier, Vitest coverage, and full hermetic Firefox bench gates. The named fresh-unconsented-profile case must remain fail-closed with no player POST, hijack, artwork, or thumbnail request.
