# Architecture Documentation

## M0 Architecture

YouTube Audio is a Firefox-first WebExtension built from one strict-TypeScript source tree. Firefox Manifest V2 is the shipping target; Firefox Manifest V3 is emitted as a capability artifact.

```mermaid
flowchart LR
    subgraph Page[YouTube page]
        MAIN[MAIN-world entrypoint]
        Player[YouTube player]
    end

    subgraph Extension[YouTube Audio]
        Content[Isolated content entrypoint]
        Background[Persistent MV2 background]
        Shared[Framework-free shared modules]
        Popup[Preact popup]
        Options[Preact options]
        Storage[(Extension storage)]
    end

    Content -->|WXT injectScript| MAIN
    MAIN -. future typed bridge .-> Content
    MAIN -. M1 PlayerHandle .-> Player
    Content --> Shared
    Background --> Shared
    Popup --> Shared
    Options --> Shared
    Popup <--> Storage
    Options <--> Storage
    Background <--> Storage
```

## Layer Responsibilities

### Background

The persistent MV2 background entrypoint owns privileged APIs, network adapters, downloads, and remote-service proxies. M2a installs an allowlist-based blocking `webRequest.onBeforeRequest` listener for first-party YouTube telemetry. Its conservative default preserves InnerTube player, attestation, Googlevideo media, `log_event`, and watch-history endpoints; errors fail open.

### Isolated content

The content entrypoint runs at `document_start` on the four supported YouTube match patterns. It injects the unlisted MAIN-world bundle and will later own validated cross-world messaging and DOM-facing features.

### MAIN world

The MAIN-world entrypoint is the only layer intended to touch YouTube player APIs and page-owned prototypes. M0 installs no hooks. M1 will implement the proven `<video>.src` hijack behind `PlayerHandle`.

### Shared modules

`src/shared/` contains framework-neutral contracts and pure logic. Feature modules are inert stubs in M0. The real ANDROID_VR request-body builder is implemented here and tested directly. `platform.ts` exposes manifest/background capability flags so later network interception and lifecycle logic can stay behind adapters.

### UI

Popup and options are extension-owned documents built with Preact and `@preact/signals`. They share one storage-backed settings model and reusable tokenized control kit. The desktop popup is a focused quick-control surface; the responsive options page repeats those quick controls first for Firefox Android, then exposes every setting through searchable groups and progressive disclosure. A separate local flag records the one-time onboarding panel without changing feature settings. Preact is not used in background, content, or page-world code.

## State Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Popup / Options
    participant Signal as enabledSignal
    participant Store as browser.storage.local
    participant Context as Other extension contexts

    User->>UI: Toggle protection
    UI->>Signal: Optimistic update
    UI->>Store: Persist setting
    Store-->>Context: storage.onChanged
    Context->>Signal: Synchronize value
```

## M2a Telemetry Flow

```mermaid
sequenceDiagram
    participant Page as YouTube page
    participant WebRequest as Firefox webRequest
    participant Policy as Telemetry policy
    participant Network as YouTube endpoint

    Page->>WebRequest: First-party request
    WebRequest->>Policy: URL + current mode
    alt Enumerated telemetry endpoint
        Policy-->>WebRequest: Block
        WebRequest--xNetwork: Cancel before transmission
    else Core, media, log_event, or unknown
        Policy-->>WebRequest: Allow
        WebRequest->>Network: Request continues unchanged
    end
```

## Security Boundaries

- Page-world data is untrusted. No page-message handler exists in M0.
- The background never accepts arbitrary URLs.
- Only YouTube page patterns and `*.googlevideo.com` are granted.
- SponsorBlock access is limited to `https://sponsor.ajay.app/*`; LRCLIB remains ungranted until its feature lands.
- Feature failures must leave native YouTube behavior intact.

## M1 Playback Flow

The isolated content layer owns extension storage and sends a fixed boolean settings payload to MAIN world through a namespaced, same-origin `postMessage`. MAIN world owns the credentialless ANDROID_VR fetch, playability gate, SPA generation, visibility override, and `PlayerHandle`. `PlayerHandle` is the sole extension writer to the page video source. Only bounded status codes return to the isolated layer; signed media URLs and player responses remain in MAIN world.

