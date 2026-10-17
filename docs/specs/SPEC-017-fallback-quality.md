# Specification: Fallback Quality and Music Song Preference

## Overview

When YouTube cannot be played as audio-only (live and DVR streams, age-restricted,
members-only, made-for-kids, or any fetch/playability failure), the extension fails open to
YouTube's native player. That playback still downloads video. This spec defines the
fallback-quality feature: a default-on setting that, at the moment of a fallback, drops the
native player to the lowest available video quality tier through YouTube's own player API,
and on YouTube Music prefers the site's native Song playback mode when the item offers one.
It is a one-shot hint, never a fight with the user's own quality choices, and it makes no
restore promise.

## Goals

- Add `fallbackQualityCapEnabled` (default `true`) to `ExtensionSettings`, with an
  options-page toggle in the playback group and no popup control.
- Act only on the page world's own `fallback` status emissions (the same choke point every
  fallback reason already flows through), and only while `enabled && fallbackQualityCapEnabled`.
  The quality cap additionally requires `forceQualityMax === 'off'`; the Music song preference is
  not a quality choice, so an explicit user maximum never suppresses it.
- Prefer, in order:
  1. On `music.youtube.com`, YouTube Music's native Song mode: when the page renders a
     `ytmusic-av-toggle` whose `button.song-button` exists and song mode is not already
     selected (`is-audio-playback-mode-selected` is not `"true"`), click that control once.
     This is YouTube Music's own audio-only playback, so no quality cap is applied.
  2. Otherwise, the lowest available quality tier on the page player:
     - Read `movie_player.getAvailableQualityLevels()` when it is a function and returned an
       array; pick the lowest known label present (known set covers `tiny` through `hd2160`
       plus `highres`; `auto` and unknown values are ignored).
     - When the list is absent, empty, or entirely unknown, request `tiny`, YouTube's
       documented floor; the player clamps to the lowest tier it actually has.
     - Request the tier through `setPlaybackQualityRange(label, label)` and
       `setPlaybackQuality(label)` when those functions exist, mirroring the existing
       quality-of-life cap path.
- Never fight `forceQualityMax`: when the user set a maximum quality, the fallback **cap** does
  not run at all (the existing quality-of-life path remains the only quality writer). The Music
  song preference is unaffected by a maximum quality.
- No restore promise: there is no getter for the user's previous quality preference, so the
  request is one-shot per fallback. The options copy states that quality can stay low on
  that page until the user changes it.
- When the page player (or, on Music, the song toggle) has not mounted yet at the fallback
  moment, retry once after `FALLBACK_QUALITY_RETRY_MS` = 1 s, then give up silently.
- Note the behaviour in the popup's fallback copy: with the cap engaged, live fallbacks say
  the video is playing at low quality to save data; non-live fallbacks say the same on
  YouTube, and "playing the song to save data" on YouTube Music. With the cap off (or
  `forceQualityMax` set) the copy stays "playing normally".
