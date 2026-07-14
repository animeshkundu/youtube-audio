# CI/CD Pipeline

The pipeline is documentation-driven and testability-first: the deterministic gates below must
stay green on every push and pull request, while live/mobile drift is caught by non-gating
nightly canaries that never block a merge.

## Workflow map

| Workflow            | File                                | Trigger                                       | Gating?                    |
| ------------------- | ----------------------------------- | --------------------------------------------- | -------------------------- |
| CI                  | `.github/workflows/ci.yml`          | push + PR (`main`/`master`/`rebuild`), manual | Gating + master release    |
| Beta                | `.github/workflows/beta.yml`        | pre-release tag `v*[a-z]*` + manual           | Gating (blocks the sign)   |
| Publish to AMO      | `.github/workflows/publish-amo.yml` | manual `workflow_dispatch` only               | Gating (blocks the submit) |
| Mobile E2E          | `.github/workflows/mobile-e2e.yml`  | nightly 04:17 UTC + manual                    | Non-gating (best-effort)   |
| Live YouTube Canary | `.github/workflows/live-canary.yml` | nightly 05:42 UTC + manual                    | Non-gating (best-effort)   |
| Pages               | `.github/workflows/pages.yml`       | (owned by another workflow)                   | n/a                        |

All workflows use least privilege: `contents: read` by default, while beta and CI's
`release-on-merge` job use `contents: write` only to publish their Release assets or push the next
version. The beta and publish-amo workflows share a single `concurrency` group (`amo-submit`,
`cancel-in-progress: false`) so every AMO submission for the one add-on ID is serialized and an
in-flight submission always finishes. Canaries and ordinary CI refs cancel superseded runs.
Each `master` push gets a run-ID-scoped CI concurrency group so every merge completes its own gates;
the release job then uses a shared non-cancelling `release-on-merge` group so two merges cannot
publish or bump concurrently.

## CI (gating)

Four parallel executable gate jobs must pass:

1. **validate**: `npm ci` then `typecheck`, `lint` (eslint 0/0), `format:check`, `test` (vitest,
   90%+ coverage), `build` (MV2), and `web-ext lint` on `.output/firefox-mv2` (0 errors).
2. **build-mv3**: `npm run build:mv3`. Proves the MV3 capability build stays buildable.
3. **bench**: the hermetic Selenium/Firefox integration bench. It installs a real (non-snap)
   Firefox via `browser-actions/setup-firefox` (the ubuntu snap Firefox cannot be driven by
   geckodriver), passes its path as `FIREFOX_BIN`, and runs `xvfb-run --auto-servernum npm run
test:bench`. The bench builds its own `BENCH=1` XPI and drives it against the local hermetic
   fixture (`tests/e2e/bench/fixture-server.mjs`), with no live network, which is why it is safe to
   gate on.
4. **matrix**: drives the real extension through the deterministic settings-permutation matrix in
   Firefox against the same hermetic fixture.

The public website is a bespoke Astro project in `website/`, deployed to GitHub Pages by `pages.yml`
on changes under `website/**` (see below). The engineering docs under `docs/` (specs, ADRs,
architecture, research, history) live in the repo and are not built into the published site.

### GitHub Release after a merge to master

On a `push` to `master` only, **release-on-merge** waits for `validate`, `build-mv3`, `bench`, and
`matrix`. Once all four succeed it checks out the exact gated merge commit with full history, runs
`npm ci` and `npm run build:ext`, copies the packaged artifact to
`dist/youtube-audio-<version>.xpi`, and creates
latest GitHub Release `v<version>`. It uses `docs/release-notes/NEXT.md` when present and generated
notes otherwise. If either the Release or its tag already exists, publishing is skipped cleanly. This
makes the initial run safe when `v0.0.2.5` already exists.

The GitHub Release XPI is **unsigned**. It is suitable for archival and manual or temporary
installation only. It is not the signed, auto-updating production channel. AMO remains the sole
signed and auto-updating channel, and the listed AMO publish remains manual and on demand.

After publishing or safely skipping an existing version, the job increments only the last numeric
segment in `package.json` (`0.0.2.9` becomes `0.0.2.10`), commits as `github-actions[bot]` with
`[skip ci]`, and pushes to `master`. The skip directive prevents the bump push from starting CI and
looping; pushes made with the workflow's `GITHUB_TOKEN` are also not used to create new workflow runs.
The serialized release concurrency group prevents two successful merge runs from racing the release
or version bump. Before pushing, each queued run rebases its one-file bump commit onto current
`origin/master`, preserving newer merge commits. Note the edge case: if several merges land inside
one version window, only the first claims the release tag `v<version>`; a later queued run finds that
tag already present, skips creating a duplicate, and its identical increment is absorbed by the
rebase rather than producing a further distinct version. No code is lost (every merge is on
`master` and ships in the next release), but a distinct release tag per merge is not guaranteed under
rapid concurrent merges. The condition is a push to `master` (a merge in the normal PR flow, but a
direct push to `master` triggers it too).

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

## Beta (gating)

`.github/workflows/beta.yml` signs the **unlisted** beta channel for the single add-on ID
`{580efa7d-66f9-474d-857a-8e2afc6b1181}` (ADR-0006). It triggers on a **pre-release** version tag whose
name carries the suffix letter (glob `v*[a-z]*`, e.g. `v0.0.2.5b1`; a clean `v0.0.2.5` tag never
matches), or on a manual `workflow_dispatch` with the suffix as input. It **validates before
signing**: it derives and validates the pre-release suffix, runs `typecheck && lint && test`, then
re-runs the full deterministic hermetic Firefox suite (`test:bench` and `test:matrix`) on the exact
ref being shipped. Both browser suites run before the clean `BETA_SUFFIX` build because they write
a throwaway BENCH extension into `.output`; the later build therefore supplies the production
bytes that are validated and signed. The workflow asserts the built manifest's version, permanent
ID, and absence of `update_url`, runs `web-ext lint`, then `web-ext sign --channel=unlisted`. After
signing it re-checks the signed XPI (valid signed zip; bundled manifest version/id/no-`update_url`),
uploads it as a workflow artifact for recoverability, and attaches it to a GitHub **prerelease**
pinned to the built commit. The XPI is hand-installed for desktop and Android testing; it does not
auto-update.

