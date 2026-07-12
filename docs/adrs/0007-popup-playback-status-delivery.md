# ADR-0007: Popup playback-status delivery via a background per-tab map with push

## Status

**Accepted**

## Date

2026-07-12

## Context

The toolbar popup is meant to answer, in one glance, "what is this tab doing?" Today it
cannot: it renders from the stored settings signals (`audioOnlyEnabledSignal`, etc.), so on
an auth-required, live, or otherwise-ineligible video — exactly the cases the
credentialless-first design expects to fall back to normal playback — it still shows
"Audio-only: Active" in green while the user is watching full video. The popup is dishonest
on its most important line (see `docs/design/ux-popup.md` §1.2).

The real per-video outcome already exists. `entrypoints/main-world.ts:emitStatus` computes a
`PlaybackStatus` (`idle | fetching | active | fallback | disabled`) with an honest `reason`
(`live`, `no-direct-audio`, `unplayable`, `http-<code>`, `not-a-watch-page`,
`media-attach-failed`, `request-failed`, or a playability status such as `LOGIN_REQUIRED`) and
dispatches it as a `yta:status` DOM `CustomEvent`. `content.ts` listens, but writes it to
`dataset.ytaStatus`/`ytaReason` **only** under `__BENCH__`; production discards it. The popup
consumes none of it.

### Problem Statement

Make the real, per-video `PlaybackStatus` available to the popup honestly — for the tab in
front of the user — surviving SPA navigation and multiple tabs, so the popup can stop showing
the stored toggle and can tell the truth on fallback videos.

### Constraints

- **Logged-out, credentialless, fail-open** hard invariants hold: this is internal runtime
  messaging with no external egress (fine under `data_collection_permissions.required:
['none']`), it must not touch `PlayerHandle`/`<video>.src`, and any messaging failure must
  never break playback or the page.
- **No new permissions.** `tabs` and the four YouTube host matches are already granted.
- **MV2 ships, MV3 stays buildable.** No background-lifetime assumption beyond what the
  existing persistent MV2 background already makes.
- **Multi-tab and SPA reality.** YouTube is a single-page app; a tab's video changes without a
  document reload, and the user can have several YouTube tabs open. The popup always describes
  the _active_ tab of the current window.

## Decision

Deliver status through the **background**, which keeps a per-tab map and answers/pushes to the
popup. The content script relays each `yta:status` event to the background; the background
folds it into `Map<tabId, TabStatusEntry>`; the popup queries the active tab's resolved state
on open and subscribes to pushes.

```
main-world.ts  --yta:status DOM event-->  content.ts
content.ts     --yta:status-update  ---->  background.ts   (per-tab map, keyed by sender.tab.id)
popup          --yta:get-status    ----->  background.ts   --> resolved PlaybackUiState
background.ts  --yta:status-changed ----->  popup          (re-render when the active tab changes)
```

All decision logic (host classification, the update reducer, the resolved-state machine) lives
in a pure, unit-tested module, `src/shared/status.ts`; the entrypoints are thin messaging glue.

### Considered Options

1. **Popup ↔ content script directly.** The popup asks the active tab's content script for its
   last `{status, reason}` and renders the reply.
   - Pros: no background state; fewer moving parts.
   - Cons: **Injection race** — on a just-opened or just-navigated tab the content script may
     not have initialized (or `document_start` has not reached the status yet), so the
     request errors and the popup has nothing to show. **No push** — a status that changes
     while the popup is open (fetching → active/fallback) never reaches it without polling.
     **Per-open cost** — every popup open round-trips to the page. **SPA staleness** — the
     content script would itself have to track which navigation a status belongs to. This
     pushes race-handling into the popup, the least reliable place for it.
2. **Background per-tab map + push (chosen).** Content pushes every status to the background;
   the background owns the per-tab truth, resolves the active tab on request, and pushes
   changes.
   - Pros: The background is always alive to receive updates, so the map is populated even
     before the popup opens (**no injection race** at popup time — an absent entry resolves to
     an honest `connecting`, not a lie). **Push** keeps an open popup live. **Multi-tab** is a
     natural map key (`sender.tab.id`). **SPA staleness** is handled centrally by the reducer +
     a `tabs.onUpdated` navigation clear + a video-id cross-check. The popup stays a thin
     consumer.
   - Cons: A little background state and three new message types; a non-persistent (MV3)
     background could in principle drop the in-memory map, tolerated because an empty map
     resolves to `connecting` and the next status emit repopulates it.
