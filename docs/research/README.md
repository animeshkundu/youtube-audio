# Research

Before any of this got built, it got investigated. Every non-obvious claim in
the product, "this is the only way to get audio without a login," "Firefox is
the only browser that can block ads this way," "this is how you skip a
sponsor segment without leaking what you're watching," started as a question
here, not an assumption in a spec.

The rule was simple: if we were not sure how something worked, we went and
found out, against the real API, the real browser, or the real upstream
project, before writing a line of production code. What follows is that trail,
in the order the questions came up.

| # | Topic | What it settled |
|---|---|---|
| 01 | [Audio-only playback](01-disable-video-audio-only.md) | How to get a direct audio stream and hijack the player without breaking it |
| 02 | [YouTube ad blocking](02-youtube-ad-blocking.md) | Where ads live in the player response and how to strip them |
| 03 | [Firefox mobile support](03-firefox-mobile-support.md) | What Firefox for Android actually supports, and where it differs from desktop |
| 04 | [YouTube streaming internals](04-youtube-streaming-internals.md) | How InnerTube, adaptive formats, and playback URLs fit together |
| 05 | [Ghost mode & anti-tracking](05-ghost-mode-anti-tracking.md) | Which telemetry endpoints are safe to drop and which ones playback depends on |
| 06 | [Background playback & media controls](06-background-playback-media-controls.md) | Keeping audio alive across tabs and the lock screen |
| 07 | [Distribution, signing & updates](07-distribution-signing-updates.md) | How Firefox add-on signing and auto-update actually work |
| 08 | [Resilience & testing](08-resilience-and-testing.md) | How to test a browser extension without a human clicking every time |
| 09 | [Segment skipping](09-segment-skipping.md) | Doing SponsorBlock-style skipping without ever sending a full video ID |
| 10 | [Quality-of-life UX](10-quality-of-life-ux.md) | The small toggles worth building, and the ones not worth the complexity |
| 11 | [Audio download & offline](11-audio-download-offline.md) | Getting a clean, portable audio file out of a stream |
| 12 | [YouTube Music features](12-youtube-music-features.md) | What's worth adding on top of Music specifically: loudness, EQ |
| 13 | [ANDROID_VR probe](13-androidvr-probe.md) | The client surface that made credentialless audio possible in the first place |
| 14 | [Design language & UX](14-design-language-and-ux.md) | Early groundwork for the visual language the product uses today |
| 17 | [Phase 0 spike results](17-phase0-spike-results.md) | What the earliest proof-of-concept spikes actually proved |
| 18 | [Firefox Android testing](18-firefox-android-testing-constrained-mac.md) | Testing Android Firefox from a machine that cannot run the Android emulator well |
| 19 | [AMO channels & on-demand publish](19-amo-channels-and-ondemand-publish.md) | How the listed and beta channels coexist under one add-on identity |

Findings here are grounding, not gospel: several were later revisited in
[ADRs](../adrs/README.md) once we had to commit to a direction, and a few were
superseded outright once real testing on real Firefox disagreed with the
theory. Where that happened, the newer document wins.
