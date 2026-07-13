# Firefox for Android (Mobile) WebExtension Support

Research brief for making **YouTube Audio** run on Firefox for Android (Fenix / GeckoView), on mobile YouTube (`m.youtube.com`) and YouTube Music (`music.youtube.com`), from the same codebase as desktop.

- Date: 2026-07-11 (all API facts verified against current Mozilla `browser-compat-data`, extensionworkshop.com, and real shipping extensions).
- Scope note: this is a single-developer personal tool. Software-licensing concerns are explicitly out of scope; reference repos below were cloned and studied freely.

---

## 1. Executive summary

**Yes — our extension can run on Firefox for Android with essentially zero mechanism changes.** The core of YouTube Audio is `webRequest.onBeforeRequest` with the `"blocking"` flag, plus `storage`, `tabs`, `browserAction`, and content scripts on `*.youtube.com`. Every one of those is supported on Firefox for Android today. This is the same API surface that makes the *full* uBlock Origin (with `webRequestBlocking`) work on Firefox Android — the one thing Chrome for Android cannot do at all.

What must change is small and manifest-only:

1. **Add `browser_specific_settings`** with an explicit `gecko.id` and a `gecko_android` block. An add-on ID is required to sign/list on AMO, and `gecko_android` is what opts the extension into Android installability. This is the *only* mandatory change.
2. **UX for toggling without a toolbar.** Android has no persistent toolbar. Our `browserAction.onClicked` toggle still works — it fires when the user taps the extension in the *Extensions* menu (☰ → Extensions → YouTube Audio). No popup is required, but a small popup would make the on/off state clearer on mobile. This is the main product decision.
3. **Content-script matching already covers mobile.** Our existing `*://*.youtube.com/*` pattern matches `m.youtube.com`, `music.youtube.com`, and `www.youtube.com` (the `*.` wildcard matches any subdomain including none). No new match entries are needed for mobile web YouTube or YouTube Music. `youtube-nocookie.com` is likewise covered.

