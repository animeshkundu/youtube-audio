# Privacy policy and consent links

## Summary

Updated the public privacy policy to match the AMO resubmission's verified data flows and made that policy directly reachable from both consent surfaces.

## Changes

- Added the hybrid Firefox consent model, revocation behavior, and fail-closed startup guarantee to the public privacy page.
- Added the default-on YouTube thumbnail artwork flow.
- Corrected SponsorBlock to explicit opt-in and off by default for new installs while preserving existing enabled settings.
- Clarified that diagnostics can only be viewed, copied, exported locally, or cleared, are never transmitted, and have no issue reporter.
- Added an August 1, 2026 last-updated date.
- Linked `https://animesh.kundus.in/youtube-audio/privacy/` beside the custom consent page's revocation note and in the options page's permanent Data & consent row.
- Added UI assertions for each link's URL, new-tab target, and `noopener noreferrer` relationship.

## Verification

Run the TypeScript, ESLint, Prettier, and Vitest coverage gates after these changes.