3. **Content mirrors to `browser.storage`; popup reads storage.** Content writes status to
   `storage.local`; the popup reads and watches it.
   - Pros: Survives background restarts; reuses the settings-watch pattern.
   - Cons: Persisting volatile per-tab playback state to disk is a category error (write
     amplification, cross-tab key collisions, stale values across restarts), and multi-tab
     needs a tab-keyed schema anyway. Storage is for settings, not live per-tab telemetry.

### Chosen Option

**Option 2.** It is the only one that is honest at popup-open time (the background already
holds the tab's status, so there is no injection race to lose to), keeps an open popup live via
push, and makes multi-tab and SPA-staleness handling centralized and testable rather than
scattered into the popup. The staleness and race reasoning the review raised is addressed
concretely:

- **Multi-tab:** the map is keyed by `sender.tab.id`; each tab is independent. `get-status`
  resolves `tabs.query({active, currentWindow})`; `tabs.onRemoved` deletes the entry.
- **SPA staleness:** the content script tags each report with `(runStart, generation)` — a
  per-lifetime start timestamp plus an epoch bumped on `yt-navigate-start`. The reducer orders
  updates lexicographically: a report from a newer content-script lifetime (`runStart`) always
  wins, and within one lifetime a strictly-older `generation` (a superseded SPA navigation) is
  dropped. Because `runStart` distinguishes lifetimes, a full reload (generation resets to 0) or a
  late message from an unloading old document can never freeze the tab's state — the pitfall a
  bare per-lifetime generation would hit. `tabs.onUpdated` (top-level `url` change, or a `loading`
  status for a same-URL reload) additionally marks the entry stale so the resolver returns
  `connecting` until the freshly loaded content script reports, and the resolver cross-checks the
  stored `videoId` against the active tab's URL and returns `connecting` on a mismatch (a
  navigation outran its report).
- **Injection race:** an absent/rejected/stale entry resolves to `connecting` (an honest
  "checking this tab"), never to a stored toggle or an optimistic `active`.
- **Trust boundary:** the background accepts updates only from the **top frame**
  (`sender.frameId === 0`) of a real tab (`sender.tab.id`), and validates the payload shape
  (`parseStatusUpdate`) before storing. Sub-frames and extension pages are ignored.
- **Bounded:** `get-status` is answered under a timeout that falls back to `connecting`, and
  the popup's fetch is itself time-boxed, so nothing hangs.

## Consequences

### Positive

- The popup can render the truth for the current tab, including on fallback videos where it
  currently lies, from a signal the extension already produces — no new detection logic.
- Race, staleness, and multi-tab handling are centralized in `background.ts` + the pure
  `src/shared/status.ts`, unit-tested without a browser and coverage-gated at ≥90%.
- Fail-open throughout: content's relay, the background's broadcast, and the popup's fetch each
  swallow failures, so the status channel can never affect playback or the page.

### Negative

- New in-memory background state and three message types to maintain.
- A non-persistent background (MV3) may drop the map; mitigated because an empty map resolves
  to `connecting` and repopulates on the next emit (acceptable; MV2 is the shipping target and
  its background is persistent).

### Neutral

- The `__BENCH__`-gated `dataset.ytaStatus`/`ytaReason` marker is unchanged; the production
  push is purely additive, so the hermetic bench keeps reading the marker while production now
  also feeds the map.
- The popup only _exposes_ the resolved state (`playbackStatusSignal`) in this pass; rendering
  the honest hero from it is a follow-up UI stack (SPEC-012, later sections).

## Related ADRs

- ADR-0005 (PII-free diagnostics): the same `emitStatus` value already feeds the diagnostics
  log; this ADR routes it to the popup instead of the disk log.

## References

- `docs/specs/SPEC-012-holistic-ux-foundations.md` — the status-channel specification.
- `docs/design/ux-popup.md` §1.2, §2 P0-1/P0-2 — the "popup is blind to the tab" review.
- `src/shared/status.ts`, `entrypoints/{content,background}.ts`,
  `entrypoints/popup/playback-status.ts` — the implementation.
