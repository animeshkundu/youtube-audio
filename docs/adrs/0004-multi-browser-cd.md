# ADR-0004: Multi-browser continuous delivery scope

## Status

**Accepted.** The owner has confirmed the scope: **publish Firefox-only today, for both
Firefox desktop and Firefox for Android, from GitHub Releases.** Chrome and Edge are
confirmed **not** a simple add (they need a Manifest V3 / declarativeNetRequest parity
rewrite, see the feasibility section) and are out of scope until the owner explicitly
redefines it, for the same reasons as ADR-0003.

## Date

2026-07-11

## Why an ADR (and not a design doc)

This records a distribution and scope decision with lasting consequences, extending
ADR-0002 (two Firefox identities) and ADR-0003 (AMO preflight). The `docs/adrs/`
series is where distribution decisions live; `docs/design/` holds UX explorations
(popup, options, onboarding, artwork). A per-browser CD scope call belongs with the
other distribution ADRs, so this is ADR-0004.

## Context

The audit question: does our CD upload Chrome, Edge, and Firefox extensions to GitHub
Releases with proper versioning, and does any of it need signing? Then: recommend the
right multi-browser CD.

Short answer up front: the CD is **Firefox MV2 only**. There is no Chrome or Edge
artifact anywhere in the pipeline, and there cannot be a meaningful one without a
Manifest V3 parity rewrite of the extension's core network-interception paths.

### Evidence: what the pipeline actually does

- The release workflow triggers only on `v*` tags and its single job is literally
  named "Validate, sign, and publish Firefox MV2"
  (`.github/workflows/release.yml:5-6,18-19`).
- It builds one target: `npm run build` = `wxt build -b firefox --mv2`
  (`package.json:26`, invoked at `release.yml:40`), lints that output with `web-ext`
  (`release.yml:42-43`), and signs it (`release.yml:45-46`).
- The only two published assets are the signed XPI and the Firefox update manifest
  (`release.yml:70-78`). Both are Firefox. No Chrome ZIP/CRX, no Edge package.
- The only other build script, `build:mv3` = `wxt build -b firefox --mv3`
  (`package.json:27`), is still **Firefox** MV3. CI builds it purely as a
  "Firefox MV3 capability artifact" (`.github/workflows/ci.yml:53-70`) and **uploads
  it nowhere**. It is a compile-only smoke check, not a distributable.
- There is no `-b chrome` or `-b edge` build anywhere in `package.json`, `wxt.config.ts`,
  `scripts/`, or `.github/workflows/`. ("chrome" appears once, as a keyword in
  `package.json:11`, and once as an Android emulator target in `mobile-e2e.yml` — neither
  is a Chrome browser build.)

### Evidence: the core mechanisms are Firefox/MV2-bound

- Blocking `webRequest`: `browser.webRequest.onBeforeRequest.addListener(blockTelemetry,
..., ['blocking'])` (`entrypoints/background.ts:357-359`).
- `filterResponseData` (the ad/telemetry player-response prune): only
  `entrypoints/background.ts` uses it, at `background.ts:82` inside `filterPlayerResponse`.
  This API is **Firefox-only** and has no Chromium equivalent.
- The platform adapter already encodes the split: `blockingWebRequest: manifestVersion
=== 2` (`src/shared/platform.ts:12`). Blocking webRequest is treated as an MV2-only
  capability, which in practice means Firefox-only (Chrome MV2 is dead).
- Credentialless ANDROID_VR media fetch: `credentials: 'omit'` throughout the fetch
  paths (`background.ts:132,237`, `main-world.ts:200,308`, `download.ts:98,107`) with the
  `ANDROID_VR_CLIENT` body in `src/shared/innertube.ts:1-2,29-30`.

## Direct answers to the four audit questions

### 1. What the release workflow produces and uploads on a version tag

**Firefox MV2 only, to a GitHub Release. Not Chrome, not Edge, not Firefox MV3.** Two
assets: (a) the Mozilla-signed XPI `dist/youtube-audio-<version>-signed.xpi`, and
(b) `dist/updates.json`, the self-hosted Firefox update manifest. Quoted steps:

- Build + sign: `release.yml:40` (`npm run build`), `release.yml:45-46`
  (`npm run release:sign`, which shells to `scripts/release.sh`).
- Generate the update manifest by templating the checked-in `updates.json` with the
  version, the Release asset `update_link`, and the XPI SHA-256 (`release.yml:48-68`).
