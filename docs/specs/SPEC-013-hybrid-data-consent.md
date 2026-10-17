# Specification: Hybrid Data-Transmission Consent

> **Status:** Shipped. Revised for 1.1.0: the optional-permission model (`sponsor.ajay.app` and
> `downloads` optional, `tabs` dropped) and the consent-required popup state with a toolbar badge.

## Overview

YouTube Audio declares Firefox's `websiteContent` data-collection category and uses a hybrid consent model so Firefox 128 ESR remains supported. Firefox versions that expose built-in data-collection consent rely on the browser's install flow. Older supported versions receive an extension-owned, focused consent tab before any extension-initiated transmission can occur.

The 1.1.0 revision narrows the install-time permission set and makes every surface honest while consent is missing: the popup replaces its controls with a consent-required state whose action deep-links to the options "Data & consent" section, and the toolbar action carries a badge until the consent question is resolved.

## Goals

- Truthfully declare `data_collection_permissions.required: ["websiteContent"]` while retaining Firefox 128 as the minimum version.
- Detect built-in-consent support from the Firefox version and platform thresholds (desktop 140+, Android 142+), then verify `browser.permissions.getAll()` contains the required `websiteContent` entry.
- On Firefox below the applicable threshold, present one unmissable, single-page consent view immediately after install and on upgrade, even if an older runtime happens to echo an unknown `data_collection` key.
- Default custom consent off and fail closed while consent state is unavailable or unreadable.
- Explain the exact transmitted website content, destinations, purposes, credentialless handling, and consequences of accepting or declining.
- Give SponsorBlock its own off-by-default choice.
- Provide a persistent options-page control to review and revoke consent; revocation immediately stops extension-initiated transmission.
- Keep the required permission set minimal: drop `tabs`, and make `sponsor.ajay.app` and `downloads` optional grants requested only from the gesture that turns the dependent feature on.
- Enforce the double gate everywhere: SponsorBlock transmission requires both the stored SponsorBlock consent and the granted `sponsor.ajay.app` host permission; audio download requires both the setting and the granted `downloads` permission.
- Never render a dead control: while required consent is not granted, the popup shows a consent-required state with a deep-link action instead of playback controls.
- Signal an undecided custom-consent state with a toolbar badge until the user makes an explicit decision, and clear it otherwise.
- Surface a missing optional permission on the affected options row with a one-gesture re-grant; features fail open until then.

## Non-Goals

- Dropping Firefox 128-139 in favor of built-in-only consent.
- Supporting logged-in or credentialed requests.
- Treating core functionality as an exemption from Mozilla's consent requirements.
- Adding analytics, identity, cookies, developer servers, or diagnostics upload.

## Technical Design

### Consent state

`src/shared/consent.ts` owns a small local-storage record independent of feature settings. Consent resolution starts denied. It detects support with `runtime.getBrowserInfo()` and `runtime.getPlatformInfo()`: Firefox desktop 140+ and Android 142+ use the built-in path; older versions use the custom path.

- built-in supported: grant only when `browser.permissions.getAll().data_collection` is an array containing `websiteContent`; a missing key or category is denied, regardless of any stored custom grant;
- built-in unsupported: grant only from an explicit stored custom acceptance;
- support detection failure or an unparseable browser version: conservatively treat built-in consent as supported, so a custom record can never bypass a missing or declined browser grant;
- any permissions or storage failure: denied.

The stored decision is versioned and includes whether SponsorBlock was separately accepted. Its `revoked` state denies both paths. On the built-in path, a stored grant affects only the separate SponsorBlock choice and never supplies required consent. Accepting also updates the SponsorBlock feature setting to match that explicit choice. Revocation stores a denial before any UI reports success.

The resolved state also exposes `pending`: true only on the custom path while no well-formed stored decision exists. A `revoked` record, both built-in outcomes, and fail-closed defaults are not pending. Only a pending state raises the toolbar badge; the built-in path never badges because Firefox owns the prompt.

