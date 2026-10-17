# Handoff: fallback quality and Music song preference (CP3 item 1.4)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP3 item 1.4 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`, specified
as SPEC-017 (new): a default-on fallback-quality feature. When a video cannot be played as
audio-only, the extension asks YouTube's native player for the lowest available quality tier once
at fallback time, and on YouTube Music prefers the site's own Song playback when the item offers a
song counterpart. No restore promise (no getter exists), never a re-assert loop, and never a fight
with the user's own `forceQualityMax` cap. The approved product call (cap on by default, reviewer
dissent retained) stands; flipping the default to opt-in is the documented escape hatch. CP3 item
1.5 (consent UX and optional permissions) remains open.

## Changes

- `docs/specs/SPEC-017-fallback-quality.md` (new): goals, non-goals, the gates, the Music song
  preference, the popup copy, error handling, testing, security, rollout/rollback, and the live
  evidence collected before implementation.
- `src/shared/fallback-quality.ts` (new): `selectLowestQualityLabel` (lowest known tier from
  `getAvailableQualityLevels()`, `auto` and unknowns ignored, `tiny` floor when unreadable),
  `fallbackQualityEngaged` (the cap gate: `enabled && fallbackQualityCapEnabled && forceQualityMax
=== 'off'`), `findSongModeSwitch`, and `switchToSongMode` (one bounded click on
  `ytmusic-av-toggle button.song-button`, fail-open).
- `src/shared/config.ts`: `fallbackQualityCapEnabled` (default `true`), `setFallbackQualityCapEnabled`,
  and the normalize fallback for non-boolean input. `src/shared/settings-signals.ts`:
  `fallbackQualityCapEnabledSignal`. `src/shared/consent.ts`: the consent-denied snapshot forces the
  field off with the other playback features.
- `entrypoints/main-world.ts`: `PageSettings` + strict `parseSettings` gain the field;
  `applyFallbackQuality` runs from the `fallback` branch of `emitStatus` (after native reclaim
  bookkeeping, before the status dispatch) and is gated on the live `settings` at both fire and
  retry time. The Music scene is `location.hostname === 'music.youtube.com'` plus, in bench builds
  only, a `ytm=1` fixture query parameter (`__BENCH__`, compiled out in production).
  `YouTubePlayerElement` gains `getAvailableQualityLevels?()`. `describePlayer().music` now reuses
  the same host check.
- `src/shared/status.ts`: the `fallback` UI state gains `host: 'youtube' | 'music'`, resolved by
  `resolveUiState` (which already classified the host) and required by `isPlaybackUiState`. No new
  messages; every existing status path derives its state the same way.
- `entrypoints/popup/App.tsx`: the fallback copy now notes the cap when engaged (setting on and no
  user maximum): "playing at low quality to save data", or "playing the song to save data" on
  Music for non-live fallbacks. The disengaged copy is byte-identical to 1.0.x.
- `entrypoints/options/App.tsx`: "Low-quality fallback" row in the playback group, independent of
  the audio-only toggle (per-tab overrides, ADR-0014), with the no-restore caveat in the
  description. Drive-by cleanup: the idle-nag row's `consequence` prop was removed, since
  `SettingRow` renders consequences only for high-impact rows and that badge is deliberately
  reserved for the two telemetry toggles (test-enforced).
- `tests/e2e/bench/fixture-server.mjs`: the player stub gains `getAvailableQualityLevels` (the real
  observed Music list incl. `auto` last), and `ytm=1` serves a faithful `ytmusic-av-toggle`
  (click flips the attributes and records a marker, playback continues) with `nosong=1` omitting
  it.
- `tests/e2e/bench/run-bench.mjs`: `probeFallbackQuality` plus six cases
  (`fallback-quality:lowest-available-on-fallback`, `disabled-does-not-cap`,
  `force-quality-max-wins`, `music-prefers-song`, `music-caps-without-song`,
  `music-song-despite-user-cap`). `tests/e2e/bench/run-matrix.mjs`: the mixed-row cell
  `fallback-quality:force-quality-max-wins-inside-mixed-row` (maximum quality set while audio-only
  and ad-block are on), the base settings gain the field, and `global:all-on` sets it explicitly.
