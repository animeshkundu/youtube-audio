# Specification: Holistic UX Foundations

> **Status:** Shipped, with the per-tab audio-only scope (§5) landed on the 1.1.0 branch. The
> status channel, honest status-driven popup hero, audio-mode artwork, first-run onboarding, and
> defaults are implemented; §5 is implemented and rides the 1.1.0 release.

## Overview

The Holistic UX pass makes the extension's surfaces honest and effortless: the popup must tell
the truth about the tab in front of the user, audio-only mode should have real artwork, and
onboarding and defaults should get a first-time user to a good state with no configuration. This
specification is the shared home for those shipped foundations.

## Goals

- Give the popup the **real, per-video playback status** for the active tab, so it can stop
  rendering the stored toggle and never claim audio-only is active on a video that fell back.
- Make that status correct under the two conditions that break naive approaches: **SPA
  navigation** (YouTube changes video without a document reload) and **multiple tabs**.
- Keep the whole channel **fail-open** and internal: no external egress, no new permissions, no
  change to `PlayerHandle`/`<video>.src`.
- Extract the decision logic into a **pure, unit-tested** module and keep the entrypoints thin.
- Render an honest popup hero and non-YouTube empty state from the resolved playback status.
- Replace the audio-only black rectangle with lifecycle-bound artwork that never writes `.src`.
- Give first-time users a one-screen, no-setup onboarding path while preserving useful defaults.

## Non-Goals

- No logged-in path, no persistence of volatile per-tab state to disk, no polling.
- No `video.poster` or media-session rewrite for artwork.
- No setup wizard, account step, or permissions pre-prompt.

## Technical Design

### 1. Status channel and honest popup hero: _Shipped_

The page world already computes the real per-video outcome
(`entrypoints/main-world.ts:emitStatus`) as a `PlaybackStatus`
(`idle | fetching | active | fallback | disabled`) with an honest `reason` and dispatches it as
a `yta:status` DOM event. Phase 0 carries that value to the popup through the background:

```
main-world.ts  --yta:status DOM event-->  content.ts
content.ts     --yta:status-update  ---->  background.ts   (Map<tabId, TabStatusEntry>)
popup          --yta:get-status    ----->  background.ts   --> resolved PlaybackUiState
background.ts  --yta:status-changed ----->  popup          (re-render when the active tab changes)
```

The architecture decision and the alternatives (popup↔content-direct, storage mirror) are
recorded in **ADR-0007**.

#### Pure module: `src/shared/status.ts` (coverage-gated ≥90%)

All decisions live here, dependency-light so any context can import it:

- `PlaybackStatus` — the shared status vocabulary (the single source of truth; `main-world.ts`
  now imports it).
- Message constants: `STATUS_UPDATE_MESSAGE`, `GET_STATUS_MESSAGE`, `STATUS_CHANGED_MESSAGE`.
- `classifyHost(url)` → `youtube | music | not-youtube` — rejects look-alike hosts
  (`evil-youtube.com`).
- `parseVideoId(url)`, `isWatchPage(url)` — mirror the page world's `?v=` watch detection.
- `parseStatusUpdate(message)` — validates a hostile update payload (status enum, reason ≤120
  chars, video-id pattern, non-negative integer generation).
