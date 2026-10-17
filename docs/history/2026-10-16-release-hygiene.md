# Release hygiene: metadata wording, AMO replies, GitHub triage, provenance

**Date:** 2026-10-16

## Summary

Closes plan items H1 through H4 ahead of the 1.1.0 submission, plus the bench-instrumentation fix
that unblocked the 2.8 CI run. Three of the four items are repository artifacts; the parts that need
the maintainer's own accounts (posting AMO replies, editing the live AMO listing fields) are
prepared as exact drafts and called out under Follow-ups.

## H1: metadata compliance wording

`amo-metadata.json` and `docs/release-notes/NEXT.md` still claimed the extension "collects nothing"
while the manifest declares `data_collection_permissions.required: ['websiteContent']` - the exact
1.0.3 rejection class. Both now state what actually happens: media requests go to YouTube and its
media servers without cookies, nothing is stored or shared with anyone else, and the optional
SponsorBlock lookup sends a 4-character hash only, only when enabled. The AMO version release notes
in the same file were also refreshed to the final 1.1.0 scope (per-tab control, coexistence, idle
nag, tidy-ups, optional grants, teardown), matching `NEXT.md`. The live AMO listing description
needs the same wording applied by hand (listing edits are independent of any version, per the
plan); the `amo-metadata.json` text is the source for it, and the Support site / email fields are
Developer Hub edits for the same reason.

## H2: AMO review reply drafts

`docs/amo-review-replies.md` carries ready-to-paste replies for the five reviews left on the 1.0.x
line (review IDs, dates, scores, and the published bodies, fetched from the public AMO ratings API
on 2026-10-16). Each reply is factual about what broke (client staleness / the August 2026 player
change, the old ad-filter collision, the broad permission set), says what changed, points at
Settings > Help & feedback for diagnostics, and promises no dates. The maintainer posts them from
the signed-in account once 1.1.0 is submitted or approved; the file can be deleted afterwards.

## H3: GitHub hygiene + support surfaces

- Created the five labels the templates and triage depend on: `dependencies`, `ci`, `triage`,
  `breakage`, `youtube-change`. The issue templates already reference them; they simply did not
  exist, so template-driven labels silently failed.
- Retest/status comments posted on the issues whose fixes are verifiable in the tree: #14 (per-tab
  control ships in 1.1.0, kept open as the tracking issue), #23 (toggle re-arms in place; bench case
  `m1:toggle-off-reclaims-native-in-place`), #12/#21/#33/#37 (narrow host permission set is now the
  code fact), #57/#34 (live streams are deliberately left to native playback; documented non-goal),
  #28/#47 (deferred per-site scoping, YT Music itself ships), #53 (separate scoping axis, not
  planned for 1.1.0). #59 was answered and closed as a usage question.
- Closed the superseded PRs individually with thanks: #84 (fixture activation landed through the
  BENCH-only match approach), #85 and #88 (mobile lane shipped on the RDP path), #95 (site rebuilt
  as the bespoke Astro site), #20 (audio-mode artwork shipped), #38 (narrow YouTube-only permissions
  shipped), #48 (per-site scoping deferred by design; manifest is generated now), #49 and #63
  (README rewritten), #61 (pre-rewrite code path no longer exists). Left open with `triage`: #80
  (download format selector, never landed), #90 and #91 (docs/cleanup for the RDP probe, still
  applicable).
- Labeled all dependabot PRs `dependencies` (workflow bumps also `ci`).
- Support surfaces: Firefox manifests have no `support_url`/`support_email` keys, so the in-package
  surfaces are now `homepage_url` (product site) and `developer` (name + repository) in
  `wxt.config.ts`, which appear in `about:addons`. The real support fields are AMO listing fields
  (Support site -> issue chooser with the breakage template, Support email -> maintainer address);
  they cannot ride `amo-metadata.json` because `web-ext sign` applies add-on-level properties only
  to a first listing, so `docs/ci-cd.md` documents them for the manual publish step.
- The YouTube breakage template now asks for the built-in diagnostics report (Settings > Help &
  feedback > Copy diagnostics) ahead of the console field, so the support destination the listing
  points at routes users to the data the triage actually needs.

## H4: provenance and NOTICE

- `NOTICE` records the third-party sources that informed shipped behavior (SponsorBlock, uBlock
  Origin, yt-dlp) and lists the reference-only projects.
- `docs/provenance.md` is the per-subsystem attestation: source, pinned commit, license, and
  handling for each shipped subsystem, the GPL-3.0-only compatibility reasoning, and the
  closed-source process statement (observable behavior captured as a spec first, implementation
  from the spec only, unverified behaviors excluded). Sources under restrictive terms (ImprovedTube
  custom terms, Iridium non-commercial, proprietary products) contributed no code.

## Bench fix folded in

`runSession` now returns `ytaNodeCount` from the page snapshot. The 2.8 bench case and the matrix
master-gate check both read this field; before the fix the case could never pass and the matrix
check was silently vacuous.

## Safety

Documentation, metadata, and bench instrumentation only. No runtime behavior change beyond the two
new static manifest fields (`homepage_url`, `developer`), which add no permissions. GitHub actions
performed: label creation, issue comments, one issue close, four PR closes with rationale, PR
labels.

## Testing

- `npm run validate` green locally (typecheck, lint, format, unit tests + coverage, MV2 build,
  `web-ext lint` with the new manifest fields, MV3 build).
- The bench fix rides CI: the final `c239c3a` run validated the `ytaNodeCount` assertions on all six
  hermetic bench lanes and all six matrix lanes, green, along with the full validate job, the MV3
  build, and Mobile Hermetic E2E.
- The AMO metadata edit is validated as JSON and depends on `web-ext sign --amo-metadata` at publish
  time.

## Follow-ups

- Maintainer with the AMO account: post the five replies from `docs/amo-review-replies.md`; edit the
  live listing description to the new wording and set the Support site / Support email fields.
- Re-run the residential canary before the release; keep PR #104 as a draft until release prep.
- AMO publish remains the manual `publish-amo.yml` step on the clean tag.