- `vitest.config.ts`: `src/shared/fallback-quality.ts` joins the covered core modules.
- Copy: `amo-metadata.json`, `docs/release-notes/NEXT.md`, `docs/design/ux-onboarding.md`, and the
  website (`index.astro`, `guide/audio.md`, `guide/faq.md`, `guide/cleaner.md`,
  `pages/how-it-works.astro`) no longer promise an untouched hand-back; they state the lowest-quality
  cap and the Music song swap.

## Evidence (live, 2026-10-16, logged out)

- On `music.youtube.com` the quality API returns only video tiers
  (`hd2160, hd1440, hd1080, hd720, large, medium, small, tiny, auto`); there is no `AUDIO` tier, so
  Song mode, not a quality value, is the native audio-only path.
- The player page renders `ytmusic-av-toggle` with `is-audio-playback-mode-selected`, and buttons
  `button.song-button` / `button.video-button`.
- A programmatic click on `song-button` flipped `playback-mode` OMV_PREFERRED to ATV_PREFERRED,
  flipped the selected flags, and playback continued without a restart or pause (media time 6 s to
  16 s across the click).

## Safety

- No new permissions, hosts, match patterns, network paths, storage keys, or bridge messages; one
  boolean rides the existing validated settings push, and the status shape gains only a
  host tag that the background was already positioned to compute.
- The page world only reads its own DOM and calls the page's own player API; the single
  programmatic click is bounded to one element match and cannot be steered by page data.
  `PlayerHandle` remains the sole media `src` writer.
- Every step is existence-checked and guarded; a missing player, toggle, or throwing API is a
  silent no-op, and the one retry re-checks the live gate before acting. The setup path
  (`applyFallbackQuality` before the status dispatch) makes the bench read deterministic.

## Testing

- Unit: `tests/unit/fallback-quality.test.ts` (the real observed list, lists without `tiny`,
  `auto`-only, empty and non-array input, unknown labels, `highres` ranking; the engagement
  predicate per gate; the song-mode locator/click against a DOM fixture mirroring the live
  attributes, including the already-selected, button-missing, and scoped-root cases),
  `tests/unit/config-reset.test.ts` (default-on for pre-field installs, explicit off preserved,
  non-boolean rejected, setter persistence), `tests/unit/consent.test.ts`, `tests/unit/status.test.ts`
  (host resolution and the stricter validator), the popup suite (engaged, disengaged, user-cap, and
  the two Music variants) and the options suite (row, action, independence, search).
- Bench: the six cases above prove the tier request, the gates, the "never fight `forceQualityMax`"
  rule, and both Music branches; the matrix cell proves the interaction inside a mixed row.
- Local bench runs remain sandbox-blocked (Firefox launch timeout under the agent shell), so CI
  executes the new cases and cell; this run is their first execution.
- `npm run validate` green (typecheck, lint, format, unit tests incl. the 90% coverage gate, MV2
  build, web-ext lint, MV3 build).

## Follow-ups

- CP3 item 1.5 (consent UX + optional permissions) is next, then CP4 plus hygiene.
- The Music popup wording ("playing the song to save data") is the feature's intent, not a
  per-video outcome report: when the song toggle is absent the page world silently applies the
  quality cap instead. The bench covers both branches; a runtime outcome channel was deliberately
  not built for it.
- The song switch on the real site may trigger YouTube Music's own player re-render; if that also
  fires an in-page navigation, the acquire path may then hijack the song's stream for a strictly
  better result. Fail-open either way; the canary should watch for the toggle absent while a song
  exists, or a switch that does not change playback.
- Options quality-select copy still says "when video is enabled"; if reviewers want it to name the
  fallback cap interaction explicitly, that is a one-string change.
