# Media-client resilience: VISIONOS primary, honest canary

**Date:** 2026-10-15

## Summary

The credentialless media path now walks an ordered client table (VISIONOS 1.02 primary,
ANDROID_VR 1.65.10 fallback) with one bounded fresh-visitorData retry per client, instead of
pinning ANDROID_VR. That change was forced by live evidence gathered with a new Node-only audit
probe: on 2026-10-15, from a residential connection, every ANDROID_VR media URL returned HTTP 403
at byte 0 (playability itself still `OK`), while VISIONOS served a full 3.4 MiB file and 8 MiB of a
58 MiB file. The shipped 1.0.4 audio-only path was therefore dead for downloads from the day
YouTube applied the 2026-08-17 change; the rotation is the forward fix, not hardening. The same
change set removes the false-positive "foreign JSON hook, so stand down" scriptlet skip, moves the
background's listener registration ahead of settings I/O, and unmasks the live canary so its
failures are visible.

## Root cause and evidence

- yt-dlp removed `android_vr` from its defaults (commit `dae52d838`, issue #17456) because all
  formats it requests are 403'd since 2026-08-17, and VISIONOS is in its default JS-player-less
  set. The extension still pinned ANDROID_VR 1.65.10.
- `tests/e2e/probe-live-client-audit.mjs` (new, pure Node, never prints signed URLs) confirms it
  from this network position, with the exact request shape the extension can send (desktop Firefox
  User-Agent header, persona in the body): VISIONOS `OK`, direct audio, clean ranged download;
  ANDROID_VR `OK` playability then media `HTTP 403` at byte 0.
- The scriptlet guard false-positived on stock YouTube (which replaces or freezes JSON
  serialization in places) and silently disabled all page-world pruning there (ADR-0013).
- The background registered its webRequest listeners after awaiting settings, so early requests
  could be unhandled, and a per-response `adblock.pruned` log write produced noise.
- `live-canary.yml` carried a job-level `continue-on-error: true`, so the nightly probe had been
  able to fail invisibly (its failures show on AMO/CI as green).

## Changes

- `src/shared/innertube.ts`: `MEDIA_CLIENTS` table with pinned personas, `buildPlayerRequest`,
  `extractVisitorData`, `retryVisitorData`; `buildAndroidVrPlayerRequest` kept as a wrapper.
- `entrypoints/main-world.ts`: `fetchPlayerResponse` walk (max 2 HTTP attempts per client, live
  terminal, allowlisted direct URL required for acceptance, `lastParsed`/`lastPlayable` retained for
  diagnostics and native arming) used by activation and download; one `media.client` log per
  accepted activation; failed-path fallback emit now generation-guarded after its await.
- `entrypoints/content.ts`: download UI timeout 8 s to 30 s, sized for the bounded 4-request walk.
- `src/shared/scriptlets.ts`: coexistence is additive chaining; the skip heuristic is gone
  (ADR-0013).
- `entrypoints/background.ts`: status channel and both webRequest listeners register before the
  settings await, `DEFAULT_SETTINGS` on storage failure, per-response `adblock.pruned` removed.
- `src/shared/logger.ts`: `media.client` code, client ids derived from `MEDIA_CLIENTS`.
- `wxt.config.ts`: MV3-only `webRequestFilterResponse`.
- Benches/probes: fixture `ROTATE*` (primary rejected, fallback accepted) and `VISITOR*`
  (fresh-token retry) modes with request-shape recording; bench cases
  `m8:client-rotation-falls-back-to-second-client` and `m8:visitorData-retry-is-bounded-and-effective`
  pin walk order, request count, and retry token; playback probe now asserts a sustained window
  (`PROBE_SUSTAIN_MS`, 45 s default, 90 s release), buffer-ahead margin, seek-to-80 % resume, and
  live metadata readiness, and refuses an empty/unknown `PROBE_CASES` filter; the audit probe is
  new.
- `live-canary.yml`: `continue-on-error` removed, log tee'd, run summary plus `live-canary-log`
  artifact (overwrite on re-run).
- Docs: SPEC-014 (new), ADR-0012 (new), ADR-0013 (new), SPEC-002/004/011, CLAUDE.md, AGENTS.md,
  ADR-0009 cross-reference, `docs/ci-cd.md` runbook, AMO notes (`management` drift corrected; no
  such permission is or was needed for `uninstallSelf()`), `amo-metadata.json` listing no longer
  claims "Collects nothing" next to a `websiteContent` declaration.

## Validation

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm test`: 287 unit tests green, coverage 97.9 % statements / 96.0 % branches (floors 90 %).
- `npm run build` (MV2) and `npm run build:mv3`: clean; MV2 manifest free of
  `webRequestFilterResponse`, MV3 carries it; `web-ext lint` 0 errors on the MV2 build.
- Live audit probe (residential, browser User-Agent): VISIONOS serves bytes, ANDROID_VR 403s at
  byte 0, exit PASS because at least one client serves every probed video.
- Adversarial reviews (runtime and test/canary) were run against the working-tree diff; all
  blocker/major findings were fixed before commit (red-green tests now use plain-function foreign
  hooks because a Proxy reads as native; the retry cap and rotation order are pinned by bench
  cases; the `PROBE_CASES` false-green and seek-skip implicit pass are fixed).
- Hermetic bench, settings matrix, and the live canary run in CI; a local headless Firefox could
  not start on this macOS/Firefox build (Marionette never came up even without the extension), so
  CI is the authoritative source for those results.

## Follow-ups

- The VISIONOS persona is pinned to yt-dlp's 2026-10-15 definition; re-check on drift and amend
  ADR-0012 with the new pin.
- If the audit probe's ANDROID_VR 403 persists next quarter, drop the fallback client rather than
  keeping a dead attempt in the walk.
- Known pre-existing nit: the `JSON.stringify` accessor cleanup restores the install-time
  descriptor, discarding a page assignment made while installed (asymmetric with the no-descriptor
  branch); unchanged here.
- Storage-read failure now enforces `DEFAULT_SETTINGS` (extension on) rather than a user's stored
  "off"; revisit if users report being re-enabled by a storage fault.
