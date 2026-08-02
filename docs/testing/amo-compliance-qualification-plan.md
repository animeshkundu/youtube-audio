# AMO Compliance Qualification Plan (hybrid data consent)

Status: living document for the `amo-compliance` branch. Owner-gated; nothing here publishes.

This plan qualifies the hybrid data-consent build (ADR-0010, SPEC-013) across the Firefox
versions the manifest claims to support, before resubmitting to AMO after the 1.0.3 rejection.

The build under test declares `data_collection_permissions.required: ["websiteContent"]`
(`wxt.config.ts:126-128`) while keeping `strict_min_version: "128.0"` (`wxt.config.ts:124`).
That combination is the whole risk surface: the manifest key is only honoured by Firefox
desktop 140+ and Firefox for Android 142+, so every older supported version must be carried
by the extension-owned consent screen in `entrypoints/consent/`.

## 0. Empirical findings that shape this plan

These were measured on this machine against real Firefox binaries, not assumed. They change
what the plan has to test and they invalidate one existing harness assumption.

### F1. A TEMPORARY install DOES populate `data_collection`

This finding contradicts the widely-repeated assumption that temporary installs cannot
exercise the built-in consent path. (It does **not** explain the bench failures — see F1a.) It was measured four ways on
Firefox 152.0.5, every one of them a **temporary** install
(`driver.installAddon(..., true)` — exactly what the bench does at
`tests/e2e/bench/run-bench.mjs:370`):

| Subject                               | `extensions.dataCollectionPermissions.enabled` | `getAll().data_collection` |
| ------------------------------------- | ---------------------------------------------- | -------------------------- |
| Minimal probe add-on, unpacked dir    | default (on)                                   | `["websiteContent"]`       |
| Minimal probe add-on, packaged `.xpi` | default (on)                                   | `["websiteContent"]`       |
| Minimal probe add-on, packaged `.xpi` | `false`                                        | **key absent**             |
| **The real production XPI**           | default (on)                                   | `["websiteContent"]`       |
| **The real production XPI**           | `false`                                        | **key absent**             |

The last two rows were taken against the actual built `.output/firefox-mv2` package (add-on ID
`{580efa7d-…}`, `data_collection_permissions.required: ["websiteContent"]`), read from the
extension's own options page.

What this establishes:

- Firefox reports a **required** data category as granted through `getAll()` on a temporary
  install. No `about:addons` install-from-file, no persistent profile, and no human click is
  required to make the built-in path resolve granted.
- Our harnesses then explicitly turn that off. Every one of them sets
  `extensions.dataCollectionPermissions.enabled = false` (`run-bench.mjs:117`, plus
  `capture-visuals.mjs:46`, `probe-audio-playback.mjs:44`, `probe-audio-matrix.mjs:99`,
  `probe-live-features.mjs:68`, `probe-adblock-live.mjs:46`, `probe-m1-canary.mjs:24`,
  `probe-mobile-fenix.mjs:39`, `verify-firefox.mjs:53`, `real-youtube-capture.mjs:64`, and
  `run-matrix.mjs` via `runSession`) and then seeds a local consent record
  (`tests/e2e/consent-helper.mjs:5-28`).

That pref was correct when detection keyed on **key presence**. The current
`src/shared/consent.ts:32-39` keys on **browser version**: `supportsBuiltInDataConsent` returns
true for any desktop major >= 140. Local Firefox is 152.0.5 and CI's `setup-firefox` pulls
`latest`, so the built-in branch is what runs. Leaving the pref at its default is therefore the
configuration that matches a real modern user, which is exactly what the concurrent
`disableBuiltInDataConsent` parameterisation in `run-bench.mjs` now does.

**Consequence.** The 140+ built-in lane is _not_ inherently untestable by Selenium: a temporary
install reaches a granted state with no persistent profile and no human. What the seeded
storage record can no longer do is simulate the _custom_ (128-139) path on a modern binary —
that now genuinely requires an old binary (§F3), because the branch is chosen by version, not
by pref.

### F1a. Correction: the pref is NOT what is breaking the bench

I initially concluded the harness pref was suppressing consent and therefore breaking the
suite. **I tested that and it is wrong.** Measured, on this machine:

| Run                              | Result    |
| -------------------------------- | --------- |
| Bench as-is (pref disabled)      | 18/52     |
| Bench with the pref line deleted | **18/52** |

Not one case changed state — the failing set is byte-identical across both runs. So consent
suppression is not the cause of the 34 failures, and the "one-line fix" does not exist. The
evidence for what _is_ happening:

- `m1:enabled-fetch-and-hijack` shows `playerPost: true` — the extension **did** POST
  `/youtubei/v1/player`. That is a transmitting action, which only happens when consent
  resolved **granted**. Consent is working in the treatment sessions.
- `consent:fresh-unconsented-profile-fails-closed` fails on `status: null` only. Its actual
  privacy assertions all hold: `playerPost: false`, `artwork: null`, `artworkRequests: []`, and
  the video src is the native fixture stream, not `/videoplayback`. **The fail-closed invariant
  itself is intact** — the case fails because it additionally requires `status === 'disabled'`.
