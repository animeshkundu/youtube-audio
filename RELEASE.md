# Firefox Release Guide

YouTube Audio has two deliberately separate distribution channels. Desktop self-hosting uses an **unlisted** Mozilla-signed XPI with `update_url`. Hands-off Firefox for Android updates require a separate **AMO-listed** add-on. A single Gecko add-on identity cannot be both AMO-listed and submitted with a self-hosted `update_url`, so each channel needs a permanent, distinct `FIREFOX_EXTENSION_ID`.

## Prerequisites and user gates

Before the first release:

1. Complete the S5 AMO policy preflight. Remote code and remotely supplied executable configuration remain prohibited.
2. Create AMO Developer Hub API credentials and save the JWT issuer and secret as `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Add encrypted repository secrets with the same names for GitHub Actions. Never commit them.
3. Choose permanent, distinct Gecko IDs for the self-hosted and AMO-listed channels. The checked-in `youtube-audio@local` value is a template and must be replaced for real distribution.
4. Complete the S4 test on a real Firefox for Android device before publishing an Android-compatible listing.
5. Submit the Android channel to AMO as **listed** and complete any review. This cannot be automated safely by the repository workflow.

## Local unlisted signing

Set the self-hosted channel identity and HTTPS update URL, then sign:

```bash
export AMO_JWT_ISSUER='user:...'
export AMO_JWT_SECRET='...'
export FIREFOX_EXTENSION_ID='youtube-audio-selfhost@your-domain.example'
export SELF_HOSTED_UPDATE_URL='https://example.github.io/youtube-audio/updates.json'
npm run release:sign
```

The script builds `.output/firefox-mv2`, runs `web-ext lint`, submits it with `web-ext sign --channel=unlisted`, and copies the Mozilla-signed artifact to `dist/youtube-audio-<version>-signed.xpi`. Missing credentials fail before contacting AMO. AMO rejects an already-submitted version, so bump `package.json` and `wxt.config.ts` together before signing.

## Tagged GitHub release

`.github/workflows/release.yml` runs on `v*` tags with Node 20. It installs locked dependencies, runs typecheck, lint, unit coverage, the MV2 build, and `web-ext lint`, then signs unlisted through the repository secrets. The workflow verifies that `vX.Y.Z` matches the package version, computes the exact signed XPI's SHA-256 digest, generates `dist/updates.json`, and publishes the signed XPI before the update manifest as GitHub Release assets.

Before enabling the workflow for production, replace its template self-hosted ID and Pages URL with the selected permanent values. Create the tag only after all local gates pass:

```bash
npm run typecheck
npm run lint
npm test
npm run test:bench
npm run build
npm run build:mv3
git tag v0.0.2.5
git push origin v0.0.2.5
```

The bench is intentionally optional/non-gating in GitHub Actions because it requires Selenium and Firefox. It remains a required local release check.

## Desktop self-hosted auto-update

The default build contains no `update_url`. Opt in only for the self-hosted desktop artifact:

```bash
FIREFOX_EXTENSION_ID='youtube-audio-selfhost@your-domain.example' \
SELF_HOSTED_UPDATE_URL='https://example.github.io/youtube-audio/updates.json' \
npm run build
```

Publish the signed XPI first. Then publish an `updates.json` based on the checked-in template over HTTPS, replacing:

- the add-on key with the self-hosted build's exact Gecko ID;
- `version` with the XPI manifest version;
- `update_link` with the GitHub Release asset URL;
- `update_hash` with `sha256:` followed by the digest of the exact signed XPI.

Firefox desktop checks this URL periodically and installs higher compatible signed versions. Keep prior update entries when maintaining a long-lived hosted manifest. Do not add the self-hosted `update_url` to default production builds.

## AMO-listed Android auto-update

Firefox for Android does not provide automatic updates for file-installed/self-hosted XPIs. Hands-off Android updates require an AMO listing:

1. Build the default no-`update_url` manifest with the Android channel's distinct permanent `FIREFOX_EXTENSION_ID`.
2. Submit it as a **listed** version through AMO and provide the required metadata and policy declarations.
3. Complete AMO review and install it from AMO on the Android device.
4. Publish later listed versions under that same Android channel ID.

AMO then supplies updates to AMO-installed desktop and Android copies. A manually installed unlisted XPI can still run on Android, but every update must be installed manually.

## Compatibility floor

Both channels retain `browser_specific_settings.gecko.strict_min_version: "128.0"` and `gecko_android: {}`. The floor accounts for Mozilla's March 2025 signing-root transition: current signatures and updates require Firefox 115+ ESR or 128+ non-ESR. The project deliberately targets 128+.

## Rollback

Never reuse a rejected or already-signed version number, change an installed channel's ID, or move an ID between listed and self-hosted distribution. Roll back by publishing a new, higher version containing the prior known-good code. Firefox update ordering will not install a lower version as an automatic rollback.
