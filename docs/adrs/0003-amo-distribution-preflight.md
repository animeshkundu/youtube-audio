# ADR-0003: AMO listing policy preflight and distribution split

> **Retired and superseded by ADR-0006.** The proposed listed-clean / unlisted-full split,
> including exclusion of audio download from the listed build, was not adopted. The owner accepted
> one build under one permanent add-on ID; audio download intentionally ships in the AMO-listed
> build. ADR-0006 is the current distribution decision.

## Status

**Retired and superseded by ADR-0006.** This document remains as the historical policy preflight,
but its proposed build split and download exclusion are not current architecture.

## Date

2026-07-11

## Context

The plan locked **AMO-listed** distribution (for hands-off desktop + Android auto-update) with
**every feature in v1**. Before the owner invests in an AMO submission, a policy preflight was run
against the current (2025-2026) Mozilla policy set to estimate rejection risk. AMO has a documented
history of removing YouTube downloaders/stream-rippers, and a 2026 US DMCA §1201 ruling on YouTube's
"rolling cipher" reframes client-spoofing media acquisition as a circumvention concern.

### Per-feature rejection risk for a LISTED submission

| Feature                                                                                               | Risk                                                             | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio download (`downloads.download` of the direct googlevideo URL)                                   | **HIGH** — near per-se rejection                                 | AUP IP/legality (§2.1) + US-law (§2.3), reinforced by the 2026 §1201 rolling-cipher ruling; AMO's downloader-removal history. The single biggest driver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Remote **rescue-config + "scriptlet engine"**                                                         | **NOT PRESENT in shipped code → LOW** (HIGH only if later built) | Code-verified 2026-07-11: `loadRescueConfig()` returns a static in-package `BUNDLED_BASELINE` (no fetch), the "scriptlet engine" is a fixed `switch` over **two hardcoded in-package op IDs** (a closed TS union, no external interpretation, no `eval`/`Function`), and the manifest has **no host permission for a config mirror** — so the extension physically cannot load remote config. The §4.2 remote-code / control-flow-from-remote risk applies ONLY to the _deferred_ "consume uBO's ruleset via signed remote config" design, which is intentionally NOT shipped. If that remote design is later built, this returns to HIGH and must be hardened (declarative-only, parameterize fixed code paths) — on any channel. |
| Audio-only via ANDROID_VR credentialless re-fetch → `<video>.src`                                     | **MED-HIGH**                                                     | Playback (not saving) is far more defensible, but the client-spoof/circumvention mechanism can still draw a §2.3 objection. Credentialless + no-persistence + fallback are the defense.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `data_collection_permissions: none` accuracy                                                          | **MED**                                                          | External calls to sponsor.ajay.app / lrclib.net / googlevideo convey "what the user is watching"; reviewers may deem `none` inaccurate (§6.2.1). `strict_min_version:128` also means the key is ignored on FF 128-139.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Source-code submission (WXT/esbuild bundle)                                                           | **MED** (procedural)                                             | Bundled output requires un-bundled sources + lockfile + pinned toolchain; reviewer rebuild must diff-clean. Low if prepared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Broad `*.googlevideo.com` + `webRequestBlocking`                                                      | **MED** (justifiable)                                            | Legitimate under least-privilege but guarantees full manual review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Telemetry-block, ad-block _concept_, segment-skip, QoL, loudness/EQ, lyrics (opt-in), background play | **LOW**                                                          | Content blocking is permitted (only _injecting_ ads is restricted); each surprising behavior is opt-in + disclosed. AMO has no single-purpose rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The preflight's historical verdict was that the proposed listed submission carried high policy
risk, with audio download as the largest identified driver. It proposed excluding download as a
risk-reduction measure alongside honest data taxonomy and source-reproducibility preparation. That
exclusion was never adopted: the owner accepted the risk and audio download intentionally ships in
the listed build under ADR-0006.

Key platform fact: an **unlisted** self-hosted XPI **does not auto-update on Firefox for Android**
(sideloaded updates are ignored on mobile). So going unlisted-only forfeits silent updates on the
exact platform the product targets — severe for a tool that breaks whenever YouTube changes.

## Retired proposal (not adopted)

The preflight proposed a **hybrid, two-build distribution from one source tree** extending
ADR-0002's two-identity model:

1. **Listed "clean" build → AMO** — the Android auto-update + discoverability channel. Excludes the
   audio **download** feature; declares an **honest data taxonomy**; includes reviewer notes + source
   - pinned toolchain for a diff-clean rebuild. (Ad rules are already in-package only — see below.)
2. **Unlisted "full" build → self-hosted signed XPI** — desktop power users; adds download; accepts
   manual updates on Android.
3. **Rescue-config:** the shipped code is already in-package-only and compliant (verified). No
   hardening is needed now. IF the deferred "signed remote rescue-config consuming uBO's ruleset"
   design is later built, it must be declarative-only and strictly parameterize fixed in-package code
   paths (never select which logic runs) — on any channel, since the remote-code ban covers unlisted.

### Projected consequences of the retired proposal

- It would have kept Android auto-update through a listed-clean build.
- It would have limited download to an unlisted-full desktop build.
- It would have required a build-time feature flag to drop download from the listed variant and
  separate variant maintenance.

## Owner decision outcome

The owner selected the listed all-in-one direction with download included, then ADR-0006 replaced
the two-build and two-identity assumptions with one build and one permanent add-on ID. Production
uses the AMO listed channel, beta uses the same ID signed unlisted at a distinct pre-release version,
and audio download ships in the listed build. This accepted outcome supersedes every exclusion and
build-split recommendation above.

## References

- AMO policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Source-code submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Acceptable Use Policy: https://www.mozilla.org/en-US/about/legal/acceptable-use/
- Data-collection consent (`data_collection_permissions`): https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- Unlisted + Android auto-update limitation: https://extensionworkshop.com/documentation/publish/distribute-sideloaded-extensions/ · https://bugzilla.mozilla.org/show_bug.cgi?id=1849605
- 2026 DMCA §1201 rolling-cipher ruling: https://news.slashdot.org/story/26/02/05/1924252/
- Historical context: [ADR-0002](0002-separate-firefox-distribution-identities.md).
- Superseding decision: [ADR-0006](0006-firefox-amo-distribution-and-beta-channel.md).