- Across the 34 failures the recurring signature is `status: null`, an absent player button,
  and an empty background status map, while markers are set and network behaviour is correct.

That points at the **status channel / page-world signal**, not at consent. The likely
candidates are the MAIN-world script not reporting (or not being injected in time) on this
Firefox, or a harness/driver mismatch on a modern binary. The treatment run also ends on
`/native-video` rather than a hijacked `/videoplayback`, consistent with the page world never
completing its swap even though the background fetched the player response.

**Root-cause this before trusting the suite, and treat it as a separate investigation from
consent.** Two cheap checks first: whether `dist/youtube-audio-bench.xpi` was stale relative to
the working tree (these were `SKIP_BUILD=1` runs against a pre-existing XPI), and whether the
same 18/52 reproduces on a clean checkout of `master`, which would prove the regression
predates the consent work entirely.

### F2. The 139/140 boundary could not be measured with this harness stack

`geckodriver` 0.37.1 cannot complete a page load in Firefox 139 or 140 under any variant tried:
`moz-extension://` navigation hangs, and on 140 even a plain content script on an `http://`
page never runs. A control add-on **without** any `data_collection_permissions` key behaves
identically on 140, which proves this is a driver/browser-version incompatibility and **not**
consent behaviour. Do not read anything about consent into it.

Practical effect: the empirical answers to U2 and U3 below cannot be obtained by pointing the
existing Selenium stack at an old binary. They need either an older `geckodriver` matched to
the 139/140 era, or a human driving a real profile. Budget for that; it is the difference
between answering the top risk and guessing at it.

### F3. Old Firefox binaries install and launch, but are not drivable by this geckodriver

Firefox 139.0 and 140.0 were both downloaded from the Mozilla archive, mounted, and copied to
`/tmp/Firefox139.app` and `/tmp/Firefox140.app`. Both launch headless and both accept a
webdriver session: `browserVersion` is reported correctly and `Addon:Install` succeeds.
`xattr -cr` on the copied `.app` is required first (macOS quarantine), otherwise launch hangs.

But page loads do not complete (see F2). So "the binary runs" and "the suite can run against
it" are different claims, and only the first is currently true. Both binaries are left in
`/tmp` for whoever picks up the 139/140 lane.

### F4. Every version this plan needs is actually obtainable

Verified by HTTP 200 against the Mozilla archive on 2026-08-01:

| Need                         | Exact source                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop 128 floor (ESR)      | `https://archive.mozilla.org/pub/firefox/releases/128.0esr/mac/en-US/` (ESR points also exist through `128.14.0esr`)                 |
| Desktop mid (custom path)    | `https://archive.mozilla.org/pub/firefox/releases/133.0/mac/en-US/`                                                                  |
| Desktop 139 (last custom)    | `https://archive.mozilla.org/pub/firefox/releases/139.0/mac/en-US/Firefox%20139.0.dmg` (downloaded, runs)                            |
| Desktop 140 (first built-in) | `https://archive.mozilla.org/pub/firefox/releases/140.0/mac/en-US/Firefox 140.0.dmg`                                                 |
| Desktop current ESR          | `140.13.0esr` is the newest 140-line ESR in the archive; `153.0esr` also exists                                                      |
| Desktop latest               | `153.0` (newest release directory in the archive at the time of writing)                                                             |
| Android 128 floor            | `https://archive.mozilla.org/pub/fenix/releases/128.0/android/fenix-128.0-android-arm64-v8a/fenix-128.0.multi.android-arm64-v8a.apk` |
| Android 141 (last custom)    | `https://archive.mozilla.org/pub/fenix/releases/141.0/android/` (same arch layout)                                                   |
| Android 142 (first built-in) | `https://archive.mozilla.org/pub/fenix/releases/142.0/android/fenix-142.0-android-arm64-v8a/fenix-142.0.multi.android-arm64-v8a.apk` |
| Android latest               | `153.0.2` (newest fenix release directory)                                                                                           |

Local Android capability: `arm64` Mac, `avdmanager`/`sdkmanager` present under
`/opt/homebrew/share/android-commandlinetools`, `adb` 1.0.41 available there (not on `PATH`),
one system image `android-34/aosp_atd/arm64-v8a`, and an existing AVD `yta_test`. So the
arm64-v8a Fenix APKs above are the right ones locally; CI's `mobile-e2e.yml` pins an x86_64
build instead and is a different lane.

### F5. Firefox disables an extension pending acceptance of newly-required permissions

Mozilla's own documentation states that on **update**, Firefox shows only the _added_ required
data permissions, and the standard Firefox behaviour for an update that adds required
permissions is that the add-on is disabled until the user accepts. The Extension Workshop page
on built-in consent does not spell out the disabled-pending state for data permissions
specifically. This is the single largest unknown and §2 case U2 exists to settle it
empirically rather than by citation.

---

## 1. Version matrix

Ten browser configurations. "Path" is which consent branch
`supportsBuiltInDataConsent` (`src/shared/consent.ts:32-39`) selects.

### Desktop