## Publish to AMO (gating, manual-only)

`.github/workflows/publish-amo.yml` is the **only** path to the AMO **listed** channel and is
`workflow_dispatch`-only (no push/tag/release/schedule trigger), so a tag push can never publish to
AMO. Inputs are `ref` (the clean release tag to check out and publish) and `dry_run`. It asserts
`ref == v<package.json version>` and that the version is clean **before** signing, runs the same
static and unit gates, then re-runs `test:bench` and `test:matrix` on the exact checked-out ref in
both real and dry-run paths. The hermetic suites precede the clean listed build so their throwaway
BENCH output cannot become the submitted artifact. It builds without `BETA_SUFFIX`, asserts the
built manifest is clean, runs `web-ext lint`, confirms tracked source is unchanged, packages a
reviewer **source archive** with `git archive` (tracked files only), then `web-ext sign
--channel=listed --upload-source-code=<zip> --amo-metadata=amo-metadata.json --approval-timeout=0`.
AMO hosts the signed XPI and becomes the sole update authority for desktop and Android; there is no
Release asset and no self-hosted `updates.json`. The recommended human gate is a GitHub Environment
`amo-production` with a required reviewer. See `RELEASE.md`.

## Mobile E2E (non-gating, best-effort)

Nightly probe of the core audio-only path on Fenix (Firefox for Android) in an x86_64 Android
emulator (`reactivecircus/android-emulator-runner`, API 34, `google_apis`, `x86_64`,
`-no-window -gpu swiftshader_indirect`). It builds the `BENCH` XPI, boots the emulator, installs
the x86_64 Fenix APK, enables "Remote debugging via USB", and runs
`tests/e2e/android/probe-audio-hold.mjs` against live `m.youtube.com`. The probe dismisses the
add-on/onboarding/default-browser overlays through uiautomator, foregrounds the watch URL through
an Android VIEW intent, taps the native Play control with `adb shell input tap`, and requires cold
`active`, `/videoplayback` re-hijack, trusted activation, decoded/unmuted playback, and an advancing
clock for 45 seconds. A local arm64 AVD passed the exact recipe with `-no-window`, so CI keeps the
headless emulator configuration; x86_64 remains a separate architecture caveat.

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

### CI validation findings (2026-07-11, ran on the PR via a temporary trigger)

Both non-gating workflows were exercised once on GitHub Actions to validate them pre-merge:

- **Emulator layer works on CI.** `android-emulator-runner` boots the x86_64 API-34 image with KVM
  in ~40 s; `adb root`, JDK, and the `BENCH` XPI build all succeed. A dash-vs-bash bug was found and
  fixed here: the emulator `script:` runs under `/usr/bin/sh` (dash), which rejects `set -o pipefail`
  (now `set -u`).
- **Fenix package mismatch fixed; UI drift remains tuning-sensitive.** The pinned `fenix-130.0`
  x86_64 release APK registers as `org.mozilla.firefox`, while Nightly registers as
  `org.mozilla.fenix`. The workflow now detects either installed package and exports it to the
  audio-hold probe. The uiautomator "Remote debugging" menu labels remain version-sensitive.
- **Datacenter-IP limitation (fundamental).** Even once Fenix loads, the probe hits **live**
  `m.youtube.com`, and YouTube treats GitHub's datacenter IPs differently (the desktop live-canary
  confirmed this: the ANDROID_VR fetch does not hijack from CI IPs). So a **live**-YouTube mobile (or
  desktop) probe cannot reliably go green from CI regardless of the Fenix tuning.
- **Real mobile verification is local.** `probe-mobile-fenix.mjs` passes 4/4 on a real emulator from
  a residential IP (see `docs/history/2026-07-11-mobile-firefox-verification.md`).
- **Recommended proper fix:** make the mobile probe **hermetic** like the desktop bench, driving the
  emulator's Fenix against the local fixture over `10.0.2.2` (requires the extension to also match
  `10.0.2.2` and the probe to point there). That removes the datacenter-IP dependency and would make
  mobile E2E deterministic and even gate-able. Tracked as a follow-up.

### Run the mobile probe locally

Requires a running Android emulator/device with Fenix and remote debugging enabled, plus the
`BENCH` XPI at `dist/youtube-audio-bench.xpi`. Geckodriver is launched with
`--android-storage internal` by the probe, avoiding the Fenix profile `fchown failed` error on
restricted emulator storage.

```bash
BENCH=1 npm run build
node_modules/.bin/web-ext build --source-dir=.output/firefox-mv2 \
  --artifacts-dir=dist/bench-web-ext-artifacts --overwrite-dest
cp dist/bench-web-ext-artifacts/*.zip dist/youtube-audio-bench.xpi
node tests/e2e/android/probe-audio-hold.mjs dist/youtube-audio-bench.xpi
```

Defaults are the eligible long-form VOD `zkfVxxJFPjM`, a 45-second hold, and five-second samples. Override
with `VIDEO_ID`, `HOLD_SECONDS`, and `SAMPLE_SECONDS`. The older
`tests/e2e/probe-mobile-fenix.mjs` remains available for the broader source/fallback matrix.

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
