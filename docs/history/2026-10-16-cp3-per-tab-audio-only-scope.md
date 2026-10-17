# Handoff: per-tab audio-only scope (CP3 item 1.2)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP3 item 1.2 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`, specified
as SPEC-012 §5 and decided in ADR-0014: the popup hero, the in-player Audio-only button, and a new
`Alt+Shift+A` shortcut become per-tab quick controls over an in-memory, tab-keyed override; the
options page stays the global editor. Idle-nag defeat, fallback quality, and the consent UX items
of CP3 remain open.

## Changes

- `src/shared/tab-scope.ts` (new): `resolveTabAudioOnly` (effective = `override ?? global`),
  `applyTabAudioOnlyOverride` (overlay that changes only `audioOnlyEnabled`), `createTabScopeStore`
  (the in-memory `Map<tabId, boolean>`, never persisted), and the three message parsers.
- `entrypoints/background.ts`: the store plus `isSupportedTabUrl` (reuses `classifyHost`, bench
  host normalization included), `applyTabScope` (store it, push it to every frame, broadcast it to
  the popup only when the changed tab is active), the real GET/SET branches, `tabs.onRemoved`
  pruning, the `toggle-audio-only` command listener, and two `__BENCH__`-only seams (`scopes` in
  the status snapshot; `yta:__bench-set-tab-scope` driving the production apply path for an
  explicit tab). A content script may set only its OWN tab's scope (`sender.tab.id`); an extension
  page (the popup) sets the active tab, which the background resolves itself, and non-YouTube
  family tabs are refused. `browser.commands` is optional-chained: it is unavailable on Firefox
  for Android, where the shortcut is simply absent while the popup and in-player controls work.
- `entrypoints/content.ts`: fetches the tab's override once, merges it into the consented settings
  snapshot every frame already pushes (so embedded frames follow their tab, SPEC-015), listens for
  scope pushes (an early push beats a stale startup reply), and the in-player toggle now sets the
  TAB's override via SET instead of writing the global preference.
- `entrypoints/popup/`: `tab-scope.ts` (signal + initial GET + live pushes + setter, all
  fail-open); `App.tsx` hero renders `resolveTabAudioOnly(global, override)`, its toggle calls the
  tab-scoped setter, and a "This tab" tag makes the scope visible; the footer pause and the
  background-play card stay global.
- `wxt.config.ts`: the `toggle-audio-only` command (Alt+Shift+A), declared in both build lanes.
- Copy: the options audio-only description now states it is the default for every tab while the
  quick buttons change only one; consent, privacy, and AMO notes need no change (no new data).

## Safety

- No storage writes for the scope: nothing is persisted, no key is added, and a background reload
  (or MV3 restart) simply reverts every tab to the global preference.
- No new permissions, hosts, or match patterns; the shortcut only resolves the active tab and
  refuses non-YouTube-family URLs.
- The page world never learns the tab id: the override rides the existing bounded settings push as
  one boolean.
- Fail-open: every fetch, set, push, and broadcast swallows failures; a refused or timed-out set
  leaves the hero on the honest global value.

## Testing

- Unit: `tests/unit/tab-scope.test.ts` (precedence both ways, overlay, the store incl. `entries`
  and pruning, the parsers), `tests/unit/popup-tab-scope.test.ts` (fetch, push, unsubscribe,
  fail-open, setter reply handling), `ui/popup.test.tsx` (the hero renders the override over the
  global and the hero toggle calls the tab-scoped action), `manifest-declaration.test.ts` (the
  command name and default key are pinned).
- Bench: `per-tab-scope:override-beats-global-and-prunes` (SPEC-012 §5): global off + override on
  hijacks the tab while storage stays untouched; a second tab follows the global and then its own
  override; the override survives a reload and an in-page SPA navigation; override-off beats a
  later global on; closing the second tab prunes only its entry. The settings matrix re-runs the
  same scenario as `scope:per-tab-override-beats-global-and-prunes` under a mixed settings row.
- Local bench runs remain sandbox-blocked (Firefox launch timeout under the agent shell), so CI
  executes the new case and cell.
- `npm run validate` green (typecheck, lint, format, unit tests incl. the 90% coverage gate, MV2
  build, web-ext lint, MV3 build).

## Follow-ups

- CP3 items 1.3 (idle-nag defeat), 1.4 (fallback quality), and 1.5 (consent UX + optional
  permissions) are next, then CP4 plus hygiene.
- The headful popup lane (documented limitation in SPEC-012) would let the bench assert the hero's
  rendered scope tag; today the background-map assertion and the popup unit tests are the faithful
  proxies.