### Startup and transmission guard

The persistent background is the sole owner of browser-version, platform, and granted-permission inspection for content-script startup. The isolated content script requests the resolved state through the fixed `yta:get-data-consent` runtime message and awaits that response before injecting MAIN world; an unavailable background or a missing, malformed, or rejected response is denied. `applyConsentToSettings()` remains the single chokepoint that neuters settings. The MAIN-world defaults are already inert, so no player, artwork, media, downloader, or SponsorBlock request can race consent resolution.

The background initializes its consent gate to `false`; SponsorBlock and other extension-owned outbound handlers require it to be `true`. Permission removal and a storage removal, revocation, or malformed replacement synchronously replace the cached state with denial and push that denial to running content scripts before asynchronous re-resolution. A well-formed stored grant, like permission addition, only re-resolves because an additive grant event must never transiently revoke a valid initializing session. A generation guard prevents an older lookup from overwriting a newer permission event. Content applies each validated `yta:data-consent-changed` push immediately, so built-in permission removal disables an already-running page without relying on `browser.permissions` availability in a content-script context. Page-originated telemetry and native YouTube playback remain under YouTube's control and are not extension-originated transmissions.

The SponsorBlock proxy additionally requires the granted `sponsor.ajay.app` host permission at request time; without it the handler resolves to no segments, so a revoked permission degrades open instead of failing the page.

### Installation and upgrade

The background `runtime.onInstalled` handler checks the same version-and-platform support detector and consent state for both `install` and `update`. If custom consent is required and not granted, it opens `consent.html` in a new active tab with `browser.tabs.create`. It never opens a popup window. Firefox desktop 140+ and Android 142+ open no custom screen, including while the built-in prompt is pending or declined. Detector failure also suppresses the custom screen and leaves transmission denied rather than risking a custom-consent bypass.

### Consent screen

The extension-owned Preact page shows every decision in one responsive view. Its prominent copy states:

- `www.youtube.com`: the opened video's `videoId`, page `VISITOR_DATA`, and an ANDROID_VR client descriptor are sent by credentialless `POST /youtubei/v1/player` to obtain a direct audio URL;
- `*.googlevideo.com`: the audio bytes are requested;
- `i.ytimg.com`: the video thumbnail is requested for lock-screen and media-session artwork;
- optional `sponsor.ajay.app`: only the first four hex characters (16 bits) of SHA-256(videoId) are sent; the video ID never leaves the device and matching is local;
- no user identity, cookies, login, analytics, developer server, or diagnostics are transmitted; diagnostics stay local.

The page explains that accepting enables audio-only playback and related features, while declining prevents those features and uninstalls the extension. The primary action accepts the required data flow. A separate unchecked SponsorBlock checkbox controls third-party transmission. “Decline and uninstall” calls `browser.management.uninstallSelf()`. A visible footer link opens the public privacy policy in a new tab, adjacent to the permanent revocation note rather than behind a disclosure.

### Consent-required popup and toolbar badge

The popup resolves consent from the background over the fixed `yta:get-data-consent` message on open. While the state is unresolved it renders only its header. When consent is not granted (pending or revoked, or a built-in category missing), it replaces the playback controls (hero switch, background-play row, pause action) with one consent-required card: a short explanation and a primary action, “Review data & consent”, that opens `options.html#data-consent`. No control that cannot take effect is rendered.

The options “Data & consent” row carries the `data-consent` anchor, and the options page scrolls the initial hash target into view after rendering.

The toolbar action shows the badge text `!` while consent is `pending` and clears it otherwise. The background applies this at startup and on every consent resolution; badge API failures are ignored because the badge is cosmetic and must never affect consent behavior.

### Optional permissions and the double gate

Production manifests request the minimal required set:

