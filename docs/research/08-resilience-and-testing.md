# 08 — Resilience & Test Strategy

_Research doc. How to keep our YouTube-audio extension **alive** against a moving target (YouTube changes weekly) and how to **verify** it deterministically. Grounded in the real, cloned source of uBlock Origin and SponsorBlock._

**Evidence base (cloned & read directly, July 2026):**

| Repo | Path used for citations | Commit | Date |
| --- | --- | --- | --- |
| gorhill/uBlock | `uBlock/…` | `697b2f1` | 2026-07-10 |
| ajayyy/SponsorBlock | `SponsorBlock/…` | `4a118fb` | 2026-07-01 |
| ajayyy/maze-utils (SB submodule, pinned = cloned) | `maze-utils/…` | `6b1ba69` | 2026-06-09 |

Citations are `repo/path/file:line` from those commits. The maze-utils clone SHA **exactly matches** the commit SponsorBlock pins as a submodule (`git ls-tree HEAD maze-utils` → `6b1ba69…`), so every maze-utils line number is the one SponsorBlock actually ships.

---

## 1. Executive summary

Two independent problems, two independent answers.

**(A) Stay alive against YouTube changes.** The single highest-leverage resilience feature is a **remote, declarative "rescue" config** that the signed extension pulls at runtime — the uBlock Origin model. uBO fixes breakage for hundreds of millions of users **without shipping an extension update** by fetching filter/scriptlet lists from a CDN, caching them, and reloading them live (`uBlock/src/js/assets.js`). We can do the same with a tiny JSON file (URL matchers, DOM-selector tables, feature kill-switches, and *identifiers that reference behaviours already shipped in the signed package* — never code). This is legal on AMO (data is allowed; remote code is not) and compatible with the ghost/no-telemetry constraint (a static, credential-less GET with no user-identifying data). The second pillar is **client-side feature detection + fail-open**: SponsorBlock never hard-codes a single selector — it tries an ordered list of fallbacks, waits for elements via `MutationObserver`, and re-attaches when YouTube swaps the DOM (`maze-utils/src/dom.ts`, `maze-utils/src/video.ts`). Our non-negotiable invariant: **if a hook is missing, do nothing to YouTube** — worst case is "audio-only silently stops working, video still plays," never "YouTube is broken."

**(B) Verify deterministically.** Adopt a **5-layer ladder** where layers 1–4 are deterministic and CI-gating and layer 5 (the existing live Selenium harness) is a **non-gating nightly canary** that is *allowed* to be flaky:

1. **Unit** over the *real* `js/` source in jsdom (fix the unsound tests first).
2. **Integration** — background↔content messaging wired together in jsdom with the existing `chrome` mock.
3. **Fixture replay** — recorded `ytInitialPlayerResponse` JSON + a frozen watch-page DOM skeleton, so page-context hooks run without live YouTube.
4. **Packaged-extension E2E on real Firefox against a *local* fake-YouTube page** — proves the actual signed `.xpi` (manifest, permissions, content-script injection, `webRequest`) works in a real browser, deterministically. This is the layer we are missing today.
5. **Live smoke** (`tests/e2e/verify-firefox.mjs`) — real Firefox + real YouTube; breakage *detection*, not gating.

Both uBO and SponsorBlock validate this shape: their **deterministic** CI runs unit/fixture tests that **import real modules** (uBO: `createWorld('./index.js')` in `uBlock/platform/npm/tests/snfe.js`; SB: `import { exportTimes } from "../src/utils/exporter"` in `SponsorBlock/test/exporter.test.ts`), while their live-browser Selenium test is **disabled by default** (`SponsorBlock/test/selenium.test.ts:6` uses `xtest`). Our current jest tests do the opposite of the proven pattern — they *re-declare copies* of the functions inside `beforeEach` and never import `js/`, so `js/` coverage is 0% and green never proves the shipped code works.

---

## 2. Resilience patterns from uBO & SponsorBlock

### 2.1 uBO: remote-updatable resources (the hotfix-without-release engine)

uBO's asset system is exactly the capability we want: **ship fixes as data, apply them at runtime.**

**Asset manifest — every list has origin + CDN mirrors + diff path.** `uBlock/assets/assets.json:1` maps an asset key to `content` (`"internal"` vs `"filters"`), an `updateAfter` interval in days, a `contentURL[]` (canonical origin plus a *local* in-extension fallback path), a `cdnURLs[]` (multiple independent mirrors), and a `patchURLs[]` (diff base). Example (`uBlock/assets/assets.json:37`, the `ublock-filters` list):

```json
"ublock-filters": {
  "content": "filters",
  "contentURL": [ "https://ublockorigin.github.io/uAssets/filters/filters.txt",
                  "assets/ublock/filters.min.txt", "assets/ublock/filters.txt" ],
  "cdnURLs":    [ "https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt",
                  "https://ublockorigin.pages.dev/filters/filters.min.txt",
                  "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/filters/filters.min.txt" ],
  "patchURLs":  [ "https://ublockorigin.github.io/uAssetsCDN/filters/",
                  "https://ublockorigin.pages.dev/filters/" ]
}
```

