# Handoff: GitHub Release on merge

## Date

2026-07-13

## Summary

CI now publishes an unsigned, versioned Firefox XPI to a latest GitHub Release only after every
executable gate succeeds on a push merge to `master`. It then increments the final numeric segment
of the four-part Firefox version and pushes the bump with `[skip ci]`.

## Key changes

- Added `release-on-merge` to `.github/workflows/ci.yml`, dependent on `validate`, `build-mv3`,
  `bench`, and `matrix`.
- Serialized release runs with a non-cancelling concurrency group and disabled workflow-level
  supersession cancellation for `master` pushes so an in-flight release cannot be interrupted by a
  later merge.
- Made GitHub Release creation idempotent when either the current Release or tag already exists.
- Kept `package.json` as the sole base-version source and incremented only its final dot-separated
  numeric segment without `npm version`.
- Documented that the GitHub Release XPI is unsigned and archival/manual-only. AMO remains the sole
  signed, auto-updating channel, with listed publishing manual and on demand.

## Verification

- Parse `.github/workflows/ci.yml` as YAML.
- Run `actionlint` when installed.
- Exercise the bump algorithm for `0.0.2.5`, `0.0.2.9`, and `1.2.3.99`.
- Check formatting and inspect the resulting diff.

## Known risk

A branch protection rule or ruleset that disallows direct pushes by `github-actions[bot]` will block
the final version-bump push. Repository settings must allow this workflow identity to update
`master`, or the bump must be moved to an approved pull-request path.
