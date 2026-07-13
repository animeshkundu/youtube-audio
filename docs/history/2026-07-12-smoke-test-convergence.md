# Handoff: Smoke-test convergence cycle

**Date:** 2026-07-12
**Status:** Converged for this cycle. On `rebuild` (PR #65).

## Summary

Three consecutive adversarial real-Firefox smoke passes (headful, logged out, own isolated
instance) against real YouTube and YouTube Music, hunting for any functional, performance, UI,
UX, or friction issue. The first two passes each found and we fixed a real defect in the
audio-only teardown/re-toggle machinery; the third pass found no reproducible new defect.

- **Pass 1** found the toggle-off stall **P0** (audio-only OFF left `<video>` at readyState 0 with
  no MediaError and reset the position). Fixed in commit `5ce6282`
  (`docs/history/2026-07-12-audio-only-toggle-off-reclaim.md`).
- **Pass 2** found the rapid-re-toggle **P1** (fast OFF then ON lost position and pause intent).
  Fixed in commit `8e4fdf7` (the addendum in the same handoff).
- **Pass 3** found no reproducible product defect. Every anomaly it raised was rigorously
  re-verified as a test-harness artifact (wrong CSS selector, Selenium's inability to drive
  `<input type="range">`, checking the wrong download-state signal, opening the popup as a full
  tab rather than a toolbar panel) or a one-off environmental flake (a CDN/session hiccup, a page
  load timeout), never a reproducible defect. The P0 and P1 fixes held under heavier abuse
  (8-flip toggle spamming, mixed-settings stress, SPA-nav races, a 2.5-minute memory-sampling run
  with no RSS growth).

## Surfaces verified clean (pass 3, each independently re-verified)

Audio-only hijack (real googlevideo audio `currentSrc`), in-player controls, artwork overlay,
onboarding, options full walk (child-gating reveal 1->0->1, EQ slider gain applies + persists),
download (one real 3,449,447-byte `.m4a`, confirmed via filesystem + `browser.downloads.search`),
SponsorBlock skip (genuine 861->869s jump in 152ms of real time against the live segment API),
quality cap (240p vs off causal difference), hide-recommendations (recommendations hidden,
comments untouched), YouTube Music audio-only + synced lyrics, long video, and the project's own
`probe-live-features.mjs` (17/17 ok: made-for-kids / unavailable / live all fall back correctly;
download on/off correct).

## Open follow-ups (NOT defects, no code change this cycle)

1. **Background-play verification gap (testing, not product).** WebDriver/marionette-automated
   Firefox does not expose a real hidden-tab state: neither opening/focusing a second tab nor
   minimizing the window makes `document.hidden` become `true` for the YouTube tab (Firefox
   appears to suppress visibility-state throttling for automated sessions). So an automated harness
   cannot establish the "backgrounded" precondition that distinguishes `backgroundPlayEnabled`
   true vs false. The mechanism itself (`enableBackgroundPlay()` in `entrypoints/main-world.ts`) is
   sound by direct code reading: it patches the `document.hidden`/`visibilityState` getters and
   swallows `visibilitychange` in the capture phase, with full descriptor restoration on cleanup.
   Verify this via a packaged extension on a real device or a manual check, not WebDriver.

2. **Age-restricted playback observation (docs accuracy, not a code defect).** One
   age-restricted-labelled video (`7E9Ed9DUQoQ`) was hijacked (audio-only active, real googlevideo
   URL) rather than falling back. This is NOT a bug: the extension hijacks any video only when the
   credentialless ANDROID*VR player response reports it playable (`getPlayability` ->
   `isPlayable: status === 'OK'`, gated at `main-world.ts` before `attach`), and falls back on any
   non-playable response. The credentialless ANDROID_VR client evidently returns some
   age-restricted content as playable (it does not enforce the web age gate the way the WEB client
   does), so that content is correctly played rather than falling back. The inaccuracy is only in
   the prose that says age-restricted content \_always* falls back; reality is "falls back whenever
   the ANDROID_VR response is non-playable." Worth a ground-truth pass against a known-currently
   age-restricted video and, if confirmed, a wording softening in `CLAUDE.md` / the research docs.
   No fallback logic change is warranted (the playability-driven gate is already correct).

## Verification

Gates green throughout the cycle: unit 242/242 (~98% coverage), hermetic Firefox bench 47/47,
settings-permutation matrix 50/50, typecheck / eslint / prettier / `mkdocs build --strict` clean.
