# Handoff: consent UX and optional permissions (CP3 item 1.5)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP3 item 1.5 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`: make the
data-consent state visible wherever it changes behavior, and stop requesting third-party access
that most installs never use. Specifically: the popup replaces its controls with a
consent-required card (with an action that deep-links to the options Data & consent row) and the
toolbar action carries a `!` badge until an extension-owned decision is made; `sponsor.ajay.app`
becomes an optional host permission requested from the SponsorBlock opt-in gesture; `downloads`
becomes an optional permission requested from the download toggle and its row is hidden where the
API is absent (Firefox for Android); `tabs` is dropped from the manifest with a bench proof that
status classification still gets its input; the background gates SponsorBlock on consent **and**
the granted host permission and refuses downloads without the granted `downloads` permission.
This is the last CP3 item; CP4 and hygiene remain.

## Changes

- `docs/specs/SPEC-013-hybrid-data-consent.md`: revised for 1.5. `pending` semantics, the
  consent-required popup/badge section, the optional-permission model and double gate, and
  updated error/testing/security sections (including the bench promises this change implements).
- `docs/adrs/0010-hybrid-firefox-data-consent.md`: dated `## Revision (2026-10-16)` section
  recording the optional-permission and badge decisions.
- `src/shared/permissions.ts` (new): `SPONSORBLOCK_ORIGIN`, `DOWNLOADS_PERMISSION` shared by the
  manifest, background gates, and options gestures.
- `wxt.config.ts`: production manifests move `downloads` and the SponsorBlock origin to
  `optional_permissions` (MV2: both; MV3: `downloads` there plus `optional_host_permissions` for
  the origin), and `tabs` is dropped. BENCH builds keep both grants required (build-only
  divergence, like the bench match patterns) so no browser-chrome prompt is ever needed in CI.
- `src/shared/consent.ts`: `DataConsentState.pending` (true only on the custom path with no
  well-formed stored record; revoked, built-in, and fail-closed defaults are decided, not
  pending), `consentBadgeText` (`!` iff pending), and a stricter `parseDataConsentMessage`
  (requires a boolean `pending` and rejects `granted && pending`).
- `entrypoints/background.ts`: fail-closed `sponsorPermissionGranted()` / `downloadsPermissionGranted()`
  helpers; `syncConsentBadge` (uses `browser.action ?? browser.browserAction` through a defensive
  cast, cosmetic, failures ignored) applied from `publishConsent` so startup and every resolution
  update the badge; the SponsorBlock handler requires consent plus the granted origin; `downloadAudio`
  returns `{ ok: false }` without the granted `downloads` permission.
- `entrypoints/popup/`: `consent-state.ts` (new) resolves consent on open over the existing
  `yta:get-data-consent` message with a 1.5 s timeout and denies on failure; `App.tsx` renders only
  the header while the answer is in flight and the consent card (with the Data & consent action)
  when denied, never the controls; `main.tsx` starts the refresh; `style.css` card styles;
  `defaultActions` exported so the deep-link target is unit-tested.
- `entrypoints/options/App.tsx`: the Skipping and Downloads toggles request their optional
  permission inside the same gesture, before the consent record and the setting (denial shows an
  inline row error and changes nothing); an enabled-without-permission notice row offers one-click
  re-grant; the Downloads row is hidden entirely when the downloads API is absent; the Data &
  consent row carries `id="data-consent"` and a mount-time hash scroll; the mount effect reads
  both permission states; five new `OptionsActions` members.

## Safety

- No new bridge messages and no new storage keys. The popup reuses the fixed
  `yta:get-data-consent` round trip; the badge is background-local and best-effort.
- Permission requests run synchronously inside the user gesture (`permissions.request` on an
  already-granted permission resolves without a prompt, which keeps BENCH and re-grant paths
  silent). A denied request leaves the setting, the consent record, and the toolbar state
  unchanged.
- The background double-gates SponsorBlock (consent **and** granted origin) and refuses downloads
  without the grant, so a revoked permission degrades open: empty segments, `{ ok: false }`, no
  error surface, every other feature unaffected.
- `tabs` is dropped without a classification regression: URLs of YouTube-family tabs remain
  visible through the existing host permissions, and the bench asserts the fixture URL is still
  read (the manifest is deliberately not widened).
- The parser is stricter than before: a reply without a boolean `pending` is denied, so the badge
  and the popup card cannot be driven by a malformed payload.

## Testing

- Unit (381 tests across 33 files, green with coverage above the 90% floor): `consent.test.ts`
  covers the pending resolution matrix phase by phase, `granted && pending` and missing-`pending`
  parse rejections, and the badge decision; `popup.test.tsx` covers the header-only in-flight
  state, the consent card with no controls and a working deep link (`options.html#data-consent`
  asserted on the real default action); `options.test.tsx` covers the request → consent record →
  setting ordering, both denial paths, the notice row and one-click re-grant, the hidden downloads
  row, and the hash deep link; `in-player-mount.test.ts` and the onboarding mocks follow the new
  payload shape.
- Bench (`tests/e2e/bench/run-bench.mjs`): the status-map probe now reads from a second tab (the
  pinned options page) so the fixture tab keeps its watch URL, and returns the resolved consent,
  the toolbar badge text, and the real manifest permission lists alongside the map. New cases:
  `consent:badge-marks-undecided-installs` (`!` exactly while pending; on Firefox 140+ the
  suppressed built-in grant is decided, so no badge), `manifest:no-tabs-with-bench-optional-grants-required`,
  `status-channel:fixture-url-visible-without-tabs-permission`, and
  `consent:badge-stays-clear-once-granted`; the fresh-profile case gains the probe.
- Manifest inspection: MV2 production keeps the YouTube and Googlevideo origins required with
  `optional_permissions: [downloads, https://sponsor.ajay.app/*]` and no `tabs`; MV3 splits the
  origin into `optional_host_permissions`; BENCH keeps both required with no optional keys.
- Local bench runs remain sandbox-blocked (Firefox launch timeout under the agent shell), so CI
  executes the new cases across 128 ESR through latest; this run is their first execution. If
  `getBadgeText` turns out to be unreadable from an extension page in headless Firefox, the two
  badge cases fail loudly and the fallback is unit-only coverage of
  `consentBadgeText` plus the applied-call path (documented in SPEC-013's testing section).
- `npm run validate` green (typecheck, lint, format, unit tests incl. the coverage gate, MV2
  build, `web-ext lint`, MV3 build).

## Follow-ups

- CP4 and hygiene next (AMO listing refresh, ADR-0015, release notes, AMO replies), then the
  residential canary re-run; AMO publish stays manual and PR #104 stays a draft until then.
- Revoking a permission in the Add-ons Manager while the options page is already open updates on
  the next open (mount-time read). The background gate is always authoritative, so the notice is
  cosmetic; a live `permissions.onRemoved` refresh was deliberately not added and remains a
  candidate if users report confusion.
- The popup deep link scrolls via a mount-time hash read (no `hashchange` listener): the popup
  always opens a fresh tab, so the simpler contract is sufficient.
- The release notes now carry the 1.3 idle-nag bullet promised by the plan row (it was missing)
  and the two 1.5 bullets, and the stale "declares no data collection" line was replaced with the
  amo-metadata wording (the H1 leftover in `docs/release-notes/NEXT.md`).
