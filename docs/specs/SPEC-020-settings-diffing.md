# Specification: Settings Diffing

## Overview

CP4 item 2.7 of the 1.1.0 release plan. Settings reach the page world as whole snapshots: the
content script forwards every consented, tab-scoped settings change, and the page world has so far
re-armed **everything** on every push, background-play override, idle-nag layers, scriptlets, player
hints, the media operation (release + full InnerTube refetch + re-attach), and the audio graph. That
made unrelated changes expensive and noisy: toggling "hide comments" or dragging an equalizer slider
tore down playback and re-fetched the stream. This spec defines a diffing contract: a pure,
unit-tested decision function maps a previous/next snapshot pair to the set of subsystems each push
must re-arm, the content script skips duplicate pushes entirely, and graph-only changes are applied
to the live audio graph in place when one is armed.

## Goals

- `src/shared/settings-diff.ts` (new) exports:
  - `PageSettingsSnapshot` (moved from the page world's private `PageSettings`): the parsed settings
    subset the page world consumes.
  - `settingsFieldChanged<T>(previous, next, keys)`: field comparison that is **array-aware**
    (element-wise for `segmentSkipCategories` and `equalizerBands`; reference comparison otherwise),
    `true` whenever `previous` is `null` (first application).
  - `pageSubsystemReArm(previous, next)`: the re-arm decision as one record of booleans:
    | Group | Inputs |
    | ---------------- | ---------------------------------------------------------- |
    | `visibility` | `enabled`, `backgroundPlayEnabled` |
    | `idleNag` | `enabled`, `backgroundPlayEnabled`, `idleNagDefeatEnabled` |
    | `scriptlets` | `enabled`, `adBlockEnabled` |
    | `qualityOfLife` | `enabled`, `forceQualityMax`, `disableAutoplayNext` |
    | `segments` | `enabled`, `segmentSkipEnabled`, `segmentSkipCategories` |
    | `fallbackQuality`| `enabled`, `fallbackQualityCapEnabled` |
    | `media` | `enabled`, `audioOnlyEnabled`, `audioArtworkEnabled` |
    | `graph` | `loudnessNormalization`, `equalizerEnabled`, `equalizerBands` |
  - `settingsEqual(left, right)` over `ExtensionSettings`: whole-snapshot equality (same array-aware
    field comparison, every field), used by the content script to drop duplicate pushes.
- Content script: `applyEffectiveSettings` returns early (no `postMessage`, no DOM updates) when the
  freshly computed effective snapshot equals the last one pushed. Duplicate consent/scope
  broadcasts, storage echoes, and repeated startup pushes stop at the source. One exception is
  load-bearing: the push that follows `injectScript('/main-world.js')` is never suppressed. Earlier
  pushes (consent/scope callbacks) are dispatched before the injected script has installed its
  message listener, so they are lost; the content script therefore forgets its diff baseline right
  after injection and always re-posts the effective snapshot once.
- Page world: `applySettings` arms each subsystem only when its group changed, with these
  equivalents to today's behavior:
  - duplicate/irrelevant pushes (for example `hideComments` or `ghostEnabled` changes, which are not
    in the page-world snapshot) re-arm nothing and emit no status;
  - `segments` changes go through `restartSegmentSkipping` as before; a media restart no longer
    re-requests segments that did not change (the internal key diff already made that a no-op);
  - `fallbackQuality` changes re-apply the cap **only while the session is already in native
    fallback** (and no media restart is happening); a media restart re-derives the status and
    applies the cap through `emitStatus` exactly as before. The cap is a fallback-time policy, so a
    toggle while audio-only is playing forces neither a refetch nor an eager cap (the old full
    restart did not apply it in that state either, because the restart landed on `active`);
  - `graph`-only changes update the live graph **in place** when one is armed (new shared
    `applyGraphSettings` in `src/shared/audiograph.ts`, reused by `armAudioGraph`), never
    refetching the stream or reloading the media element; turning both audio features off disposes
    the graph; a feature turning on with no live graph still takes the full path so a fresh
    response supplies the loudness dB;
  - `media` changes (and first application) keep the exact previous sequence: operation restart,
    graph dispose, re-fetch/re-attach, status emission.
- The `graph` fast path is the fix for the worst existing case: an equalizer slider drag used to
  re-fetch the stream and rebuild the graph for every input event.

## Non-Goals

- No settings-storage schema, defaults, or write-path changes; no new settings.
- No change to `parseSettings` validation, the bridge payload, or the message nonce.
- No change to SPA navigation re-arming (`observeYouTubeSpa` still re-runs everything: a new video is
  a full re-arm by definition), nor to the release/reclaim bookkeeping.
- No per-piece content-script DOM diffing beyond the whole-snapshot early return.
- No bench-runner changes: seeding settings still exercises first-application (all groups), and the
  only mid-session mutations in the bench are `audioOnlyEnabled` (media group) and per-tab scope.

## Technical Design

### `src/shared/settings-diff.ts`

```ts
export interface PageSettingsSnapshot {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  audioArtworkEnabled: boolean;
  backgroundPlayEnabled: boolean;
  idleNagDefeatEnabled: boolean;
  fallbackQualityCapEnabled: boolean;
  adBlockEnabled: boolean;
  segmentSkipEnabled: boolean;
  segmentSkipCategories: readonly SponsorCategory[];
  forceQualityMax: QualityCap;
  disableAutoplayNext: boolean;
  loudnessNormalization: boolean;
  equalizerEnabled: boolean;
  equalizerBands: EqualizerBands;
  downloadEnabled: boolean;
}

export interface PageSubsystemReArm {
  visibility: boolean;
  idleNag: boolean;
  scriptlets: boolean;
  qualityOfLife: boolean;
  segments: boolean;
  fallbackQuality: boolean;
  media: boolean;
  graph: boolean;
}
```

Comparison rule: `Array.isArray(left) && Array.isArray(right)` compares length plus element
identity; anything else compares with `!==`. Arrays are always freshly structured-cloned per push,
so reference comparison alone would flag every array field as changed.

### `applyGraphSettings` (`src/shared/audiograph.ts`)

```ts
export function applyGraphSettings(
  graph: Pick<AudioGraphHandle, 'setGain' | 'setEqualizer'>,
  settings: {
    loudnessNormalization: boolean;
    equalizerEnabled: boolean;
    equalizerBands: EqualizerBands;
  },
  loudnessDb: number | undefined
): number;
```

Computes the loudness gain (`1` when normalization is off or the dB is not finite, matching
`loudnessDbToGain`), applies gain then equalizer to the handle, and returns the gain. `armAudioGraph`
uses it for arming (same computation and call order as before; it still records the loudness dB and
publishes the bench marker) and the settings fast path uses it for in-place updates.

### Page-world `applySettings`

```ts
const previous = settingsApplied ? settings : null;
const groups = pageSubsystemReArm(previous, next);
settings = next;
settingsApplied = true;
// groups.visibility / idleNag / scriptlets / qualityOfLife: tear down and re-arm when true.
// groups.segments: restartSegmentSkipping().
// groups.fallbackQuality: applyFallbackQuality() only when lastStatus === 'fallback' and no media
//   restart follows (the restart re-derives the status and applies through emitStatus).
// groups.media: operation restart + graph dispose + activate/emit (the previous tail, unchanged).
// groups.graph (and !media): in-place update when audioGraphHandle is armed; dispose when both
// features turned off; otherwise restart only if a feature turned on with no live graph.
```

The page world keeps `audioGraphHandle` and `liveLoudnessDb` beside the existing
`audioGraphCleanup`; a new `disposeAudioGraph()` clears both and runs the cleanup exactly once.

### Content script

```ts
if (currentEffectiveSettings && settingsEqual(currentEffectiveSettings, settings)) return;
```

before the `postMessage` and the top-frame control updates.

One guaranteed delivery survives the diff: the post-injection push.

```ts
await injectScript('/main-world.js');
// The MAIN-world listener only exists now that the injected script has evaluated, so every push
// the consent/scope callbacks dispatched was posted into the void. Forget the baseline so this
// push is never suppressed: the page world must receive the snapshot for the page it loaded with.
currentEffectiveSettings = null;
applyEffectiveSettings();
```

Without the reset, whether the page world ever received the initial snapshot depended on a race
between the async consent/scope replies and the injection: when a reply landed before injection, the
pre-injection push set the baseline (and was lost), and the identical post-injection push was then
suppressed. The hermetic bench exposed exactly that in CI: `m1:toggle-off-reclaims-native-in-place`
froze on `disabled` (never hijacked, so no reclaim) and
`fallback-quality:lowest-available-on-fallback` reported `disabled` with zero quality calls, while
sessions whose replies happened to land after injection passed.

## Error Handling

- All comparisons are total: non-array/non-number fields compare by identity, `null` previous means
  "changed".
- The graph fast path cannot throw into the page: `applyGraphSettings` only calls the handle setters
  (which are the same calls the arming path already makes in the same order).
- `disposeAudioGraph` is idempotent (cleanup reset to a no-op after the first run).
- A push carrying no changed group performs no work and emits no status, leaving the last status
  honest.

## Testing Strategy

- `tests/unit/settings-diff.test.ts` (new): first application marks every group; identical snapshots
  mark none (including equal-content, new-reference arrays); per-field cases for each group
  (visibility follows `backgroundPlayEnabled`, scriptlets follow `adBlockEnabled`, segments follow
  category arrays, graph follows a single band value, media follows `audioOnlyEnabled`/artwork);
  content-only settings (`downloadEnabled`) leave every group false except none; `settingsEqual`
  covers identical snapshots, one differing scalar, array content differences, and equal-content
  arrays.
- `tests/unit/audiograph.test.ts`: `applyGraphSettings` applies gain-then-equalizer in order, uses
  gain `1` when normalization is off, clamps through `loudnessDbToGain` for finite dB, returns `1`
  for a missing/non-finite dB, and forwards the bands unchanged.
- `vitest.config.ts`: `src/shared/settings-diff.ts` joins the covered core list.
- Bench: the live-bridge cases guard the post-injection delivery contract end-to-end:
  `m1:toggle-off-reclaims-native-in-place` and `fallback-quality:lowest-available-on-fallback` both
  start from a seeded page-world activation, which can only happen if the initial snapshot actually
  reached the page world. Seeded-settings first-application behavior is otherwise unchanged; the
  mid-session `audioOnlyEnabled` toggles remain in the media group. The graph
  fast path has no bench case (the fixture seeds settings before load); its units are covered by the
  two suites above and the spec calls out a future mid-session EQ bench case as optional.
- `npm run validate` is the gate.

## Dependencies

- None new.

## Security and Privacy Considerations

- The diff runs over the same validated snapshot; no new input surface. Duplicate-push suppression
  happens after consent and tab-scope application, so consent revocations can never be swallowed as
  "duplicates" (a revocation changes the effective snapshot).
- No new permissions, storage, messages, or network behavior.

## Performance Considerations

- Duplicate pushes cost one comparison instead of a page-world re-arm; irrelevant pushes cost a
  comparison plus at most one cleanup no-op.
- The graph fast path removes a full InnerTube request, media re-attach, and graph rebuild per
  equalizer input event.
