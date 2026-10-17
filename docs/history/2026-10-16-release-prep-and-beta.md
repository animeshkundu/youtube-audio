# Release prep and the v1.1.0b1 beta

**Date:** 2026-10-16

## Summary

Release prep for 1.1.0 is complete and the unlisted beta is signed and published for hand-install.
`package.json` moved 1.0.5 to 1.1.0 (minor; the bump also synced the `package-lock.json` root
version, which had drifted at `0.0.2.5`), the release notes carry the version marker, and PR #104
was marked ready for review. The `v1.1.0b1` tag was pushed on the bump commit only after its CI
and Mobile Hermetic E2E runs were green; the Beta workflow validated, signed, re-verified, and
attached the XPI to a GitHub prerelease. AMO remains the sole update authority; nothing was
submitted to any AMO channel by this work.

## Facts

- Bump commit `d51e4ae` (`Prepare the 1.1.0 release version`): local `npm run validate` green,
  built MV2/MV3 manifests at `1.1.0`, then CI (all gate jobs, six bench lanes, six matrix lanes)
  and Mobile Hermetic E2E green.
- Tag `v1.1.0b1` (lightweight, matching the existing `v1.0.x` tags) points at
  `d51e4ae1349db2a4bbbf5c3228c7dc32e80a39f7`.
- Beta run [`39006682194`](https://github.com/animeshkundu/youtube-audio/actions/runs/39006682194)
  succeeded in 23m31s: gates, hermetic bench, settings matrix, MV2 build with `BETA_SUFFIX`,
  manifest assertions (`1.1.0b1`, permanent ID, no `update_url`), `web-ext lint`, unlisted sign,
  signed-XPI verification, artifact upload, prerelease publish.
- Independent check of the published asset `youtube-audio-1.1.0b1-beta.xpi` (104 KB,
  [prerelease](https://github.com/animeshkundu/youtube-audio/releases/tag/v1.1.0b1)): it carries
  `META-INF/cose.sig`, `cose.manifest`, `mozilla.rsa`, and `mozilla.sf`, and the bundled manifest
  is `{580efa7d-66f9-474d-857a-8e2afc6b1181}` at `1.1.0b1` with no `update_url`.
- Runner pin: every workflow now uses `runs-on: ubuntu-24.04` instead of `ubuntu-latest` (a no-op
  today) because GitHub starts phasing `ubuntu-latest` to Ubuntu 26 on 2026-10-19
  (`actions/runner-images#14748`), inside the soak and publish window. The rationale is recorded in
  `docs/ci-cd.md`.

## Remaining owner steps

- Hand-install the beta from the prerelease on Firefox desktop and Firefox for Android and soak it
  for several days with the local canary recipe recorded in
  `docs/history/2026-10-15-media-client-resilience-visionos.md`.
- Apply the AMO listing edits in the Developer Hub: the refreshed description wording (source:
  `amo-metadata.json`) and the Support site/email fields (see `docs/ci-cd.md`).
- Post the five 1.0.x review replies from `docs/amo-review-replies.md` once 1.1.0 is submitted or
  approved.
- After the soak: merge PR #104, tag `v1.1.0` on the merge commit, run the Publish to AMO workflow
  with `dry_run = true` first, then the real listed submission.

## Follow-ups

- Revisit the runner pin once the Ubuntu 26 migration is validated.
- The beta run carries informational annotations only (Node 20 deprecation on pinned actions and
  the Ubuntu 26 migration notice); no code impact.
