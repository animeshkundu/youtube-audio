# ADR-0010: Hybrid Firefox data-transmission consent

## Status

Accepted.

## Date

2026-08-01

## Context

AMO rejected version 1.0.3 because the manifest declared `data_collection_permissions.required: ["none"]` while extension-owned requests transmit website content. Mozilla's taxonomy includes request and response information in `websiteContent`; neither same-origin transmission nor core functionality creates an exemption.

The extension supports Firefox desktop and Android from version 128. Firefox's built-in data consent is available only from Firefox 140 desktop and 142 Android. Older supported versions require a custom consent experience meeting §6.2.2.

### Constraints

- Retain `strict_min_version: "128.0"` for ESR and Android compatibility.
- Personal-data transmission is opt-in and defaults off where Firefox does not collect consent.
- The custom view must be extension-owned, immediate on install and upgrade, unmissable in a new focused tab, single-page, prominent, and free of deceptive patterns.
- Declining core required transmission must offer direct uninstall.
- SponsorBlock is a distinct optional third-party transmission and needs a separate choice.
- Consent resolution must fail closed before any content-script/page-world startup race.

## Decision

Declare `data_collection_permissions.required: ["websiteContent"]` and use hybrid runtime consent.

At startup, detect built-in-consent support from `browser.runtime.getBrowserInfo()` and `browser.runtime.getPlatformInfo()`: Firefox desktop 140+ and Android 142+ use the built-in path; earlier versions use custom consent. Support and grant are deliberately separate. On a supported version, grant only when `browser.permissions.getAll()` returns a `data_collection` array containing `websiteContent`; a missing key, missing category, or malformed array denies transmission even if extension-local storage contains an earlier custom grant. This is required because `permissions.getAll()` enumerates granted permissions, so key absence can mean the native prompt is pending or was declined, not that the browser lacks the feature. On unsupported versions, extension-local explicit acceptance is required.

If browser/platform detection throws or the major version is unparseable, conservatively use the built-in path. That may leave an older installation unable to consent until detection works, but it cannot turn a stored custom acceptance into permission after a native refusal. Treating detector failure as unsupported would reopen the consent bypass. A valid stored revocation denies both paths. Missing, malformed, or unreadable permissions/storage state also denies transmission.

For custom consent, `runtime.onInstalled` handles both install and update and uses the same version-and-platform support detector before opening the extension-owned `consent.html` through `tabs.create({ active: true })`. It never opens a popup window, and it never opens the custom screen on supported versions, including while native consent is pending or declined. A detector failure suppresses the custom screen while transmission remains denied. The page presents all destinations, transmitted fields, purposes, credentialless handling, accept impact, decline impact, the accept action, `Decline and uninstall`, and a separate unchecked SponsorBlock choice in one view.

The persistent background is the sole resolver for content-script startup because browser-version, platform, and granted-permission inspection belong in a privileged extension context and permission events are reliably delivered there. Content uses a fixed internal runtime request for current state. It awaits a validated response before MAIN-world injection; background unavailability, message failure, or a malformed response is denied. `applyConsentToSettings()` remains the single settings chokepoint, and the background independently gates SponsorBlock at its privileged fetch boundary.

On storage changes or permission removal, the background first replaces its cache with denial and pushes that denial to running content scripts, then asynchronously resolves again under a generation guard. Permission addition only re-resolves and publishes the result; it never synchronously denies, because an install-time addition must not yank consent from an initializing session. The generation guard prevents a stale earlier lookup from restoring a superseded grant. Running content scripts consume background pushes rather than subscribing to `browser.permissions` themselves, so native permission revocation takes effect immediately even where that API is unavailable in content-script contexts. Options permanently exposes review and revocation.

### Considered Options

1. **Built-in consent only, minimum Firefox 140 desktop / 142 Android**
   - Pros: least custom UI and state.
   - Cons: drops Firefox 128-139, including the supported ESR range and older Android installations.
2. **Custom consent on every Firefox version**
   - Pros: one runtime path.
   - Cons: duplicates Firefox's native install consent, adds first-run friction for every user, and ignores the browser's purpose-built mechanism.
3. **Hybrid consent**
   - Pros: preserves the full version range, uses native consent where available, and supplies the required compliant fallback only where necessary.
   - Cons: two branches require explicit feature-detection and cross-version qualification.

### Chosen Option

Hybrid consent provides truthful disclosure and fail-closed control without sacrificing Firefox 128 support. It confines custom complexity to versions that need it.

## Consequences

### Positive

- Manifest disclosure matches actual website-content transmission.
- Firefox 140+/142+ users receive the native browser experience with no duplicate screen.
- Firefox 128-139 users receive a §6.2.2-compliant opt-in page on install and upgrade.
- Revocation has an easy, persistent options-page control and immediately stops extension-owned transmission.
- SponsorBlock remains an independent, off-by-default third-party choice.

### Negative

- Consent capability and state must be qualified across desktop and Android version boundaries.
- Existing pre-consent users on older Firefox cannot use core transmission-dependent features until they explicitly accept.
- Declining means uninstall because the product's core audio mechanism cannot function without YouTube requests.

### Neutral

- Firefox 128 safely ignores the unknown `data_collection_permissions` manifest key; the minimum version remains unchanged.
- Native YouTube page traffic is not created by the extension and remains under YouTube's control.

## Related ADRs

- ADR-0006: Firefox AMO distribution and beta channel.
- ADR-0008: Audio-mode artwork and egress stance; its former `none` conclusion is superseded by this ADR.
- ADR-0009: Credentialless Android VR requests.

## References

- Mozilla Add-on Policies, Data Collection and Transmission (§6.2.2).
- SPEC-013: Hybrid Data-Transmission Consent.