Risks/caveats: the `menus`/`contextMenus` API is **not** available on Android (we don't use it — fine). Background *service workers* are unsupported on Android (we use an MV2 persistent background page — fine; keep MV2). And the DOM-dependent alert banner we inject (`videoElement.parentNode.parentNode`) may land in the wrong place on the mobile player; that's cosmetic and worth a mobile-aware tweak, not a blocker.

Bottom line: **one manifest block to become installable; one UX decision (popup vs. bare toggle) to make it pleasant.** The audio-only mechanism itself is fully supported on Android.

---

## 2. Current state of Firefox Android extension support & install path (2026)

Timeline:

- **Pre-2020:** The old Firefox for Android ("Fennec") supported a broad range of extensions.
- **2020 – 2023 (Fenix / GeckoView rewrite):** Extension support was cut back to a small, Mozilla-curated **"Recommended Extensions" collection** only. Arbitrary add-ons could not be installed on release builds (you had to use Nightly + a custom collection hack).
- **December 2023 — Firefox for Android 120:** Mozilla shipped the **open extension ecosystem** GA. Users can install from an open, growing catalog on the AMO Android site (400+ at launch). [Mozilla add-ons blog / release notes]
- **May 2024:** Catalog passed **1,000+ Android extensions**. [Mozilla add-ons blog]
- **2026 (now):** Arbitrary compatible extensions are installable on release Firefox for Android, the same open model as desktop.

**Current install path:**

- Users install from **[addons.mozilla.org](https://addons.mozilla.org/android)** (AMO), the same as desktop, or from the in-browser Add-ons Manager (☰ menu → *Extensions* / *Add-ons Manager*).
- The extension must be **signed by AMO** and must **declare Android compatibility** (`gecko_android` in the manifest, see §5) to appear as installable on Android.
- For developer/side-load testing without AMO, use `web-ext run -t firefox-android` against Nightly/Beta (§6). Release Firefox for Android only installs AMO-signed add-ons.
- Not every desktop extension is Android-installable: it must use only the supported API subset and declare `gecko_android`. Mozilla's own guidance says the large majority of desktop extensions aren't Android-ready *until the developer opts in and verifies*.

Sources: [Mozilla add-ons blog — "1000+ Firefox for Android extensions"](https://blog.mozilla.org/addons/2024/05/02/1000-firefox-for-android-extensions-now-available/); [Firefox Android 120 release notes](https://www.firefox.com/en-US/firefox/android/120.0/releasenotes/); [Mozilla support — Find and install extensions on Firefox for Android](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android); [extensionworkshop — Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

---

## 3. API availability matrix (Firefox for Android)

Verified against **`mdn/browser-compat-data`** (`webextensions/…`, `main` branch, queried 2026-07-11). `"mirror"` in BCD means "Android support mirrors the Firefox-desktop value" — i.e. supported the same as desktop. `firefox_android` version numbers are the Android build that introduced the feature.

| API / manifest key | Desktop? | Firefox Android? | Notes (BCD `firefox_android`) |
|---|---|---|---|
| **`webRequest`** | Yes | **Yes — since Android 48** | `api/webRequest.json` → `firefox_android: 48`. Core of our mechanism. |
| **`webRequest.onBeforeRequest`** | Yes | **Yes — since Android 48** | Async listeners since 52. We use a **synchronous blocking** listener. |
| **`webRequestBlocking` permission / `"blocking"`** | Yes (FF 48) | **Yes** | BCD `"mirror"` → resolves to desktop `48`. This is exactly what full uBlock Origin uses on Android. **Our audio-only interception is fully supported on Android.** |
| **`browserAction` (MV2)** | Yes | **Yes — since Android 55** | `"Available for use in Manifest V2 only."` We use `browser_action`. On mobile it renders in the Extensions menu, not a toolbar (see §4). |
| `action` (MV3) | Yes | Yes (`"mirror"`) | MV3 unified action. Not needed if we stay MV2. |
| `pageAction` | Yes | Yes — since Android 50 | Alternative UI entry; we don't need it. |
| **`tabs`** | Yes | **Yes — since Android 54** | We use `tabs.get`/`tabs.reload`/`tabs.sendMessage`/`tabs.onRemoved`. All fine. |
| **`storage`** | Yes | **Yes — since Android 48** | `storage.local` for on/off + options. Fine. |
| **`runtime` (messaging)** | Yes | Yes | `sendMessage`/`onMessage` used by content ↔ background. Fine. |
| **`content_scripts`** | Yes | **Yes** | Supported; `all_frames`, `run_at: document_start`, match patterns all work. |
| **`options_ui`** | Yes | **Yes — since Android 57** | Our options page works; opens from the add-on's detail page in the Add-ons Manager. Prefer `open_in_tab: true` on mobile (small screens). |
| Background **event page** (MV2 `persistent:false`) | Yes | **Yes** | Recommended background style on Android. |
| Background **persistent page** (MV2) | Yes | Yes | Our current `background.scripts` (persistent) works; DarkReader/uBlock ship persistent MV2 pages on Android. |
| Background **service worker** (MV3) | Yes | **No** | extensionworkshop: *"Background service workers aren't supported on Firefox for Android. Instead, use event pages"* (Bug 1573659). Another reason to stay MV2. |
| `menus` / `contextMenus` | Yes | **No** | `api/menus.json` → `firefox_android: false`. We don't use it. uBlock declares `menus` but the context menu simply doesn't appear on Android. |
| `commands` (keyboard shortcuts) | Yes | Limited/none on mobile | No hardware keyboard assumption on phones; don't rely on it. |
| `sidebar_action` | Yes | No | No sidebar on Android. |

**MV2 vs MV3 on Android:** Firefox for Android supports both, but Mozilla **explicitly recommends MV2** for Android because of feature-parity gaps (service workers unsupported, various known bugs). extensionworkshop: *"it's recommended you use Manifest V2 for extensions targeting Firefox for Android."* **Recommendation: keep YouTube Audio on MV2.**

Sources (BCD raw JSON): `mdn/browser-compat-data/webextensions/api/{webRequest,browserAction,pageAction,tabs,storage,menus}.json` and `.../manifest/{browser_action,page_action,options_ui,permissions}.json`; [extensionworkshop porting/dev guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/); [MDN Browser support for JavaScript APIs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs).

---

## 4. UI/UX on mobile: toggling without a toolbar; mobile YouTube matching

### 4.1 How the user toggles the extension (no toolbar)

Firefox for Android has **no persistent add-on toolbar**. Browser actions surface through the **main menu → Extensions** (some builds pin a couple of extensions near the menu). Behavior depends on whether the `browser_action` defines a `default_popup`:

- **No `default_popup` (our current manifest):** tapping the extension entry in the Extensions menu **fires `browserAction.onClicked`**. Our existing toggle handler (`js/global.js:70`) runs unchanged — one tap flips audio-only on/off and reloads the active tab. `browserAction.setIcon` (used at `js/global.js:46,58`) updates the icon shown in that menu, so the enabled/disabled icon still communicates state.
  - *Downside on mobile:* the menu entry gives no obvious "this is a toggle" affordance, and the icon is small. Users may not realize a tap toggles it.
- **With a `default_popup`:** tapping opens the popup as a modal/sheet. This is what uBlock (`popup-fenix.html`) and SponsorBlock/DarkReader (`default_popup`) do — a clearer surface for state and controls on a touch screen.

**Recommendation:** add a tiny `default_popup` with a single large On/Off switch (and a link to Options). It reads far better on mobile than a bare `onClicked` and still works on desktop. If we want the absolute minimum change, the bare `onClicked` toggle *does* function on Android — it's just less discoverable.

Sources: [extensionworkshop dev guide (menu/popup behavior, inspector caveats)](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/); reference popups in §7.

### 4.2 Content-script matching for `m.youtube.com` and `music.youtube.com`

Our current content-script match (`manifest.json:21`) is:

```json
"matches": ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"]
```

WebExtension match-pattern semantics: `*.youtube.com` matches **any** host under `youtube.com` including an empty subdomain. So this **already** covers:

- `www.youtube.com` (desktop),
- `m.youtube.com` (mobile web YouTube),
- `music.youtube.com` (YouTube Music — desktop *and* mobile web use this host),
- `youtube.com` itself.

**No new match entries are required** to reach mobile YouTube or YouTube Music. SponsorBlock uses the same broad `https://*.youtube.com/*` pattern and relies on it for mobile (`SponsorBlock/manifest/manifest.json` content_scripts; `firefox-manifest-extra.json`).

### 4.3 Mobile DOM differences (what to watch)

The interception happens at the **network layer** (`webRequest` sees the `googlevideo.com` media request with `mime=audio`), which is backend-served and identical across desktop/mobile/Music. That's why the mechanism ports cleanly. The DOM-touching parts need mobile awareness:

- **Video element:** `document.getElementsByTagName('video')[0]` (`js/youtube_audio.js:15`) still finds the player `<video>` on `m.youtube.com` and `music.youtube.com`. Fine.
- **Injected alert banner:** we walk `videoElement.parentNode.parentNode` and append a `<div>` (`js/youtube_audio.js:32,38`). The mobile player layout (`m.youtube.com`) and the YouTube Music UI differ from desktop; the banner may land oddly or overlap controls. Low risk (cosmetic, and already gated behind the `disable_video_text` option), but worth a mobile-specific check or simply suppressing the banner on `m.`/`music.` hosts.
- **YouTube Music specifics:** Music autoplays a queue and treats the video element as an audio surface already; our audio-only swap still applies (it forces the audio-only stream), but test that navigation between tracks (SPA route changes, no full reload) still triggers a fresh media request our listener catches. SponsorBlock handles YouTube's SPA navigation via `yt-navigate-finish`/URL polling — we may need similar re-arm logic if per-track requests aren't re-observed.

---

## 5. Required manifest changes for Android support (concrete)

Current `manifest.json` (relevant excerpt):

```json
{
  "manifest_version": 2,
  "background": { "scripts": ["js/global.js"] },
  "permissions": ["tabs", "webRequest", "*://*/*", "webRequestBlocking", "storage"],
  "browser_action": { "default_title": "Youtube Audio" },
  "content_scripts": [ { "matches": ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"], ... } ],
  "options_ui": { "page": "html/options.html", "browser_style": true, "chrome_style": true }
}
```

### Mandatory change — make it installable on Android

Add a `browser_specific_settings` block. An explicit **`gecko.id` is required** to sign/list on AMO, and **`gecko_android` is what marks the add-on Android-compatible**:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "youtube-audio@animeshkundu.github.io",
    "strict_min_version": "120.0"
  },
  "gecko_android": {
    "strict_min_version": "120.0"
  }
}
```

- `120.0` matches the open-extensions GA. You can pick the newest version you'll actually test against (extensionworkshop advises choosing the most recent version you expect to support, and setting `gecko_android` only after verifying on-device). An **empty `"gecko_android": {}`** also works (inherits desktop min) — DarkReader does exactly this (`darkreader/src/manifest-firefox.json:7`).
- Without `gecko_android`, the add-on will not present as installable on Android.

### Recommended changes (quality/mobile UX)

1. **Narrow host permissions** (optional, hygiene): the extension only needs YouTube + googlevideo. `"*://*/*"` and the `<all_urls>` webRequest filter (`js/global.js:52`) are broader than necessary. Consider `"*://*.youtube.com/*"`, `"*://*.youtube-nocookie.com/*"`, `"*://*.googlevideo.com/*"`. Broad host perms also trigger extra Android permission-grant UX (and Android currently can't edit host-permission grants in the Add-ons Manager — Bug 1812125). Not required to ship, but cleaner.
2. **Add a mobile-friendly `default_popup`** (see §4.1) so the toggle is discoverable on touch. Optional but recommended.
3. **`options_ui`: add `"open_in_tab": true`** and drop `chrome_style` (Chrome-only, ignored by Firefox). Small screens render an in-tab options page better than an embedded panel. uBlock and SponsorBlock both use `open_in_tab: true`.
4. **Keep `manifest_version: 2`** — recommended for Android (§3).
5. Background page: current persistent MV2 page is fine on Android. Optionally set `"persistent": false` (event page) to align with Mozilla's preferred style; if you do, confirm the `webRequest` listener re-arms on wake (it does — `global.js` registers the listener at top level based on stored state on each load).

### Minimum viable diff

If we want the smallest possible change to *also load on Android*: **add the `browser_specific_settings` block above. That's it.** Everything else already works. The popup/permission/options tweaks are polish.

Source for keys: [extensionworkshop — gecko_android / strict_min_version](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/); [MDN browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).

---

## 6. Dev / testing workflow on Android

Tooling: `web-ext` **7.12.0+** required for `-t firefox-android`.

**adb setup:**
1. Install Android Platform Tools (`adb`) and put it on `PATH`.
2. Enable *USB debugging* (Developer options) on the device, connect via USB (or use an emulator/AVD).
3. `adb devices` → confirm the device is listed (e.g. `51800F220F01564  device`).

**Install a Firefox that allows side-loading** (release Firefox only installs AMO-signed add-ons; use Nightly/Beta for dev):
- `org.mozilla.fenix` — Nightly
- `org.mozilla.firefox_beta` — Beta
- `org.mozilla.firefox` — Release

**Run the extension on-device:**
```bash
web-ext run -t firefox-android \
  --adb-device <DEVICE_ID_FROM_adb_devices> \
  --firefox-apk org.mozilla.fenix
```
- The add-on loads into the browser's main profile (not a fresh temp profile). You need **at least one tab open** for it to load.
- Navigate the device to `https://m.youtube.com/` and `https://music.youtube.com/` to exercise our content scripts.

**Debugging from desktop (`about:debugging`):**
1. Desktop Firefox → `about:debugging` → **Setup** → enable/allow the USB device → **Connect** next to the device.
2. Under the device: find YouTube Audio, click **Inspect** for the background/content context; for background logs use **Processes → Main Process → Inspect → Debugger/Console**.
3. Or tail native logs: `adb logcat | grep <your-addon-id>` (e.g. install/version warnings).
4. Known limitation: you **cannot inspect a Fenix `browserAction` popup's markup** via the Inspector (Bug 1637616); workaround is to temporarily open the popup as a full page/tab.

Source: [extensionworkshop — Developing extensions for Firefox for Android (web-ext, adb, about:debugging)](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

---

## 7. Reference extensions — what they do for mobile (manifest evidence)

All three are MV2 on Firefox and known-good on Firefox for Android. Cloned `--depth 1` to `/tmp/yta-research/03-firefox-mobile/`.

### uBlock Origin (`gorhill/uBlock`) — the strongest proof our mechanism works
`uBlock/platform/firefox/manifest.json`:
- **`webRequest` + `webRequestBlocking` + `<all_urls>`** permissions (lines 114–126) — the exact blocking mechanism we use, shipping on Firefox Android.
- **`gecko_android: { "strict_min_version": "115.0" }`** (lines 25–27) alongside `gecko.id` + `strict_min_version: "115.0"` (lines 18–23).
- `manifest_version: 2` (line 108).
- **Mobile-specific popup:** `browser_action.default_popup = "popup-fenix.html"` (line 15) — a dedicated Fenix popup layout (`uBlock/src/popup-fenix.html`, `uBlock/src/js/popup-fenix.js`). `default_area: "navbar"` (line 8) is desktop-only and ignored on Android.
- Declares `menus` permission (line 118) even though the context menu is inert on Android (menus API unsupported) — harmless.

**Takeaway:** full `webRequestBlocking` on Firefox Android is real and shipping. Our audio-only interception is in the same supported class.

### SponsorBlock (`ajayyy/SponsorBlock`)
- `SponsorBlock/manifest/firefox-manifest-extra.json`:
  - `gecko.id: "sponsorBlocker@ajay.app"`, `gecko.strict_min_version: "102.0"` (lines 3–6),
  - **`gecko_android: { "strict_min_version": "113.0" }`** (lines 7–9),
  - **`background.persistent: false`** (event page, lines 11–13) — Mozilla's preferred Android background style,
  - `browser_action.default_area: "navbar"` (desktop hint).
- Base `SponsorBlock/manifest/manifest.json`: `options_ui.open_in_tab: true` (line 24); content scripts (in `manifest-v2-extra.json:119–136`) match `https://*.youtube.com/*` — the same broad pattern that reaches `m.` and `music.` automatically.
- Has explicit **mobile handling code** (`SponsorBlock/src/utils/mobileUtils.ts`, e.g. `isMobileControlsOpen()` reading the mobile `player-control-overlay`) — evidence that the mobile player DOM differs and warrants mobile-specific UI logic (relevant to our §4.3 banner note).

### Dark Reader (`darkreader/darkreader`)
- `darkreader/src/manifest-firefox.json`:
  - `gecko.id: "addon@darkreader.org"`, `gecko.strict_min_version: "78.0"` (lines 3–6),
  - **`gecko_android: {}`** (line 7) — empty block, i.e. "Android-compatible, inherit desktop min version." Simplest possible opt-in.
- Base `darkreader/src/manifest.json`: MV2 (line 2), `browser_action.default_popup: "ui/popup/index.html"` (line 14), persistent background page (lines 21–24) — a persistent MV2 page that runs fine on Android.

**Cross-extension pattern:** MV2 + `gecko.id` + a `gecko_android` block (empty or with a min version) + a `default_popup` for a touch-friendly control. That's the whole recipe.

---

## 8. Concrete recommendation for YouTube Audio (one codebase, desktop + mobile)

1. **Stay on Manifest V2.** Recommended for Android; avoids the service-worker gap. No migration needed.
2. **Add `browser_specific_settings`** (mandatory) with `gecko.id` + `strict_min_version`, and `gecko_android` (empty `{}` is enough; or `"strict_min_version": "120.0"` to pin to the open-extensions era). This alone makes the current extension Android-installable — the audio mechanism, storage, tabs, and content scripts already work there.
3. **Add a small `default_popup`** with a large On/Off switch + a link to Options. Improves discoverability of the toggle on mobile (no toolbar); works identically on desktop. Keep `browserAction.onClicked` as a fallback isn't possible alongside a popup (popup suppresses onClicked), so move the toggle logic into the popup, or keep bare `onClicked` if you prefer the minimal path. **Preferred: popup with a switch.**
4. **Content scripts: no change required** — `*://*.youtube.com/*` already covers `m.youtube.com`, `music.youtube.com`, `www.youtube.com`; `youtube-nocookie.com` covered too. Add a small **mobile guard** for the injected banner (suppress or reposition on `m.`/`music.` hosts) and verify SPA/track-change re-arming on YouTube Music.
5. **Tighten permissions** (recommended): replace `"*://*/*"` and the `<all_urls>` webRequest filter with YouTube + `*.googlevideo.com` hosts. Smaller Android grant surface, and works around the current Android limitation on editing host-permission grants.
6. **Options page:** add `"open_in_tab": true`, drop `chrome_style` (no-op in Firefox). Better on small screens.
7. **Test loop:** `web-ext run -t firefox-android --adb-device <id> --firefox-apk org.mozilla.fenix`, then drive `m.youtube.com` and `music.youtube.com`; debug via desktop `about:debugging`.

Do items 1–2 to *ship on Android at all*; add 3–6 to make it feel native. Nothing about the audio-only interception itself needs to change.

---

## 9. References

**Reference repos (cloned `--depth 1`, 2026-07-11):**
- `gorhill/uBlock` — `platform/firefox/manifest.json` (webRequestBlocking L114–126; gecko_android L25–27; default_popup popup-fenix.html L15); `src/popup-fenix.html`, `src/js/popup-fenix.js`. https://github.com/gorhill/uBlock
- `ajayyy/SponsorBlock` — `manifest/firefox-manifest-extra.json` (gecko_android strict_min 113 L7–9; background persistent:false L11–13); `manifest/manifest.json` (options_ui open_in_tab L24); `manifest/manifest-v2-extra.json` (content_scripts youtube match L119–136); `src/utils/mobileUtils.ts`. https://github.com/ajayyy/SponsorBlock
- `darkreader/darkreader` — `src/manifest-firefox.json` (gecko_android `{}` L7; gecko.id L4); `src/manifest.json` (MV2 L2; default_popup L14). https://github.com/darkreader/darkreader

**Mozilla docs / data:**
- extensionworkshop — Developing extensions for Firefox for Android (gecko_android, strict_min_version, web-ext -t firefox-android, adb, about:debugging, MV2 recommendation, service-worker/menu caveats): https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- MDN — Browser support for JavaScript APIs: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs
- MDN — webRequest / onBeforeRequest / BlockingResponse: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest
- MDN — browser_specific_settings (gecko / gecko_android): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- BCD (raw JSON queried): `mdn/browser-compat-data` `webextensions/api/{webRequest,browserAction,pageAction,tabs,storage,menus}.json`, `webextensions/manifest/{browser_action,page_action,options_ui,permissions}.json` — https://github.com/mdn/browser-compat-data
  - `webRequest.firefox_android: 48`; `browserAction.firefox_android: 55` (MV2 only); `pageAction: 50`; `tabs: 54`; `storage: 48`; `options_ui: 57`; `menus.firefox_android: false`; `webRequestBlocking`/`action`/`background`: `"mirror"` (= desktop support).
- Mozilla add-ons blog — 1000+ Firefox for Android extensions (May 2024): https://blog.mozilla.org/addons/2024/05/02/1000-firefox-for-android-extensions-now-available/
- Firefox for Android 120 release notes (open extensions GA, Dec 2023): https://www.firefox.com/en-US/firefox/android/120.0/releasenotes/
- Mozilla Support — Find and install extensions on Firefox for Android: https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android
- Relevant bugs: service workers on Android (1573659), popup inspector (1637616), host-permission grant edit on Android (1812125), pending host-permission indicator (1820867).

**Our codebase:**
- `/Users/kundus/Software/youtube-audio/manifest.json` (MV2, browser_action, content_scripts L21, permissions L14)
- `/Users/kundus/Software/youtube-audio/js/global.js` (webRequest blocking listener L52; browserAction.onClicked toggle L70; setIcon L46/L58)
- `/Users/kundus/Software/youtube-audio/js/youtube_audio.js` (video element L15; injected banner DOM walk L32/L38)
