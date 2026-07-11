# Smoke Test and QA Protocol

Status: living document. Run the manual checklist before every release. Keep the automated
upgrades in `tests/e2e/bench/` and `tests/unit/` green as a precondition, not a substitute.

## Why this exists

Three user-visible bugs shipped from the `rebuild` line with a fully green test suite
(24/24 bench cases, 90%+ unit coverage, a passing live probe run). The suite was green
because it asserted the wrong things: implementation signals we designed, not the outcomes a
user sees. This protocol is the durable fix. It is blunt on purpose.

### The three escapes

| Bug                         | What the user saw                                                                                                          | What the suite asserted                                                                                                                                              | Why it stayed green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No icon                     | Generic puzzle-piece in the toolbar and on `about:addons`                                                                  | Nothing. No test reads the built `manifest.json`                                                                                                                     | `wxt.config.ts` declared no `icons` and no `browser_action.default_icon`; the bench drives page content, so Selenium never sees browser chrome; `web-ext` lint does not fail on a missing icon and the bench runs `web-ext build` with `stdio: 'ignore'`, so even a warning is swallowed                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Ad-block dead in video mode | Pre-roll and mid-roll ads played on normal video playback (audio-only hid the bug because it swaps the whole media stream) | `m2b:enabled-prunes-player-ads`: the page does `fetch('/youtubei/v1/player', POST)` and the response has no `adPlacements`                                           | The extension pruned only the network XHR (`background.ts` `filterPlayerResponse`, `types:['xmlhttprequest']`). The first video and its pre-roll are driven by the inline `window.ytInitialPlayerResponse` server-rendered into the watch page, which nothing touched. The fixture's inline response was `{ playabilityStatus: { status: 'OK' } }` with no ad fields, so an inline-prune path could not even be exercised. The one green assertion tested the exact surface that already worked                                                                                                                                                                                                                               |
| Download makes many files   | "A whole host of files" instead of one clean track                                                                         | `m5:download-enabled-initiates-selected-audio`: button visible, `download.filename === 'Fixture Watch Page.webm'`, `download.url` includes `/videoplayback?itag=251` | The assertion read `dataset.ytaDownload`, which the content script sets to the request payload (url + filename) after the background returns `ok:true`. That proves the request was initiated, not that one file landed. `assembleAudioMedia` (the range-walking single-file assembler) was imported into `background.ts` but never called; `downloadAudio` handed the raw itag URL straight to `browser.downloads.download`. On real YouTube that Googlevideo URL is delivered in segments, so many files land. The fixture `/videoplayback` returns one complete 200 with `Content-Length`, so the segmented failure mode could not occur on the bench, and `assembleAudioMedia`/`parseContentRange` had zero unit coverage |

The live probe run did not save these either. `docs/history/2026-07-11-live-e2e-results.md`
recorded the ad-block live check as `FAIL-ENVIRONMENTAL` twice (the logged-out datacenter
session was served no ad payload) and explicitly listed "ad-field pruning on an actual live
response containing `adPlacements`/`playerAds`" as a known blind spot, then shipped anyway.
Download was marked `PASS` on the strength of the title changing to "Audio download started"
and a marker holding a URL. Nobody opened the Downloads folder.

## Systemic gaps

Name them so they are easy to catch in review:

1. Signal testing, not outcome testing. We asserted "request fired", "DOM marker set",
   "response pruned", "download initiated". None of those is what the user experiences.
2. Happy-path fixtures. The fixture modeled the shapes we designed for (an empty inline
   response, a single-file media endpoint), not the shapes real YouTube ships (inline ads,
   segmented range media). A fixture that cannot express the failure cannot catch it.
3. Browser-chrome blind spot. Toolbar icon, `about:addons` entry, and the popup button are
   chrome, not page DOM. Selenium page-context probes and the hermetic bench are structurally
   blind to them, and `web-ext` lint does not fail the build on a missing icon.
4. Dead-wiring blind spot. A helper can be perfectly unit-tested (or untested) and never
   called on the runtime path. Nothing asserted the integration path actually invokes it.
5. No manual visual pass of the installed build. No human loaded the packaged extension and
   looked at it before release.
