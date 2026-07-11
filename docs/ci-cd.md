# CI/CD Pipeline

The pipeline is documentation-driven and testability-first: the deterministic gates below must
stay green on every push and pull request, while live/mobile drift is caught by non-gating
nightly canaries that never block a merge.

## Workflow map

| Workflow            | File                                | Trigger                                       | Gating?                     |
| ------------------- | ----------------------------------- | --------------------------------------------- | --------------------------- |
| CI                  | `.github/workflows/ci.yml`          | push + PR (`main`/`master`/`rebuild`), manual | Gating (all 3 jobs)         |
| Release             | `.github/workflows/release.yml`     | tag push `v*`                                 | Gating (blocks the publish) |
| Mobile E2E          | `.github/workflows/mobile-e2e.yml`  | nightly 04:17 UTC + manual                    | Non-gating (best-effort)    |
| Live YouTube Canary | `.github/workflows/live-canary.yml` | nightly 05:42 UTC + manual                    | Non-gating (best-effort)    |
| Pages               | `.github/workflows/pages.yml`       | (owned by another workflow)                   | n/a                         |

All workflows use least-privilege `permissions: contents: read` (release needs `contents: write`
to publish assets) and a `concurrency` group keyed on `${{ github.workflow }}-${{ github.ref }}`.
CI and the canaries cancel superseded runs per ref; the release does **not** cancel in progress,
so a publish that has started always finishes.

## CI (gating)

Three parallel jobs, each an independent required check:

1. **validate** — `npm ci` then `typecheck`, `lint` (eslint 0/0), `format:check`, `test` (vitest,
   90%+ coverage), `build` (MV2), and `web-ext lint` on `.output/firefox-mv2` (0 errors).
2. **build-mv3** — `npm run build:mv3`. Proves the MV3 capability build stays buildable.
3. **bench** — the hermetic Selenium/Firefox integration bench. It installs a real (non-snap)
   Firefox via `browser-actions/setup-firefox` (the ubuntu snap Firefox cannot be driven by
   geckodriver), passes its path as `FIREFOX_BIN`, and runs `xvfb-run --auto-servernum npm run
test:bench`. The bench builds its own `BENCH=1` XPI and drives it against the local hermetic
   fixture (`tests/e2e/bench/fixture-server.mjs`) — no network, 21 deterministic cases — which is
   why it is safe to gate on.

### Run CI checks locally

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build          # Firefox MV2
npx web-ext lint --source-dir=.output/firefox-mv2
npm run build:mv3
npm run test:bench     # hermetic bench (needs a local Firefox)

# Or all deterministic gates at once:
./scripts/validate.sh
```

## Release (gating)

Triggered by a `v*` tag. Reuses the same deterministic gates
(`typecheck && lint && test && build` + `web-ext lint`), then signs the unlisted MV2 XPI via AMO
(`AMO_JWT_ISSUER` / `AMO_JWT_SECRET`), verifies the tag matches `package.json` version, and
publishes the signed XPI plus a self-hosted `updates.json`
(`https://animeshkundu.github.io/youtube-audio/updates.json`).

## Mobile E2E (non-gating, best-effort)

Nightly probe of the core audio-only path on Fenix (Firefox for Android) in an x86_64 Android
emulator (`reactivecircus/android-emulator-runner`, API 34, `google_apis`, `x86_64`,
`-no-window -gpu swiftshader_indirect`). It builds the `BENCH` XPI, boots the emulator, installs
the x86_64 Fenix APK, enables "Remote debugging via USB", and runs
`tests/e2e/probe-mobile-fenix.mjs` against live `m.youtube.com`.

### x86_64 vs arm64 (important)

The CI emulator is **x86_64**, not arm64. The probe (`probe-mobile-fenix.mjs`) does not download
any APK itself — it only installs the extension into whatever Fenix is already running — so the
arch decision lives entirely at the APK-install layer in the workflow. The workflow installs the
**x86_64** Fenix build via the `FENIX_APK_URL` env var (default pins
`fenix-130.0-android-x86_64`); an arm64 APK would refuse to install on the x86_64 emulator.
Override the URL per run through the `fenix_apk_url` `workflow_dispatch` input, or bump the pinned
version in the workflow `env` when it ages out.

### Mobile-CI caveats (first run needs tuning)

- **This job is best-effort and its first CI runs need observation/tuning.** It is
  `continue-on-error: true` and never blocks a merge.
- **Remote debugging enable flow.** `tests/e2e/android/ui.py` drives Fenix's UI via uiautomator to
  toggle "Remote debugging via USB". The exact menu labels are Fenix-version-specific and are the
  most likely thing to need adjustment; the workflow dumps the UI tree to the log and guards each
  tap so failures are visible without aborting.
- **SDK path shim.** `ui.py` hardcodes a macOS Homebrew SDK path
  (`/opt/homebrew/share/android-commandlinetools`). The Linux job symlinks that path to the
  runner's `ANDROID_SDK_ROOT` so its `adb` calls resolve. (Do not "fix" `ui.py` for this; the shim
  keeps the local macOS default intact.)
- **geckodriver ↔ GeckoView.** The npm `geckodriver` must be compatible with the installed Fenix
  build; a large version gap between them is a likely early failure mode.
- **Live network.** The probe hits real `m.youtube.com` logged-out, so YouTube bot-flagging can
  cause intermittent, expected reds.

### Run the mobile probe locally

Requires a running Android emulator/device with Fenix and remote debugging enabled, plus the
`BENCH` XPI at `dist/youtube-audio-bench.xpi`:

```bash
BENCH=1 npm run build
node_modules/.bin/web-ext build --source-dir=.output/firefox-mv2 \
  --artifacts-dir=dist/bench-web-ext-artifacts --overwrite-dest
cp dist/bench-web-ext-artifacts/*.zip dist/youtube-audio-bench.xpi
node tests/e2e/probe-mobile-fenix.mjs
```

## Live YouTube Canary (non-gating, best-effort)

Nightly desktop probe (`tests/e2e/probe-audio-playback.mjs`) that installs the `BENCH` XPI in a
real (non-snap) Firefox under `xvfb` and drives live YouTube watch pages, asserting that eligible
VODs actually play audio-only (currentTime advances, `videoWidth === 0`, googlevideo src) and live
streams fall back gracefully. It is network-dependent and bot-flag-prone, so it is
`continue-on-error: true` and non-gating; its job is to surface YouTube-side drift the hermetic
bench cannot see.

Because that probe uses geckodriver's default Firefox discovery (it does not read `FIREFOX_BIN`),
the workflow symlinks the setup-firefox binary to `/usr/local/bin/firefox` (ahead of the snap on
`PATH`) so geckodriver drives the real Firefox.

### Run the live canary locally

```bash
# build the BENCH XPI as above, then:
node tests/e2e/probe-audio-playback.mjs      # add HEADLESS=0 to watch
# broader live matrix (35+ harvested videos):
node tests/e2e/probe-audio-matrix.mjs
```

## Dependency updates

`.github/dependabot.yml` opens weekly PRs (Monday 06:00 UTC) for the `npm` and `github-actions`
ecosystems. npm dev-tooling bumps are grouped into one PR to cut review noise; Actions bumps keep
the workflow pins current.
