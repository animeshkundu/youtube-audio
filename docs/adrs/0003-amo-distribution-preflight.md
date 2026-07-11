# ADR-0003: AMO listing policy preflight and distribution split

## Status

**Proposed** — decision required from the project owner. This ADR contradicts two previously locked
plan decisions ("AMO-listed" and "everything in v1"), so it is surfaced for approval rather than
adopted unilaterally.

## Date

2026-07-11

## Context

The plan locked **AMO-listed** distribution (for hands-off desktop + Android auto-update) with
**every feature in v1**. Before the owner invests in an AMO submission, a policy preflight was run
against the current (2025-2026) Mozilla policy set to estimate rejection risk. AMO has a documented
history of removing YouTube downloaders/stream-rippers, and a 2026 US DMCA §1201 ruling on YouTube's
"rolling cipher" reframes client-spoofing media acquisition as a circumvention concern.

### Per-feature rejection risk for a LISTED submission

| Feature | Risk | Basis |
| --- | --- | --- |
| Audio download (`downloads.download` of the direct googlevideo URL) | **HIGH** — near per-se rejection | AUP IP/legality (§2.1) + US-law (§2.3), reinforced by the 2026 §1201 rolling-cipher ruling; AMO's downloader-removal history. The single biggest driver. |
| Remote **rescue-config + "scriptlet engine"** | **HIGH** (structural) | Source-code guide bans control-flow decisions based on external resources and concealing functionality in fetched data (§4.2). Signed + declarative-only helps but a literal reviewer reads "engine consuming external scriptlets" as remote-code-by-proxy. **This risk persists on unlisted too** (enforced at signing). |
| Audio-only via ANDROID_VR credentialless re-fetch → `<video>.src` | **MED-HIGH** | Playback (not saving) is far more defensible, but the client-spoof/circumvention mechanism can still draw a §2.3 objection. Credentialless + no-persistence + fallback are the defense. |
| `data_collection_permissions: none` accuracy | **MED** | External calls to sponsor.ajay.app / lrclib.net / googlevideo convey "what the user is watching"; reviewers may deem `none` inaccurate (§6.2.1). `strict_min_version:128` also means the key is ignored on FF 128-139. |
| Source-code submission (WXT/esbuild bundle) | **MED** (procedural) | Bundled output requires un-bundled sources + lockfile + pinned toolchain; reviewer rebuild must diff-clean. Low if prepared. |
| Broad `*.googlevideo.com` + `webRequestBlocking` | **MED** (justifiable) | Legitimate under least-privilege but guarantees full manual review. |
| Telemetry-block, ad-block *concept*, segment-skip, QoL, loudness/EQ, lyrics (opt-in), background play | **LOW** | Content blocking is permitted (only *injecting* ads is restricted); each surprising behavior is opt-in + disclosed. AMO has no single-purpose rule. |

Verdict: **as specified, a LISTED submission is HIGH RISK (near-certain rejection)**, driven by the
download feature and the remote rescue-config. With both removed/hardened it becomes
accept-with-conditions.

Key platform fact: an **unlisted** self-hosted XPI **does not auto-update on Firefox for Android**
(sideloaded updates are ignored on mobile). So going unlisted-only forfeits silent updates on the
exact platform the product targets — severe for a tool that breaks whenever YouTube changes.

## Decision (proposed)

**Hybrid, two-build distribution from one source tree** (extends ADR-0002's two-identity model):

1. **Listed "clean" build → AMO** — the Android auto-update + discoverability channel. Excludes the
   audio **download** feature; ships ad/scriptlet rules **in-package** only (no runtime remote config
   that steers control flow); declares an **honest data taxonomy**; includes reviewer notes + source
   + pinned toolchain for a diff-clean rebuild.
2. **Unlisted "full" build → self-hosted signed XPI** — desktop power users; adds download and any
   remote-config features; accepts manual updates on Android.
3. **Regardless of channel:** harden the rescue-config to strictly *parameterize fixed in-package
   code paths* (never select which logic runs) and rename the "scriptlet engine" to what it is (a
   bounded in-package declarative interpreter with a fixed op allowlist) — the remote-code ban
   applies to unlisted too.

### Consequences

- Keeps Android auto-update (via the listed-clean build) — the platform we care about.
- Preserves download + aggressive remote-config for desktop via the unlisted-full build.
- Requires a build-time feature flag to produce the two variants, honest `data_collection_permissions`
  wiring, and the rescue-config hardening. These are **new scope** beyond the current tree.

## Owner decision required

This reverses "everything in one listed v1." Options:
- **(A) Adopt the hybrid split** (recommended): listed-clean + unlisted-full.
- **(B) Unlisted-only full build:** ship everything, desktop-first, accept manual Android updates.
- **(C) Attempt a listed all-in-one anyway:** high rejection risk; not recommended.

No submission, signing, or credential step will be taken without the owner's go-ahead and AMO API
credentials.

## References

- AMO policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Source-code submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Acceptable Use Policy: https://www.mozilla.org/en-US/about/legal/acceptable-use/
- Data-collection consent (`data_collection_permissions`): https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- Unlisted + Android auto-update limitation: https://extensionworkshop.com/documentation/publish/distribute-sideloaded-extensions/ · https://bugzilla.mozilla.org/show_bug.cgi?id=1849605
- 2026 DMCA §1201 rolling-cipher ruling: https://news.slashdot.org/story/26/02/05/1924252/
- Relates to [ADR-0002](0002-separate-firefox-distribution-identities.md).