- `tabs` is dropped. Status classification reads the active tab’s URL only for origins the extension already holds host permissions for; a tab without one resolves to the not-YouTube state.
- `downloads` is optional (MV2 and MV3 `optional_permissions`). The options row is hidden entirely where `browser.downloads` is absent, which is the case on Firefox for Android.
- `sponsor.ajay.app` is optional: MV2 `optional_permissions`, MV3 `optional_host_permissions`.

Both grants are requested from the gesture that enables the dependent feature, because Firefox only honors `permissions.request` inside a user-action handler: turning segment skipping on requests the host permission before the SponsorBlock consent record and setting are persisted, and turning downloads on requests the API permission before the setting is stored. A denied or failed request leaves the feature off and shows an inline message; nothing half-applies.

Granted permissions persist across upgrades. When a feature is on without its permission (right after upgrading from a build where the permission was required, or after revoking it in the Add-ons Manager), the affected row shows a notice with a single “Grant access” gesture and the feature fails open until re-granted: the background SponsorBlock proxy resolves to no segments, and download requests report their ordinary failure.

The background enforces the double gate at request time: consent alone never authorizes transmission. BENCH builds keep both permissions required so hermetic cases run without browser-chrome prompts; that divergence is build-only, like the bench match patterns.

### Options control

A “Data & consent” section remains visible in settings. It summarizes the same destinations, shows current consent status, links to the full consent page and public privacy policy, and offers revocation. Revocation stops extension-owned transmission and returns custom-consent installations to the consent-required state. The row is the deep-link target (`#data-consent`) for the popup’s consent action. The Skipping and Downloads rows own the optional-permission gestures and states described above.

## Error Handling

- Browser/platform support-detection failure uses the built-in path and denies consent unless Firefox reports the required category.
- Permissions and storage read failures deny consent.
- Consent persistence failures leave the prior decision effective and show an inline error.
- Failure to open the consent tab cannot enable transmission.
- Failure to uninstall is reported on the consent page without silently accepting.
- Storage-change parsing rejects malformed records as denied.
- A denied or failed optional-permission request reports inline and leaves the feature, its consent record, and its setting unchanged.
- A revoked optional permission degrades the dependent feature open (no segments, no download) and shows the re-grant notice.
- Badge updates are best-effort; failures are ignored.

## Testing Strategy

