# Specification: Hybrid Data-Transmission Consent

## Overview

YouTube Audio declares Firefox's `websiteContent` data-collection category and uses a hybrid consent model so Firefox 128 ESR remains supported. Firefox versions that expose built-in data-collection consent rely on the browser's install flow. Older supported versions receive an extension-owned, focused consent tab before any extension-initiated transmission can occur.

## Goals

- Truthfully declare `data_collection_permissions.required: ["websiteContent"]` while retaining Firefox 128 as the minimum version.
- Detect built-in-consent support from the Firefox version and platform thresholds (desktop 140+, Android 142+), then verify `browser.permissions.getAll()` contains the required `websiteContent` entry.
- On Firefox below the applicable threshold, present one unmissable, single-page consent view immediately after install and on upgrade, even if an older runtime happens to echo an unknown `data_collection` key.
- Default custom consent off and fail closed while consent state is unavailable or unreadable.
- Explain the exact transmitted website content, destinations, purposes, credentialless handling, and consequences of accepting or declining.
- Give SponsorBlock its own off-by-default choice.
- Provide a persistent options-page control to review and revoke consent; revocation immediately stops extension-initiated transmission.

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

### Startup and transmission guard

The persistent background is the sole owner of browser-version, platform, and granted-permission inspection for content-script startup. The isolated content script requests the resolved state through the fixed `yta:get-data-consent` runtime message and awaits that response before injecting MAIN world; an unavailable background or a missing, malformed, or rejected response is denied. `applyConsentToSettings()` remains the single chokepoint that neuters settings. The MAIN-world defaults are already inert, so no player, artwork, media, downloader, or SponsorBlock request can race consent resolution.

The background initializes its consent gate to `false`; SponsorBlock and other extension-owned outbound handlers require it to be `true`. Permission removal and a storage removal, revocation, or malformed replacement synchronously replace the cached state with denial and push that denial to running content scripts before asynchronous re-resolution. A well-formed stored grant, like permission addition, only re-resolves because an additive grant event must never transiently revoke a valid initializing session. A generation guard prevents an older lookup from overwriting a newer permission event. Content applies each validated `yta:data-consent-changed` push immediately, so built-in permission removal disables an already-running page without relying on `browser.permissions` availability in a content-script context. Page-originated telemetry and native YouTube playback remain under YouTube's control and are not extension-originated transmissions.

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

### Options control

A “Data & consent” section remains visible in settings. It summarizes the same destinations, shows current consent status, links to the full consent page and public privacy policy, and offers revocation. Revocation stops extension-owned transmission and returns custom-consent installations to the consent-required state.

## Error Handling

- Browser/platform support-detection failure uses the built-in path and denies consent unless Firefox reports the required category.
- Permissions and storage read failures deny consent.
- Consent persistence failures leave the prior decision effective and show an inline error.
- Failure to open the consent tab cannot enable transmission.
- Failure to uninstall is reported on the consent page without silently accepting.
- Storage-change parsing rejects malformed records as denied.

## Testing Strategy

- Unit tests cover desktop and Android support thresholds, built-in grant-array membership, the pending/declined-prompt bypass regression, legacy custom consent, malformed/missing state, persistence, revocation on both paths, and API/storage/detector failures.
- Unit tests verify fail-closed effective settings before and without consent, validate the fixed content/background payload, and cover unavailable-background and malformed-reply startup failures.
- On actual Firefox 128-139, the temporary-install E2E harnesses seed the same versioned local consent record through an extension-owned page before testing playback or visuals. SponsorBlock cases additionally seed its independent opt-in.
- On modern Firefox, temporary installation bypasses the native UI but reports a manifest required category through `permissions.getAll().data_collection`. Treatment harnesses leave that Firefox capability enabled and fail loudly unless the required category or legacy custom record makes consent resolve granted.
- Blocking desktop CI runs both the hermetic bench and settings-permutation suite on Firefox 128 ESR, representative custom-consent versions, both sides of the desktop 139/140 boundary, a post-boundary release, and current mainline. Every seeded session reports its resolved source and throws before feature assertions if consent remains denied. Firefox 128-133 use geckodriver 0.36.0 through the harness's explicit `GECKODRIVER_BIN`; current geckodriver's add-on-install request is incompatible with those releases, while Firefox 134+ uses the current npm-provided driver.
- The hermetic fixture harness programmatically registers the real packaged content script for the
  exact BENCH fixture origin before it navigates there. Firefox 139-142 and current Fenix releases
  can install a temporary add-on while not activating its static HTTP localhost content-script match;
  the persistent MV2 background owns the dynamic registration because Firefox unloads scripts
  registered by an extension page when that page is unloaded. BENCH therefore retains the local host
  permissions but does not add local origins to the static content-script declaration, avoiding double
  injection on browsers that activate both forms. The content script itself, its background consent
  request, and its fail-closed behavior are unchanged.
  The persistent-profile upgrade qualification builds a separate BENCH artifact with static fixture
  matches at installation time; this is limited to that non-temporary profile test. The named
  fresh-profile case still proves that a running content script makes no player, artwork, thumbnail,
  or media request without consent.
