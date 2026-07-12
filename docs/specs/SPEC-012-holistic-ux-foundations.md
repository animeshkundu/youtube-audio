# Specification: Holistic UX Foundations

> **Status:** Phase 0 (status channel) implemented. Later sections (artwork, onboarding,
> defaults) are placeholders this pass reserves for the follow-up UX stacks; they are marked
> _Planned_ and carry no code yet.

## Overview

The Holistic UX pass makes the extension's surfaces honest and effortless: the popup must tell
the truth about the tab in front of the user, audio-only mode should have real artwork, and
onboarding and defaults should get a first-time user to a good state with no configuration. This
specification is the shared home for those foundations. **This pass owns the status-channel
section**; the remaining sections are reserved for later stacks so their specs land here rather
than fragmenting.

## Goals

- Give the popup the **real, per-video playback status** for the active tab, so it can stop
  rendering the stored toggle and never claim audio-only is active on a video that fell back.
- Make that status correct under the two conditions that break naive approaches: **SPA
  navigation** (YouTube changes video without a document reload) and **multiple tabs**.
- Keep the whole channel **fail-open** and internal: no external egress, no new permissions, no
  change to `PlayerHandle`/`<video>.src`.
- Extract the decision logic into a **pure, unit-tested** module and keep the entrypoints thin.

## Non-Goals (this pass)

- No popup visual redesign. This pass only wires and _exposes_ the resolved state
  (`playbackStatusSignal`); the honest hero, empty state, and micro-copy are a follow-up stack
  (see `docs/design/ux-popup.md` §2–§3).
- No logged-in path, no persistence of volatile per-tab state to disk, no polling.

## Technical Design

### 1. Status channel (this pass)

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
  the same reference.
- `markEntryStale(entry)` — invalidates an entry on navigation.
- `resolveUiState(url, entry)` → `active | connecting | fallback(+reason) | disabled |
not-a-watch-page | not-youtube`. A rejected/absent/stale/foreign-video entry resolves to
  `connecting`, **never** to a stored toggle, so the popup cannot lie before a report lands.

#### Content relay: `entrypoints/content.ts`

On each `yta:status`, in addition to the unchanged `__BENCH__` DOM marker, content pushes
`{type: STATUS_UPDATE_MESSAGE, status, reason?, videoId?, runStart, generation}` to the
background, computing `videoId` from `location.href`. `runStart` is the content script's lifetime
start (`Date.now()` at init), and `statusGeneration` is bumped on `yt-navigate-start`; together
they let the background order reports across both a full reload (new `runStart`) and an SPA
navigation (new `generation`). The push is fail-open: any `sendMessage` rejection is swallowed and
never affects the page or playback.

#### Background map + resolution: `entrypoints/background.ts`

- `Map<tabId, TabStatusEntry>` keyed by `sender.tab.id`. Updates are accepted **only** from the
  top frame (`sender.frameId === 0`) after `parseStatusUpdate`.
- `yta:get-status` resolves `tabs.query({active, currentWindow})` and returns
  `resolveUiState(tab.url, entry)`, under a timeout that falls back to `connecting` (bounded).
- On an accepted change to the active tab, broadcasts `yta:status-changed` with the resolved
  state; a closed popup has no receiver, so the rejection is swallowed.
- `tabs.onUpdated` (top-level `url` change, or a `loading` status for a same-URL reload) marks
  the tab's entry stale (resolves to `connecting`); `tabs.onRemoved` deletes it.

#### Popup wiring: `entrypoints/popup/playback-status.ts` + `main.tsx`

`startPlaybackStatusChannel()` (called from `main.tsx`) fetches `yta:get-status` on open and
subscribes to `yta:status-changed`, exposing the result via `playbackStatusSignal` (default
`connecting`, never a stored toggle). Bounded (time-boxed fetch) and fail-open. **The rendered
popup does not consume the signal yet** — that is the follow-up hero stack.

### 2. Audio-mode artwork — _Planned (later stack)_

Reserved. See `docs/design/audio-mode-artwork.md`. Will extend this spec.

### 3. Onboarding — _Planned (later stack)_

Reserved. See `docs/design/ux-onboarding.md`.

### 4. Defaults — _Planned (later stack)_

Reserved.

## Hard-invariant compliance

- **Credentialless / logged-out:** the channel carries only a status enum + reason + a video id
  already visible in the URL; it attaches no credentials and makes no external request. Fine
  under `data_collection_permissions.required: ['none']`.
- **`PlayerHandle` sole `<video>.src` writer:** untouched.
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
  lower generation, older-lifetime straggler dropped, stale-accept),
  `markEntryStale` (the onUpdated url-change → `connecting` path), and `parseStatusUpdate`
  validation. `src/shared/status.ts` is on the coverage allowlist at ≥90%.
- `popup-status-channel.test.ts` — the popup client with a stubbed `browser`: honest
  `connecting` default, initial `get-status` fetch, live `status-changed` push, unsubscribe on
  cleanup, and fail-open on a rejected fetch or an unavailable runtime.

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
- `docs/design/ux-popup.md` — the popup UX review that motivated this (§1.2, P0-1/P0-2).
- `docs/adrs/0005-pii-free-diagnostics-and-issue-reporter.md` — the same `emitStatus` value also
  feeds the PII-free diagnostics log.