- `reduceStatusUpdate(current, update, now)` — folds an update into the tab entry, ordered
  lexicographically on `(runStart, generation)`. A report from a newer content-script lifetime
  (`runStart`) always wins (so a full reload, whose generation resets to 0, never freezes); within
  one lifetime a strictly-older `generation` (a superseded SPA navigation) is dropped by returning
  the same reference. A stale entry (see `shouldMarkStale`) is revived only by a **strictly** newer
  `generation`, so an equal-tuple straggler from the now-unloaded old document cannot clear the stale
  flag; a live entry still accepts an equal epoch so a same-operation `fetching`→`active` transition
  (which reuses the operation's generation) lands.
- `shouldMarkStale(entry, changeInfo)` decides whether a `tabs.onUpdated` event invalidates the
  entry. A `loading` status (a reload) always does, and a bare URL change does only when it points at
  a **different** video id. A same-video URL rewrite (YouTube appending `&t=`/`list` params during
  playback) is not stale, so it cannot reject the same operation's own `active` report and strand the
  popup on `connecting`.
- `markEntryStale(entry)` returns the entry with its `stale` flag set.
- `resolveUiState(url, entry)` → `active | connecting | fallback(+reason) | disabled |
not-a-watch-page | not-youtube`. A rejected/absent/stale/foreign-video entry resolves to
  `connecting`, **never** to a stored toggle, so the popup cannot lie before a report lands.

#### Content relay: `entrypoints/content.ts`

On each `yta:status`, in addition to the unchanged `__BENCH__` DOM marker, content relays
`{type: STATUS_UPDATE_MESSAGE, status, reason?, videoId?, runStart, generation}` to the background
via `buildStatusUpdateMessage`. The `yta:status` DOM event is observable and forgeable by arbitrary
page JS, so its ordering provenance is **not trusted**: `generation` is a **content-owned** counter
that begins a new value each time the forwarded `videoId` changes (grouping a same-operation
`fetching`→`active` under one generation while a new video supersedes the old), and `runStart` is the
isolated per-tab epoch below. Only the display fields (`status`, `reason`, `videoId`) come from the
event; a forged `videoId` is harmless because `resolveUiState` cross-checks it against the tab URL,
and a momentary forged `status` is superseded by the next genuine report. Because the ordering is
generated here in the isolated content context, a hostile page cannot forge a huge generation to
freeze the popup.

`runStart` is a **monotonic, poison-resistant** per-tab epoch from `nextStatusRunStart()`: it takes
`max(Date.now(), previous + 1)`, where `previous` is the last epoch persisted in per-tab
`sessionStorage['__yta_run_epoch__']`, so a full reload always produces a strictly-later value even
when two loads collide within a millisecond or the system clock rolls back. The stored value is
validated (a safe non-negative integer no more than a day past `now`) so the origin-shared, hostile
page cannot poison ordering, and it falls back to `Date.now()` when `sessionStorage` throws. Together,
`runStart` (a newer document always wins across a full reload, whose page-world generation resets)
and `generation` (a superseded SPA navigation within one lifetime is dropped) let the background
order every report. The push is fail-open: any `sendMessage` rejection is swallowed and
never affects the page or playback.

#### Background map + resolution: `entrypoints/background.ts`

- `Map<tabId, TabStatusEntry>` keyed by `sender.tab.id`. Updates are accepted **only** from the
  top frame (`sender.frameId === 0`) after `parseStatusUpdate`.
- `yta:get-status` resolves `tabs.query({active, currentWindow})` and returns
  `resolveUiState(tab.url, entry)`, under a timeout that falls back to `connecting` (bounded).
- On an accepted change to the active tab, broadcasts `yta:status-changed` with the resolved
  state; a closed popup has no receiver, so the rejection is swallowed.
- `tabs.onUpdated` marks the tab's entry stale (which resolves to `connecting`) only when
  `shouldMarkStale` agrees (a `loading` reload, or a URL change to a **different** video id), so a
  same-video URL rewrite during playback does not strand the popup on `connecting`; `tabs.onRemoved`
  deletes it.

#### Popup wiring: `entrypoints/popup/playback-status.ts` + `main.tsx`

`startPlaybackStatusChannel()` (called from `main.tsx`) fetches `yta:get-status` on open and
subscribes to `yta:status-changed`, exposing the result via `playbackStatusSignal` (default
`connecting`, never a stored toggle). Bounded (time-boxed fetch) and fail-open. `popup/App.tsx`
consumes the signal to render the honest hero, fallback copy, active-only pulse, and non-YouTube
empty state. The stored toggle controls preference, but never substitutes for per-tab truth.

### 2. Audio-mode artwork: _Shipped_

`src/shared/artwork.ts` selects a safe YouTube thumbnail and mounts a pointer-transparent artwork
overlay without touching the media element source. The overlay mounts into the player root
(`.html5-video-player`/`#movie_player`) and is inserted directly **after** the video container, so it
paints above the video but below the control chrome; this avoids collapsing to a black rectangle on
real YouTube, whose immediate `.html5-video-container` wrapper is zero-height. It falls back to the
`<video>`'s direct parent on other layouts (fixtures). `entrypoints/main-world.ts` mounts it after a
successful audio-only attach when `audioArtworkEnabled` is on. The overlay cleanup is registered
through `PlayerHandle.onRestore()`, so disable, navigation, failed playback, and circuit-breaker
teardown all remove it. Image failures fall open to the bundled placeholder or the existing black
screen. The bench-only `http://localhost`/`127.0.0.1` thumbnail allowance is `__BENCH__`-gated
(dead-code-eliminated from production). See ADR-0008 and `docs/design/audio-mode-artwork.md`.

### 3. Onboarding: _Shipped_

The background install handler opens the options surface once for a fresh install. The options
entrypoint reads `seenOnboarding` and renders the dedicated `Onboarding` surface until dismissal.
The one-screen experience explains that useful defaults are already on, teaches the in-player
Audio-only button, provides an Open YouTube action, and offers direct access to settings. It has
initial focus, focus trapping, Escape dismissal, and fail-open persistence. See
`docs/design/ux-onboarding.md`.

### 4. Defaults: _Done_

The shipped defaults provide value without setup: the extension, audio-only playback, artwork,
background play, Ghost mode, ad blocking, and loudness normalization start on. Riskier or more
specialized controls remain off until selected, including segment skipping, aggressive telemetry,
quality capping, autoplay-next suppression, page decluttering, equalizer, and audio download.

### 5. Per-tab audio-only scope: _Implemented_

The popup hero becomes a quick control for the tab in front of the user. It toggles an
in-memory, tab-keyed override owned by the background (ADR-0014); options and every other
surface keep editing the global preference.

Behavior:

- Effective audio-only for a tab is `override ?? global`. The override covers only the
  `audioOnlyEnabled` field; the global pause (`enabled`) still wins when off.
- The popup hero renders and toggles the effective value for the active tab and carries a small
  "This tab" tag so the scope is visible before the first toggle; the in-player Audio-only button
  sets the same tab's override. The footer (pause/resume) and the secondary card (background
  play) stay global, and the options page remains the global editor of the preference.
