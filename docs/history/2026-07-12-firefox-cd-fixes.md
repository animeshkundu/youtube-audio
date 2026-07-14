# Handoff: Firefox-only CD fixes (ADR-0004)

## Date

2026-07-12 (documenting work committed 2026-07-11, `f3cc2c8` and `0a939b0`)

## Summary

Closed the two mechanical gaps ADR-0004 identified in the Firefox-only continuous-delivery
pipeline: the self-hosted desktop `updates.json` had no live endpoint, and the manifest version
was a hardcoded literal independent of `package.json`. Both are fixed. Scope and browsers are
unchanged (Firefox MV2, desktop + Android, from one signed XPI).

## Key changes

- **Single-source version.** `wxt.config.ts` now reads `version` from `package.json` at config
  load instead of a hardcoded literal, so the release tag gate, the packaged manifest, the
  signed XPI filename, and `updates.json` cannot diverge. Verified a default build emits the
  `package.json` version with no `update_url`.
- **Serve `updates.json` via a stable redirect.** `SELF_HOSTED_UPDATE_URL` points at
  `https://github.com/animeshkundu/youtube-audio/releases/latest/download/updates.json`, which
  GitHub serves as a stable redirect to the newest release asset. Chosen over a GitHub Pages
  deploy so there is no extra hosting step and no race with the MkDocs deploy.
- ADR-0004 (`docs/adrs/0004-multi-browser-cd.md`) records the audit, the Firefox-only decision,
  and the implementation status of these fixes.

## Testing

Documented in ADR-0004's implementation-status section: default build emits the correct version
and no `update_url`; the release workflow uploads the XPI before the manifest to avoid a 404
window.

## Superseding note

The self-hosted `update_url` / `updates.json` production path is **now being superseded** by the
AMO-only model in ADR-0006: production moves to the AMO **listed** channel under a single ID
(`{580efa7d-66f9-474d-857a-8e2afc6b1181}`) with **AMO as the sole update authority** for desktop and
Android, and no `update_url` on the listed build. The single-source-version fix stays relevant;
the self-hosted desktop update machinery is retired for production (it may still drive a
desktop-only beta if ever wanted).

## Next steps

- Rewire the release/publish workflows to the ADR-0006 model: drop `SELF_HOSTED_UPDATE_URL` from
  the production build and add an on-demand `workflow_dispatch` AMO listed-publish job. Owner-gated.
- Wire the permanent add-on ID `{580efa7d-66f9-474d-857a-8e2afc6b1181}` across `wxt.config.ts`,
  `release.yml`, and the bench `ADDON_ID` pin in lockstep (currently the `youtube-audio@local`
  placeholder).