```mermaid
sequenceDiagram
    participant Storage as Extension storage
    participant Content as Isolated content
    participant Main as MAIN world
    participant API as InnerTube
    participant Video as YouTube video

    Storage-->>Content: instant settings update
    Content->>Main: booleans-only CustomEvent
    Main->>API: credentialless ANDROID_VR request
    API-->>Main: player response
    Main->>Main: playability + direct-audio gate
    Main->>Video: PlayerHandle sets audio src
    Main-->>Content: bounded status code
```

Failures and unsupported videos fail open to native playback. SPA navigation invalidates stale asynchronous operations before they can attach media. On every teardown (global disable, navigate, re-attach, or circuit breaker) `PlayerHandle` never rewrites `<video>.src`; the captured native `blob:` source is backed by a discarded MediaSource and reassigning it would stall the element. A MAIN-world coordinator instead reclaims native playback in place through YouTube's own player API (`#movie_player.loadVideoById`) at the live position, pinned to the hijacked `videoId` and guarded by the element still holding the owned URL. The reclaim is one-shot and fail-open.

## M3a Segment-skip Flow

The persistent background hashes each video ID and requests only the four-character SHA-256 prefix from SponsorBlock with credentials omitted and no referrer. It filters the anonymity bucket locally and returns normalized, merged ranges through the isolated content bridge. MAIN world listens on the same `<video>` used by `PlayerHandle`, seeks to a range end at most once per navigation, and discards stale work after SPA navigation. No view-count, submission, voting, or plaintext-video-ID endpoint exists.

```mermaid
sequenceDiagram
    participant Main as MAIN world
    participant Content as Isolated content
    participant Background as Background
    participant Sponsor as SponsorBlock API
    participant Video as Shared page video

    Main->>Content: nonce-authenticated video ID + categories
    Content->>Background: fixed Sponsor segment message
    Background->>Background: SHA-256(video ID), first 4 hex
    Background->>Sponsor: GET /api/skipSegments/prefix (credentials omitted)
    Sponsor-->>Background: anonymity bucket
    Background->>Background: exact local filter + merge
    Background-->>Main: normalized skip ranges
    Video-->>Main: timeupdate
    Main->>Video: seek once to segment end
```

Any hashing, network, parsing, bridge, media, or seek failure returns an empty list or no-op and leaves native playback intact.

## M3b Quality-of-Life Flow

The isolated content layer turns the three cosmetic settings into one extension-managed stylesheet. It replaces the style text on instant storage changes and removes it when globally disabled, without exposing settings through persistent page attributes. The MAIN-world layer feature-detects the native player API for bounded quality-cap reassertion and uses YouTube's own autonav toggle when autoplay-next suppression is enabled.

```mermaid
sequenceDiagram
    participant Storage as Extension storage
    participant Content as Isolated content
    participant Main as MAIN world
    participant Player as YouTube player
    participant DOM as YouTube page

    Storage-->>Content: QoL settings update
    Content->>DOM: Replace one cosmetic stylesheet
    Content->>Main: Nonce-authenticated settings payload
    Main->>Player: Optional quality range + quality hint
    Main->>Player: Optional native autonav toggle click
    Player-->>Main: Quality-change event
    Main->>Player: Bounded quality reassertion
```

Missing selectors, controls, and undocumented player methods are no-ops. No perpetual interval, page prototype patch, DOM deletion, or remote input is used.

## M2b Ad-block Flow

The persistent MV2 background owns deterministic response rewriting. For enabled `/youtubei/v1/player` and `/youtubei/v1/next` POSTs, Firefox `filterResponseData` buffers the original bytes, removes only the bundled allowlist of ad descriptor keys, and emits the rewritten JSON. Any stream, decoding, parsing, or serialization failure emits the original bytes unchanged. Disabling global protection or ad blocking leaves the response filter inert.

```mermaid
sequenceDiagram
    participant Page as YouTube player
    participant Filter as Firefox response filter
    participant Pruner as Pure ad pruner
    participant API as InnerTube

    Page->>API: POST player / next
    API-->>Filter: response bytes
    Filter->>Pruner: buffered UTF-8 JSON
    alt Valid response with known ad keys
        Pruner-->>Filter: JSON without ad descriptors
        Filter-->>Page: rewritten bytes
    else Disabled or any failure
        Filter-->>Page: original bytes unchanged
    end
```

