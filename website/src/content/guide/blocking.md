---
title: Blocking and skipping
summary: Ghost mode, bounded ad-descriptor blocking, optional segment skipping, and fallback.
order: 3
group: Features
---

Audio-only remains the main way YouTube Audio can reduce battery and data use. Its optional protection tools support that quieter experience by blocking known ads and tracking requests, and by skipping selected parts inside videos.

## Choose what to block

Open the full options page, then use **Privacy and Blocking** to control ad blocking and Ghost mode. The popup shows a short blocking summary, but the individual switches live in options. Use **Pause YouTube Audio** in the popup when you want every feature temporarily disabled.

**Ghost mode** blocks a fixed allowlist of seven YouTube activity-reporting endpoint
patterns before they leave Firefox. Core requests needed for signed-out playback are
allowed. **Aggressive telemetry blocking** adds the watch-time and playback patterns, for
nine in total, but it can make history and saved position less reliable, so it is off until
you enable it.

The ad blocker removes known ad descriptions from YouTube's player responses before the
native player sees them. It does not promise to remove every server-inserted ad. If a
response is unfamiliar or cannot be handled safely, the original response continues
unchanged.

## Skip sponsor and non-music segments

Segment skipping is off by default and requires a separate consent opt-in. In the options
page, open **Skipping** and turn it on when you want community timings from
[SponsorBlock](https://sponsor.ajay.app/). Only sponsor reads and non-music sections are
supported.

When skipping is enabled, the lookup sends only the first **four characters** of a hash of the video ID, without cookies or a referrer. SponsorBlock returns a larger bucket, and the exact match happens on your device. See [Privacy](../../privacy/) for the full data flow.

All three tools fail open. A block, lookup, or skip that cannot be completed becomes a no-op, so normal YouTube playback remains available. For every related switch, see the [settings reference](../settings/).
