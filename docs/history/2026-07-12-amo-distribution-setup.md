# Handoff: AMO credentials and distribution decisions

## Date

2026-07-12

## Summary

The owner set up AMO Developer Hub API access and made the production distribution decision:
AMO-listed production under a **single** permanent add-on ID, plus an unlisted signed beta
channel on the same ID, published to AMO on demand. This handoff records the credential setup
and the decision; the formal record is ADR-0006.

## Key changes

- **AMO API credentials.** A JWT issuer and secret were created on the AMO Developer Hub and
  stored as the GitHub repo secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. `scripts/release.sh`
  and `.github/workflows/release.yml` already consume these two names for `web-ext sign`; no new
  secret is needed for the on-demand listed-publish workflow.
- **Distribution decision (ADR-0006).**
  - Single permanent add-on ID for every channel: **`{580efa7d-66f9-474d-857a-8e2afc6b1181}`**.
  - **Production = AMO `listed`** (no `update_url`); AMO is the sole update authority, giving
    hands-off auto-update on Firefox desktop and Firefox for Android.
  - **Beta = AMO `unlisted`** on the same ID at a distinct pre-release version, installed by
    hand for desktop and Android testing.
  - **Publish to AMO on demand** (a manual run after hands-on testing), never automatically on a
    tag or release.
  - The source-code archive attached to a listed submission is an AMO reviewer-rebuild artifact,
    not a user download.
  - This **supersedes ADR-0002** (two identities to one) and **refines ADR-0004** (Firefox-only
    CD retained; production distribution moves from self-hosted `updates.json` to the AMO
    listing). Grounded in `docs/research/19-amo-channels-and-ondemand-publish.md`.

## Testing

Decision and credential setup only; no code change in this handoff. The listed-publish workflow
and the ID wiring are follow-ups (see Next steps).

## Next steps (owner-gated)

- Wire `{580efa7d-66f9-474d-857a-8e2afc6b1181}` across `wxt.config.ts`, `release.yml`, and the bench
  `ADDON_ID` pin in lockstep, replacing the `youtube-audio@local` placeholder.
- Add an on-demand `workflow_dispatch` workflow that builds the listed-clean variant (no
  `update_url`) and runs `web-ext sign --channel=listed` with the existing secrets; see the
  design in research 19, section 5.
- Complete the ADR-0003 AMO policy preflight (honest `data_collection_permissions`, source
  submission) and a real-device Firefox for Android test before the first listed publish.