| #   | Version        | Path     | Why this one                                                                                     | Source                                       |
| --- | -------------- | -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| D1  | 128.0esr       | custom   | The floor the manifest claims. Also the ESR line real institutional users sit on.                | archive `128.0esr/mac/en-US/`                |
| D2  | 133.0          | custom   | Mid-range sanity: catches anything that only works at the exact floor or the exact boundary.     | archive `133.0/mac/en-US/`                   |
| D3  | 139.0          | custom   | **Last** desktop version on the custom path. The boundary that matters.                          | archive `139.0/mac/en-US/` (already fetched) |
| D4  | 140.0          | built-in | **First** desktop version on the built-in path.                                                  | archive `140.0/mac/en-US/`                   |
| D5  | 140.13.0esr    | built-in | Current ESR line. Institutional users will land here, on the built-in path, via ESR auto-update. | archive `140.13.0esr/mac/en-US/`             |
| D6  | 153.0 (latest) | built-in | What most users actually run. Also what CI's `setup-firefox: latest` uses.                       | archive `153.0/mac/en-US/`                   |

D2 and D5 are the drop-first candidates if time is short. D1, D3, D4 are not negotiable: they
are the floor and the two sides of the boundary.

### Android (Fenix)

| #   | Version | Path     | Why                                             | Source                                                            |
| --- | ------- | -------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| A1  | 128.0   | custom   | Android floor.                                  | `pub/fenix/releases/128.0/android/fenix-128.0-android-arm64-v8a/` |
| A2  | 141.0   | custom   | **Last** Android version on the custom path.    | `pub/fenix/releases/141.0/android/…`                              |
| A3  | 142.0   | built-in | **First** Android version on the built-in path. | `pub/fenix/releases/142.0/android/fenix-142.0-android-arm64-v8a/` |
| A4  | 153.0.2 | built-in | Current Android.                                | `pub/fenix/releases/153.0.2/android/…`                            |

Locally use `arm64-v8a` against the existing `yta_test` AVD (arm64 host, arm64 system image).
The `x86_64` variants exist at the same paths and are what `.github/workflows/mobile-e2e.yml`
would need if this ever runs in CI. Note `docs/ci-cd.md` records that live-YouTube probes
cannot go green from GitHub datacenter IPs, so the Android lanes here are **local-only** by
design.

Android geckodriver compatibility is a real constraint: `geckodriver` 0.37.1 against a
GeckoView from Fenix 128 is a five-year version gap in browser terms. If 0.37.1 refuses to
drive Fenix 128/141, A1 and A2 degrade to manual-only. Discover this early (§6 step 2), do not
find out on qualification day.

---

## 2. Upgrade boundaries (highest priority)

Clean install is the easy case and the bench already models the shape of it. The dangerous user
is the one who already has 1.0.3 working, has no consent record at all, and receives this build
as an automatic AMO update. Every case below starts from that state.

**Seed state for all U-cases** (this is the "existing 1.0.3 user"):

- extension version 1.0.3 installed and enabled;
- `browser.storage.local.settings` present with a non-default value that proves migration —
  set `segmentSkipEnabled: true` (1.0.3 allowed SponsorBlock on; this build defaults it off at
  `src/shared/config.ts:45`) and `hideComments: true`;
- **no** `dataTransmissionConsent` key;
- `seenOnboarding` / `seenAudioOnlyCoach` set, so first-run UI does not confound the result.

### U1 — Update on Fx 128-139 (custom path). Severity: high. Likelihood: medium.

Run on D1 (128.0esr) and D3 (139.0).

Assert, in order:

1. Immediately after the update completes, a **new focused tab** at
   `moz-extension://…/consent.html` is open. Source: `handleOnboardingInstalled`
   (`entrypoints/background.ts:91-100`) fires for `reason === 'update'`
   (`shouldOpenOnboarding`, `:87-89`) and calls `tabs.create({ …, active: true })` (`:96`).
   Assert it is a **tab** in the existing window, not a popup window.
2. Before any interaction with that tab, open a YouTube watch page. Assert the fail-closed
   invariant holds: no `/youtubei/v1/player` POST from the extension, no `/videoplayback`
   hijack of `<video>.src`, no `i.ytimg.com` artwork request, status marker `disabled`. Source:
   `entrypoints/content.ts:97` awaits `resolveDataConsent()` before `injectScript` at `:125`,
   and `applyConsentToSettings` (`src/shared/consent.ts:131-143`) zeroes every transmitting
   feature.
3. Read back `browser.storage.local.settings`. Assert `segmentSkipEnabled` is **still `true`**
   and `hideComments` is **still `true`**. `normalizeSettings`
   (`src/shared/config.ts:202-269`) preserves any present boolean and only substitutes the
   default for absent/malformed keys, so the stored value must survive. This is the
   regression that would silently reset a user's settings.
4. Accept on the consent page with the SponsorBlock checkbox **unchecked**. Assert:
   `dataTransmissionConsent` is written as `{version:1, decision:'granted',
sponsorBlockAllowed:false}`; core playback now hijacks; and SponsorBlock does **not** fetch,
   because `entrypoints/background.ts:488-489` requires `dataConsent.sponsorBlockAllowed`.