The mirrors are **GitHub Pages, Cloudflare `pages.dev`, and jsDelivr** — three independent, free static hosts. A solo dev can host all three today.

**URL selection spreads load and prefers cache/origin as configured.** `getContentURLs()` (`uBlock/src/js/assets.js:181`) assembles the candidate URL list, honours `favorLocal`/`favorOrigin`, and **randomly shuffles the CDN list** (`uBlock/src/js/assets.js:200-205`) so users don't hammer one mirror.

**Fetch is cache-then-network with defensive guards.** `assets.fetchText()` (`uBlock/src/js/assets.js:330`) adds a **cache-bypass token** for external URLs (modulo a prime so it doesn't collide across days, `:346-350`) and — critically — **rejects anything that looks like HTML** (`if ( text.startsWith('<') && text.endsWith('>') )` → error, `uBlock/src/js/assets.js:371-375`), so a captive-portal or error page is never mistaken for a filter list. `getRemote()` (`uBlock/src/js/assets.js:1003`) iterates the candidate URLs, and on success **writes the fetched content to a runtime cache** (`assetCacheWrite`, `:1050`) and extracts metadata directives from the list body (`Last-Modified`, `Expires`, `Diff-Path`, `Diff-Expires`, `:1056-1062`). On failure it records the error and moves to the next URL (`:1071-1073`). A fetched copy that is **older than the cached one is ignored** (`resourceIsStale`, `:1044-1046`).

**Applied at runtime, no extension update.** The fetched list is stored in `cacheStorage` via `assetCacheWrite()` (`uBlock/src/js/assets.js:748`); the updater then **broadcasts `{ what: 'assetUpdated' }`** (`uBlock/src/js/assets.js:1318`), an `after-asset-updated` observer recompiles the affected list and **invalidates the compiled-engine "selfie" snapshot** (`µb.selfieManager.destroy()` + `this.loadFilterLists()`, `uBlock/src/js/storage.js:661`, `:713`) — the new rules take effect at runtime without the user updating the extension.

**Differential (diff) updates — fixes as tiny patches.** Since uBO 1.54.0, lists carrying `Diff-Path`/`Diff-Expires` are updated by downloading only a **patch**, not the whole list. `diffUpdater()` (`uBlock/src/js/assets.js:1230`) gathers candidates, spawns a dedicated `Worker('js/diff-updater.js')` (`:1269`), posts each asset's diff details, and on `status === 'updated'` writes the patched text back to cache (`:1298-1311`); statuses `nopatch-yet`/`nodiff` skip cleanly (`:1315-1317`). The worker itself parses and applies the patch: `parsePatch()` / `applyPatch()` (Perl-`_patch`-style, `uBlock/src/js/diff-updater.js:68`, `:107`), `applyPatchAndValidate()` (`:156`), and `fetchPatchDetailsFromCDNs()` which resolves the patch file against `patchURLs`/`cdnURLs` (`uBlock/src/js/diff-updater.js:183-207`). **If patching fails, uBO falls back to a full fetch.** (Confirmed by Mozilla-hosted uBO docs and the v1.54 announcement — see references.)

**Network-supplied patches are integrity-checked before use.** `applyPatchAndValidate()` (`uBlock/src/js/diff-updater.js:156-181`) applies the diff, then **computes the SHA-1 of the patched text and rejects it unless it matches the `checksum` shipped in the patch** (`sha1Full.startsWith(checksum) === false` → `badchecksum`); it also feature-detects `crypto.subtle` and bails (`nocrypto`) rather than throwing. So a corrupted/tampered patch is discarded and the list is left untouched until the next full fetch. This is the concrete precedent for signing/validating our rescue config (§2.3).

**Update scheduling is throttled and interval-driven.** Inter-fetch delay defaults to `updaterAssetDelayDefault = 120000` ms (2 min, `uBlock/src/js/assets.js:1184`). `updateNext()` skips assets whose `writeTime + updateDelay > now` (`:1399-1400`), where the delay comes from `getUpdateAfterTime()` (`:125`) driven by the list's `Expires:` directive (`uBlock/src/js/assets.js:55-64` parses `Expires: N days|hours`) or the manifest `updateAfter` (`:137-138`); the built-in default is 5 days. The cycle is scheduled through **`browser.alarms`** so it survives MV3 service-worker suspension (`µb.scheduleAssetUpdater` sets both a `vAPI.defer` timer and a persistent alarm, `uBlock/src/js/storage.js:1584-1587`); default cadence knobs live at `uBlock/src/js/background.js:48-50` (`autoUpdateAssetFetchPeriod: 5`, `autoUpdateDelayAfterLaunch: 37`, `autoUpdatePeriod: 1`), with an emergency fast-path when a list is badly stale (`uBlock/src/js/start.js:507-526`). Even the manifest of sources is remote-updatable (`assets.json` has `updateAfter: 13`; a refreshed manifest is reloaded in place, `assets.js:1429-1431`).

**Safety model — remote lists cannot ship code (this is the key precedent for us).** A remote filter list is *declarative text*. It can invoke a **scriptlet by name** (a token + string args), but the scriptlet **code ships inside the signed extension** (`uBlock/src/js/resources/scriptlets.js`, `uBlock/src/js/scriptlets/`). The parser resolves the token through a `scriptletDB` (`uBlock/src/js/scriptlet-filtering-core.js:53`, store at `:186`), and a filter referencing an **unknown/renamed scriptlet silently no-ops** (`redirectEngine` lookups return `undefined` rather than throwing, `uBlock/src/js/redirect-engine.js:171-219`) — a moved hook degrades, it doesn't crash. Privileged scriptlets are **trust-gated**: `tokenRequiresTrust()` (`uBlock/src/js/redirect-engine.js:197-200`) flags them, and `normalizeRawFilter()` **drops** such a filter when the source isn't trusted (`uBlock/src/js/scriptlet-filtering-core.js:36-47`); trust is an origin/prefix allow-list defaulting to `'ublock-'` (`uBlock/src/js/background.js:87`), so only uBO's own first-party lists qualify. Injected code additionally runs inside a `try/catch` IIFE with MAIN/ISOLATED world isolation (`uBlock/src/js/scriptlet-filtering-core.js:77-83`). **Takeaway: a remote list selects among pre-shipped behaviours and supplies parameters; it is never executable code.** That is exactly the boundary AMO requires and the boundary our rescue config must respect.

### 2.2 SponsorBlock: server-driven *data*, but client-side *resilience*

A common misconception is that SponsorBlock has a "config server" that pushes selectors. **It does not.** Two separate mechanisms:

**Its server serves crowd-sourced *data*, not client config or selectors.** `asyncRequestToServer()` (`SponsorBlock/src/utils/requests.ts:12`) picks the server address from `Config` and delegates to maze-utils' background request proxy:

```ts
export async function asyncRequestToServer(type, address, data = {}, headers = {}): Promise<FetchResponse> {
    const serverAddress = Config.config.testingServer ? CompileConfig.testingServerAddress : Config.config.serverAddress;
    return await (sendRequestToCustomServer(type, serverAddress + address, data, headers));
}
```

Segments are fetched by **hash prefix, not full video ID**: the client sends only the first 5 hex chars of `SHA-256(videoID)` and filters the response client-side (`getHash(videoID,1).slice(0,5)` → `GET /api/skipSegments/<hashPrefix>`, `SponsorBlock/src/utils/segmentData.ts:62-70`), and treats any non-200/404 as a soft failure (returns `null`, no throw, `:89`). This **k-anonymity** design means the server can't learn exactly which video a user watched. This is the privacy bar to match if we ever fetch anything keyed on user activity.

**Its "config" is local storage, versioned + migrated — no network selectors.** `maze-utils`' `ProtoConfig.fetchConfig()` reads only `chrome.storage.sync` / `chrome.storage.local` (`maze-utils/src/config.ts:174-198`). Schema evolution across versions is a pure client-side migration function: SponsorBlock passes `migrateOldSyncFormats` (`SponsorBlock/src/config.ts:189`) into `setupConfig()` (`maze-utils/src/config.ts:200-209`), which normalises old stored shapes on load. Debug export sanitises identity (`generateDebugDetails` deletes `userID`, masks `serverAddress`, `SponsorBlock/src/config.ts:625`).

**DOM resilience is 100% client-side feature detection + fail-safe.** This is the pattern to copy for our DOM hooks:

- **Ordered multi-selector fallback, actively dated.** SponsorBlock's own source is full of selector *cascades* that are patched whenever YouTube's markup shifts, with inline dates marking each addition: the progress-bar attach point tries newer-mobile (Sept 2024), newer-mobile (May 2024), desktop, Invidious/VideoJS, YT Music, Piped, and YTTV selectors in order and returns `null` if none match (`SponsorBlock/src/content.ts:537-585`); the controls container (`SponsorBlock/src/utils/pageUtils.ts:5-27`) and the 11-entry player reference-node list (`SponsorBlock/src/utils.ts:233-263`) follow the same shape. The maze-utils primitive behind them, `findValidElementFromSelector(selectors[])`, returns the *first visible* match (`maze-utils/src/dom.ts:57`, `findValidElementFromGenerator` at `:65`); the channel-ID resolver chains YouTube → Embed → Invidious → Mobile selectors (`maze-utils/src/video.ts:429-432`). **The lesson: never one selector — an ordered list, first-visible-wins, `null` on miss.**
- **Async wait instead of assume-present.** `waitForElement(selector)` resolves via a shared `MutationObserver` and never throws if the element is late (`maze-utils/src/dom.ts:106`).
- **Re-attach when YouTube swaps the player (SPA navigation).** `setupVideoMutationListener()` observes `.html5-video-container` and rebuilds the observer when the element goes invisible (`maze-utils/src/video.ts:456-490`); `refreshVideoAttachments()` re-finds the `<video>` via `waitForElement("video", true)` and handles the miniplayer case (`maze-utils/src/video.ts:504-520`); `waitForVideo()` queues callers until a video exists (`:490`).
- **Visibility validation, not blind `querySelector`.** `isVisible`/`isVisibleOrParent` gate every match (`maze-utils/src/dom.ts:44-55`), so a hidden/stale node is skipped rather than used.

**Contrast with our current code.** `js/youtube_audio.js:15` does `document.getElementsByTagName('video')[0]` with **no guard** — if YouTube renders the `<video>` late or renames the container, `videoElement` is `undefined` and the handler throws. That is the exact class of brittleness SponsorBlock engineered away.

**Player-state hook (relevant to our reimagined InnerTube path).** SponsorBlock reads live player state by injecting a script into the page's **MAIN world** (MV3 declares `world:"MAIN"`; MV2 injects a `<script>` tag — `SponsorBlock/src/document.ts` → `maze-utils/src/injected/document.ts`, wired at `SponsorBlock/src/content.ts:122-136`). That script listens to YouTube's *own* custom events (`yt-player-updated`, `yt-navigate-start`, `yt-navigate-finish`) and calls the player's API (`document.getElementById("movie_player").getVideoData()` etc.), posting results back via `window.postMessage`. Crucially it **degrades**: `getYouTubeVideoID()` falls back to URL parsing then DOM-anchor scraping when the hook hasn't fired, and direct InnerTube (`youtubei/v1/player`) calls in maze-utils' `metadataFetcher.ts` are wrapped in a swallowing `try/catch` that returns null-filled metadata rather than throwing. For us this says two things: hook YouTube's own events rather than polling blindly, and make every player/InnerTube read fail-soft — which also makes it **recordable as a fixture** (see §3).

**Build-time list generation (a third pattern).** SponsorBlock's Invidious/Piped instance list is regenerated **monthly by CI** and baked into the package (`SponsorBlock/ci/generateList.ts`, header: "should not be shipped with the extension"; `.github/workflows/updateInvidous.yml` cron `0 0 1 * *` → auto-PR). This is the *middle ground*: not runtime-fetched, but not hand-maintained either. Useful for data that changes slowly (e.g. a curated default selector set) where a release cadence is acceptable.

### 2.3 A concrete remote-hotfix design for **our** extension (ghost-safe)

Goal: fix a YouTube breakage (renamed param, moved selector, a sub-feature that started interfering) **without a signed release**, without any telemetry, and without ever executing remote code.

**Artifact.** One small JSON, `rescue.json`, hosted on **≥2 independent free static hosts** (GitHub Pages + jsDelivr from a public repo, mirroring uBO's `cdnURLs`). Strict, versioned, declarative schema:

```jsonc
{
  "schema": 1,
  "version": 42,                       // monotonic; client ignores older
  "minExtVersion": "0.1.0",            // compat gate
  "expires": 21600,                    // TTL seconds (client re-checks no sooner)
  "audio": {
    "requestMatch": "mime=audio",      // substring that marks the audio stream request
    "excludeMatch": ["live=1"],        // skip these
    "stripParams": ["range", "rn", "rbuf"]
  },
  "selectors": {                       // ordered fallbacks, consumed like maze-utils findValidElementFromSelector
    "video": ["video.html5-main-video", "#movie_player video", "video"],
    "playerContainer": [".html5-video-container", "#movie_player"]
  },
  "flags": {                           // kill-switches; fail-open
    "audioOnly": true,
    "ghostStealth": true,
    "adBlock": true
  },
  "ops": [                             // uBO-scriptlet-style: reference PRE-SHIPPED handlers by id
    { "id": "strip-request-params", "when": "audio.request", "args": { "params": ["range","rn"] } }
  ],
  "notice": { "since": "2026-07-10", "text": "A YouTube change is being worked on." }
}
```

**Hard rules (this is what keeps it legal + ghost-safe):**

1. **Data, never code.** `ops[].id` selects among handlers **already shipped in the signed package** (the uBO trusted-scriptlet boundary, `static-filtering-parser.js:2346`); `args` are strings/numbers only. The JSON is **never** passed to `eval`/`new Function`/`import()`. This is what AMO permits — the policy prohibits *"load remote code for execution"* (extensionworkshop.com), not fetching declarative data; uBO's globally-deployed practice is the proof of interpretation.
2. **Cache-first, fail-open.** Bundle a `rescue.json` **inside** the extension as last-known-good (uBO's local `contentURL` fallback). On fetch: validate schema + `version` + `minExtVersion`; if valid, store in `storage.local`; if the fetch fails, times out, or fails validation, **keep the last-good copy** (`getRemote` staleness/fallback, `assets.js:1044`). **Never block YouTube on the network.** If *every* config is unavailable, run the shipped defaults.
3. **Ghost fetch discipline.** `fetch(url, { credentials: 'omit', cache: 'no-cache' })` — **no cookies, no custom headers, no query params derived from user data, no unique/per-install ID.** Every user's request is byte-identical: it reveals only "an install checked for updates," nothing about the user or which video. (SponsorBlock still hashes even the video ID; we send *nothing* about the user at all.) Reject non-JSON / HTML bodies (uBO `fetchText` guard, `assets.js:371`). Enforce a small size cap and HTTPS-only.
4. **Integrity beyond TLS.** Because AMO forbids remote code, the file is inert data — but a compromised CDN could still feed *bad selectors*. Ship a public key in the package and verify a **detached signature** over `rescue.json` (Ed25519 via WebCrypto); reject on mismatch and fall back to last-good. (uBO already validates every network-fetched patch with a SHA-1 checksum before applying it, `uBlock/src/js/diff-updater.js:156-181` — same principle.) At minimum, strict schema validation + reject-unknown-fields.
5. **Throttle.** Re-check at most every `expires` seconds (and never more than, say, hourly), mirroring uBO's per-asset `Expires` + 2-min inter-fetch floor (`assets.js:1184`, `:1399`).
6. **Rollback is instant.** A bad rescue config is fixed by pushing a corrected JSON (bump `version`) — seconds, not an AMO review cycle. The kill-switch `flags` let us *disable* a misbehaving sub-feature remotely while a real fix ships.

**Risk table.**

| Risk | Mitigation (with precedent) |
| --- | --- |
| CDN outage | Bundled last-known-good + ≥2 mirrors (uBO `contentURL` local + `cdnURLs[]`) |
| Stale config | TTL/`expires` + `Last-Modified` staleness check (`assets.js:1044`) |
| Compromised host feeds bad selectors | Ed25519 signature + strict schema + **fail-open** so worst case is "audio-only off," not "YouTube broken" |
| AMO rejection | Config is declarative data, not code — policy-compliant; uBO ships this at scale |
| Privacy leak / de-ghosting | Static credential-less GET, no IDs, identical for all users |
| Poisoned config breaks YouTube | Every hook `try/catch` + fail-open + kill-switch + instant rollback |

---

## 3. Test strategy — the determinism ladder

The environment problem is real: live YouTube brings ads, autoplay gating, consent walls, and bot checks (all visible in `tests/e2e/verify-firefox.mjs:99-112`, `:135`). The fix is not "make live YouTube deterministic" (impossible) but **push almost all proof below the live layer** and keep the live layer as a non-gating detector.

| Layer | Environment | What it proves | Deterministic? | CI gate? |
| --- | --- | --- | --- | --- |
| 1 Unit | jsdom + `chrome` mock, **imports real `js/`** | Each shipped function's logic (param stripping, request classification, selector resolution, rescue-config validation) | Yes | Yes |
| 2 Integration | jsdom, both scripts loaded, mock messaging | background `webRequest`→message→content `src` swap wired together | Yes | Yes |
| 3 Fixture replay | jsdom + recorded YouTube data | Player-response parsing & DOM hooks against a **frozen real** YouTube shape | Yes | Yes |
| 4 Packaged E2E, fake YouTube | **real Firefox** + local page mimicking the player contract | The real signed `.xpi` (manifest, permissions, injection, `webRequest`) works in a real browser | Yes | Yes (push or nightly) |
| 5 Live smoke | real Firefox + **real YouTube** | The whole path still works against the actual moving target | **No** | **No** — nightly canary, alert-only |

**Why layer 4 is the one we're missing.** Today we jump from unsound unit tests straight to live YouTube. Layer 4 loads the *actual built extension* in a *real* Firefox (reusing the existing geckodriver plumbing) but points it at a **local HTML page** that reproduces YouTube's contract: a `<video>` element plus a stub endpoint that emits a `…googlevideo…mime=audio…` request. That deterministically exercises manifest wiring, content-script injection at `document_start`, the `webRequest` blocking listener, and the `src` swap — everything except YouTube's unpredictability. It is real *and* reproducible.

**What each of our three concrete targets maps to:**

- **(a) webRequest / telemetry-blocking logic** → Layer 1. Call `processRequest(details)` with **recorded request-detail fixtures** (real googlevideo URLs, telemetry URLs like `/api/stats`, `/youtubei/v1/log_event`, `/ptracking`). Assert the audio path emits the stripped URL and the telemetry path is cancelled. Pure function, zero network. (uBO tests its network engine exactly this way against fixture requests: `uBlock/platform/npm/tests/request-data.js`, `snfe.js`.)
- **(b) page-context player/response hook** → Layers 1+3. Unit-test the parser against a **saved `ytInitialPlayerResponse.json`** fixture; integration-test the injected hook against a frozen watch-page DOM. Refresh the fixture periodically from a real page (a maintainer task, not a test-time fetch).
- **(c) audio-only behaviour** → Layers 2+4. Layer 2: in jsdom, feed the content-script handler a `mime=audio` message and assert `video.src` swaps and the banner is appended/removed (`js/youtube_audio.js:13-45`). Layer 4: confirm the same in real Firefox against the local fake page (proves MSE `blob:`→direct-URL swap actually takes in a real media element).

**CI shape** (extend `.github/workflows/ci.yml`): jest (layers 1–3) on every push, headless, no network; layer 4 on push or nightly (needs a browser but is deterministic); layer 5 nightly with retries, `continue-on-error`, and an issue/alert on failure — this is how the *maintainer* learns of breakage server-side, with **zero user telemetry**.

### 3.1 How uBO & SponsorBlock actually test (evidence)

**SponsorBlock — deterministic unit/fixture tests that import real source; live Selenium disabled.**
- `SponsorBlock/jest.config.js`: `ts-jest`, `roots: ["test"]`, `github-actions` reporter.
- `test/urlParser.test.ts:1` imports the **real** `getStartTimeFromUrl` and drives it with pure string fixtures (`:4-26`).
- `test/exporter.test.ts:1-6` (`@jest-environment jsdom`) imports the **real** `exportTimes`/`importTimes` and round-trips fixture segment objects.
- `test/previewBar.test.ts:1-12` imports the **real** `PreviewBar` class and exercises `createChapterRenderGroups` with fixture segments in jsdom.
- `test/selenium.test.ts:6` — the live Chrome test is **`xtest(...)` (skipped by default)**, **self-skips if no browser is installed** (`:9-24`), loads the *built* extension via `--load-extension=../dist/`, hits a real ad-free video (`jNQXAC9IVRw`), and on failure **dumps the live page source to `test-results/source.html`** specifically to diagnose YouTube layout drift (`SponsorBlock/test/selenium.test.ts:44-51`). Real-browser E2E is explicitly opt-in and non-gating.
- `.github/workflows/tests.yml` runs `npm run test` (build + jest) on push/PR and even sets up a **WireGuard VPN** (to reach YouTube from a non-blocked region) — yet the Selenium test still doesn't run in normal CI because it's `xtest`. The deterministic gate is the three pure-unit suites; `ci.yml` is build + lint only.

**uBO — node-runner tests that import the real packaged engine + fixtures; plus manual HTML harnesses.**
- `uBlock/platform/npm/tests/snfe.js:26-51` imports the **real** engine via `createWorld('./index.js')` (`esm-world` gives each test a fresh module world), then loads real filter lists with `engine.useLists([...])` and asserts match results with `assert.strict`. This is the canonical "test the shipped module, not a copy" pattern.
- Sibling suites (Mocha entry `uBlock/platform/npm/test.js:29-50`): `wasm.js` **feature-detection test** — asserts `enableWASM()` resolves `true` with `WebAssembly` present and `false` when the sandboxed global is `undefined` (`uBlock/platform/npm/tests/wasm.js:34-52`), the exact "hook-missing → degrade, don't throw" contract; `leaks.js` (global-namespace smoke); and `request-data.js` — a **golden-file replay** (opt-in `--full-battery`) that loads frozen snapshots of real EasyList/EasyPrivacy/uBlock lists (`tests/data/bundle.tgz`) plus a frozen corpus of real captured request URLs (`scaling-palm-tree/requests.json`) and asserts the engine reproduces precomputed verdicts in `data/results.json` (`uBlock/platform/npm/tests/request-data.js:105-113`). This golden-file-replay-against-frozen-real-data pattern is the model for our fixture layer (§3, layers 1+3).
- `uBlock/docs/tests/` holds **manual** browser HTML harnesses (`scriptlet-injection-filters-1.html`, `procedural-cosmetic-filters.html`, `static-filtering-parser-checklist.txt`) for behaviour that can't run headless.
- The **root** `package.json` `test` script is a deliberate no-op stub (`echo "Error: no test specified" && exit 1`) — automated tests live only in `platform/npm/`. `.github/workflows/main.yml` is a **release/build** pipeline (triggered on tag creation; clone uAssets, build MV2/MV3 packages), not a live-site or test gate.

**Both projects converge on the same lesson:** deterministic CI = import real modules + feed fixtures; live-browser tests exist but are opt-in/non-gating.

---

## 4. Fixing our unsound jest setup

### 4.1 Diagnosis (verified)

`tests/unit/global.test.js:16-91` **re-declares copies** of `removeURLParameters`, `reloadTab`, `processRequest`, `enableExtension`, `disableExtension`, `saveSettings` inside `beforeEach` — it **never imports `js/global.js`**. So:
- Coverage of `js/**` is **0%** even though `jest.config.js:5` collects it. The tests exercise a parallel universe.
- `jest.config.js:10-17` sets **all coverage thresholds to 0**, with a comment admitting "IIFE patterns making direct import difficult." This directly contradicts the project's own mandate of **90% coverage + TDD** (`docs/agent-instructions/02-testing-and-validation.md:7-39`, `:249`).
- A refactor of `js/global.js` cannot break these tests, and a bug in the shipped code cannot fail them. Green is meaningless.

The blocker is real: `js/global.js` and `js/youtube_audio.js` are bare scripts that call `chrome.*` at top level (`js/global.js:70`, `:86`, `:100`, `:104`; `js/youtube_audio.js:1`), so a naive `require('../../js/global.js')` would execute side effects against nothing.

### 4.2 The fix — make the real source importable, guard the bootstrap

Split each file into **pure, exported functions** + a **`main()` bootstrap** that only auto-runs in the extension runtime. In the browser MV2 background/content context `module` is `undefined`, so the export guard is inert; under jest (CJS via `babel-jest`, already a devDependency) `module.exports` exists, so tests import the real functions **and** choose when to run the wiring. This ships unchanged to Firefox.

`js/global.js` (illustrative diff — logic identical, structure testable):

```js
const tabIds = new Set();

function removeURLParameters(url, parameters) { /* …unchanged… */ }
function reloadTab() { /* …unchanged… */ }
function processRequest(details) { /* …unchanged… */ }
function enableExtension() { /* …unchanged… */ }
function disableExtension() { /* …unchanged… */ }
function saveSettings(currentState) { /* …unchanged… */ }

// All top-level side effects move here (the onClicked listener, the initial
// storage.get bootstrap, onMessage, onRemoved).
function main() {
  chrome.browserAction.onClicked.addListener(/* … */);
  chrome.storage.local.get('youtube_audio_state', /* … */);
  chrome.runtime.onMessage.addListener((m, sender) => tabIds.add(sender.tab.id));
  chrome.tabs.onRemoved.addListener((id) => tabIds.delete(id));
}

// Runtime (Firefox): module is undefined → wire up. Test (jest/CJS): export instead.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tabIds, removeURLParameters, reloadTab, processRequest,
                     enableExtension, disableExtension, saveSettings, main };
} else {
  main();
}
```

A **sound** test that yields real coverage of `js/global.js`:

```js
const g = require('../../js/global.js');   // real source, instrumented by babel-jest

describe('processRequest (real source)', () => {
  it('strips range/rn/rbuf and messages the tab for an audio request', () => {
    g.tabIds.add(1);
    g.processRequest({ tabId: 1,
      url: 'https://r1.googlevideo.com/videoplayback?mime=audio&range=0-1&rn=2&rbuf=3' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1,
      { url: 'https://r1.googlevideo.com/videoplayback?mime=audio' });
  });

  it('ignores live streams', () => {
    g.tabIds.add(1);
    g.processRequest({ tabId: 1, url: 'https://x/y?mime=audio&live=1' });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('wires listeners on main()', () => {
    g.main();
    expect(chrome.browserAction.onClicked.addListener).toHaveBeenCalled();
  });
});
```

The existing `tests/setup.js` `chrome` mock is good and is reused verbatim — only the *tests* change (import instead of re-declare). For the content script, apply the same guard to `js/youtube_audio.js` (wrap the top-level `chrome.runtime.sendMessage` + `onMessage.addListener` in `main()`), then unit-test the message handler in jsdom against a fixture DOM (a `<video>` + parent nodes), asserting the `src` swap and banner injection (`js/youtube_audio.js:13-45`).

**Then ratchet coverage.** Once tests import real source, replace the `0` thresholds in `jest.config.js:10-17` with real numbers and raise toward the mandated 90% (`docs/agent-instructions/02-testing-and-validation.md:11`). Delete the re-declared function bodies from `tests/unit/global.test.js`. Coverage now reflects the shipped code.

_(Alternative considered and rejected: loading the file via `vm.runInThisContext(fs.readFileSync(...))`. It can execute the script with a pre-injected `chrome`, but it **bypasses babel/istanbul instrumentation, so it produces no coverage** — defeating the goal. Importing through the transformer is required for meaningful coverage.)_

---

## 5. Breakage monitoring without telemetry

No automatic phone-home. Four complementary, ghost-safe channels:

1. **Local self-diagnostics + a "degraded" flag.** The extension already stamps `data-yta-*` attributes on `documentElement` (read by the harness: `data-yta-content-loaded`, `data-yta-msg-count`, `data-yta-last-url`, `data-yta-src-after-set`, `verify-firefox.mjs:143-146`). Promote this to an in-extension health check: after enabling on a watch page, if the expected signal (a `mime=audio` request / a successful `src` swap) hasn't fired within N seconds, set an internal `degraded=true` in `storage.local`. Purely local.
2. **User-visible signal (the honest UX).** On `degraded`, show a toolbar badge/icon variant (uBO/SB use icon state; our `enableExtension`/`disableExtension` already swap icons, `js/global.js:46-63`) and an options-page banner: *"Audio-only may not be working here — YouTube may have changed. Check for an update or report it,"* linking to GitHub issues. Users become the reporting channel — the SponsorBlock/uBO community-issue model — with zero automatic data collection.
3. **User-initiated diagnostics copy.** A "Copy diagnostics" button that dumps **local, non-identifying** state (extension version, which hook failed, active selector-set version, browser UA) to the clipboard for pasting into an issue — modelled on SponsorBlock's `generateDebugDetails`, which explicitly **sanitises `userID` and masks `serverAddress`** (`SponsorBlock/src/config.ts:614-636`). Nothing leaves the machine unless the user pastes it.
4. **Maintainer-side canary (server, not users).** The nightly Layer-5 live smoke (`tests/e2e/verify-firefox.mjs`) already emits a machine verdict (`MECHANISM_FIRED` / `MECHANISM_DID_NOT_FIRE`, `:230-236`). Run it as a scheduled GitHub Action; when the verdict flips, open an issue / email the maintainer. The maintainer learns of breakage from **their own CI**, then pushes a `rescue.json` fix — the users' browsers report nothing. The rescue config's `notice` field (§2.3) can then surface "a known YouTube change is being worked on" in the options page, closing the loop declaratively.

---

## 6. Recommendation & prioritized checklist

**Strategic recommendation.** Combine uBO's **remote declarative rescue config** (hotfix without release) with SponsorBlock's **client-side feature-detection + fail-open** (survive until the hotfix lands), and prove both with a **deterministic 4-layer test base** topped by the existing live harness as a **non-gating canary**. The governing invariant everywhere: **degrade to inert; never break YouTube.**

**Prioritized checklist:**

1. **[P0] Make tests sound.** Refactor `js/global.js` + `js/youtube_audio.js` to the export-guard/`main()` pattern (§4.2); rewrite `tests/unit/*` to import real source; delete the re-declared copies. _Proves the shipped code; unblocks everything._
2. **[P0] Fail-open the DOM hooks.** Guard `js/youtube_audio.js:15` (no more unguarded `getElementsByTagName('video')[0]`); wrap every YouTube touch in `try/catch`; adopt an ordered multi-selector resolver + `waitForElement`/`MutationObserver` re-attach (port the maze-utils pattern, `dom.ts:57`/`:106`, `video.ts:456`). _Stops YouTube-change breakage from throwing._
3. **[P1] Restore coverage gates.** Replace the `0` thresholds (`jest.config.js:10-17`) with real numbers ratcheting to 90% (`02-testing-and-validation.md:11`).
4. **[P1] Add Layer 4 (packaged E2E vs local fake YouTube).** Reuse geckodriver; serve a local page reproducing the `<video>` + `mime=audio` request contract. _Deterministic proof the real `.xpi` works._
5. **[P1] Add fixtures.** Commit `tests/fixtures/`: recorded request-detail objects (audio + telemetry URLs) and a `ytInitialPlayerResponse.json`; unit-test `processRequest` and any player-response parser against them (Layers 1+3).
6. **[P2] Ship the rescue-config client** (§2.3): bundled last-good, ≥2 mirrors, `credentials:'omit'`, schema + signature validation, TTL throttle, fail-open. Externalize the URL matchers/selectors currently hard-coded in `js/global.js:38-39`.
7. **[P2] Breakage UX**: `degraded` flag + options-page banner + "Copy diagnostics" (sanitised).
8. **[P2] Nightly canary CI**: run `verify-firefox.mjs` scheduled, `continue-on-error`, alert on verdict flip. Keep it **out** of the blocking gate.

---

## 7. References

**Cloned repositories (read directly):**
- gorhill/uBlock — `https://github.com/gorhill/uBlock` @ `697b2f1` (2026-07-10). Key: `src/js/assets.js`, `src/js/diff-updater.js`, `src/js/storage.js`, `src/js/background.js`, `src/js/start.js`, `src/js/redirect-engine.js`, `src/js/scriptlet-filtering-core.js`, `src/js/static-filtering-parser.js`, `assets/assets.json`, `platform/npm/test.js`, `platform/npm/tests/{snfe,request-data,wasm,leaks}.js`, `docs/tests/`, `.github/workflows/main.yml`.
- ajayyy/SponsorBlock — `https://github.com/ajayyy/SponsorBlock` @ `4a118fb` (2026-07-01). Key: `src/utils/requests.ts`, `src/utils/segmentData.ts`, `src/config.ts`, `src/content.ts`, `src/utils.ts`, `src/utils/pageUtils.ts`, `src/document.ts`, `test/{urlParser,exporter,previewBar,selenium}.test.ts`, `jest.config.js`, `ci/generateList.ts`, `.github/workflows/{ci,tests,updateInvidous}.yml`.
- ajayyy/maze-utils — `https://github.com/ajayyy/maze-utils` @ `6b1ba69` (2026-06-09; = SponsorBlock's pinned submodule). Key: `src/dom.ts`, `src/video.ts`, `src/config.ts`, `src/injected/document.ts`, `src/metadataFetcher.ts`.

**This repo:** `js/global.js`, `js/youtube_audio.js`, `manifest.json`, `tests/unit/global.test.js`, `tests/setup.js`, `jest.config.js`, `tests/e2e/verify-firefox.mjs`, `docs/agent-instructions/02-testing-and-validation.md`.

**Web (confirmed July 2026):**
- Mozilla Add-on Policies — "Add-ons must be self-contained and not load remote code for execution." `https://extensionworkshop.com/documentation/publish/add-on-policies/` (governs the data-not-code boundary for the rescue config).
- uBlock Origin differential filter-list updates (since v1.54.0; `Diff-Path`/`Diff-Expires`, `diff-updater.js`, ~5h for uBO filters, 5-day default, full-fetch fallback). uBO filter-list management: `https://deepwiki.com/gorhill/uBlock/3.4-filter-list-management-and-updates`; update cadence: `https://superuser.com/questions/1935574/what-is-the-default-update-frequency-for-a-ublock-origin-filter-list`.
