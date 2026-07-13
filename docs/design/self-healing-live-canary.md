# Design note: Self-healing live-YouTube canary (recorded, to build later)

**Status:** Recorded / not yet built. Owner directive 2026-07-12: "we need workflows which continuously
check against [real YouTube] and if it finds a breakage, trigger an agent with holistic details of the
repro and ask it to fix holistically. Record it for now, we will build later."

## Why

The hermetic fixture bench (`tests/e2e/bench/`) is intentionally deterministic so it can gate CI. By
construction it cannot catch drift in the thing we do not control: real YouTube's DOM, the InnerTube
player response shape, ad delivery (SABR / server-stitched), consent walls, and A/B experiments. The
core audio-only mechanism and every surface (controls, artwork, ad-block, SponsorBlock, download) can
silently break in production while every hermetic test stays green.

## What to build

A scheduled (cron) GitHub Actions workflow — extending `.github/workflows/live-canary.yml` — that:

1. Builds the **production** extension and loads it into a **real Firefox** (desktop and, via the
   owner-gated Fenix lane, Android) against **live** youtube.com / m.youtube.com / music.youtube.com.
2. Asserts the core flows on a small rotating set of known-stable videos:
   - Audio-only hijack succeeds (the `<video>` src is a `googlevideo.com` audio URL) and falls back
     cleanly where expected (live, age-restricted).
   - In-player controls mount in `.ytp-right-controls` before the gear and look correct.
   - Audio-mode artwork overlay renders and covers the black video area.
   - **Ad-blocking removes ads with audio-only both ON and OFF** (the native-playback path is the one
     that regressed in the field — see task #69).
   - SponsorBlock skips; download produces a valid audio file.
3. On any breakage, produce a **holistic repro bundle**, not just a red X:
   - failing flow + assertion, video id, timestamp, platform/host,
   - page DOM snapshot around the player, the InnerTube player-response shape,
   - the PII-free diagnostic log (the reporter already builds this),
   - screenshots, and the specific invariant that broke.
4. Open an issue with the bundle **and trigger an agent** (a workflow / dispatched subagent) seeded
   with that full context, instructed to root-cause and fix **holistically** (fix the real cause, not
   the symptom), with the change gated behind human review before merge.

## Building blocks that already exist

- `tests/e2e/real-youtube-capture.mjs` — loads the production XPI in a real Firefox against a real
  video and screenshots the player/controls/artwork (the first real-YouTube driver).
- The PII-free diagnostics + serverless issue reporter (SPEC on diagnostics) — the repro-bundle source.
- The orchestration tooling (decompose / run_workflow / floor-keeper) — candidates for the
  "trigger an agent to fix holistically" step.

## Guardrails

- Never a CI **gate** (non-deterministic). It is a **canary + repro generator + fix trigger**.
- Credentialless, logged-out only. No login path.
- The auto-triggered fix is a _proposal_ behind human review — never an unattended merge.

Tracked as task #71. Memory: `self-healing-canary`.