- Publish signed XPI (`release.yml:70-73`), then the manifest (`release.yml:75-78`),
  both via `softprops/action-gh-release`.

Note on the self-hosted manifest: `updates.json` is published as a **Release asset**,
but the `update_url` compiled into the signed build points at GitHub **Pages**
(`SELF_HOSTED_UPDATE_URL: https://animeshkundu.github.io/youtube-audio/updates.json`,
`release.yml:25`; consumed in `wxt.config.ts:19,96`). `pages.yml` only builds the MkDocs
site from `docs/**` (`pages.yml:5-9,43-49`) and does not deploy `updates.json`, so the
embedded `update_url` currently has nothing serving it. This, plus the placeholder
`FIREFOX_EXTENSION_ID: youtube-audio@local` (`release.yml:24`), is why RELEASE.md:33
says to "replace its template self-hosted ID and Pages URL with the selected permanent
values" before enabling for production. The mechanism is built; the hosting endpoint is
not yet wired.

### 2. Versioning

**Wired correctly for the tag gate, but not a single source of truth for the artifact.**
The release gate enforces that the tag equals `package.json` version and fails otherwise:
`if [ "${GITHUB_REF_NAME#v}" != "$VERSION" ]` where `VERSION` is read from `package.json`
(`release.yml:53-57`). The XPI filename and the `updates.json` `version` are both derived
from `package.json` (`release.yml:53,58,61-67`). Good so far.

