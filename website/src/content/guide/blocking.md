---
title: No ads, no tracking
summary: Ghost mode, ad blocking, and how both fail open to normal YouTube.
order: 3
group: Features
---

Audio-only remains the main way YouTube Audio can reduce battery and data use. Its optional protection tools support that quieter experience by blocking known ads and tracking requests, and by skipping selected parts inside videos.

## Choose what to block

Open the full options page, then use **Privacy and Blocking** to control ad blocking and Ghost mode. The popup shows a short blocking summary, but the individual switches live in options. Use **Pause YouTube Audio** in the popup when you want every feature temporarily disabled.

**Ghost mode** blocks a careful list of YouTube activity-reporting requests before they leave Firefox. Core requests needed for signed-out playback are allowed. **Aggressive telemetry blocking** also blocks watch-time and playback statistics, but it can make history and saved position less reliable, so it is off until you enable it.

The ad blocker removes known ad descriptions from YouTube's player responses before the native player sees them. If a response is unfamiliar or cannot be handled safely, the original response continues unchanged.

## Skip sponsor and non-music segments

In the options page, open **Skipping** and turn segment skipping or either category on or off. Sponsor reads and non-music sections use community timings from [SponsorBlock](https://sponsor.ajay.app/).

When skipping is enabled, the lookup sends only the first **four characters** of a hash of the video ID, without cookies or a referrer. SponsorBlock returns a larger bucket, and the exact match happens on your device. See [Privacy](/youtube-audio/privacy/) for the full data flow.

All three tools fail open. A block, lookup, or skip that cannot be completed becomes a no-op, so normal YouTube playback remains available. For every related switch, see the [settings reference](/youtube-audio/guide/settings/).