5. **The interaction that will actually bite users**: after step 4, the effective SponsorBlock
   state. `ConsentPage.accept` (`entrypoints/consent/App.tsx:30`) calls
   `setSponsorBlockEnabled(false)`, which is `setSegmentSkipEnabled`
   (`src/shared/config.ts:114-116`) — it **overwrites the user's preserved
   `segmentSkipEnabled: true` with `false`**. Decide explicitly whether that is intended
   (defensible: the new consent model makes SponsorBlock opt-in and the user just declined it
   on the consent screen) and, if it is, assert it deliberately rather than discovering it as
   a bug report. If it is not intended, this is a defect to fix before submission.

### U2 — Update on Fx 140+ with the added permission NOT yet accepted. Severity: critical. Likelihood: high. **Highest-risk unknown.**

Run on D4 (140.0) and D6 (latest). This is the case the team is guessing about; the plan's job
is to stop guessing.

The user is going from a build declaring `required: ["none"]` (that is what 1.0.3 shipped —
see the `git log -L` on `wxt.config.ts`, the branch diff changes `none` to `websiteContent`) to
one declaring `required: ["websiteContent"]`. That is an **added required data permission**.

Design the test to answer three questions in order, and design it so the answer is observed,
not inferred:

- **Q1: is the extension even running?** If Firefox disables the add-on pending acceptance
  (§0 F5), then no content script runs, `resolveDataConsent` is never called, and the question
  of what `getAll()` returns is moot — the user simply sees the extension stop working until
  they click through `about:addons`. Observe by checking whether the content script marker
  appears at all on a watch page after the update.
- **Q2: if it IS running, what does `permissions.getAll()` report before acceptance?**
  Read it directly from an extension page and record the literal object. Two outcomes:
  - `data_collection` absent, or present but without `websiteContent` → `resolveDataConsent`
    returns `granted:false` (`src/shared/consent.ts:91-94`). Correct and fail-closed. The user
    sees a dead extension with **no explanation**, because `handleOnboardingInstalled` refuses
    to open the custom screen on a built-in-path runtime. That is a UX gap worth naming even
    though it is not a compliance failure.
  - `data_collection: ["websiteContent"]` present _before_ the user accepted → consent is
    granted purely on the manifest declaration. That would mean this build transmits before
    the user has agreed on the very path AMO cares most about. **This outcome blocks
    submission.**

**What F1 already tells us about Q2, and why it raises the stakes.** On a _fresh temporary
install_ of the real XPI on Firefox 152, `getAll()` reports `data_collection:
["websiteContent"]` with no user interaction whatsoever. A temporary install is documented to
skip the consent dialog, yet the required category still reads as granted. Two readings:

1. Firefox treats a **required** category as granted-by-declaration once the add-on is
   installed at all, because accepting it was a precondition of installing. Under this reading
   our `getAll()` check is a check on _the manifest we wrote_, not on _anything the user did_ —
   it can never return false on a normally-installed add-on, and `granted` is effectively
   hardcoded true on the 140+ path.
2. It is an artefact of the temporary-install path specifically, and a real install-from-file
   or AMO install behaves differently.

**These have opposite consequences and the plan must distinguish them.** Under reading 1,
`resolveDataConsent`'s built-in branch provides no user-consent signal at all — defensible
(Mozilla did collect the consent, at install time, and required categories cannot be opted out
of) but it means the fail-closed guarantee on 140+ rests entirely on Firefox's install flow,
not on anything we verify. That is worth stating plainly to the AMO reviewer rather than
letting them discover it. Under reading 2 the update case remains genuinely open.

Distinguish them by installing the real XPI **persistently** via `about:addons` →
"Install Add-on From File" (with `xpinstall.signatures.required=false` for an unsigned build)
on a profile that has never seen the add-on, and reading `getAll()` before and after the
install prompt. That is a human step; budget ten minutes for it. It is the single highest
information-per-minute action in this plan.

- **Q3: after the user accepts in `about:addons`,** does everything work: hijack, artwork,
  background play, and does the preserved `segmentSkipEnabled: true` now actually skip? Note
  `sponsorBlockAllowed` on the built-in path requires a stored record
  (`src/shared/consent.ts:95`), and an updating 1.0.3 user has **no** stored record and never
  sees the custom screen — so SponsorBlock stays off for them with no in-product way to turn it
  on except the options toggle, which calls `setSponsorBlockConsent(true)`
  (`entrypoints/options/App.tsx:595`). Verify that options path works on the built-in branch;
  `setSponsorBlockConsent` (`src/shared/consent.ts:115-119`) requires `consent.granted` first,
  which should now be true.

How to run it: this needs a **real update of a real installed add-on**, which the current
harness cannot do (§5). The tractable method is a locally-hosted `update_url`: build a 1.0.3
XPI and the new XPI, sign both unlisted under the permanent ID, serve an `updates.json` from a
local HTTPS server, install 1.0.3, then trigger "Check for Updates". `wxt.config.ts:49` still
supports `SELF_HOSTED_UPDATE_URL` precisely for a local experiment like this, and it explicitly
must never be set for a listed build. Failing that, the fallback is manual `about:debugging`
installation of 1.0.3 followed by installation of the new XPI over it, which reproduces most of
the state transition even if it is not byte-identical to an AMO update.

### U3 — In-place BROWSER upgrade while installed: 139 → 140, and Android 141 → 142. Severity: critical. Likelihood: high.