The gap: the version that actually lands **inside** the built manifest and signed XPI is
a **hardcoded literal** in `wxt.config.ts:58` (`version: '0.0.2.5'`), independent of
`package.json:3` (`0.0.2.5`) and the root `updates.json` template. They match today only
by manual coordination, which RELEASE.md:27 explicitly calls out ("bump `package.json`
and `wxt.config.ts` together before signing"). If `wxt.config.ts` ever lags, the tag gate
still passes (it checks `package.json`), the published `updates.json` advertises the
`package.json` version, but the XPI manifest carries the stale `wxt.config.ts` version.
Research doc 07 (line 168) states the `updates.json` `version` "must match the XPI's
manifest version," so this divergence would break the desktop auto-update handshake. This
is a latent correctness hole, not an active bug (the values match now).

**Chrome/Edge/Firefox version divergence:** none exists, because no Chrome or Edge
artifact is produced. The only version concern is the `package.json` vs `wxt.config.ts`
duplication above.

### 3. Signing per browser, and whether it is needed

- **Firefox: yes, mandatory, and it is implemented.** `scripts/release.sh:28-33` runs
  `web-ext sign --channel=unlisted` with `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`, which are
  required (the script exits early if absent, `release.sh:11-19`) and supplied as repo
  secrets (`release.yml:22-23`). A Mozilla signature is **mandatory** to install or update
  on release/beta Firefox on desktop and Android (research 07, Executive summary point 1),
  so this is not optional. The self-hosted `updates.json` fits **desktop only**: Firefox
  desktop polls `update_url` ~every 24h and installs higher signed versions (research 07,
  "How/when Firefox applies it"). On Firefox for **Android**, a file-installed unlisted XPI
  gets **no auto-update at all**; hands-off Android updates require an **AMO-listed**
  add-on under a separate identity (ADR-0002; RELEASE.md "AMO-listed Android auto-update";
  research 07 Option A vs B). That listed submission stays human-gated (ADR-0003).
- **Chrome: would require a Chrome Web Store submission.** A distributable Chrome extension
  is a CRX signed by the Web Store on publish; there is no self-sign. Side-loading an
  unpacked/CRX build is developer/enterprise-policy only, not a real end-user channel, and
  Chrome MV2 is dead, so any Chrome build must be MV3. None of this exists in the repo.
- **Edge: would require an Edge Add-ons store submission** (Partner Center), store-signed.
  Edge is Chromium, so it can consume a **Chromium MV3** package (the same MV3 build that
  would target Chrome), but only after that MV3 build exists. It cannot consume the current
  Firefox MV2 XPI, and the Firefox MV3 artifact we build is still Gecko-targeted.

### 4. Feasibility and scope reality

Shipping to Chrome/Edge is **not a CD upload step; it is a feature-parity rewrite** of the
network-interception and ad/telemetry-block paths, and parts are impossible on MV3.
Chrome and Edge are Chromium MV3 only now:

- **No blocking `webRequest`.** `onBeforeRequest ... ['blocking']`
  (`background.ts:357-359`) and the telemetry/ad-block redirect/cancel logic must be
  re-expressed as static `declarativeNetRequest` (DNR) rules. DNR cannot run arbitrary
  per-request JS logic, so any decision that depends on runtime state (settings, video
  context) has to be reshaped into precompiled rule sets or dynamic rules with far less
  flexibility.
- **No `filterResponseData`.** The player-response ad prune (`filterPlayerResponse`,
  `background.ts:79-108`, using `filterResponseData` at `background.ts:82`) reads and
  rewrites the response body in flight. **Chromium has no equivalent API at all.** This
  path cannot be ported; it would need a different mechanism (for example main-world fetch
  interception / response rewriting injected into the page), which is a fundamentally
  different and more fragile design. This is the single hardest blocker.
- **Host-permission / ANDROID_VR model differs.** The credentialless ANDROID_VR re-fetch
  (`credentials: 'omit'`, `innertube.ts`, `background.ts:132,237`, `main-world.ts:200,308`)
  depends on the extension's cross-origin fetch and host-permission model, which behaves
  differently under MV3 service-worker background and Chromium's permission prompts. It is
  portable in principle but needs revalidation, and the MV3 background is a
  non-persistent service worker, not the persistent page this extension relies on
  (`background.ts:333` `persistent: { firefox: true }`; `platform.ts:11`).

**What breaks or needs a DNR/MV3 re-implementation on Chromium:**

| Feature                                         | Fate on Chromium MV3                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Telemetry blocking (blocking `onBeforeRequest`) | Re-implement as `declarativeNetRequest`; loses runtime conditional logic                  |
| Player-response ad prune (`filterResponseData`) | **No API exists.** Not portable; needs a new response-rewrite design or is dropped        |
| Audio-only via ANDROID_VR credentialless fetch  | Portable in principle; needs MV3 service-worker + host-permission revalidation            |
| Persistent background state                     | Rewrite for a non-persistent service worker                                               |
| Audio download                                  | Portable (`downloads` exists on Chromium), but inherits the store-policy risk of ADR-0003 |

**Is Chrome/Edge even in scope?** No. The product's stated north star is **Firefox
desktop + Firefox for Android** (product direction; research 03 executive summary; the
entire ADR-0002/0003 distribution model is Gecko-only). Firefox is the one place the full
blocking `webRequest` + `filterResponseData` mechanism is supported, which is exactly why
the tool targets it. Chrome/Edge are not a listed goal.

## Per-browser CD decision table

| Browser           | Artifact today                                                             | Store vs self-host                                                            | Signing required                                                             | Versioning                                                                                          | Feasibility / effort                                                    | Features that break on MV3                                                           |
| ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Firefox (MV2)** | Signed XPI + `updates.json`, both to GitHub Releases (`release.yml:70-78`) | Self-hosted (unlisted) desktop; AMO-listed for Android auto-update (ADR-0002) | **Yes, implemented** (`web-ext sign --channel=unlisted`, `release.sh:28-33`) | Tag == `package.json` gate (`release.yml:53-57`); manifest version duplicated in `wxt.config.ts:58` | Shipping now (owner gates: real Gecko IDs, Pages endpoint, AMO listing) | N/A (stays MV2)                                                                      |
| **Firefox (MV3)** | Compile-only CI artifact, uploaded nowhere (`ci.yml:53-70`)                | Not distributed                                                               | Would need signing if ever shipped                                           | Same source as MV2 build                                                                            | Builds, but not a shipping target                                       | Blocking webRequest + `filterResponseData` degrade even on Gecko MV3                 |
| **Chrome**        | **None**                                                                   | Chrome Web Store (CRX store-signed); unpacked is dev/enterprise only          | **Yes** (store publish signature); no self-sign                              | No artifact                                                                                         | **Not a CD step; MV3 parity rewrite.** MV2 is dead                      | `filterResponseData` impossible; blocking webRequest to DNR; ANDROID_VR revalidation |
| **Edge**          | **None**                                                                   | Edge Add-ons (Partner Center, store-signed)                                   | **Yes** (store publish signature)                                            | No artifact                                                                                         | Consumes the same Chromium MV3 build as Chrome, once that exists        | Same as Chrome                                                                       |

## Decision

**Firefox-only CD: publish Firefox desktop and Firefox for Android from one signed XPI,
to GitHub Releases.** This matches the product's Firefox desktop + Android north star and
is the only browser where the core mechanism (blocking `webRequest` +
`filterResponseData`) is fully supported. Do not add Chrome or Edge to CD; there is nothing
valid to upload until a Chromium MV3 build exists, and producing one is a
network-interception rewrite, not a pipeline change.

One XPI can serve both desktop and Android because the manifest already carries the three
Android-enabling keys (`wxt.config.ts:92-102`): a `gecko.id` (`FIREFOX_EXTENSION_ID`,
currently the placeholder `youtube-audio@local`, `wxt.config.ts:18,94`),
`strict_min_version: '128.0'` (`wxt.config.ts:95`), and `gecko_android: {}`
(`wxt.config.ts:101`). The empty `gecko_android` block is exactly what marks the add-on
Android-installable (research 03 section 5; research 07 point 5), so the same signed XPI
installs on desktop Firefox and on Firefox for Android.

## Does release.yml deliver Firefox desktop + Android today?

Audit of the current pipeline against the confirmed goal, item by item:

- **Builds one XPI that installs on both desktop and Android? YES (manifest is correct),
  with a placeholder-ID caveat.** The build carries `gecko.id`, `gecko_android: {}`, and
  `strict_min_version: '128.0'` (`wxt.config.ts:94,95,101`). The ID is the template
  `youtube-audio@local`, which RELEASE.md:11 and ADR-0002 say must be replaced with a
  permanent, distinct ID before real distribution.
- **Signed so it installs on release/beta Firefox + Android? YES.** `web-ext sign
--channel=unlisted` (`release.sh:28-33`), gated on `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`
  (`release.sh:11-19`) which are wired as repo secrets under those exact names
  (`release.yml:22-23`). A Mozilla signature is mandatory on release/beta Firefox for both
  desktop and Android.
- **Tag -> package.json version as single source of truth, carried by the XPI +
  updates.json? PARTIAL.** The tag gate enforces `tag == package.json version`
  (`release.yml:53-57`), and the XPI filename + `updates.json` `version` derive from
  `package.json` (`release.yml:53,58,61-67`). But the version compiled **into** the XPI
  manifest is a separate hardcoded literal in `wxt.config.ts:58`. It is not sourced from
  `package.json`, so it is not a true single source of truth.
- **Self-hosted updates.json gives hands-off auto-update on desktop AND Android? DESKTOP
  YES, ANDROID NO.** Firefox desktop polls `update_url` ~every 24h and installs higher
  signed versions (research 07). Firefox for **Android does not auto-update a
  file-installed / self-hosted XPI at all** (research 07 point 3 and Option A; ADR-0002).
  Hands-off Android updates require an **AMO-listed** add-on under a separate identity
  (ADR-0002; research 07 Option B), which is human-gated (ADR-0003) and not part of this
  CD. So self-hosted CD delivers: desktop auto-update, Android manual-update-only.
- **Release asset URL stable? YES, but updates.json is not hosted where the build looks.**
  GitHub Release asset URLs (`.../releases/download/<tag>/<file>`) are stable, and the
  workflow points `update_link` at them (`release.yml:60`). However `updates.json` is
  published only as a **Release asset** (`release.yml:75-78`), while the `update_url`
  baked into the signed build points at GitHub **Pages**
  (`https://animeshkundu.github.io/youtube-audio/updates.json`, `release.yml:25`,
  `wxt.config.ts:96`), and `pages.yml` does not deploy `updates.json` (`pages.yml:5-9`).
  So even desktop auto-update is not actually live until that endpoint is served.
- **Mobile-specific missing step:** Android install is by opening the signed XPI URL /
  file-install (research 07 Option A), which works but is **manual to update**. For
  hands-off mobile auto-update, the AMO-listed Android channel (ADR-0002's second
  identity) must be created and submitted; that is deliberately human-gated and absent
  from CD.

Net: the workflow **builds and signs a correct dual-target XPI and uploads it to a stable
Release URL**, so a user can install on both desktop and Android today. What is missing for
"proper" desktop+mobile releases is (a) a real add-on ID, (b) actually serving
`updates.json` at the `update_url`, (c) collapsing the version to one source, and (d) the
AMO-listed channel if hands-off Android updates are wanted.

## Recommendation and prioritized gaps to fix

**Recommendation: keep Firefox-only CD, desktop + Android from one signed XPI.** The
pipeline is close; fix these gaps, in priority order, so releases publish Firefox
desktop+mobile properly (all are config/doc/owner steps, no mechanism change):

1. **Replace the placeholder add-on ID** `youtube-audio@local` with a permanent, distinct
   Gecko ID before the first real release (`wxt.config.ts:18`, RELEASE.md:11, ADR-0002).
   An installed ID is permanent and cannot move channels later.
2. **Actually serve `updates.json` at the `update_url`.** Either deploy it to the Pages
   path the build points at (`animeshkundu.github.io/youtube-audio/updates.json`) or
   repoint `SELF_HOSTED_UPDATE_URL` at the stable Release-asset URL. Without this, even
   desktop auto-update is dead (`release.yml:25,75-78`, `pages.yml:5-9`).
3. **Make the manifest version a single source of truth.** Source the `wxt.config.ts`
   manifest version from `package.json` instead of the hardcoded literal
   (`wxt.config.ts:58` vs `package.json:3`) so the tag gate, the XPI, and `updates.json`
   can never diverge (research 07 line 168: updates.json version must match the XPI).
4. **For hands-off Android auto-update, stand up the AMO-listed channel** (ADR-0002's
   second identity + ADR-0003 policy preflight). This is owner-gated (AMO submission,
   review, real-device S4 test) and is the only path to silent updates on the exact
   platform the product targets. Until then, document Android as manual-update
   (file-install the new signed XPI), which the self-hosted CD already supports.
5. **Optional hardening:** verify `cancel-in-progress: false` and the tag concurrency group
   already protect against a half-published release (`release.yml:13-15`, correct today),
   and keep publishing the XPI before the manifest to avoid a 404 window
   (`release.yml:70-78`, correct today).

If Chrome/Edge are ever desired later, the prerequisite work is a Chromium MV3 target
(blocking `webRequest` -> `declarativeNetRequest`, a replacement for the
`filterResponseData` player-response prune, MV3 service-worker revalidation of the
ANDROID_VR fetch), then Chrome Web Store + Edge Partner Center accounts and store-signed
publish jobs. Given the north star and the `filterResponseData` blocker, do not pursue this
unless the owner redefines scope.

## Implementation status

Landed in the same change as this ADR (Firefox-only CD, desktop + Android from one signed XPI):

- **Gap 2 (serve `updates.json`) — FIXED.** `SELF_HOSTED_UPDATE_URL` now points at
  `https://github.com/animeshkundu/youtube-audio/releases/latest/download/updates.json`
  (`release.yml`). GitHub serves `releases/latest/download/<asset>` as a stable redirect to
  the newest release's asset, and the workflow already uploads `updates.json` under that
  name, so desktop auto-update is live the moment a tag publishes, with no GitHub Pages
  coupling. Chosen over deploying to Pages because it needs no extra hosting step and no
  race with the MkDocs deploy.
- **Gap 3 (single source of truth for the version) — FIXED.** `wxt.config.ts` reads
  `version` from `package.json` at config load instead of a hardcoded literal, so the tag
  gate, the packaged manifest, the signed XPI filename, and `updates.json` cannot diverge.
  Verified: a default build emits `version: "0.0.2.5"` from `package.json` with no
  `update_url`.
- **Gap 1 (permanent add-on ID) — OWNER DECISION, deliberately not auto-applied.** The ID
  is a permanent identity (changing it after installs exist orphans them, ADR-0002) and the
  bench pins its moz-extension UUID by this exact ID (`tests/e2e/bench/run-bench.mjs`
  `ADDON_ID`), so the manifest ID and six test files must move in lockstep. Recommended
  value: `youtube-audio@animeshkundu.github.io` (owner-controlled domain form). Left as the
  `youtube-audio@local` placeholder pending owner confirmation; wiring it across
  `wxt.config.ts`, `release.yml`, `run-bench.mjs` + the probe files, and the `updates.json`
  template is a single mechanical pass once confirmed.
- **Gap 4 (AMO-listed Android auto-update) — OWNER-GATED**, unchanged (ADR-0002 second
  identity + ADR-0003 preflight + real-device S4). Until then Android is
  install-and-manual-update from the signed XPI URL, which this CD supports today.

## Related ADRs

- `0002-separate-firefox-distribution-identities.md`
- `0003-amo-distribution-preflight.md`

## References

- `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml`
- `scripts/release.sh`, `scripts/build-ext.sh`, `RELEASE.md`
- `wxt.config.ts`, `package.json`, root `updates.json`
- `entrypoints/background.ts`, `src/shared/platform.ts`, `src/shared/innertube.ts`
- `docs/research/03-firefox-mobile-support.md`, `docs/research/07-distribution-signing-updates.md`
