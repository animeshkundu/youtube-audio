# Handoff: Data-surface minimization

## Date

2026-08-01

## Summary

Reduced the extension's executable third-party data surface after the AMO v1.0.3 rejection while preserving local Android diagnostics and the privacy-preserving SponsorBlock design.

## Changes

- Deleted the retired LRCLIB path end to end: background endpoint and handler, content renderer, MAIN-world metadata event, setting and signal, LRC parser, and dedicated tests. The existing host-permission removal remains intact.
- Removed remote issue delivery from diagnostics: no GitHub issue URL builder or tab-opening UI remains. The closed-schema local log, persistence, redaction, preview, clipboard copy, local Markdown export, refresh, and clear remain.
- Changed `segmentSkipEnabled` to default off. Stored booleans are still normalized directly, so an existing stored `true` remains enabled after upgrade while new installs and missing values use `false`.
- Updated the options copy to name `sponsor.ajay.app` and state that only a 16-bit video hash prefix is sent. The full video ID continues to be matched locally.
- Added ADR-0011, partially superseding only ADR-0005's issue-delivery decision.

## Verification

- Added migration tests for the new-install off default and preservation of stored `true`.
- Updated options tests to lock the explicit SponsorBlock recipient and prefix disclosure.
- Updated diagnostics UI tests to lock local export and the absence of GitHub-opening behavior.
- Typecheck passed during implementation. Final lint, format, and coverage results are recorded in the coordinating handoff after concurrent consent work settles.