Start: extension installed on D3 (139.0) with custom consent **already granted**
(`dataTransmissionConsent = {version:1, decision:'granted', sponsorBlockAllowed:true}`), and
SponsorBlock working. Then run the same profile under D4 (140.0).

Predicted behaviour, read off the code:

- `supportsBuiltInDataConsent` now returns `true` (140 >= 140), so `resolveDataConsent` takes
  the built-in branch at `src/shared/consent.ts:84`.
- The stored `granted` record is **ignored for required consent** — the branch only reads
  `permissions.data_collection`. The comment at `:85-87` says this is deliberate.
- So the outcome hinges entirely on whether Firefox 140, on an add-on that was installed under
  139 and never went through a 140-era install prompt, reports `data_collection:
["websiteContent"]` in `getAll()`.
  - If it does → seamless: consent survives, `sponsorBlockAllowed` also survives because the
    stored record still supplies it (`:95`). Best case.
  - If it does not → **the user silently loses consent on a browser upgrade**, every feature
    turns off, and no custom screen opens (built-in path suppresses it), so they get no
    explanation and no recovery path except the options page. This is a serious UX failure and
    a plausible one.

Assert: content-script marker present; `getAll()` literal contents; resolved consent
`granted`/`source`; whether audio-only still hijacks; whether SponsorBlock still skips; and
whether any consent tab opened (it should not, on 140).

Then the mirror case on Android: A2 (141.0) with custom consent granted → A3 (142.0).

Also run the **reverse** direction once (140 → 139, a downgrade or an ESR-vs-release profile
switch): the custom branch resumes and the stored record grants consent again, so this should
be clean. Cheap to check, and it confirms the stored record was not destroyed.

### U4 — Update on a profile that had consent REVOKED. Severity: medium. Likelihood: low.

`{decision:'revoked'}` denies on both paths (`src/shared/consent.ts:77-83`). Assert an update
does not resurrect consent, and that the custom screen re-opens on 128-139 (it does:
`handleOnboardingInstalled` checks `consent.granted`, which is false).

---

## 3. Functional regression coverage per version

Run on every version in §1 after consent is granted, because "consent works" is worthless if
the product stopped working on 128.

| Capability                                  | How to check                                                                        | Automatable today                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio-only hijack                           | `<video>.src` contains `/videoplayback`, `videoWidth === 0`, `currentTime` advances | Yes — bench `m1:enabled-fetch-and-hijack` (`run-bench.mjs:1033`)                                                                                     |
| Toggle-off restores native, in place        | Position and pause state preserved                                                  | Yes — `m1:toggle-off-reclaims-native-in-place` (`:1082`), `m1:rapid-retoggle-preserves-position-and-pause` (`:1126`)                                 |
| Background / lock-screen play               | Audio continues on `visibilitychange` / tab switch                                  | Partly — `m1:visibility-suppression` (`:1728`); real lock-screen is Android-manual                                                                   |
| Artwork                                     | Artwork marker set; only the intended thumbnail is requested                        | Yes — `ux:active-audio-only-artwork-marker-present` (`:1210`), `ux:artwork-requests-only-intended-thumbnail-no-extra-egress` (`:1216`)               |
| Loudness normalization                      | Applied gain equals the expected value from the fixture's `loudnessDb`              | Yes — `m4:loudness-normalization-arms-bounded-gain` (`:1597`), matrix `feature:equalizer-*` (`run-matrix.mjs:364,379`)                               |
| EQ on YouTube Music                         | Configured band gains land on the graph                                             | Yes (hermetic) — real music.youtube.com is manual                                                                                                    |
| Download (opt-in)                           | Exactly one assembled file from multiple ranges                                     | Yes — matrix `download:assembles-full-file-via-multiple-ranges` (`run-matrix.mjs:467`)                                                               |
| SponsorBlock (needs consent **and** opt-in) | Seeks past sponsor; k-anon prefix only                                              | Yes — `m3a:segment-skip-seeks-past-sponsor` (`:1540`), `m3a:privacy-k-anon-prefix-no-viewcount` (`:1551`), category cases (`run-matrix.mjs:406,415`) |
| Ad blocking                                 | Both the XHR player response and the inline `ytInitialPlayerResponse`               | Yes — `m2b:enabled-prunes-player-ads` (`:1512`), `m2b:enabled-prunes-inline-player-response` (`:1516`), with controls at `:1686,:1691`               |
| Telemetry blocking                          | Conservative policy blocks the expected beacons                                     | Yes — `m2a:conservative-telemetry-policy` (`:1503`)                                                                                                  |
| SPA navigation                              | Second hijack re-arms; no DOM accumulation                                          | Yes — `m1:spa-navigation-rearms-second-hijack` (`:1424`), `ux:spa-navigation-does-not-accumulate-injected-dom` (`:1469`)                             |
| Fail-open: live stream                      | No hijack, native playback                                                          | Yes — `m1:live-stream-falls-back-no-hijack` (`:1309`), matrix `edge:live-fallback-still-prunes-ads` (`run-matrix.mjs:483`)                           |
| Fail-open: age-restricted / auth            | No hijack, native playback                                                          | Yes — `m1:auth-required-falls-back-no-hijack` (`:1330`), `edge:auth-required-falls-back` (`run-matrix.mjs:492`)                                      |
| Fail-open: made-for-kids                    | No hijack                                                                           | Yes — `edge:kids-unplayable-falls-back` (`run-matrix.mjs:507`)                                                                                       |
| Members-only                                | No hijack                                                                           | **Gap** — no fixture case found. Add one, or state it as manual-only.                                                                                |

