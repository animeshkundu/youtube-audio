# Firefox Release Guide

YouTube Audio ships to Firefox (desktop and Android) from a **single permanent add-on ID**,
`youtube-audio@animesh.kundus.in`, under the model fixed by
[ADR-0006](docs/adrs/0006-firefox-amo-distribution-and-beta-channel.md):

- **Production** is the AMO **listed** channel. The listed build omits `update_url`; **AMO is the
  sole update authority**, delivering hands-off auto-update on Firefox desktop and Firefox for
  Android. Publishing is **on demand** (a manual run), never automatic on a tag.
- **Beta** is the **same ID** signed **unlisted** at a distinct pre-release version. It is a
  Mozilla-signed XPI installed by hand for desktop and Android testing. It does not auto-update;
  testers reinstall the next signed beta.

Self-hosted distribution (a `SELF_HOSTED_UPDATE_URL` build flag feeding a hosted `updates.json`) is
**retired for production**. AMO is the only update path.

## Prerequisites and owner gates

Before the first listed publish:

1. Complete the S5 AMO policy preflight. Remote code and remotely supplied executable configuration
   remain prohibited.
2. Create AMO Developer Hub API credentials and save the JWT issuer and secret as the GitHub repo
   secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Never commit them.
3. Review `amo-metadata.json` (the first-listing summary, category, and license). It is used only
   for the **first** listed submission; later versions reuse the prior listing metadata.
4. Complete the S4 test on a real Firefox for Android device before publishing an Android-compatible
   listing.
5. (Recommended) Create a GitHub Environment named `amo-production` with a **required reviewer**, so
   the on-demand publish pauses for a human approval click before it can touch AMO. Optionally scope
   `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` to that environment. Optionally protect the `v*` tag
   namespace so only maintainers can create release tags.

## Versioning

`package.json` holds the single **base** version (for example `0.0.2.5`). The clean base is the
production/listed version. A beta build appends a Firefox-toolkit pre-release suffix via the
`BETA_SUFFIX` build env, for example `BETA_SUFFIX=b1` yields the manifest version `0.0.2.5b1`. AMO
rejects hyphens, so the suffix attaches directly (no `-`); valid forms are `a`/`b`/`pre`/`rc` + a
number. The toolkit comparator sorts `0.0.2.5b1` **below** the clean `0.0.2.5`, so the beta never
collides with or supersedes the listed version under the shared ID.

After the executable CI gates pass for every merge push to `master`, CI publishes latest GitHub
Release `v<current version>` with `youtube-audio-<current version>.xpi`, then increments the final
numeric segment in `package.json` and pushes the bump with `[skip ci]`. Existing releases or tags are
skipped cleanly before the bump, so the first run is safe if `v0.0.2.5` already exists. The GitHub
Release XPI is **unsigned** and is only for archival and manual or temporary installation. It does
not replace either Mozilla-signed path below: AMO remains the signed, auto-updating production
channel, and listed publishing remains manual and on demand.

## Beta channel (unlisted, hand-installed)

`.github/workflows/beta.yml` signs the unlisted beta. It triggers on a **pre-release** version tag
whose name contains the suffix letter (for example `v0.0.2.5b1`; a clean `v0.0.2.5` tag never
triggers it), or on a manual `workflow_dispatch` with the suffix as input. It validates first, then
signs: it derives and validates the suffix, runs `typecheck`/`lint`/`test`, builds with
`BETA_SUFFIX`, asserts the built manifest carries the expected pre-release version, the permanent
ID, and no `update_url` (all **before** signing), runs `web-ext lint`, signs with
`web-ext sign --channel=unlisted`, re-checks the signed XPI (valid signed zip; bundled manifest
version/id/no-`update_url`), uploads the signed XPI as a workflow artifact, and attaches it to a
GitHub **prerelease**.

To cut a beta:

```bash
# Local gates first
npm run typecheck && npm run lint && npm test && npm run build && npm run test:bench

# Then tag a pre-release version and push it (letter suffix, no hyphen):
git tag v0.0.2.5b1
git push origin v0.0.2.5b1
```

Download the signed XPI from the resulting GitHub prerelease and install it by hand on Firefox
desktop and Firefox for Android to test. Local beta signing is also available with
`BETA_SUFFIX=b1 npm run release:sign` (see `scripts/release.sh`).

## Production (AMO listed, on demand)

`.github/workflows/publish-amo.yml` is `workflow_dispatch`-only; it has **no** push/tag/release/
schedule trigger, so tagging or releasing never publishes to AMO. Run it manually after a beta is
hand-tested:

1. Tag the tested commit with the **clean** version and push it: `git tag v0.0.2.5 && git push
origin v0.0.2.5`. (The tag itself triggers nothing.)
2. Run the **Publish to AMO (listed)** workflow, with `ref = v0.0.2.5`. Use `dry_run = true` first
   for a local rehearsal (gates + build + `web-ext lint` + source archive, no AMO contact).
3. If the `amo-production` environment is configured, approve the deployment.

The workflow checks out the exact ref, asserts `ref == v<package.json version>` and that the version
is clean (a beta suffix can never reach the listed channel), runs the gates and build (no
`BETA_SUFFIX`, so the clean version with no `update_url`), asserts the built manifest is clean
(version, permanent ID, no `update_url`), runs `web-ext lint`, packages a reviewer **source
archive** with `git archive` (only tracked files, so `node_modules` / `.output` / `dist` are
excluded), then runs `web-ext sign --channel=listed --upload-source-code=<source.zip>
--amo-metadata=amo-metadata.json --approval-timeout=0`. AMO hosts the signed XPI; there is no GitHub
Release asset on the listed path. The source archive is a review artifact for AMO's un-minified
source requirement, never shipped to users.

A dry run never contacts AMO, so it cannot catch AMO-side problems (credentials, metadata
acceptance, developer-agreement state, first-listing eligibility). The first real listed submission
is an irreversible operation gated on the owner preconditions above.

## Compatibility floor

Both channels retain `browser_specific_settings.gecko.strict_min_version: "128.0"` and
`gecko_android: {}`. The floor accounts for Mozilla's March 2025 signing-root transition: current
signatures and updates require Firefox 115+ ESR or 128+ non-ESR. The project deliberately targets
128+.

## Rollback

Never reuse a rejected or already-signed version number. Because the beta and the listed version
share one ID, keep each beta suffix ahead of the last one and never regress the clean base below a
published listed version. Roll back by publishing a new, higher clean version containing the prior
known-good code; Firefox update ordering will not install a lower version as an automatic rollback.