The MAIN-world entrypoint separately applies a small static operation baseline from `rescue.ts`. Its inline-response operation installs a reversible `ytInitialPlayerResponse` accessor and `JSON.parse` wrapper, pruning only parsed player responses that contain known ad keys. The dispatcher accepts only compiled operation IDs, catches failures per operation, and supports cleanup on instant settings changes. A best-effort native-function heuristic skips those hooks when another page-context blocker appears to have wrapped JSON parsing or serialization. The heuristic cannot reliably identify a particular extension because browser extension worlds are isolated. No rescue configuration or code is fetched remotely; that work remains gated on the post-S5 AMO preflight.

## M4 YouTube Music Extras Flow

The MAIN-world layer owns one shared Web Audio graph per media element. It reads YouTube's per-track loudness value from the already-requested player response, applies a bounded gain, and chains the user's five EQ bands in series. The isolated content layer requests lyrics only after explicit opt-in; background calls the fixed LRCLIB endpoint without credentials or referrer, and content renders timed text safely.

```mermaid
sequenceDiagram
    participant Main as MAIN world
    participant Video as Page video
    participant Content as Isolated content
    participant Background as Background
    participant LRCLIB as LRCLIB

    Main->>Video: One MediaElementSource per element
    Main->>Video: EQ filters then normalized GainNode
    Main->>Content: Bounded track metadata
    Content->>Background: Opt-in lyrics request
    Background->>LRCLIB: GET /api/get, credentials omitted
    LRCLIB-->>Content: Timed LRC via background
    Content->>Video: Sync text-only lyric lines to currentTime
```

Any graph, metadata, bridge, remote, parse, or DOM failure is a no-op. Scrobbling is out of scope because it conflicts with ghost mode.

## M5 Audio Download Flow

An off-by-default in-player control initiates a fresh credentialless ANDROID_VR request in MAIN world. MAIN selects the preferred direct audio format and sends a nonce-authenticated JSON-string payload through isolated content. The background independently validates the Googlevideo URL and bounded canonical filename, then uses the downloads API directly. A credentialless Blob fallback is used only when the direct handoff fails.

```mermaid
sequenceDiagram
    participant User
    participant Content as Isolated content
    participant Main as MAIN world
    participant API as InnerTube
    participant Background as Background
    participant Downloads as Firefox downloads

    User->>Content: Click Download audio
    Content->>Main: Nonce + request ID (JSON detail)
    Main->>API: Credentialless ANDROID_VR player POST
    API-->>Main: Direct audio format + title
    Main-->>Content: Validated URL + sanitized filename
    Content->>Background: Fixed download operation
    Background->>Background: Revalidate Googlevideo URL + filename
    Background->>Downloads: Direct downloads.download
```

Acquisition, bridge, validation, direct-download, and fallback failures return a bounded failure result and never alter playback.

## Release and Distribution

One source tree feeds a single Firefox add-on identity, `youtube-audio@animesh.kundus.in` (ADR-0006). Production is the AMO **listed** channel: the listed build omits `update_url`, and AMO is the sole update authority, delivering hands-off auto-update on Firefox desktop and Firefox for Android. A **beta** channel uses the same ID signed **unlisted** at a distinct pre-release version and is installed by hand for desktop and Android testing. Publishing to AMO is on demand (a manual run after testing), never automatic on a tag. AMO credentials (`AMO_JWT_ISSUER` / `AMO_JWT_SECRET`) exist only at signing time. The single ID is wired across `wxt.config.ts`, the bench `ADDON_ID`, and the workflows. `.github/workflows/beta.yml` signs the unlisted beta on a pre-release tag; `.github/workflows/publish-amo.yml` (manual `workflow_dispatch` only) signs the listed production version on demand. The self-hosted `updates.json` path from ADR-0004 is retired for production.

```mermaid
flowchart LR
    Source[WXT source, single ID] --> Beta[Unlisted signed beta: pre-release version]
    Source --> Prod[Listed build: no update_url]
    Beta --> Install[Hand-installed desktop + Android testing]
    Prod --> AMO[AMO listed signature, on-demand publish]
    AMO --> Desktop[Firefox desktop auto-update]
    AMO --> Android[Firefox Android auto-update]
```

## Build Outputs

- `.output/firefox-mv2/`: shipping Firefox MV2 directory.
- `.output/firefox-mv3/`: Firefox MV3 capability directory.
- `dist/youtube-audio.xpi`: stable packaged MV2 artifact consumed by the Selenium harness.
- `dist/youtube-audio-<version>-signed.xpi`: Mozilla-signed unlisted release artifact (created only with AMO credentials).