The bench is genuinely strong here. The cross-version work is therefore mostly _running the
existing suite against a different binary_, which is why §7 recommends parameterising
`FIREFOX_BIN` rather than writing new assertions.

---

## 4. Consent-specific cases

| ID  | Case                                                                                                                            | Where it must run         | Automatable                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Fresh unconsented profile does not hijack, does not POST `/youtubei/v1/player`, sets no artwork marker, sends no `/vi/` request | Every version             | **Automated but currently RED** — `consent:fresh-unconsented-profile-fails-closed` (`run-bench.mjs:1006-1021`). Its privacy assertions all pass (no player POST, no artwork, no `/vi/`, native src); it fails only on `status === 'disabled'` (§0 F1a). The fail-closed invariant is intact; the status signal is not.                                                 |
| C2  | Accept persists `{version:1, granted, sponsorBlockAllowed}` and unlocks playback                                                | D1, D3 (custom path only) | Yes, with the update harness                                                                                                                                                                                                                                                                                                                                           |
| C3  | Decline actually uninstalls                                                                                                     | D1, D3                    | **Human.** `browser.management.uninstallSelf({showConfirmDialog:true})` (`entrypoints/consent/App.tsx:17`) opens native browser chrome that Selenium cannot drive. Note `uninstallSelf` does **not** require the `management` permission — see §8 finding G1.                                                                                                          |
| C4  | Revoke from options stops transmission immediately                                                                              | D1, D3, D4, D6            | Yes — `revokeDataConsent` writes storage, and both `entrypoints/content.ts:110-118` and `entrypoints/background.ts:462-468` react to `storage.onChanged` by dropping to denied _first_ and re-resolving after. Assert with a watch page open: transmission must stop without a reload.                                                                                 |
| C5  | Consent screen renders correctly at narrow Android widths and wide desktop                                                      | all                       | Semi — `capture-visuals.mjs` already screenshots; it does not currently capture `consent.html`. Add it (§7 B3). Human judgement still decides "correct".                                                                                                                                                                                                               |
| C6  | It is a focused **tab**, not a popup                                                                                            | D1, D3, A1, A2            | Yes — assert window handle count and that the new handle's URL is `consent.html` in the same window                                                                                                                                                                                                                                                                    |
| C7  | Privacy-policy link resolves                                                                                                    | all                       | Yes, cheap — the link target is `https://animesh.kundus.in/youtube-audio/privacy/` (`entrypoints/consent/App.tsx:143`) and the options page carries the same link (`entrypoints/options/App.tsx:792`). A link-check assertion belongs in the unit/CI layer, not the browser bench.                                                                                     |
| C8  | On 140+ the custom screen never opens, including while the native prompt is pending                                             | D4, D5, D6                | Yes, once U2's harness exists                                                                                                                                                                                                                                                                                                                                          |
| C9  | Consent copy matches what the code actually transmits                                                                           | all                       | Unit + human. The screen names `www.youtube.com`, `*.googlevideo.com`, `i.ytimg.com`, and optional `sponsor.ajay.app`. Cross-check against the manifest origins (`wxt.config.ts:104-110`) — note the manifest grants `sponsor.ajay.app` unconditionally while the fetch is gated at runtime (`background.ts:488`), which is fine but should be stated to the reviewer. |

---

## 5. What can be automated, and what cannot

Honest assessment. The project mandate is no-human validation on the hermetic bench, and most
of the _functional_ surface already meets it. The _consent_ surface does not yet.

### Already automated, no new work

- The full functional matrix in §3 (52 bench cases, ~19 matrix cases).
- C1 fail-closed, via a genuinely fresh profile (`runSession({seedConsent:false})`).
- Settings normalization / migration behaviour — `tests/unit/config-reset.test.ts` and the
  consent unit suite `tests/unit/consent.test.ts` (which already pins the 139/140 and 141/142
  thresholds at `:70-74`).

### Needs new harness work (tractable)

- **Root-causing the 34 bench failures.** The measured state is 18/52, and it is **not** caused
  by the consent pref (§0 F1a — deleting it changed nothing). The signature is `status: null` /
  empty status map with correct network behaviour, so this is a status-channel or page-world
  problem. This is the largest single blocker and it needs a real investigation, not a
  one-liner.
- **Keeping the built-in (140+) lane usable.** Contrary to the common assumption, a temporary
  Selenium install _does_ populate `data_collection` (§0 F1, proven against the real production
  XPI), so no persistent profile is needed to exercise the 140+ path. The other agent's
  `disableBuiltInDataConsent` parameterisation in `run-bench.mjs` already models this correctly:
  pref off only for the deliberately-unconsented case, real default everywhere else.