6. Live-YouTube blindness. Logged-out and datacenter sessions are rarely served ads, so a
   live ad-block check is unreliable. We treated `FAIL-ENVIRONMENTAL` as "not a blocker"
   instead of "still unverified".
7. Green-bench over-trust. 24 green cases read as "done" while three shipped outcomes were
   broken. Green is necessary, not sufficient.

## Part A. Manual smoke checklist

Run every item on a freshly built and installed package before tagging a release. This is the
last line against chrome-level and outcome-level escapes the automated suite cannot see. Do
not delegate it to a bench pass.

### Preconditions

- [ ] `BENCH` unset. Build the production package: `wxt build -b firefox --mv2` (and `--mv3`).
- [ ] Load the built package as a temporary add-on in a clean Firefox profile
      (`about:debugging` > This Firefox > Load Temporary Add-on), or install the signed XPI.
- [ ] Use a real, logged-out YouTube and YouTube Music. No account. Confirm your region and a
      known monetized channel that serves ads to logged-out viewers before you start.

### Chrome and packaging (the icon class of bug)

- [ ] Toolbar shows the YouTube Audio icon, not a generic puzzle piece.
- [ ] `about:addons` lists the extension with its real icon, name, and description.
- [ ] Clicking the toolbar button opens the popup; the popup renders its own icon and controls.
- [ ] The built `manifest.json` (in `.output/firefox-mv2/`) has an `icons` block and a
      `browser_action.default_icon` (MV2) / `action.default_icon` (MV3), and every referenced
      file exists in the package.

### Per-setting effect (toggle in the real UI, confirm the real result)

Master switch:

- [ ] Extension `enabled` off: the page is untouched, native YouTube plays normally.
- [ ] Extension `enabled` on: default behavior applies (audio-only, background play,
      ghost, ad-block, segment-skip, loudness on per defaults).

Playback:

- [ ] `audioOnlyEnabled` on: a normal video plays audio with `videoWidth == 0` (no video
      decode); off: native video plays.
- [ ] `backgroundPlayEnabled` on: switch tabs or minimize; audio keeps playing and does not
      pause on `visibilitychange`. Off: normal YouTube pause-on-hide behavior.

Ghost / telemetry:

- [ ] `ghostEnabled` on: with devtools Network open, YouTube telemetry beacons
      (`/youtubei/v1/log_event`, `/api/stats/qoe`, `/api/stats/atr`) are blocked or reduced.
- [ ] `aggressiveTelemetry` on: broader telemetry is blocked and playback still works (no
      stalls from over-blocking).

Ad-block (the class that shipped broken; do this in VIDEO mode, not audio-only):

- [ ] Turn `audioOnlyEnabled` OFF and `adBlockEnabled` ON. Watch a genuinely ad-heavy,
      monetized video from a logged-out session in real video mode. Confirm ZERO pre-roll and
      ZERO mid-roll ads. This is the exact step that was missed. Audio-only mode hides this bug
      because it replaces the media stream, so it must be checked with video showing.
- [ ] Reload the same video (first load is driven by the inline `ytInitialPlayerResponse`) and
      confirm no pre-roll on the very first play, not just after an SPA navigation.
- [ ] `adBlockEnabled` OFF on the same video: ads return. This proves the control, not just the
      treatment.

Segment skip:

- [ ] `segmentSkipEnabled` on with a video that has SponsorBlock ranges: the player seeks past
      the sponsor segment automatically. Toggle categories and confirm only selected categories
      skip.

Quality of life:

- [ ] `forceQualityMax` set to a cap (e.g. 480p): the player quality is pinned at or below it.
- [ ] `disableAutoplayNext` on: the next video does not autoplay at the end.
- [ ] `hideShorts`, `hideRecommendations`, `hideComments`: each hides exactly its target and
      leaves the rest of the page intact.

YouTube Music extras:

- [ ] `loudnessNormalization` on: quiet and loud tracks even out; off: raw loudness returns.
- [ ] `equalizerEnabled` on with non-flat bands: audible tonal change; flat bands sound
      identical to off.