- Unit tests cover desktop and Android support thresholds, built-in grant-array membership, the pending/declined-prompt bypass regression, legacy custom consent, malformed/missing state, persistence, revocation on both paths, and API/storage/detector failures.
- Unit tests cover the `pending` resolution matrix (custom with no record, custom granted and revoked, both built-in outcomes, malformed records), the popup consent-required render (no controls, working deep-link action), the options gesture ordering (permission request before the consent record and setting), denial paths, the hidden downloads row when the API is absent, the enabled-without-permission notice and re-grant, and the badge-text decision.
- Unit tests verify fail-closed effective settings before and without consent, validate the fixed content/background payload, and cover unavailable-background and malformed-reply startup failures.
- On actual Firefox 128-139, the temporary-install E2E harnesses seed the same versioned local consent record through an extension-owned page before testing playback or visuals. SponsorBlock cases additionally seed its independent opt-in.
- On modern Firefox, temporary installation bypasses the native UI but reports a manifest required category through `permissions.getAll().data_collection`. Treatment harnesses leave that Firefox capability enabled and fail loudly unless the required category or legacy custom record makes consent resolve granted.
- Blocking desktop CI runs both the hermetic bench and settings-permutation suite on Firefox 128 ESR, representative custom-consent versions, both sides of the desktop 139/140 boundary, a post-boundary release, and current mainline. Every seeded session reports its resolved source and throws before feature assertions if consent remains denied. Firefox 128-133 use geckodriver 0.36.0 through the harness's explicit `GECKODRIVER_BIN`; current geckodriver's add-on-install request is incompatible with those releases, while Firefox 134+ uses the current npm-provided driver.
- The desktop harness installs its temporary bench XPI through geckodriver's absolute-path `install addon` command. Selenium's `installAddon()` helper sends the XPI as base64; Firefox 138-143 can activate that temporary extension while failing to load its declarative content script from the decoded profile copy. Path installation keeps the same XPI, add-on ID, temporary lifetime, and consent behavior while allowing the content process to load the script.
- Blocking Android CI runs a hermetic Fenix matrix from the minimum supported Fenix 128 through current, including both sides of the Android 141/142 boundary. Its BENCH-only build permits the emulator host alias `10.0.2.2`, while production host permissions remain unchanged. The probe binds the local fixture on the runner, establishes an `adb reverse` map for its ephemeral port, and loads it through emulator `localhost`. This preserves a secure context for the nonce-authenticated bridge and advertises media at the BENCH-only loopback origin accepted by the existing media safety policy, without changing production extension code or network permissions. Before playback assertions, it proves that the fixture origin is secure and exposes `crypto.randomUUID`. Geckodriver establishes Android Marionette first, completing Fenix app-data preparation. The probe then drives Fenix's native Remote debugging setting through a uiautomator helper that waits for a valid hierarchy rather than elapsed launch time, retries command failures, missing dumps, malformed XML, and complete menu-to-Settings routes with backoff, and reports raw failed commands and dumps. It waits for the resulting RDP socket, retries transient adb failures, and reports the final command output on timeout before uploading and temporarily installing the XPI through Firefox Android's RDP add-ons actor. This is required because Fenix 128 rejects Marionette's temporary-add-on command and later tested releases did not load its content script after that command. The live-YouTube Android playback probe remains a separate non-gating nightly canary.
- The hermetic bench keeps a named fresh-profile case that deliberately suppresses the automatic required-category grant and asserts no player hijack, player request, artwork marker, or artwork request before consent.
- The hermetic bench runs with `tabs` absent from the manifest; its status-map cases assert the fixture tab’s URL-based classification, which is the no-`tabs` classification proof. A badge probe reads the toolbar badge from an extension page and asserts `!` while undecided and clear when granted. Bench builds keep the optional permissions required, so the optional flows themselves are covered by unit tests.
- Resolver tests simulate native category addition and removal. A blocking persistent-profile qualification measures the Firefox 139-to-140 browser boundary for both granted and revoked custom records. The real native install/update prompt and live revocation path remain manual until stable browser-chrome automation covers them.
- UI tests verify the exact destination/data copy, unchecked SponsorBlock default, accept persistence, revoke control, and decline/uninstall action.
- Build output is inspected for the manifest declaration and extension page.
- Required gates: TypeScript, ESLint, Prettier, Vitest coverage, Firefox MV2 build, and `web-ext lint`.

## Security and Privacy Considerations

- All InnerTube, Googlevideo, and third-party fetches remain credentialless.
- Install-time permissions are minimal: third-party host access and downloads are optional grants tied to their dependent gestures, and `tabs` is not requested.
- Consent is stored only in extension-local storage and carries no identity.
- Custom consent is opt-in, default off, and never inferred from existing feature settings.
- Consent failure cannot widen access or trigger fallback transmission.
- Revocation is enforced at both isolated-content and privileged-background boundaries.

## Performance Considerations

Background startup performs one browser-info query, one platform-info query, one permissions query, and one local-storage read. Content performs one internal message round trip before injection; subsequent permission or storage changes are pushed from background. The MAIN-world script is not injected until content has received and validated consent, avoiding speculative page-world work.

## Dependencies

No new package dependency is introduced. The feature uses WebExtension permissions (including optional grants), storage, tabs (without requiring the `tabs` permission), runtime, and management APIs, plus the existing Preact UI stack; `downloads` is only exercised where the API exists.

## Rollout and Rollback

The declaration and runtime guards ship atomically. Existing users on Firefox 128-139 see the focused consent tab on upgrade and stay denied until acceptance. Firefox versions with built-in consent do not see the custom screen. Rolling back the runtime guard without also rolling back the manifest declaration is prohibited because declaration and behavior must remain synchronized.