- `Alt+Shift+A` (a new `commands` entry, `toggle-audio-only`) toggles the active tab's override.
  Firefox for Android does not support `commands`, so the shortcut is desktop-only; the popup and
  in-player paths work everywhere.
- The override is in-memory only, pruned on `tabs.onRemoved`, and lost on background reload.
  It survives document reloads and SPA navigations in the same tab.
- The override reaches every frame of the tab through the existing settings push, so embedded
  players follow their tab (SPEC-015).

Channel vocabulary (extends ADR-0007's channel; the pure logic lives in
`src/shared/tab-scope.ts`):

```
popup         --yta:set-tab-scope { audioOnly }-->  background (active tab; extension pages only)
content       --yta:set-tab-scope { audioOnly }-->  background (sender's own tab; in-player toggle)
popup/content --yta:get-tab-scope --------------->  background --> { audioOnly: boolean | null }
background    --yta:tab-scope-changed ------------>  the tab's frames (all frames), and the popup
                                                     (only when the changed tab is the active one)
```

- `SET`: a popup sender targets the active tab, which the background resolves itself; a content
  script may set only its own `sender.tab.id` (the in-player toggle). Non-YouTube-family tabs are
  refused, a malformed payload is dropped, and no caller can target an arbitrary tab. The
  popup-facing path is time-boxed with a `null` (follow global) fallback.
- `GET`: from a content script the background answers for `sender.tab.id`; from the popup it
  answers for the active tab. The reply is `{ audioOnly: boolean | null }` where `null` means
  "follow the global preference".
- The content script merges the override into the consented settings snapshot it already
  pushes per document, and re-applies on every scope push; a fetch failure leaves the global
  behavior in place. An override push that arrives before the initial fetch wins over the
  stale startup reply.
- The popup exposes the override as a signal and renders `resolveTabAudioOnly(...)` in the
  hero; the existing gate that hides the active state while the global pause is off is
  unchanged.
- No storage writes, no new storage keys, no new permissions, and no new origins.

Validation:

- Unit: the precedence table, the settings overlay, the in-memory store, and the message
  parsers (`tests/unit/tab-scope.test.ts`).
- Bench: `per-tab-scope:override-beats-global-and-prunes` (see below).
- Matrix: the same scenario runs once as a dedicated cell in the settings-permutation matrix.

## Hard-invariant compliance

- **Credentialless / logged-out:** the channel carries only a status enum + reason + a video id
  already visible in the URL; it attaches no credentials and makes no external request. Fine
  under `data_collection_permissions.required: ['none']`.
- **`PlayerHandle` sole `<video>.src` writer:** status and onboarding do not touch media; artwork
  is a separate DOM overlay and never reads or writes `.src`.
- **Fail-open:** content relay, background broadcast, and popup fetch each swallow failures.
- **No new permissions:** `tabs` + the four YouTube host matches were already granted.
- **MV2 ships / MV3 buildable:** no new background-lifetime assumption; an empty map (e.g. a
  non-persistent MV3 background) resolves to `connecting` and repopulates on the next emit.

## Testing & Validation

### Unit (`tests/unit/`)