- [ ] `lyricsEnabled` on for a track with LRCLIB lyrics: synced lyrics render; off: no lyrics
      panel.

Download (the class that made many files):

- [ ] `downloadEnabled` off: the download button is hidden.
- [ ] `downloadEnabled` on: the button appears. Click it on a real video. Confirm EXACTLY ONE
      file lands in Downloads (not a batch of segments), the filename is the sanitized title
      with a `.webm` or `.m4a` extension, and the file opens and plays start to finish in a
      normal audio player.

### Cross-cutting

- [ ] SPA navigation: move between videos without reload; audio-only, ad-block, and segment
      skip all re-arm on the new video.
- [ ] No uncaught errors in the page console or the extension background console during any of
      the above.

## Part B. Automated upgrades

These make the three escapes deterministic bench or unit failures. Keep them as the standing
gate.

### Make the fixture model real shapes

`tests/e2e/bench/fixture-server.mjs`:

- [ ] Inline `window.ytInitialPlayerResponse` carries a real ad shape: `adPlacements` and
      `playerAds` (done in the current fix). The first-load prune path is only exercised when
      the inline response actually contains ads.
- [ ] Add a segmented media endpoint: a `/videoplayback` variant that answers `206` with a `Content-Range` header and refuses a single full `200`, so a naive `downloads.download(url)` would produce many parts and only a range-assembling path yields one file. Keep the single-file endpoint for the audio-only hijack cases.

### Assert outcomes, not signals

`tests/e2e/bench/run-bench.mjs` and `tests/unit/`:

- [ ] Manifest outcome (unit or build step): the built `manifest.json` has `icons` with the
      expected sizes and a `browser_action`/`action` `default_icon`, and every referenced icon
      path exists in the packaged output. Fail the build if not.
- [ ] Ad-block video outcome: after an `enabled` load, assert `window.ytInitialPlayerResponse`
      has no `adPlacements` and no `playerAds` (inline path), in addition to the existing XHR
      response assertion. Assert the disabled control still has both.
- [ ] Download outcome: exactly one `browser.downloads.download` call for one click, and the
      assembled bytes equal the concatenation of the served ranges (byte-for-byte), against the
      segmented fixture endpoint. Assert one output file, not "download initiated".
- [ ] Wiring guard: because the download outcome runs against the segmented endpoint, it passes
      only if `assembleAudioMedia` is actually on the runtime path. Keep a bench case that
      breaks if the assembler is ever unwired again.

### Unit coverage for byte-level logic

- [ ] `assembleAudioMedia` and `parseContentRange` have direct unit tests over range walking,
      short reads, size caps, and the single-`200` fast path (added in the current fix). Any
      helper that transforms response bytes gets the same treatment.

### Harness notes for chrome-level checks

- [ ] Selenium page-context cannot see the toolbar icon, the `about:addons` entry, or the
      popup chrome. Cover the icon deterministically at the manifest/package layer (above), and
      keep the visual confirmation on the manual checklist. If a headed run with a screenshot is
      added for the popup, treat it as manual-assist, not a hermetic gate.
- [ ] Stop swallowing `web-ext` output in the bench build. Surface warnings, and add a
      packaging check that fails on a missing icon rather than relying on lint defaults.

## Part C. Definition of done

Update the bar. A feature is not done until its real user-visible outcome is verified.

- Done means: one bench (or unit) assertion on the OUTCOME the user experiences, plus one
  manual smoke tick on the freshly installed build. A green "action fired", "request
  initiated", "response pruned", or "DOM marker set" is not done.
- Every helper that transforms bytes or a response is done only when it is both unit-tested and
  proven wired by an integration outcome assertion. An imported-but-unused helper is a defect,
  not a detail.
- A live probe that returns `FAIL-ENVIRONMENTAL` is an open risk, not a pass. Any capability
  that cannot be verified live (for example, ad-block on a logged-out session) must be covered
  by a hermetic outcome assertion over a real-world-shaped fixture and ticked manually before
  release.
- Fixtures model real-world shapes, not the shapes we designed for. When a bug escapes, add the
  real shape to the fixture as part of the fix so the bench can express the failure.
  </content>
  </invoke>
