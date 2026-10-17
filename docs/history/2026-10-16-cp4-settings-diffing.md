# Handoff: settings diffing (CP4 item 2.7)

Date: 2026-10-16
Branch: `fix/media-client-rotation` (the consolidated 1.1.0 branch)

## Scope

The plan's CP4 item 2.7 from `docs/plans/2026-10-15-youtube-audio-1.1.0-release-plan.md`: "Re-arm only
affected subsystems instead of a full refetch" (`content.ts`, `main-world.ts`). Every settings push
previously forwarded the whole snapshot, and the page world tore down and re-armed everything:
visibility override, idle-nag layers, scriptlets (rescue-config refetch), player hints, the media
operation (release + full InnerTube player refetch + re-attach), the audio graph, and a status
emission. Toggling an unrelated option, or dragging an equalizer slider, restarted the stream. This
change diffs the snapshot at both hops and re-arms per subsystem, with the equalizer update applied
to the live graph in place.

## Changes

- `docs/specs/SPEC-020-settings-diffing.md` (new): the subsystem map, the comparison rules, the
  graph fast path, and the tests.
- `src/shared/settings-diff.ts` (new): `PageSettingsSnapshot` (the page world's settings subset,
  moved out of `main-world.ts` so the decision is testable), `settingsFieldChanged` (array-aware
  field comparison; a `null` previous snapshot counts as changed), `pageSubsystemReArm` (visibility,
  idleNag, scriptlets, qualityOfLife, segments, fallbackQuality, media, graph), and `settingsEqual`
  (whole-model equality for the content script).
- `src/shared/audiograph.ts`: `applyGraphSettings(graph, settings, loudnessDb)` is the single
  arming/update path, reused by `armAudioGraph` and by the in-place settings update; it returns the
  applied gain.
- `entrypoints/main-world.ts`:
  - `applySettings` runs `pageSubsystemReArm(settingsApplied ? settings : null, next)` and gates
    each teardown/re-arm on its group. The first push (no previous snapshot) arms everything exactly
    as before.
  - Media restart (operation restart + graph dispose + `activateEnhancements`/`emitStatus`) only
    runs for `media` changes (`enabled`, `audioOnlyEnabled`, `audioArtworkEnabled`) or when a
    graph feature turns on with no live graph armed.
  - Graph-only changes update the live handle via `applyGraphSettings` (no refetch, no media
    reload) and refresh the bench marker; both features off disposes the graph.
  - `audioGraphHandle`, `liveLoudnessDb`, and an idempotent `disposeAudioGraph()` keep the fast path
    from ever touching a disposed graph; `armAudioGraph` records both.
  - `lastStatus` is tracked in `emitStatus`; a `fallbackQuality` toggle re-applies the cap only when
    the session is already in native fallback and no media restart follows (the cap is a
    fallback-time policy, and the old restart did not apply it while landing on `active` either).
  - Segment skipping is gated by its group (`restartSegmentSkipping` keeps its own key diff).
- `entrypoints/content.ts`: `applyEffectiveSettings` drops an identical effective snapshot before
  `postMessage` and the control updates, so duplicate consent/scope broadcasts and storage echoes
  never reach the page world.
- `docs/release-notes/NEXT.md`: one user-facing bullet (settings changes no longer restart the
  stream; equalizer moves apply live).
- Tests: `tests/unit/settings-diff.test.ts` (first application, identical pushes with fresh array
  references, the full per-field group map, the master switch, request-time keys, array-aware
  comparison, `settingsEqual`), `tests/unit/audiograph.test.ts` (gain-then-equalizer order, unity
  gain fallbacks, returned gain); `vitest.config.ts` adds `settings-diff.ts` to the covered list.

## Behavior deltas (intentional, spec'd)

- Duplicate and content-only pushes (distraction styles, telemetry opt-ins) re-arm nothing and emit
  no status; the last honest status stays.
- Non-media toggles no longer interrupt the audio-only hijack (background play, idle-nag, ad-block,
  quality/autoplay hints, segment skip all re-arm only their own subsystem).
- A mid-session fallback-cap enable applies immediately only when the session is already in native
  fallback; otherwise it is read at the next fallback status. No refetch either way.
- Equalizer/loudness changes on an armed graph apply live.

## Safety

- The first push is byte-for-byte the previous behavior; every setting keeps an owning group, so no
  change can silently stop applying.
- Fail-open is untouched: nothing new can throw into the page, `disposeAudioGraph` is idempotent,
  and the fast path only makes the same handle calls the arming path already makes.
- No new permissions, storage, messages, or network paths.

## Testing

- Focused runs green (18 new tests across two suites); full `npm test` green with the coverage gate.
- `npm run validate` green (typecheck, lint, format, unit tests incl. coverage, MV2 build,
  `web-ext lint`, MV3 build).
- Bench: seeded settings exercise first-application, so every existing case keeps its path. The only
  mid-session mutations in the runner are `audioOnlyEnabled` (media group, unchanged) and per-tab
  scope. No runner changes.

## Correction (CI round 1): the post-injection push must not be diffed

The first CI run on the 2.7 commit failed every hermetic bench and every settings-matrix job. Two
live-bridge cases froze on a page world that never activated:

- `m1:toggle-off-reclaims-native-in-place`: `frozen.status` was `disabled` with an empty
  `nativeReclaimCalls` (never hijacked, so nothing to reclaim);
- `fallback-quality:lowest-available-on-fallback`: `status: disabled`, zero quality calls.

Root cause: the content script's startup order calls `applyEffectiveSettings` from the consent and
tab-scope callbacks **before** `injectScript('/main-world.js')`. Those pushes are dispatched before
the MAIN-world listener exists (the injected script only installs it when it evaluates), so they are
lost; the diff baseline nevertheless recorded them. The post-injection `applyEffectiveSettings()` was
then suppressed as a duplicate, leaving the page world with no settings at all. Whether a session
survived depended on a race between the async consent/scope replies and the injection, which is why
only some cases failed while others passed.

Fix (`entrypoints/content.ts`): after `await injectScript('/main-world.js')`, set
`currentEffectiveSettings = null` before the `applyEffectiveSettings()` call. The page world always
receives exactly one snapshot after its listener exists; later identical pushes are still diffed out.
SPEC-020 records the same guarantee and its bench coverage.

Lesson: the diff's invariant is "no *redundant* pushes", not "at most one push per page". Any code
path whose delivery is load-bearing (the bridge handshake here) must be exempted explicitly rather
than relying on the snapshot not having changed.

## Follow-ups

- Optional bench case: mid-session equalizer change asserting no new fetch and a live marker update
  (the fast path's glue is currently covered by the unit-tested decision + `applyGraphSettings`).
- Optional: per-piece content-script DOM diffing (`updateDistractionStyle` still rebuilds on any
  snapshot change).
- CP4 continues with 1.6 (distraction extras) and 2.8 (teardown on disable/update), then hygiene
  H2-H4.