- `status.test.ts` — the pure module: `classifyHost` (incl. look-alike rejection), `parseVideoId`,
  `isWatchPage`, `isPlaybackStatus`/`isPlaybackUiState`, `resolveUiState` (every branch:
  `not-youtube`, `not-a-watch-page`, `connecting` for no/stale/foreign-video entry, `active`,
  `fallback`+reason, `disabled`, `fetching`/`idle`→`connecting`), `reduceStatusUpdate` (first
  report, superseded-straggler drop, newer generation within a lifetime, newer-lifetime-wins on a
  lower generation, older-lifetime straggler dropped, stale entry revived only by a superseding
  report),
  `shouldMarkStale` (a `loading` reload and a different-video URL mark stale; a same-video rewrite
  stays live), `markEntryStale`, and `parseStatusUpdate` validation. `src/shared/status.ts` is on
  the coverage allowlist at ≥90%.
- `popup-status-channel.test.ts` — the popup client with a stubbed `browser`: honest
  `connecting` default, initial `get-status` fetch, live `status-changed` push, unsubscribe on
  cleanup, and fail-open on a rejected fetch or an unavailable runtime.
- `tab-scope.test.ts` — the per-tab scope module: precedence (`override ?? global` both ways),
  the settings overlay (`null` passthrough and boolean override), the store (set/get/delete
  with a missing key answering `null`), and the message parsers (valid, malformed, and
  wrong-type payloads). `src/shared/tab-scope.ts` is on the coverage allowlist at ≥90%.
- `ui/popup.test.tsx` — the hero renders the effective value (`resolveTabAudioOnly`) and the
  hero toggle calls the tab-scoped action, while the footer and background-play controls stay
  on their global actions.

### E2e bench (`tests/e2e/bench/run-bench.mjs`)

- **Background-channel assertion (real Firefox, real extension).** The task's sanctioned "read
  the map" path. Drives the fallback fixtures and the active fixture and reads the **real**
  per-tab map from the extension's own options page via a `__BENCH__`-only background message
  (`yta:__bench-status-map`, dead-code-eliminated in production — it reads the production map and
  never fabricates a status):
  - `status-channel:fallback-live-reaches-background-map` — `LIVESTREAM01` → entry
    `status: 'fallback', reason: 'live'`.
  - `status-channel:fallback-auth-reaches-background-map` — `AUTHVIDEO01` → entry
    `status: 'fallback', reason: 'LOGIN_REQUIRED'`.
  - `status-channel:active-reaches-background-map` — `FIXTURE0001` → entry `status: 'active'`.
- **Per-tab scope (real Firefox, real extension).**
  `per-tab-scope:override-beats-global-and-prunes` seeds the global audio-only preference off,
  then through the `__BENCH__`-only `yta:__bench-set-tab-scope` seam (which calls the production
  apply path) asserts: the override turns the tab's hijack on while the global preference stays
  off; a second YouTube tab without an override stays disabled and then activates with its own
  override; the override survives a reload and an in-page SPA navigation of the same tab; setting
  it back to `false` with the global preference changed to on disables the tab again; and closing
  the second tab prunes its entry from the in-memory scope store.
- **Browser-action popup DOM lane (attempted; documented limitation).**
  `status-channel:browser-action-popup-lane-opens` exercises the new `openBrowserActionPopup()`
  helper, which drives the **real** toolbar popup via Marionette's chrome context
  (`-remote-allow-system-access`): it opens the unified-extensions panel and clicks our action
  widget, proving the lane is reachable against the built extension.

  **Limitation (honest, not faked):** in **headless** Firefox the popup's `moz-extension`
  `<browser>` does not attach, so geckodriver cannot switch into it to read the rendered popup
  document. The helper therefore returns a structured probe (`popupBrowserAttached`, `popupUrl`,
  `note`) and a later **headful** stack can extend it to switch into that `<browser>` and assert
  the popup DOM across active / fallback / non-YouTube / two-tab / SPA / mid-nav /
  no-content-script states. The Phase-0 faithful proxy for "is the state correct?" is the
  background-map assertion above (it verifies the exact map the popup's `get-status` reads); no
  bench-only rendering path fakes the popup.

### Gates

`npm run typecheck && npm run lint && npm run format:check && npm test` (new unit tests green,
`status.ts` ≥90%), `npm run test:bench`, `npm run test:matrix`, and `mkdocs build --strict`.

## Related documents

- **ADR-0007** — Popup playback-status delivery (background per-tab map + push).
- **ADR-0014** — Per-tab audio-only scope (the in-memory, tab-keyed override this adds).
- `docs/specs/SPEC-015-m9-embedded-player-frames.md` — frames follow the tab's settings push.
- `docs/design/ux-popup.md` — the popup UX review that motivated this (§1.2, P0-1/P0-2).
- `docs/adrs/0005-pii-free-diagnostics-and-issue-reporter.md` — the same `emitStatus` value also
  feeds the PII-free diagnostics log.