- Blocking Android CI runs a hermetic Fenix matrix from the minimum supported Fenix 128 through current, including both sides of the Android 141/142 boundary. Its BENCH-only build permits the emulator host alias `10.0.2.2`, while production host permissions remain unchanged. The runner assigns the disposable emulator's browser role to Fenix before launch, pins the emulator locale to English, opens About Firefox, and taps Fenix's unique `wordmark` control five times to expose the session-only Secret settings row. It then uses exact, state-verified Fenix UI controls to enable Remote debugging via USB. This invokes Fenix's live GeckoView runtime setting, which direct preference-file writes do not reliably invoke across archived releases. The RDP installer waits up to three minutes for either Fenix's abstract `@<package>/firefox-debugger-socket` or a filesystem socket, then uses the Remote Debugging Protocol add-ons actor rather than Marionette's desktop-only endpoint. WebDriver starts before RDP installation so its pinned extension UUID mapping is available before the probe opens the extension options page. The emulator runner starts the host adb daemon before launch and invokes one checked-in shell script so state shared between setup commands cannot be lost across the action's per-line shells. The mobile matrix runs for both pull requests and master pushes, and the release workflow waits for the exact master commit's matrix conclusion before publishing. The live-YouTube Android playback probe remains a separate non-gating nightly canary.
- The hermetic bench keeps a named fresh-profile case that deliberately suppresses the automatic required-category grant and asserts no player hijack, player request, artwork marker, or artwork request before consent.
- Resolver tests simulate native category addition and removal. A blocking persistent-profile qualification measures the Firefox 139-to-140 browser boundary for both granted and revoked custom records. The real native install/update prompt and live revocation path remain manual until stable browser-chrome automation covers them.
- UI tests verify the exact destination/data copy, unchecked SponsorBlock default, accept persistence, revoke control, and decline/uninstall action.
- Build output is inspected for the manifest declaration and extension page.
- Required gates: TypeScript, ESLint, Prettier, Vitest coverage, Firefox MV2 build, and `web-ext lint`.

## Security and Privacy Considerations

- All InnerTube, Googlevideo, and third-party fetches remain credentialless.
- Consent is stored only in extension-local storage and carries no identity.
- Custom consent is opt-in, default off, and never inferred from existing feature settings.
- Consent failure cannot widen access or trigger fallback transmission.
- Revocation is enforced at both isolated-content and privileged-background boundaries.

## Performance Considerations

Background startup performs one browser-info query, one platform-info query, one permissions query, and one local-storage read. Content performs one internal message round trip before injection; subsequent permission or storage changes are pushed from background. The MAIN-world script is not injected until content has received and validated consent, avoiding speculative page-world work.

## Dependencies

No new package dependency is introduced. The feature uses WebExtension permissions, storage, tabs, runtime, and management APIs plus the existing Preact UI stack.

## Rollout and Rollback

The declaration and runtime guards ship atomically. Existing users on Firefox 128-139 see the focused consent tab on upgrade and stay denied until acceptance. Firefox versions with built-in consent do not see the custom screen. Rolling back the runtime guard without also rolling back the manifest declaration is prohibited because declaration and behavior must remain synchronized.