- Adjust the listing wording that promised an untouched hand-back ("hands you back to normal
  YouTube") in the AMO listing copy, the release notes, and the website guide, since fallback
  playback is now deliberately capped.

## Non-Goals

- No quality restoration when the user revisits a video or turns the feature off; no getter
  exists and inventing one (reading the YT settings store) is out of scope.
- No persistent re-assert loop: the tier is written once per fallback. The existing
  `forceQualityMax` path keeps its own re-assert behaviour and stays untouched.
- No mobile-app or Android-specific surface: the Song toggle described here exists on the
  YouTube Music web player; the feature simply does nothing extra where it is absent.
- No new network, storage, message, or permission surface: the whole feature is one boolean
  on the existing settings push plus local player/DOM calls in the page world.
- No change to when fallbacks happen: this only reacts to the existing status emissions.

## Technical Design

### Settings

- `src/shared/config.ts`: `fallbackQualityCapEnabled` (default `true`), `setFallbackQualityCapEnabled`,
  and the normalize fallback for non-boolean input, mirroring `idleNagDefeatEnabled`.
- `src/shared/settings-signals.ts`: `fallbackQualityCapEnabledSignal`.
- `src/shared/consent.ts`: the consent-denied snapshot forces the field off with the other
  playback features.
- `entrypoints/main-world.ts`: `PageSettings` and `parseSettings` gain the field; the
  page-world settings push already carries it.

### Shared pure helpers (`src/shared/fallback-quality.ts`)

- `QUALITY_LABEL_ORDER` (private): `tiny`, `small`, `medium`, `large`, `hd720`, `hd1080`,
  `hd1440`, `hd2160`, `highres`.
- `selectLowestQualityLabel(available: unknown): string`: lowest known label in the input
  array, else `tiny`.
- `fallbackQualityEngaged({ enabled, fallbackQualityCapEnabled, forceQualityMax }): boolean`.
- `findSongModeSwitch(root: ParentNode): Element | null`: the `button.song-button` inside
  `ytmusic-av-toggle` unless song mode is already selected.
- `switchToSongMode(root: ParentNode): boolean`: clicks the control once, fail-open.

### Page-world wiring (`entrypoints/main-world.ts`)

- `emitStatus` applies the feature in its `fallback` branch, after native reclaim bookkeeping
  and before the status dispatch, so the same message that lands in the background already
  has the quality request behind it.
- `isMusicPage()` is `location.hostname === 'music.youtube.com'` and, in bench builds only
  (`__BENCH__`), a `ytm=1` query parameter on the fixture origin, so the bench can exercise
  the Music branch hermetically. The production build compiles the bench branch out.
- The attempt reads the live `settings` closure at fire time and again at retry time, so a
  toggle change between fallback and retry wins.
- The feature never touches `PlayerHandle` and never writes a media `src`; it only calls the
  player element's quality API, exactly like the existing quality-of-life cap.

### Popup surface

- `PlaybackUiState`'s `fallback` kind gains `host: 'youtube' | 'music'`, resolved by
  `resolveUiState` (which already classifies the host) and validated by
  `isPlaybackUiState`. No new messages; the background already derives every state from the
  URL plus the stored entry.
- `heroStatusCopy` takes the engaged flag (computed from the existing signals) and renders:
  - live: `Live stream, playing at low quality to save data.` when engaged, existing
    `Live stream, playing normally.` otherwise;
  - non-live, YouTube: `Audio-only isn't available on this video. Playing at low quality to
save data.`;
  - non-live, Music: `Audio-only isn't available on this video. Playing the song to save
data.`
    The Music wording is deliberately optimistic: the page world prefers song mode when the
    control exists, and silently falls back to the quality cap when it does not. The popup has
    no per-video outcome report for that branch (documented limitation, fail-open by design).

### Options surface

- Playback group row `option-fallback-quality`, label "Low-quality fallback", state-aware
  description that states the no-restore caveat ("Quality can stay low until you change it.")
  and the Music song behaviour. The row is deliberately independent of the audio-only toggle,
  because that toggle is per-tab at runtime (ADR-0014): a tab override can enable audio-only
  while the global default is off. It is not a high-impact row (that badge stays reserved for
  the telemetry toggles).

## Evidence

Verified live (logged out, music.youtube.com, 2026-10-16) against `dQw4w9WgXcQ`:

- `movie_player.getAvailableQualityLevels()` on the Music watch page returns
  `['hd2160','hd1440','hd1080','hd720','large','medium','small','tiny','auto']`; there is no
  audio-only tier in the quality API, so Song mode (not a quality value) is the native
  audio-only path.
- The player page renders `<ytmusic-av-toggle>` with
  `is-audio-playback-mode-selected="false"` and buttons
  `<button class="song-button" aria-pressed="false">Song</button>` /
  `<button class="video-button" aria-pressed="true">Video</button>`.
- A programmatic click on `button.song-button` flipped the element to
  `playback-mode="ATV_PREFERRED"`, `is-audio-playback-mode-selected="true"`, kept playback
  running (media time advanced 6 s to 16 s, never paused or restarted), and left the page
  stable. The same click path is therefore safe to use from the page world, fail-open.

## Error Handling

- Every step is wrapped and existence-checked: a missing player, a throwing quality API, a
  missing toggle, or a refused click is a silent no-op and native playback is untouched.
- The retry is a single timer; it re-checks the live settings before acting and never chains.
- Setting the quality range to a tier the player does not have is a no-op by YouTube's own
  clamping behaviour; the extension never asserts success.

## Testing Strategy

- Unit (`tests/unit/fallback-quality.test.ts`): tier selection across the real observed list,
  lists without `tiny`, `auto`-only and empty/unknown inputs, non-string entries; the
  engagement predicate across each gate; the song-mode locator and click against a DOM fixture
  that mirrors the live-verified attributes, including the already-selected and
  button-missing cases.
- Unit (existing suites): config default/normalize/setter, the consent snapshot, status host
  resolution (YouTube vs Music URLs), popup copy for engaged, disengaged, and Music fallbacks.
- Bench (`tests/e2e/bench/fixture-server.mjs`, `run-bench.mjs`): the fixture gains
  `getAvailableQualityLevels`, a `ytm=1` Music page with a faithful `ytmusic-av-toggle`
  (click flips the attributes and records a marker without pausing), and `nosong=1` to omit
  the toggle. Cases:
  - `fallback-quality:lowest-available-on-fallback` (live fallback + defaults): the recorded
    quality call is the lowest tier of the fixture list.
  - `fallback-quality:disabled-does-not-cap`: no quality call.
  - `fallback-quality:force-quality-max-wins`: the quality-of-life call is present and no
    fallback tier was requested.
  - `fallback-quality:music-prefers-song`: the fixture song marker is set and no quality
    call was made.
  - `fallback-quality:music-caps-without-song`: with the toggle absent, the cap applies.
  - `fallback-quality:music-song-despite-user-cap`: with `forceQualityMax` set, the song marker
    is still set (orthogonal to the cap) and no fallback tier is requested.
- Matrix (`run-matrix.mjs`): a cell running the live fallback with `forceQualityMax` set plus
  audio-only and ad-block on, asserting the quality-of-life cap runs and the fallback cap
  does not (the plan's required interaction).

## Security Considerations

- No new permissions, hosts, network calls, storage keys, or bridge messages; one boolean
  travels on the existing validated settings push, and the page world only reads its own DOM
  and calls the page's own player API.
- The Music path performs one programmatic click on a YouTube Music control, bounded to a
  single element match; it cannot be steered by page data and cannot write media state
  (`PlayerHandle` stays the sole media `src` writer).
- Fail-open everywhere: the worst case is a page that keeps playing exactly as YouTube
  intended.

## Rollout and Rollback

- Default on is the approved product call (reviewers preferred opt-in; their dissent is
  noted). The escape hatch is flipping the default to `false` or making it opt-in in the
  options copy; no other code changes are needed.
- Turning the toggle off stops all new writes immediately; the only state is whatever tier
  YouTube already switched to, which the user can change in YouTube's own menu (no restore
  promise, by design).
- The bench fixture and cases are hermetic; no live YouTube dependency is added to the gate.