- **Running the bench against an arbitrary Firefox binary.** `run-bench.mjs:105` already reads
  `FIREFOX_BIN`, but §0 F2 shows `geckodriver` 0.37.1 cannot complete page loads on 139/140, so
  this needs a matched older geckodriver before it is useful. Not as cheap as it first looked.
- **Simulating an extension update.** Absent today: the bench installs a single XPI as a
  temporary add-on (`run-bench.mjs:370`, `installAddon(BENCH_XPI, true)`), and a temporary
  add-on cannot be updated in place or survive a restart. This is the single biggest harness
  gap and it is exactly what §2 needs. Two routes: a local `update_url` server, or install-over
  with a persistent (signed) add-on.
- **Capturing `consent.html` in `capture-visuals.mjs`.**
- **Asserting the literal `permissions.getAll()` object from an extension page** — trivial, and
  it is what turns U2/U3 from speculation into evidence.

### Genuinely requires a human

- **C3 decline-and-uninstall.** Native confirm dialog.
- **The `about:addons` accept flow in U2/U3.** Browser chrome. Selenium page context cannot see
  it — `docs/testing/smoke-test-protocol.md` already names this "browser-chrome blind spot".
- **Android lock-screen / notification-shade playback and artwork.** No API surface a probe can
  read.
- **Visual judgement** on the consent screen at real device widths.
- **Real YouTube Music loudness/EQ being audible.**

### Cannot be done in this environment

- **CI cannot run the live probes green.** `docs/ci-cd.md:182-185` records that GitHub
  datacenter IPs are treated differently by YouTube and the ANDROID_VR fetch does not hijack
  from them. All live and Android verification is local, from a residential IP.
- **CI cannot pin an old Firefox easily** — `setup-firefox` supports a version input, but the
  gating suite should stay on latest; old-version runs belong in a local lane or a separate
  non-gating workflow.
- **Android 128/141 may be undrivable** by `geckodriver` 0.37.1. If so, A1 and A2 become
  manual-only. Discover early.

---

## 6. Order of execution

Do them in this order. Each step is cheap relative to the one after it, and each can kill the
submission before you spend the next one.

0. **Unblock the tree.** `npm run build` was failing on a missing `requiresCustomDataConsent`
   export; it now builds. Confirm before starting.
1. **Root-cause the 34 bench failures (§7 B1).** Measured baseline is **18/52**, and it is not
   the consent pref (§0 F1a). Until this is understood, every bench result is uninterpretable
   and no cross-version claim can be made. Start with the two cheap checks in F1a: a stale
   `dist/youtube-audio-bench.xpi`, and whether the same 18/52 reproduces on clean `master`.
   **Blocks everything.**
2. **The persistent-install spike (U2 Q2).** Ten minutes with `about:addons` →
   "Install Add-on From File" on a virgin profile, reading `getAll()` before and after the
   prompt. It decides whether our built-in-path consent check verifies a user decision or
   merely re-reads our own manifest — which changes what we tell the AMO reviewer.
3. **Android drivability spike.** 30 minutes: boot `yta_test`, install Fenix 128 arm64, see if
   `geckodriver` 0.37.1 attaches. Given §0 F2 (it cannot drive desktop 139/140), expect this to
   fail for old Fenix too and plan for manual Android coverage.
4. **U2** (update on 140+ without acceptance). The one that can invalidate the whole approach.
5. **U3** (139→140 in-place browser upgrade). The one that can silently break every existing
   user.
6. **U1** (update on 128/139, custom path) including the `segmentSkipEnabled` overwrite
   question.
7. **Functional regression sweep** across whatever binaries step 3 proves drivable.
8. **Android A1–A4**, at whatever fidelity the spike allows.
9. **Consent-specific C2–C9**, including the human-only ones.
10. **D2, D5** if time remains.

### If there is only time for three things

1. **Root-cause the 34 bench failures.** 18/52 is the real state of the suite today. Every
   coverage claim in §3, and every "the bench is green" line in the submission notes, is false
   until this is understood. It is not a consent problem — that hypothesis was tested and
   rejected.
2. **U2 Q2 via a persistent install** — whether `getAll()` reports `websiteContent` before any
   user decision. It determines whether our 140+ consent gate is a real check or a tautology,
   and that is exactly what an AMO reviewer will probe.
3. **U3 (139→140)** — silently dropping consent for every existing user on a routine browser
   update is the highest-volume real-world failure, and the code makes it plausible: the
   built-in branch deliberately ignores the stored grant.

---

## 7. Concrete harness changes this plan depends on

Ranked. `tests/e2e/` is being edited concurrently by another agent (consent seeding); these are
proposals layered on that work, not replacements for it.

- **B1 (blocking). Root-cause the 34 failing bench cases.** Measured 18/52, unchanged by
  deleting the consent pref (§0 F1a), so this is not a consent-seeding problem. The signature is
  `status: null` + empty background status map + missing player button, while markers are set
  and network behaviour is correct — i.e. the status channel or the MAIN-world page script, not
  the consent gate. First two checks: stale `dist/youtube-audio-bench.xpi` (these were
  `SKIP_BUILD=1` runs), and whether clean `master` shows the same 18/52 (which would prove the
  regression predates all consent work). Separately, keep the guard idea: an assertion that
  **fails loudly** when a seeded session does not resolve `granted:true`, so consent drift can
  never hide inside an unrelated failure again.
