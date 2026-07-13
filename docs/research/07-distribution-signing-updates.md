# Distribution, Signing & Auto-Update for a Solo-Dev Firefox WebExtension

Research brief for **YouTube Audio** (Manifest V2), reimagined as a personal
one-stop YouTube + YouTube Music tool for **Firefox desktop + Firefox for
Android**, maintained by a **single developer**. Goal: a **permanent,
reliably installable, auto-updating** personal install on both platforms
**without** needing a public AMO listing or passing featured review.

All claims below are grounded in current (2025-2026) Mozilla documentation
(extensionworkshop.com, developer.mozilla.org, addons-server API docs). Doc
URLs are in [References](#references). Freshness: verified **2026-07-11**.

---

## Executive summary

**The hard constraints that shape everything:**

1. **Signing is mandatory** on release/beta Firefox, on **both** desktop and
   Android. You cannot self-sign. Every signature comes from Mozilla via
   addons.mozilla.org (AMO), even for privately distributed add-ons.
2. **Unlisted (self-distribution) signing is automated and fast** (usually
   minutes) and produces a signed `.xpi` you host yourself. No public listing,
   no featured review needed.
3. **Self-hosted auto-update (`update_url` -> your `updates.json`) works on
   desktop but NOT on Firefox for Android.** On Android, only extensions
   **installed from AMO** auto-update — Fenix polls AMO roughly every 24h and
   installs new versions silently (confirmed by Mozilla staff, Jan 2024; there
   is no manual "check for updates" button — Bugzilla #1810177, still open). A
   sideloaded / file-installed XPI on Android has **no auto-update mechanism at
   all** and must be **manually re-installed** to update. (Mozilla staff state
   self-hosted distribution is "not officially supported" on Android, May 2025.
   That `update_url` is *specifically* ignored is inferred — no update path
   exists for file-installed add-ons — but the user-visible outcome, no
   auto-update, is confirmed.)
4. Since the **March 2025 root-certificate expiration**, only **Firefox 115+
   (ESR) / 128+ (non-ESR)** can validate signatures and receive updates. Set
   `strict_min_version` accordingly. (Your own phone/desktop on current Firefox
   are fine.)
5. To be installable on Android at all, the manifest **must** opt in with
   `browser_specific_settings.gecko_android` (an empty object `{}` is enough).
   Our current manifest has no `browser_specific_settings` block, so today it
   would be **desktop-only** even after signing.

**Recommended path (respects "no public listing"):**

- **Desktop:** unlisted-sign the XPI via `web-ext sign --channel unlisted`,
  host the XPI + a hand-tiny `updates.json` on **GitHub Releases + GitHub
  Pages**, and point `gecko.update_url` at it. This gives a **permanent,
  fully auto-updating** desktop install. Solved cleanly.
- **Android:** install the same signed XPI **once from a file** via the hidden
  debug menu (tap the Firefox logo 5x in *Settings -> About*, then *Settings ->
  Install extension from file*). It is a real, permanent install that survives
  restarts, but it will **not auto-update** — you re-install the new XPI when
  you ship a version (a 30-second manual step, scriptable via `adb`).

**If hands-off auto-update on Android is a must-have**, the *only* way to get it
is to **list the add-on on AMO** (public). For a clean, simple MV2 extension the
listing flow is largely automated validation; it does not need to be "featured"
and manual review is usually light. AMO-listed add-ons auto-update on **both**
desktop and Android with zero self-hosting. This is the pragmatic choice if the
"no public listing" preference is soft. See
[Recommendation](#recommendation-for-our-project) for the decision and a hybrid
option.

---

## Signing options compared

| Method | How you sign | Installable on **release** Firefox? | Auto-update **desktop**? | Auto-update **Android**? | Public listing / review? | Effort |
|---|---|---|---|---|---|---|
| **AMO listed** (public) | `web-ext sign --channel listed` or AMO web upload / API | Yes (install from AMO, both platforms) | Yes (AMO-managed) | **Yes** (AMO-managed) | Yes — public, may get manual review | Medium (metadata, policy compliance) |
| **AMO unlisted** (self-distribution) | `web-ext sign --channel unlisted` or API | Yes (host XPI yourself) | Yes (via your `update_url`) | **No** (file-install only; manual updates) | No listing; automated signing, may be reviewed later | Low |
| **Unsigned** (`xpinstall.signatures.required=false`) | no signing | **No on release/beta** — only Developer Edition, Nightly, ESR | No | No | No | Low but fragile, wrong channel |
| **Temporary add-on** (`about:debugging` / `web-ext run`) | none | Loads anywhere for dev, but **vanishes on restart** | n/a | n/a | No | Dev only |

Notes verified from Mozilla docs:

- "Extensions and themes need to be signed by Mozilla before they can be
  installed in release and beta versions of Firefox." Unsigned add-ons run only
  on Developer Edition / Nightly / ESR after toggling
  `xpinstall.signatures.required` in `about:config`, and the add-on needs an ID.
- **All** signing (listed or unlisted) happens through AMO. There is no
  offline / self-signing option.
- **Unlisted** add-ons "cannot be publicly viewed or installed from AMO" but
  are still "subject to be manually reviewed at any time." In practice unlisted
  signing is automated and completes in minutes for a passing extension.
- `web-ext sign` requires `--channel` since **web-ext v8** (our repo pins
  `web-ext ^10.5.0`, so v8+ semantics apply). The old
  `--use-submission-api` / `--id` flags were removed; submitting updates now
  relies on the add-on **ID being present in `manifest.json`**.

---

## Self-hosted auto-update: verified `updates.json` + manifest

This is the desktop auto-update mechanism (and the format is what an AMO listing
would replace). Verified against the Extension Workshop "Updating your
extension" page and MDN.

### 1. Manifest changes (`manifest.json`)

Add a `browser_specific_settings` block. **Three things matter:** a stable
`gecko.id`, the `gecko.update_url`, and `gecko_android: {}` to make it Android-
installable.

```jsonc
{
  "manifest_version": 2,
  "name": "Youtube Audio",
  "version": "0.0.2.5",
  // ...existing keys...
  "browser_specific_settings": {
    "gecko": {
      "id": "youtube-audio@animeshkundu.github.io",
      "strict_min_version": "128.0",
      "update_url": "https://animeshkundu.github.io/youtube-audio/updates.json"
    },
    "gecko_android": {}
  }
}
```

- `id` — email-like string, `<=80` chars, matching
  `^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$`, **or** a GUID in braces. It does not
  need to be a real address; it just needs to be unique and stable. AMO checks
  uniqueness the first time you sign. **Pick it once and never change it** —
  the ID is the identity Firefox uses to match updates.
  - For MV2 the ID is technically optional (AMO auto-assigns a GUID if omitted),
    but self-hosting updates and re-signing require a **known, fixed** ID, so
    set it explicitly.
- `strict_min_version: "128.0"` — because of the **March 2025 root-cert
  expiration**, Firefox older than **115 (ESR) / 128 (non-ESR)** cannot validate
  current signatures or receive updates. `128.0` is a safe modern floor.
- `update_url` — **must be HTTPS**. Only consulted for self-distributed
  installs (ignored for AMO-installed copies).
- `gecko_android: {}` — **required for Android availability.** Per MDN: without
  `gecko_android`, "the extension is available on desktop Firefox only." An
  empty object means "supported on Android, no special version range."

### 2. The update manifest (`updates.json`)

Structure verified from Extension Workshop / MDN. Top-level `addons`, keyed by
your `gecko.id`; each entry has an `updates` array.

```json
{
  "addons": {
    "youtube-audio@animeshkundu.github.io": {
      "updates": [
        {
          "version": "0.0.2.5",
          "update_link": "https://github.com/animeshkundu/youtube-audio/releases/download/v0.0.2.5/youtube_audio-0.0.2.5.xpi",
          "update_hash": "sha256:PUT_REAL_HEX_HASH_HERE",
          "applications": {
            "gecko": { "strict_min_version": "128.0" }
          }
        }
      ]
    }
  }
}
```

Field rules (verified):

- `version` — the version this entry describes; must match the XPI's manifest
  version.
- `update_link` — HTTPS link to the signed `.xpi`. If it is not HTTPS you
  **must** provide `update_hash`. GitHub Release asset URLs are HTTPS, so the
  hash is optional but recommended (it guards against a cached/corrupt fetch).
- `update_hash` — string starting with `sha256:` or `sha512:` followed by the
  hex digest of the exact XPI bytes.
- `applications.gecko.strict_min_version` / `strict_max_version` — optional
  compatibility gate. If `applications` is present it **must** contain a
  `gecko` object or the entry is ignored.
- You keep **all** versions in the array (Firefox picks the highest compatible
  one). Append, don't replace.

### 3. How/when Firefox applies it

- Firefox checks each add-on's `update_url` about **every 24 hours**
  (`extensions.update.interval`, default 86400s) with
  `extensions.update.enabled = true`. For testing you can lower the interval in
  `about:config` (minimum effective ~120s / 2 minutes) and relaunch.
- If a higher `version` with a compatible range is found, Firefox downloads the
  XPI from `update_link`, verifies signature (and `update_hash` if given), and
  applies it silently.
- **Hosting requirement:** serve `updates.json` over **HTTPS**. GitHub Pages
  and GitHub Release asset URLs both qualify. (For the *web-install* download of
  the XPI itself on desktop, the server should send
  `Content-Type: application/x-xpinstall`; GitHub Releases already serves a
  usable content type and the file-install path does not need it.)
- **Ordering pitfall:** publish/upload the signed XPI **before** you publish an
  `updates.json` that references it, so Firefox never fetches a 404.

---

## Firefox for Android: the real 2026 install paths

This is the crux and where most stale guidance is wrong. Since the **December
2023 "open extensions" GA**, stock Firefox for Android (release) can install
**any AMO-listed** extension directly, and current stable builds also expose an
**"Install extension from file"** option behind the hidden debug menu. Here are
the concrete options with trade-offs.

### Option A — Install your unlisted signed XPI from a file (no listing) ✅ works on stable

Verified steps from Extension Workshop ("Installing self-distributed
extensions", anchor `#install-addon-from-file-android`):

1. Sign the XPI (`web-ext sign --channel unlisted`) and get the `.xpi` onto the
   phone (download it, `adb push`, or share it to the device).
2. In Firefox for Android open **Settings -> About Firefox**.
3. **Tap the Firefox logo five times in quick succession.** This unlocks hidden
   menu items (the debug menu).
4. Go back to **Settings**, open **Install extension from file**.
5. Browse to and open the saved `.xpi`.
6. When prompted, tap **Add**. It appears in the **Extensions** list and is a
   real, permanent install (survives restarts). Automatic compatibility checks
   run on file install.

> **Stable-channel nuance (2025 reports):** on some current release Fenix
> builds the "Install extension from file" item is gated behind a secret
> settings toggle reachable at `chrome://geckoview/content/config.xhtml` (a
> `xpinstall`/extensions dev flag) in addition to the 5-tap unlock. If the menu
> item is missing after the 5-tap, enable it there. Nightly always exposes it.
> This is a developer/power-user path, not a normal discoverable end-user flow.

- **Requires:** `browser_specific_settings.gecko_android` present in the
  manifest, a valid signature, and `strict_min_version <= your Firefox`.
- **Trade-off:** **No auto-update.** There is no update mechanism for
  file-installed / sideloaded add-ons on Android — only AMO-installed
  extensions auto-update there (Mozilla staff, May 2025). To update you repeat
  the file-install with the new signed XPI (old version is replaced by the
  same-ID install). Web-download auto-install (the desktop convenience) also
  does **not** work on Android; a
  direct link only downloads the file.
- **Best for:** exactly our "personal, no public listing" case, accepting a
  manual update step on the phone.

### Option B — List on AMO, install from AMO ✅ only path with Android auto-update

1. Sign/submit `--channel listed` (or via AMO web upload), providing minimal
   metadata (name, summary, categories, license). `gecko_android: {}` present.
2. On the phone, open Firefox for Android, search AMO for your add-on (or open
   its AMO URL) and tap **Add to Firefox**.
3. Updates are delivered **automatically** by Firefox on both Android and
   desktop whenever you publish a new listed version. No `update_url`, no
   self-hosting. On Android the check is a silent background poll roughly every
   24h (confirmed by Mozilla staff, Jan 2024); there is **no manual "check for
   updates" button** on Android yet (Bugzilla #1810177, open), so a new version
   lands within about a day.

- **Trade-off:** the add-on is **publicly listed** and subject to AMO policy /
  possible manual review. It does not have to be promoted or "featured"; it is
  simply discoverable. This is the **only** hands-off Android auto-update path.

### Option C — Custom AMO collection (Nightly-style debug setting)

Historically the way to get non-curated add-ons onto Android. In the debug menu
(same 5-tap unlock) there is **Settings -> Custom Add-on collection**, where you
enter your **AMO numeric user ID** and a **collection name**. Firefox then shows
that collection's add-ons in the Add-ons manager, installable and
auto-updating.

- **Catch:** an AMO collection can only contain **AMO-listed** add-ons, so this
  still requires listing (Option B) — it does not enable installing a purely
  *unlisted* add-on. Since the Dec 2023 GA let release Android install any
  listed add-on directly, the collection trick is now mostly redundant for a
  solo dev. Skip unless you specifically want to curate a private set.

### Option D — Firefox Android Nightly + disable signature enforcement

Firefox for Android **Nightly** exposes `about:config`, where you can set
`xpinstall.signatures.required = false` and install an **unsigned** XPI.

- **Trade-offs:** Nightly-only (not your daily-driver release Firefox), still no
  self-hosted auto-update, and generally unstable. Not recommended for a tool
  you actually rely on. Useful only for throwaway testing.

**Bottom line for Android:** with the "no public listing" constraint, **Option
A** is the answer and updates are **manual**. If you want auto-update on Android,
you must accept **Option B** (public listing).

---

## Desktop permanent install path

Two ways to get a permanent (non-temporary) install on desktop; the first is
the recommended one and also gives auto-update.

### Recommended: unlisted-signed XPI + self-hosted `update_url`

1. `web-ext sign --channel unlisted` -> downloads a Mozilla-signed `.xpi`.
2. Host the XPI (GitHub Release asset) and an `updates.json` (GitHub Pages)
   as above; manifest carries `gecko.id` + `gecko.update_url`.
3. Install once: **about:addons -> gear icon -> Install Add-on From File ->**
   pick the signed `.xpi` **-> Add**. (Or serve a web-install link with
   `Content-Type: application/x-xpinstall` for one-click install.)
4. From then on it **auto-updates** from your `updates.json` on the normal
   ~24h cycle. Permanent across restarts.

This works on **release Firefox** because the XPI is Mozilla-signed.

### Alternative: unsigned on Developer Edition / Nightly / ESR

- Set `xpinstall.signatures.required = false` in `about:config` (only effective
  on Developer Edition / Nightly / ESR — **not** release/beta) and install the
  unsigned XPI. The add-on still needs an ID.
- **Trade-off:** ties you to a non-release channel and gives no managed
  auto-update. Only worth it if you refuse to touch AMO at all. Not recommended.

---

## Solo-dev release automation (`web-ext sign` + CI)

### One-time setup

1. **Get AMO API credentials:** sign in at addons.mozilla.org ->
   *Developer Hub -> Manage API Keys*
   (`https://addons.mozilla.org/developers/addon/api/key/`). Generate a **JWT
   issuer** (`--api-key`, looks like `user:123456:78`) and a **secret**
   (`--api-secret`). Store both as **GitHub Actions secrets**
   (`AMO_API_KEY`, `AMO_API_SECRET`). Never commit them.
   - The AMO API authenticates each request with a short-lived JWT
     (`iss`=key, `jti` nonce, `iat`, `exp` <=5 min, signed HS256), sent as
     `Authorization: JWT <token>`. `web-ext` builds this for you; you only
     supply key + secret.
2. Add the `browser_specific_settings` block (id, update_url, `gecko_android`)
   to `manifest.json` **once**.

### Minimal GitHub Actions pipeline

Triggered on a version tag. It builds a clean source dir (reuse the existing
`scripts/build-ext.sh` staging), signs unlisted, computes the hash, updates
`updates.json`, and publishes both the XPI (Release asset) and `updates.json`
(Pages).

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: write   # create releases
  pages: write
  id-token: write

jobs:
  sign-and-publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      # Stage only the extension files (existing script builds dist/extension/)
      - name: Stage extension source
        run: ./scripts/build-ext.sh

      # Sign unlisted -> downloads a Mozilla-signed .xpi into web-ext-artifacts/
      - name: Sign (unlisted / self-distribution)
        env:
          WEB_EXT_API_KEY: ${{ secrets.AMO_API_KEY }}
          WEB_EXT_API_SECRET: ${{ secrets.AMO_API_SECRET }}
        run: |
          npx web-ext sign \
            --source-dir=dist/extension \
            --channel=unlisted \
            --artifacts-dir=web-ext-artifacts

      - name: Collect artifact + hash
        id: pack
        run: |
          XPI="$(ls web-ext-artifacts/*.xpi | head -1)"
          VERSION="$(node -p "require('./manifest.json').version")"
          DEST="youtube_audio-${VERSION}.xpi"
          cp "$XPI" "$DEST"
          echo "version=$VERSION"      >> "$GITHUB_OUTPUT"
          echo "xpi=$DEST"             >> "$GITHUB_OUTPUT"
          echo "sha256=sha256:$(sha256sum "$DEST" | cut -d' ' -f1)" >> "$GITHUB_OUTPUT"

      # Publish the signed XPI as a Release asset (stable download URL)
      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: ${{ steps.pack.outputs.xpi }}

      # Append this version to updates.json (a small node/jq step), then deploy
      # the docs/ (or a dedicated branch) to GitHub Pages so
      # https://<user>.github.io/<repo>/updates.json serves it.
      - name: Update updates.json
        run: |
          node scripts/update-updates-json.mjs \
            --version "${{ steps.pack.outputs.version }}" \
            --hash "${{ steps.pack.outputs.sha256 }}" \
            --link "https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/${{ steps.pack.outputs.xpi }}"
      # ...commit updates.json / deploy-pages step here...
```

Notes:

- `web-ext sign --channel=unlisted` submits to AMO, waits for the **automated**
  signing (usually minutes; `--approval-timeout` defaults to 15 min in v8), and
  downloads the signed XPI. Env vars `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`
  are the documented way to pass credentials.
- **Re-runs / versioning:** bump `manifest.json` `version` on every release
  (the tag drives it). AMO rejects re-signing an already-signed version number.
- **Rate limits:** the AMO API throttles with HTTP **429 + `Retry-After`** when
  exceeded, but the documented quotas are far above a solo dev's handful of
  signs per week, so this is a non-issue at our volume. Handle 429 by honoring
  `Retry-After` if you script the raw API instead of `web-ext`.
- A ready-made helper Action exists —
  [`imigueldiaz/firefox-updates-json`](https://github.com/imigueldiaz/firefox-updates-json)
  (updated 2026-07) computes the XPI hash and edits `updates.json`/`manifest.json`
  — but it self-describes as an unfinished proof-of-concept, so a ~20-line
  `scripts/update-updates-json.mjs` you own is safer than depending on it.

---

## Recommendation for our project

**Decision hinges on one question: is auto-update on *Android* a hard
requirement, or is a manual re-install on the phone acceptable?**

### Primary recommendation (honors "no public listing")

Ship **unlisted-signed + self-hosted updates**, accept manual Android updates:

1. **Manifest:** add `browser_specific_settings` with a fixed `gecko.id`
   (`youtube-audio@animeshkundu.github.io`), `strict_min_version: "128.0"`,
   `update_url` pointing at `https://animeshkundu.github.io/youtube-audio/updates.json`,
   and `gecko_android: {}` (without this it is desktop-only).
2. **Credentials:** create AMO API key/secret, store as GitHub secrets.
3. **CI:** add the `release.yml` above; tag `vX.Y.Z` to build -> sign unlisted
   -> publish XPI to Releases -> update `updates.json` on Pages.
4. **Desktop install (once):** `about:addons -> Install Add-on From File ->`
   signed XPI. Auto-updates thereafter. **Done, fully hands-off.**
5. **Android install:** push the signed XPI to the phone, unlock the debug menu
   (5x logo tap in *About*), *Install extension from file*. On each new release,
   repeat the file-install (scriptable: `adb push` the new XPI + tap through, or
   just re-open it from Downloads). ~30s per update.

### If Android auto-update matters more than avoiding a public listing

**List the extension on AMO** (`--channel listed`, same `gecko_android: {}`
manifest). Then install from AMO on both devices and get **automatic updates
everywhere** with no self-hosting. For a clean MV2 extension the listing is
mostly automated validation; it need not be promoted. This is objectively the
lowest-maintenance long-term path and the only one that auto-updates on Android.

### Hybrid (best of both, slightly more work)

List on AMO **and** keep the `update_url` self-host. AMO-installed copies (your
phone) auto-update via AMO; anyone using the self-hosted XPI auto-updates on
desktop via `update_url`. One codebase, one signed artifact per release.

### Pitfalls to avoid

- **Missing `gecko_android`** -> extension silently unavailable on Android even
  though it signs and installs fine on desktop. Easy to miss.
- **Changing `gecko.id`** after first sign -> Firefox treats it as a different
  add-on; updates stop matching. Choose it once.
- **`strict_min_version` too low** -> post-March-2025 cert change, only 115 ESR
  / 128+ can validate/update; don't set an ancient floor.
- **Expecting `update_url` to auto-update on Android** -> it does not. Plan for
  manual Android updates unless listed on AMO.
- **Publishing `updates.json` before the XPI exists** -> Firefox fetches a 404.
  Upload the XPI first.
- **Re-signing the same version number** -> AMO rejects it. Always bump
  `manifest.json` `version`.
- **Committing API keys** -> use GitHub secrets / env vars only.
- **Non-HTTPS `update_url` or `update_link`** -> ignored / requires
  `update_hash`. Keep everything HTTPS.
- **Wrong channel for unsigned** -> `xpinstall.signatures.required=false` has no
  effect on release/beta; it only works on Developer Edition / Nightly / ESR.

---

## References

Mozilla official docs (Extension Workshop / MDN / AMO API):

- Signing & distribution overview —
  https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- Distributing an add-on yourself (self-distribution) —
  https://extensionworkshop.com/documentation/publish/self-distribution/
- Installing self-distributed extensions (incl. **Android file install**,
  5-tap debug menu) —
  https://extensionworkshop.com/documentation/publish/install-self-distributed/
- Submitting an add-on (listed vs unlisted) —
  https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- Updating your extension (`update_url`, `updates.json` schema) —
  https://extensionworkshop.com/documentation/manage/updating-your-extension/
- Developing extensions for Firefox for Android (temporary + persistent load) —
  https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- `web-ext` command reference (`sign`, `--channel`, `--api-key/secret`) —
  https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- MDN `browser_specific_settings` (`gecko.id`, `update_url`, `gecko_android`,
  **March 2025 cert / 115-128 min-version note**) —
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- MDN Updates (updates.json spec) —
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/Updates
- AMO External API — authentication (JWT: iss/jti/iat/exp, `Authorization: JWT`) —
  https://mozilla.github.io/addons-server/topics/api/auth.html
- AMO External API — add-on upload / version create endpoints —
  https://mozilla.github.io/addons-server/topics/api/addons.html
- AMO External API — overview (status codes, 429/maintenance) —
  https://mozilla.github.io/addons-server/topics/api/overview.html

Community / primary-source corroboration (verified against named Mozilla-staff
posts and Bugzilla, not AI summaries):

- Mozilla Discourse — **listed AMO add-ons auto-update on Android** (~24h poll),
  answered by Mozilla staff (Simeon Vincent / dotproto), Jan 2024 —
  https://discourse.mozilla.org/t/automatic-update-of-android-addon/125788
- Mozilla Discourse — self-hosted / unlisted distribution is "not officially
  supported" on Android (Mozilla staff, May 2025) —
  https://discourse.mozilla.org/t/distributing-unlisted-extesnion-via-direct-link/143040
- Mozilla Discourse — you cannot install unsigned from file on Android; signed
  XPI file-install is the only self-host path (Mozilla staff, Jun-Jul 2025) —
  https://discourse.mozilla.org/t/is-add-on-loading-from-file-possible-in-firefox-for-android-139-0-4/144353
- Mozilla Discourse — Android installs add-ons only from AMO; local-file XPI is
  a dev/power-user feature (Mozilla staff, 2024-2025) —
  https://discourse.mozilla.org/t/why-can-i-not-load-a-simple-custom-extension-addon-xpi-file-in-android-nightly/129335
- Bugzilla #1810177 — "Add a button to manually check for extension updates"
  (Android has no manual update button; open) —
  https://bugzilla.mozilla.org/show_bug.cgi?id=1810177
- Bugzilla #1872169 — "Fenix ignores 'extensions.update.enabled'" (RESOLVED
  FIXED, Jan 2024; confirms Fenix has a real AMO update pipeline) —
  https://bugzilla.mozilla.org/show_bug.cgi?id=1872169
- Note: no Bugzilla bug states "update_url is ignored on Android" verbatim; the
  no-auto-update outcome for file-installed add-ons is confirmed by staff, the
  exact code-level cause is inferred.

Example self-hosting tooling:

- `imigueldiaz/firefox-updates-json` (GitHub Action; generates `updates.json`,
  computes XPI hash; updated 2026-07-07; self-described proof-of-concept) —
  https://github.com/imigueldiaz/firefox-updates-json

Project facts used: `manifest.json` is MV2 v0.0.2.5 with **no**
`browser_specific_settings` today; `package.json` already pins
`web-ext ^10.5.0`; build staging via `scripts/build-ext.sh`.
