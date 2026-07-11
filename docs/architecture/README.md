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

The persistent MV2 background entrypoint will own privileged APIs, network adapters, downloads, and remote-service proxies. M0 only initializes configuration state; no interception logic is active.

### Isolated content

The content entrypoint runs at `document_start` on the four supported YouTube match patterns. It injects the unlisted MAIN-world bundle and will later own validated cross-world messaging and DOM-facing features.

### MAIN world

The MAIN-world entrypoint is the only layer intended to touch YouTube player APIs and page-owned prototypes. M0 installs no hooks. M1 will implement the proven `<video>.src` hijack behind `PlayerHandle`.

### Shared modules

`src/shared/` contains framework-neutral contracts and pure logic. Feature modules are inert stubs in M0. The real ANDROID_VR request-body builder is implemented here and tested directly. `platform.ts` exposes manifest/background capability flags so later network interception and lifecycle logic can stay behind adapters.

### UI

Popup and options are extension-owned documents built with Preact and `@preact/signals`. They share the same storage-backed enabled state. Preact is not used in background, content, or page-world code.

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

## Security Boundaries

- Page-world data is untrusted. No page-message handler exists in M0.
- The background never accepts arbitrary URLs.
- Only YouTube page patterns and `*.googlevideo.com` are granted.
- SponsorBlock and LRCLIB origins remain ungranted placeholders until their opt-in features land.
- Feature failures must leave native YouTube behavior intact.

## Build Outputs

- `.output/firefox-mv2/`: shipping Firefox MV2 directory.
- `.output/firefox-mv3/`: Firefox MV3 capability directory.
- `dist/youtube-audio.xpi`: stable packaged MV2 artifact consumed by the Selenium harness.
