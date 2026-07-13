# Handoff: Bundle size and runtime-performance optimization

## Date

2026-07-12

## Summary

A measured, behavior-preserving size and performance pass over the packaged production build.
The dominant win came from removing an accidental `@preact/signals` dependency from the two
non-UI runtime bundles (background + content), which had been dragging the Preact reconciler and
hooks into contexts that have no UI and never read a signal. The packaged production XPI dropped
from 82,700 to 67,736 bytes (-14,964 bytes, -18.1%); the unpacked build dropped from 190.82 kB to
150.31 kB (-40.5 kB). No feature or behavior changed: the full gate set (unit, hermetic Firefox
bench 32/0, settings matrix 48/0) stays green.

## Root cause of the main win

`src/shared/config.ts` is the single settings store imported by every context. It also created
~18 module-scope `@preact/signals` signals and `applySettings()` wrote all of them on every
settings change. Because `applySettings` is on the code path that `background.ts` and `content.ts`
run (via `initializeSettings` / `watchSettings`), the signal writes and the `@preact/signals`
import were reachable from those bundles and could not be tree-shaken. Importing `@preact/signals`
(the integration package, not `-core`) pulls in `preact` + `preact/hooks`, so each of the two
bundles carried ~20 kB of Preact runtime it never used. The background and content scripts have no
DOM UI and never read a signal, so this was pure dead weight.

## Key changes

- `src/shared/settings-signals.ts` (new): owns the 18 UI signals and a single `subscribeSettings`
  listener that mirrors the store into them. Only the extension UI (popup + options) imports this
  module, so `@preact/signals` is now confined to the UI `components` chunk.
- `src/shared/config.ts`: dropped the `@preact/signals` import, the 18 signal exports, and the 18
  signal writes in `applySettings` (which now only updates `currentSettings` and notifies
  subscribers). The store's public API (getters, `subscribeSettings`, `watchSettings`, mutators) is
  unchanged, so background / content / page-world behavior is byte-for-byte identical.
- `entrypoints/popup/App.tsx`, `entrypoints/options/App.tsx`: import signals from
  `settings-signals`, setters from `config` (split of the previous single import).
- `tests/unit/ui/popup.test.tsx`, `tests/unit/ui/options.test.tsx`: import the signals from their
  new home.
- `src/shared/player.ts`: gated the bench-only `127.0.0.1` / `localhost` media-URL allowance in
  `isSafeMediaUrl` behind the compile-time `__BENCH__` flag (the pattern already used in every
  entrypoint). Production now hijacks only `https:` media urls and the fixture-only host strings are
  dead-code-eliminated from `main-world.js`. `vitest.config.ts` now defines `__BENCH__: false` so the
  pure-module unit suite matches production.
- `entrypoints/content.ts`: the `document_start` MutationObserver's `attach` callback now
  short-circuits with three cheap `getElementById` checks before the class-based `querySelector`,
  so once the three player-control buttons are installed (steady state on a watch page) each
  mutation batch does less work. This is a conservative work-reduction on a hot path, not a
  measured runtime speedup; the bench + matrix confirm behavior is unchanged. A SPA teardown removes
  the buttons, so the guard falls through and reinstalls exactly as before.

## Before / after (bytes)

Packaged production XPI (web-ext zip of `.output/firefox-mv2`): 82,700 -> 67,736 (-14,964, -18.1%).

Per-file (unpacked, MV2):

| File                          | Baseline  | After     | Delta            |
| ----------------------------- | --------- | --------- | ---------------- |
| background.js                 | 44,474    | 24,161    | -20,313 (-45.7%) |
| content-scripts/content.js    | 40,842    | 20,629    | -20,213 (-49.5%) |
| main-world.js                 | 20,616    | 20,556    | -60              |
| chunks/components-\*.js       | 30,118    | 30,187    | +69              |
| chunks/options-\*.js          | 10,643    | 10,643    | 0                |
| chunks/popup-\*.js            | 1,791     | 1,796     | +5               |
| CSS + icons + html + manifest | unchanged | unchanged | 0                |
| Total (WXT sum)               | 190.82 kB | 150.31 kB | -40.5 kB         |

MV3 mirrors MV2 (same entrypoints + shared code; `npm run build:mv3` total ~150.3 kB, signals
absent from background/content).

## Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm test`: 139 passed; coverage 97.67% stmts / 95.31% branch / 95.65% func / 98.92% lines.
- `npm run test:bench`: 32 passed, 0 failed (PASS).
- `npm run test:matrix`: 48 passed, 0 failed (PASS).
- `npx web-ext lint --source-dir=.output/firefox-mv2`: 0 errors, 3 warnings (all pre-existing:
  the Android `strict_min_version` note and Preact's `innerHTML` assignment in the UI chunk; none
  from the changed source).
- Production-output hygiene reconfirmed: no `.map` files, no `__BENCH__` / `data-yta-bench` /
  `ytaBench` / `fixture` strings, Preact resolves to its production build (no dev-only strings),
  `@preact/signals` present only in the UI `components` chunk, and `127.0.0.1` / `localhost` absent
  from `main-world.js`.

## Context for continuation

- Add new UI signals to `settings-signals.ts`, not `config.ts`. Keeping the reactive layer out of
  the core store is what keeps `@preact/signals` (and therefore the Preact runtime) out of the
  background and content bundles. A future import of any `*Signal` from `config.ts` would silently
  re-inflate both bundles by ~20 kB each.
- The repo-root `img/` directory is not packaged (only `public/` is copied into the build), and all
  five declared icon sizes (16/32/48/96/128) are referenced by the manifest; nothing redundant
  ships. Minification is on (esbuild, WXT production default) and no sourcemaps are emitted.

## Next steps

- None required. Further byte trimming would target the 30 kB UI `components` chunk (Preact + the
  shared component set), which is inherent to the settings UI and not worth micro-optimizing.
