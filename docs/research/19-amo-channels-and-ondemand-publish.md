# AMO Channels and an On-Demand Publish Flow

> **Decision update:** [ADR-0006](../adrs/0006-firefox-amo-distribution-and-beta-channel.md)
> adopted the **single permanent add-on ID** `{580efa7d-66f9-474d-857a-8e2afc6b1181}` (shape (a) in
> section 3), not the two-identity split this brief leaned toward. Production is AMO **listed**
> and beta is the **same ID** signed **unlisted** at a distinct pre-release version; the
> self-hosted `updates.json` path is retired for production. The channel analysis below stands as
> the grounding research; the identity choice was resolved by ADR-0006.

Research brief for **YouTube Audio** (Manifest V2, Firefox desktop + Firefox for
Android). The owner just created AMO Developer Hub API credentials (JWT issuer +
secret), stored as the GitHub repo secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`,
and wants to **publish to AMO on demand** (a manual `workflow_dispatch`, run only
after hands-on testing), never automatically on every release.

This doc answers three things: (a) whether AMO has alpha/beta/prod-style channels
and how to use them, (b) a recommended channel strategy consistent with ADR-0002
/ 0003 / 0004, and (c) a concrete design for an on-demand publish workflow. It is
research + design only; it does not implement the workflow.

All claims are grounded in current (2025-2026) Mozilla documentation
(extensionworkshop.com, addons-server API docs) plus two named real-world add-on
patterns. Doc URLs are in [References](#references). Freshness: verified
**2026-07-11**.

---

## Executive summary

1. **AMO has exactly two distribution channels: `listed` and `unlisted`.** There
   is **no alpha/beta/prod channel, no pre-release channel, and no
   percentage-based staged rollout** for a listed add-on. Mozilla states this
   plainly: *"Pre-release channels are not supported on addons.mozilla.org
   (AMO)."*
2. **The old AMO "beta versions" / "Development Channel" feature is gone.** AMO
   once let a single listing carry opt-in beta versions under a "Development
   Channel"; that was sunset years ago (around 2019) as part of simplifying the
   submission workflow. It is not coming back and is not the modern pattern.
3. **The modern beta pattern is self-hosting.** Mozilla's own guidance is to sign
   a beta build for **self-distribution** and give it its **own `update_url`**,
   so only beta testers get beta updates while the release audience keeps
   updating from its normal channel. Beta and release can share one add-on ID
   (differentiated by `update_url`), **or** be split into two listings/IDs.
4. **Real add-ons use two separate listings for a public beta.** uBlock Origin
   ships a distinct **"uBlock Origin Dev Build"** as a separate AMO listing with
   a **different add-on ID** (`uBlock0@raymondhill.net` for stable vs a distinct
   dev ID), precisely because a single AMO listing cannot carry a built-in beta
   channel.
5. **Recommended mapping for this project (no new identities needed):**
   **beta/testing = the existing unlisted, self-hosted channel** (what
   `release.yml` already produces on a `v*` tag); **production = a new AMO-listed
   channel** published on demand. This is exactly ADR-0002's two-identity model,
   and the listed channel is the **only** way to get hands-off Firefox for
   Android auto-update (ADR-0002 / 0004).
6. **On-demand publish = a separate `workflow_dispatch` workflow** (for example
   `.github/workflows/publish-amo.yml`) that checks out a chosen tag, builds the
   AMO-listed variant, and runs `web-ext sign --channel=listed` with the existing
   `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`. Because it has **no `push` / tag
   trigger**, publishing to AMO can never happen automatically on a release. The
   current `release.yml` (tag-triggered, `--channel=unlisted`, self-hosted XPI)
   stays exactly as it is.

---

## 1. The two AMO channels: listed vs unlisted

AMO models distribution as two channels per add-on. Every version is submitted to
one of them. The channel is chosen at upload/sign time and is the single most
important distribution decision.

| | **Listed** | **Unlisted (self-distribution)** |
|---|---|---|
| Meaning | Public on addons.mozilla.org; discoverable and installable from AMO and the in-Firefox Add-ons Manager | *"cannot be publicly viewed or installed from AMO"*; you host the signed `.xpi` yourself |
| Signing | Mozilla-signed via AMO (automated validation, then signed) | Mozilla-signed via AMO (same automated validation, then signed) |
| Review | Automated validation before signing; *"subject to be manually reviewed at any time"* per Add-on Policies. First listed version enters the public catalog and may draw a manual policy review | Same automated validation; also *"subject to be manually reviewed at any time"*, but no listing metadata / catalog placement |
| Auto-update, **desktop** | **Yes, AMO-managed.** *"updates to installed copies are handled automatically by Firefox"* with no `update_url` | Only via your own `update_url` -> `updates.json` (this project's `release.yml` self-hosted mechanism) |
| Auto-update, **Android** | **Yes, AMO-managed** (Fenix polls AMO ~24h) | **No.** A file-installed / sideloaded XPI does not auto-update on Android at all (research 07; ADR-0002) |
| `update_url` in manifest | Must be **absent** (AMO manages updates for listed copies) | Present (points at your self-hosted `updates.json`) |
| Suited for | The production, discoverable, hands-off-updating audience (incl. Android) | *"a beta version"* / a *"limited audience"*; desktop power users; this project's self-hosted desktop channel |
| `web-ext` invocation | `web-ext sign --channel=listed` | `web-ext sign --channel=unlisted` (what `scripts/release.sh` runs today) |

Key facts, verbatim from Mozilla docs:

- Signing is mandatory: *"Extensions and themes need to be signed by Mozilla
  before they can be installed in release and beta versions of Firefox."* There
  is no offline / self-signing path; **both** channels sign through AMO.
- `web-ext sign` (v8+) *"creates a listing for your extension on AMO if
  `--channel` is set to `listed` ... adds a version to a listed extension if the
  `--channel` is set to `listed` ... downloads a signed copy ... if `--channel`
  is set to `unlisted`."* Note the asymmetry: for **listed** there is nothing to
  download and host (AMO hosts it); for **unlisted** you get a signed XPI back to
  host yourself.
- `--channel` *"is required."* Accepted values are exactly `listed` and
  `unlisted`.

---

## 2. Alpha / beta / prod: does AMO have them? (No.)

**Direct answer: AMO does not have alpha/beta/prod distribution channels, a
pre-release channel, or a staged (percentage) rollout for listed add-ons.** The
only axis AMO exposes is `listed` vs `unlisted`.

Evidence:

- Mozilla's dedicated page "Distribute pre-release versions" opens with:
  *"Pre-release channels are not supported on addons.mozilla.org (AMO)."*
- The "Submitting an add-on" flow offers only two paths, *"On this site"*
  (listed) and *"On your own"* (self-distribution). No beta/alpha option, no
  rollout percentage, no phased-release control appears anywhere in the
  submission UI or the External API.
- The AMO External API upload endpoint takes a `channel` form field whose value
  *"can be either `unlisted` or `listed`"* and nothing else. There is no
  `rollout`, `percentage`, `track`, or `prerelease` parameter.

### What existed before and what replaced it

AMO historically had a **"beta versions" / "Development Channel"** feature: a
single listing could carry opt-in beta versions shown under a separate section,
and testers could choose to install them. Mozilla **retired that feature** (around
2019) while simplifying the submission workflow, citing low usage and user
confusion. Its documented replacement is **self-hosting a signed beta build**.

### The modern beta pattern (Mozilla's recommendation)

From "Distribute pre-release versions", the supported way to run a beta today:

1. In the beta build's `manifest.json`, *"specify the location of your update
   manifest"* so *"your beta users will receive future updates."* If the release
   channel is also self-hosted, use *"a different update URL for the beta
   channel."*
2. Sign the beta *"using the self-distribution workflow"* or *"use web-ext to
   sign the extension"*; if the release version is listed on AMO you must
   *"define which channel you are signing with web-ext"* (i.e. `--channel`).
3. *"host the .xpi file on a web property that you own, such as a Github
   repository"* and *"Direct your beta users to install the extension from the
   web property."*
4. Updates then flow only to beta testers: *"only beta users will get these
   updated versions"*; the release channel is updated *"separately."*
5. To sunset a beta, ship *"a final beta version without an update URL"* (if the
   release is listed) so Firefox migrates those users back to the AMO listing
   *"within a few days."*

The takeaway: **"beta" on Firefox is a self-hosted, `update_url`-driven concept,
not an AMO feature.** That is exactly the machinery this repo already built for
its unlisted self-hosted channel.

### One related 2025 change (not a rollout feature)

Effective **2025-08-04**, Mozilla lifted restrictions on **closed-group
(restricted-access) extensions**, allowing a listing to be published to a defined
set of users rather than fully public. This is a *private-audience* capability,
not a staged/percentage rollout and not a beta channel, but it is the closest
AMO-native option if the owner ever wants a **private tester group** on the
listed channel. It does not change the core answer.

---

## 3. One add-on ID vs separate listings

Two valid shapes exist for "a beta audience and a stable audience":

**(a) One add-on ID, differentiated by `update_url`.** Mozilla's pre-release page
uses a single ID: the release audience updates from its normal channel, the beta
audience installs a self-hosted build whose `update_url` points at a separate
beta `updates.json`. One GUID can carry both a listed channel (no `update_url`)
and unlisted self-distributed versions (with `update_url`); the two never collide
because a *listed version must not contain `update_url`* and an *unlisted version
supplies its own*. The risk is operational: it is easy to accidentally submit an
`update_url`-bearing build to the listed channel, which AMO rejects for that
channel.

**(b) Two separate listings / IDs.** uBlock Origin ships **"uBlock Origin Dev
Build"** as a **separate AMO listing with a different add-on ID** from stable
(`uBlock0@raymondhill.net`). Users can even run both side by side because the IDs
differ. This is the pragmatic real-world pattern for a *public* beta on AMO,
since a single listing has no built-in beta channel.

### Reconciling with ADR-0002

ADR-0002 already commits this project to **two permanent, distinct identities**
from one source tree:

1. an **unlisted, self-hosted desktop** channel (permanent ID +
   `SELF_HOSTED_UPDATE_URL`), and
2. an **AMO-listed** channel (a different permanent ID, no `update_url`).

ADR-0002 phrases the constraint as *"AMO submission does not permit one add-on
identity to combine a listed channel with a self-hosted update URL."* Precisely,
the hard rule is that **a single version/build cannot be both AMO-listed and
self-hosted-auto-updating** (a listed version must omit `update_url`). AMO does
technically allow one GUID to hold both a listed and an unlisted channel, so
shape (a) is not physically impossible; but the project deliberately keeps the
two as **separate identities** so the default build stays listing-eligible (no
`update_url`) and an accidental `update_url` can never block or get rejected on
the listed submission. That decision maps beta/prod onto channels cleanly and is
the model this doc builds on.

**A useful property of the two-ID split:** because the beta (unlisted) and prod
(listed) are *different add-ons* on AMO, the **same version string** `vX.Y.Z` can
be signed unlisted for testing and later submitted listed for production with **no
"version already exists" conflict** (AMO scopes "already signed" per add-on ID).
Under a single shared ID you would have to bump the version between the beta sign
and the prod submit. The split makes "test the exact bytes, then publish that
version to AMO" straightforward.

---

## 4. Recommended channel strategy for YouTube Audio

Map the informal "beta -> prod" progression onto the two-identity model. **No
third identity and no new mechanism are required.**

| Stage | AMO channel | Identity | How it ships | Auto-update | Who |
|---|---|---|---|---|---|
| **Beta / testing** | `unlisted` (self-distribution) | the self-hosted desktop ID (ADR-0002 #1) | **Already automated:** `release.yml` on a `v*` tag signs unlisted and publishes the signed XPI + `updates.json` to GitHub Releases | Desktop via `update_url`; Android manual re-install | Owner + desktop power users; the pre-promotion test build |
| **Production** | `listed` | the AMO-listed ID (ADR-0002 #2) | **New on-demand `workflow_dispatch`** (this doc, section 5): `web-ext sign --channel=listed` | AMO-managed on **desktop and Android** | The public / Android users who need hands-off updates |

Why this is the right fit:

- It reuses what exists. The unlisted self-hosted tag pipeline is exactly a
  "beta/testing" channel in Firefox terms (self-hosted, `update_url`-driven).
  Nothing new is needed for the "beta" side.
- Production on the **listed** channel is the **only** path to hands-off Firefox
  for Android auto-update (ADR-0002 / 0004; research 07). That is the platform
  the product targets, so the listed channel is the point of the whole exercise.
- It honors ADR-0003. The **listed** build must be the "clean" variant: honest
  `data_collection_permissions`, and (if ADR-0003's hybrid split is adopted)
  **download excluded** from the listed build, while the unlisted self-hosted
  build keeps the full feature set. The on-demand workflow therefore builds the
  *listed-clean* variant, not the same artifact as the tag pipeline. (ADR-0003 is
  still "Proposed"; the workflow's build step is where that feature flag lands
  once the owner decides.)
- It avoids a rollout illusion. Since AMO has no percentage rollout, "staged"
  here means **manual promotion**: the owner tests the unlisted build, then
  chooses to publish that version to the listed channel. The human gate *is* the
  staging.

**Optional future extension (only if wanted):** to give *testers* a hands-off
auto-updating build on **Android** before promoting to the stable listing, the
only AMO-native route is a **separate "Dev Build" listing** (uBlock Origin
pattern) or a **closed-group listing** (2025 restricted-access capability) under a
third ID. This is extra scope and extra AMO review surface; recommend deferring
it unless Android-tester auto-update becomes a hard requirement.

---

## 5. On-demand publish workflow design (design only, not implemented)

Goal: a **manual** GitHub Action that publishes a specific, already-tested,
already-tagged version to the AMO **listed** channel, using the existing repo
secrets, and that **can never fire on its own**.

### 5.1 How it differs from today's `release.yml`

| | `release.yml` (exists) | `publish-amo.yml` (proposed) |
|---|---|---|
| Trigger | `on: push: tags: ['v*']` (automatic) | `on: workflow_dispatch` only (**manual**) |
| Channel | `web-ext sign --channel=unlisted` | `web-ext sign --channel=listed` |
| Identity / build | self-hosted ID **with** `SELF_HOSTED_UPDATE_URL` | AMO-listed ID, **no** `update_url`; listed-clean variant (ADR-0003) |
| Output | signed XPI + `updates.json` uploaded to GitHub Releases (self-host) | version submitted to AMO; **AMO hosts the XPI** (no Release asset, no `updates.json`) |
| Android auto-update | No (self-hosted) | **Yes** (AMO-managed) |
| Secrets | `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` | **same two secrets**, no new secret needed |

The two workflows are independent files. `release.yml` is untouched; the new file
adds the manual AMO path. Because publishing lives only in a `workflow_dispatch`
workflow, a tag push never publishes to AMO.

### 5.2 Inputs

- `ref` (string, required): the git tag or SHA to publish, for example
  `v0.0.2.5`. The workflow checks this out so it publishes the exact tested
  commit, not `HEAD`. Optionally validate that it is an annotated `v*` tag.
- `channel` (choice: `listed` | `unlisted`, default `listed`): normally
  `listed` (the whole purpose). Keeping `unlisted` as an option lets the same
  manual button re-sign a self-hosted build if ever needed, but listed is the
  intent.
- `dry_run` (boolean, default `false`): when true, run gates + build +
  `web-ext lint` but skip the sign/submit call. A safe rehearsal.

### 5.3 Steps

1. **Checkout** at `inputs.ref` (fetch tags/history so the ref resolves).
2. **Setup Node 20**, `npm ci`.
3. **Echo + guard the version**: read `version` from `package.json` (single
   source of truth per ADR-0004) and, if `inputs.ref` is a `vX.Y.Z` tag, assert
   `ref == v${version}`. Print "Publishing <version> to AMO <channel>".
4. **Gates** (cheap re-run for safety): `npm run typecheck && npm run lint &&
   npm test`.
5. **Build the AMO-listed variant.** Set the **AMO-listed** `FIREFOX_EXTENSION_ID`
   and **do not** set `SELF_HOSTED_UPDATE_URL` (listed must have no `update_url`).
   If ADR-0003's hybrid split is adopted, also set the "listed-clean" feature
   flag (download excluded). `FIREFOX_EXTENSION_ID=<amo-listed-id> npm run build`.
6. **`web-ext lint`** the built `.output/firefox-mv2`.
7. **Sign + submit to AMO** (skip if `dry_run`):
   ```
   npx web-ext sign \
     --source-dir=.output/firefox-mv2 \
     --channel=${{ inputs.channel }} \
     --api-key=$AMO_JWT_ISSUER \
     --api-secret=$AMO_JWT_SECRET \
     [--amo-metadata=amo-metadata.json]   # first listed version only
   ```
   - For **listed**, `web-ext sign` creates the listing on the first version and
     adds a version thereafter. There is no signed XPI to download or host: AMO
     hosts it. The step's success = "version accepted by AMO."
   - The **first** listed version requires `--amo-metadata` (a JSON file with
     `categories`, `summary`, and the version `license`; translated fields need
     at least one locale). Later versions do not require it and reuse the prior
     license.
8. **No GitHub Release / `updates.json` step** on the listed path (that machinery
   belongs to the self-hosted unlisted flow only). Optionally capture and print
   the AMO version/submission URL for the owner.

### 5.4 Secrets and safety

- Uses the already-created `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` repo secrets. No
  new secret. `web-ext` builds the short-lived HS256 JWT from them.
- **Stays manual by construction:** the only trigger is `workflow_dispatch`. No
  `push`, no `schedule`, no `release` event. Nothing about tagging or releasing
  invokes it. Optionally scope the secrets to a protected **GitHub Environment**
  (for example `amo-production`) with a required reviewer, so even the manual run
  needs an approval click before it can touch AMO.
- Concurrency: a single-flight group (like `release.yml`) with
  `cancel-in-progress: false`, so a submit is never interrupted mid-flight.

### 5.5 Two preconditions the workflow depends on (owner-gated, not code)

These are ADR-level gates that must be settled before the first real listed
publish; the workflow *design* does not remove them:

1. **A permanent AMO-listed `FIREFOX_EXTENSION_ID`.** ADR-0006 finalized this as the single
   permanent ID `{580efa7d-66f9-474d-857a-8e2afc6b1181}` (wired in `wxt.config.ts`, the workflows, and
   the bench `ADDON_ID`). An installed ID is permanent (ADR-0002).
2. **AMO policy readiness** (ADR-0003): honest `data_collection_permissions`, the
   listed-clean feature flag if adopted, and **source-code submission** for the
   WXT/esbuild bundle (un-minified sources + pinned toolchain for a diff-clean
   reviewer rebuild).

### 5.6 Alternative: direct AMO API instead of web-ext

`web-ext sign --channel=listed` is the simplest path, but it does not upload the
**source-code** archive that a listed review of a bundled build requires. If that
must be automated, call the External API directly instead of `web-ext`:

1. `POST /api/v5/addons/upload/` with multipart `upload=<xpi>` and
   `channel=listed`; poll `GET /api/v5/addons/upload/<uuid>/` until `valid` /
   `processed`.
2. `POST /api/v5/addons/addon/<guid>/versions/` with the upload `uuid` (or
   `PUT /api/v5/addons/addon/<guid>/` to create-or-add-version); attach the
   source archive via the same versions endpoint's `source` multipart field.
3. Authenticate every request with the `Authorization: JWT <token>` header built
   from `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` (short-lived HS256, `exp` <= 5 min).

Recommendation: start with `web-ext sign --channel=listed` and attach source via
the AMO web UI for the first submission; move to the direct API only if fully
automated source upload becomes necessary.

---

## References

Mozilla official docs (Extension Workshop / addons-server API), verified
2026-07-11:

- Signing & distribution overview (listed vs unlisted, signing mandatory) —
  https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Submitting an add-on ("On this site" vs "On your own") —
  https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- **Distribute pre-release versions** ("Pre-release channels are not supported on
  addons.mozilla.org (AMO)"; the self-hosted beta pattern) —
  https://extensionworkshop.com/documentation/publish/distribute-pre-release-versions/
- web-ext command reference (`sign`, `--channel=listed|unlisted`, `--api-key` /
  `--api-secret`, `--amo-metadata`) —
  https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- AMO External API - add-on upload / version create (`POST /api/v5/addons/upload/`
  with `channel` = `unlisted`|`listed`; `POST /api/v5/addons/addon/<guid>/versions/`) —
  https://mozilla.github.io/addons-server/topics/api/addons.html
- AMO External API - authentication (JWT `iss`/`jti`/`iat`/`exp`,
  `Authorization: JWT`) —
  https://mozilla.github.io/addons-server/topics/api/auth.html

Real-world patterns and history (corroboration):

- uBlock Origin Dev Build - a **separate AMO listing** with a distinct add-on ID
  from stable —
  https://addons.mozilla.org/en-US/firefox/addon/ublock-origin-dev-build/
- AMO "beta versions" / Development Channel sunset (simpler submission workflow) —
  https://blog.mozilla.org/addons/2019/09/20/simpler-submission-workflow-coming-soon-to-amo/
- Add-on Policies (current canonical policy set; closed-group / restricted-access
  extensions permitted per the 2025 update effective 2025-08-04) —
  https://extensionworkshop.com/documentation/publish/add-on-policies/
  Corroboration of the 2025-08-04 closed-group change —
  https://alternativeto.net/news/2025/6/mozilla-updates-add-on-policies-on-amo-and-lifts-restrictions-on-closed-group-extensions/

Project docs this reconciles with:

- `docs/adrs/0002-separate-firefox-distribution-identities.md` (two identities)
- `docs/adrs/0003-amo-distribution-preflight.md` (listed policy preflight, hybrid split)
- `docs/adrs/0004-multi-browser-cd.md` (Firefox-only CD; listed = Android auto-update)
- `docs/research/07-distribution-signing-updates.md` (signing, self-hosted updates, Android)
- `.github/workflows/release.yml`, `scripts/release.sh`, `RELEASE.md`, `wxt.config.ts`
</content>
</invoke>