- **B2. Extension-update simulation.** Local `update_url` + two signed XPIs, or install-over.
  Prerequisite for every §2 case.
- **B3. `FIREFOX_BIN` version-sweep driver** + `consent.html` capture in `capture-visuals.mjs`.
- **B4. A bench case asserting the literal `permissions.getAll()` shape**, so a future Firefox
  change to the `data_collection` contract breaks a test instead of breaking users.
- **B5. A members-only fixture case** to close the §3 gap.

---

## 8. Findings from reading the code while planning

Things that look like real bugs or gaps, not plan steps.

- **G1. `management` permission is requested but not needed.** The branch adds `'management'`
  to `permissions` (`wxt.config.ts:101`), and the only use is
  `browser.management.uninstallSelf()` (`entrypoints/consent/App.tsx:17`). MDN is explicit that
  `uninstallSelf` "does not require the 'management' API permission". Requesting `management`
  makes Firefox show the user a scary "Monitor extension usage and manage themes" prompt and
  hands an AMO reviewer an unjustified permission on a submission that was already rejected for
  over-claiming. **Recommend dropping it and verifying `uninstallSelf` still works.** Cheap,
  and it removes an easy reviewer objection.
- **G2. Consent acceptance silently overwrites a preserved SponsorBlock preference.** See U1
  step 5. `entrypoints/consent/App.tsx:30` writes `setSegmentSkipEnabled(sponsorBlock)`
  unconditionally, so an upgrading user who had SponsorBlock on and leaves the box unchecked
  loses that setting permanently. Arguably correct under the new opt-in model, but it is
  undocumented and untested. Decide and assert.
- **G3. `npm run build` is broken on the working tree right now.** `entrypoints/background.ts:6`
  imports `requiresCustomDataConsent` from `src/shared/consent.ts`, which exports no such
  symbol. Mid-edit by a concurrent agent; flagging so it is not mistaken for a plan assumption.
- **G4. Built-in-path users get a dead extension with no explanation.** If `getAll()` does not
  report `websiteContent` on a 140+ runtime (U2 Q2 outcome 1, U3 failure branch), consent
  resolves denied, every feature turns off, and `handleOnboardingInstalled`
  (`entrypoints/background.ts:94`) deliberately opens nothing. The only surface that explains
  the state is the options page. Consider a non-blocking in-product hint for
  `granted === false && source === 'firefox'`.
- **G5. The `sponsorBlockAllowed` choice is unreachable for built-in-path upgraders.** On the
  built-in path it comes only from a stored record (`src/shared/consent.ts:95`), and an
  upgrading user has none and never sees the custom screen. The options toggle
  (`entrypoints/options/App.tsx:595` → `setSponsorBlockConsent(true)`) is the only route.
  Verify it works there; it is the sole path.
- **G6. The unit suite pins the thresholds but nothing pins the manifest.** No test asserts the
  built `manifest.json` contains `data_collection_permissions.required: ["websiteContent"]`.
  Given this exact key caused the rejection, it deserves a build-output assertion in the same
  spirit as the existing `manifest:icons-declared-and-present` case
  (`tests/e2e/bench/run-matrix.mjs:298`).

---

## 9. Definition of "flawless" (stop conditions)

Answerable yes/no. Submission is blocked unless every **must** is yes.

**Must (blocks submission)**

1. `./scripts/validate.sh` green, and `npm run test:bench` / `npm run test:matrix` green on
   latest desktop Firefox **after** B1, with the new assertion proving consent actually
   resolved granted.
2. C1 fail-closed passes on D1, D3, D4, D6: no player POST, no hijack, no artwork request, no
   `/vi/` request before consent.
3. U2 Q2 answered by observation, and the answer is **not** "consent granted before the user
   accepted".
4. U3 answered: either consent survives 139→140, or the loss is understood, documented, and
   given a recovery path the user can find.
5. U1 passes on D1 and D3: custom tab opens on update, fail-closed until accept, settings
   preserved per §2 U1 step 3, and the G2 behaviour is a decision rather than a surprise.
6. Full §3 functional sweep green on D1 (the floor) and D6 (latest). A feature that is broken on
   128 while the manifest claims 128 is itself an AMO-facing misrepresentation.
7. Android: A3 (142, built-in) and at least one custom-path version (A1 or A2) verified for
   audio-only playback + consent behaviour, at whatever fidelity §6 step 2 permits. If
   `geckodriver` cannot drive them, a documented manual pass counts.
8. C3 decline-and-uninstall confirmed by a human on one custom-path version.
9. G1 resolved: `management` either dropped or justified in writing to the reviewer.
10. Manifest assertion (G6) in place, so the rejected key can never silently regress.

**Should (fix if found, does not block)**

- D2 and D5 sweeps; A2 and A4 sweeps.
- C5 visual capture of `consent.html` at Android and desktop widths.
- G4 in-product explanation for the denied-built-in state.
- B5 members-only fixture case.

**Explicitly out of scope**

- Any logged-in path (hard invariant).
- Making the live-YouTube canary green from CI (impossible, §5).
- MV3 runtime qualification; MV3 must only stay buildable (`npm run build:mv3`).
