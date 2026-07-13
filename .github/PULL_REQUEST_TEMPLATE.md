<!--
Thanks for contributing. Keep the PR focused, and remove sections that do not apply.
Read AGENTS.md and CONTRIBUTING.md first. Do not attribute work to an AI/LLM/vendor.
-->

## Summary

<!-- What does this change do, and why? Link the related issue(s). -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] YouTube breakage fix
- [ ] Refactor / tooling / docs

## Checklist

### Documentation (No spec, no code)

- [ ] Spec created or updated in `docs/specs/`
- [ ] ADR added in `docs/adrs/` (for a significant or hard-to-reverse decision), or N/A
- [ ] Architecture updated in `docs/architecture/` if structure or a data flow changed, or N/A
- [ ] Handoff recorded in `docs/history/`

### Tests

- [ ] Unit tests added or updated (real `src/` modules, 90% coverage floor holds)
- [ ] Hermetic bench case added/updated for any runtime-facing change (`npm run test:bench`), or N/A
- [ ] A bug fix includes a test that fails before the fix

### Gate (all green locally: `npm run validate`)

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm test`
- [ ] `npm run build` (Firefox MV2) and `npx web-ext lint --source-dir=.output/firefox-mv2`
- [ ] `npm run build:mv3` (Firefox MV3 capability artifact)

### Invariants (see AGENTS.md)

- [ ] Logged-out only; no dependency on the user's YouTube login
- [ ] All fetches are credentialless (`credentials: "omit"`)
- [ ] `PlayerHandle` remains the sole `<video>.src` writer
- [ ] Live / Kids / age-restricted / auth-required and any failure fall back to native playback

### Hygiene

- [ ] No AI / LLM / assistant / vendor attribution anywhere (commits, code, docs); no em dashes

## Notes for reviewers

<!-- Anything worth calling out: tradeoffs, follow-ups, manual verification performed. -->
