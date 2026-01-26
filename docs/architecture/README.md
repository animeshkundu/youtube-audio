# Architecture Documentation

## Purpose

This folder contains high-level system architecture documentation using Mermaid.js diagrams and design documents.

## Current Architecture

### YouTube Audio Browser Extension Architecture

```mermaid
flowchart TD
    subgraph Browser["Browser Environment"]
        subgraph Extension["YouTube Audio Extension"]
            BG[Background Script<br/>global.js]
            CS[Content Script<br/>youtube_audio.js]
            OP[Options Page<br/>options.js]
        end

        subgraph APIs["Browser APIs"]
            WR[WebRequest API]
            ST[Storage API]
            TB[Tabs API]
            BA[BrowserAction API]
        end

        subgraph YouTube["YouTube Page"]
            VP[Video Player]
            DOM[Page DOM]
        end
    end

    User([User]) -->|Click Extension Icon| BA
    BA -->|Toggle State| BG
    BG -->|Enable/Disable| WR
    WR -->|Intercept Audio URL| BG
    BG -->|Send Audio URL| CS
    CS -->|Replace Video Source| VP
    CS -->|Add Audio-Only Indicator| DOM
    BG <-->|Store State| ST
    OP <-->|Read/Write Settings| ST
    BG <-->|Track Active Tabs| TB
```

### Component Responsibilities

#### Background Script (`global.js`)

- Manages extension state (enabled/disabled)
- Intercepts WebRequests to detect audio streams
- Communicates audio URLs to content scripts
- Handles tab lifecycle management

#### Content Script (`youtube_audio.js`)

- Receives audio URLs from background script
- Replaces video source with audio-only stream
- Displays user notification overlay
- Respects user preferences from storage

#### Options Page (`options.js`)

- Provides user preferences UI
- Saves settings to browser storage

### Data Flow

```mermaid
sequenceDiagram
    participant User
    participant BrowserAction
    participant Background as Background Script
    participant Storage
    participant WebRequest
    participant Content as Content Script
    participant VideoPlayer

    User->>BrowserAction: Click icon
    BrowserAction->>Background: Toggle state
    Background->>Storage: Save new state
    Background->>Background: Enable/Disable WebRequest listener

    Note over Background,VideoPlayer: When extension is enabled

    WebRequest->>Background: Intercept request with mime=audio
    Background->>Background: Parse and clean URL
    Background->>Content: Send audio URL
    Content->>VideoPlayer: Replace src with audio URL
    Content->>Content: Show notification overlay
```

## Adding Diagrams

### Mermaid.js Syntax

All diagrams should be written in Mermaid.js for version control and rendering in Markdown.

### Common Diagram Types

- **Flowchart**: System components and relationships
- **Sequence**: Data flow and interactions
- **Class**: Module structures
- **State**: State machines and transitions

### Resources

- [Mermaid Documentation](https://mermaid.js.org/intro/)
- [Mermaid Live Editor](https://mermaid.live)
