# Provenance and clean-room attestation

The record behind `NOTICE`: which third-party sources each shipped subsystem was informed by, how
the material was handled, and the attestation for behavior derived from closed-source products.
Written for the 1.1.0 release (plan item H4). The research briefs in
[`docs/research/`](./research/) are the primary evidence; each was written from sources that were
cloned and read, with `repo/path:line` citations and pinned commits.

## Method

1. **Research first, pinned.** Every upstream project was shallow-cloned at a recorded commit and
   studied in a dated brief (`docs/research/0N-*.md`). The briefs are the only artifact the
   implementing agent worked from; they capture behavior and protocol shape, not copied code.
2. **Spec, then implement.** Shipped behavior is specified in `docs/specs/` and implemented against
   the spec, so a reader can trace intent without consulting any upstream source.
3. **No vendoring.** No upstream file, filter list, or asset is copied wholesale into the tree. The
   only third-party code in the product is build-time dependencies declared in `package.json`.
4. **License check.** The project is GPL-3.0-only. Sources under GPL-3.0 are license-compatible;
   sources under restrictive or proprietary terms contributed **no code** (see the table and the
   attestation below).

## Per-subsystem provenance

| Shipped subsystem                                                         | Source studied (pinned)                                                                                                                                 | Source license                                                             | Handling                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Segment skipping (`src/shared/sponsorblock.ts`, background proxy)         | `ajayyy/SponsorBlock@4a118fb`; `ajayyy/maze-utils@6b1ba69` (`docs/research/09`)                                                                         | GPL-3.0                                                                    | Protocol reimplemented from the brief and SponsorBlock's public k-anonymity documentation (hash-prefix fetch, local exact-ID filter). Their view-count/telemetry call is deliberately **not** implemented (research 09 §3.2). No code copied.                            |
| Ad and telemetry filtering (`src/shared/adblock.ts`, `background.ts`)     | `gorhill/uBlock@697b2f10`; `uBlockOrigin/uAssets@cccd0e00` (`docs/research/02`)                                                                         | GPL-3.0                                                                    | The pruning strategy (remove ad descriptors from the parsed player response) follows the approach the brief documents; the implementation is ours over our own budgeted response filter, with fixtures and unit tests. No uBO filter list or scriptlet code is included. |
| Page-world scriptlets (`src/shared/scriptlets.ts`)                        | uBO scriptlet engine (same commits; `docs/research/02`, ADR-0003, ADR-0013)                                                                             | GPL-3.0                                                                    | Closed operation IDs implemented in-package (ADR-0003); the coexistence rule (additive chaining, ADR-0013) is our design. No uBO code, no external rule interpreter, no remote config.                                                                                   |
| Quality-of-life hiding (`src/shared/quality-of-life.ts`)                  | `code-charity/youtube@43fa27d3` (ImprovedTube); `ParticleCore/Iridium@9e2dcabc` (`docs/research/10`, SPEC-006)                                          | ImprovedTube: custom copyleft terms; Iridium: restrictive (non-commercial) | **Behavior study only; no code incorporated.** CSS-only hiding, our own rules, verified against live DOM class names (class names of the target site are facts, not expression).                                                                                         |
| Credentialless media acquisition (`src/shared/innertube.ts`)              | `yt-dlp/yt-dlp@59d9ae60` (client table, `docs/research/04`, `13`); `LuanRT/YouTube.js@14825d77`, `LuanRT/googlevideo@d2fa40d7` (protocol understanding) | yt-dlp: The Unlicense; LuanRT projects: reference-only                     | Client personas (VISIONOS 1.02 primary, ANDROID_VR 1.65.10 fallback, ADR-0012) and the rotation design implemented independently; every claim re-verified with our own live probes (`docs/history/2026-10-15-media-client-resilience-visionos.md`). No code copied.      |
| YouTube Music loudness/EQ (`src/shared/audiograph.ts`)                    | `th-ch/youtube-music@7ac63006`, `boidushya/better-lyrics@510d1e6e`, `web-scrobbler/web-scrobbler@577ed01d` (`docs/research/12`)                         | Reference-only                                                             | Web Audio usage studied; the graph (gain + 5-band biquad chain) is implemented from the platform API and unit-tested. No code copied.                                                                                                                                    |
| Diagnostics, reporter, redaction (`src/shared/{logger,redact,report}.ts`) | none                                                                                                                                                    | -                                                                          | Original design (SPEC-011, ADR-0005), PII-free by construction.                                                                                                                                                                                                          |
| Popup and options design language (`entrypoints/{popup,options}`)         | uBO popup layout; 1Password (proprietary; product study); Raindrop/Arc/Linear-class IA (`docs/research/14`)                                             | uBO: GPL-3.0; others: proprietary                                          | Design study captured in a brief, implemented from that brief. No proprietary code or assets.                                                                                                                                                                            |

## Closed-source attestation

Some behaviors were learned from **closed-source** products (their shipped UI and public writing),
including YouTube's own player behavior, which is the primary subject of every brief. The process
was:

1. The behavior was captured as an observable specification in a dated research brief (what it does,
   under which conditions, verified against the live product), never as source.
2. The implementing work started from that specification and the repo's own spec, written by an agent
   that had not read any proprietary source.
3. Where a behavior could not be verified from the live product or public documentation, it was left
   out of the release rather than guessed (for example, unverified mobile selector candidates were
   excluded from the distraction-hiding work).

## Changes to this record

A change that adopts behavior or a protocol from another project must extend this table (source,
pinned commit, license, handling) and, when the source is not license-compatible, must show that no
code was incorporated.
