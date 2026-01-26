# YouTube Audio 🎵

[![CI](https://github.com/animeshkundu/youtube-audio/actions/workflows/ci.yml/badge.svg)](https://github.com/animeshkundu/youtube-audio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Stream only audio from YouTube videos - Save battery and bandwidth

## Overview

YouTube Audio is a browser extension that disables video playback and streams only the audio from YouTube videos. Perfect for listening to music, podcasts, and any audio content without the battery drain and bandwidth usage of video.

**🌐 Website:** [animeshkundu.github.io/youtube-audio](https://animeshkundu.github.io/youtube-audio)

**🦊 Firefox:** [Install from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/youtube-audio/)

## Features

- 🔋 **Save Battery** - No video decoding means significantly less battery usage
- 📶 **Save Bandwidth** - Audio streams are 10-20x smaller than video
- 🎯 **One-Click Toggle** - Enable/disable with a single click
- 🌡️ **Reduce Heat** - Your device stays cool during long listening sessions
- 🔒 **Privacy Focused** - No tracking, no analytics, works entirely locally
- ⚡ **Lightweight** - Minimal footprint, only activates on YouTube

## Installation

### Firefox (Recommended)

Install directly from the [Firefox Add-ons Store](https://addons.mozilla.org/en-US/firefox/addon/youtube-audio/).

### Chrome

Coming soon! Contributions welcome.

### From Source

1. Clone the repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on"
4. Select the `manifest.json` file

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Run linter
npm run lint

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Format code
npm run format
```

### Project Structure

```
youtube-audio/
├── js/                     # Extension source code
│   ├── global.js          # Background script
│   ├── youtube_audio.js   # Content script
│   └── options.js         # Options page
├── css/                    # Stylesheets
├── html/                   # HTML pages
├── img/                    # Icons
├── tests/                  # Jest tests
├── docs/                   # Documentation
│   ├── adrs/              # Architecture Decision Records
│   ├── specs/             # Technical specifications
│   ├── architecture/      # System diagrams
│   └── agent-instructions/ # AI agent protocols
├── website/               # GitHub Pages website
└── scripts/               # Automation scripts
```

## Documentation

This repository is **AI-Enabled** and optimized for agentic coding. Key documentation:

- **[Agent Instructions](docs/agent-instructions/)** - Protocols for AI agents
- **[Architecture](docs/architecture/)** - System design and diagrams
- **[Specifications](docs/specs/)** - Technical specifications
- **[ADRs](docs/adrs/)** - Architecture Decision Records

## Contributing

Contributions are welcome! Please:

1. Read the [agent instructions](docs/agent-instructions/) before making changes
2. Create a specification for new features
3. Write tests for new functionality
4. Run `npm run lint` and `npm test` before submitting

## License

[MIT License](LICENSE) - Free and open source

## Author

**Animesh Kundu** - [GitHub](https://github.com/animeshkundu)
