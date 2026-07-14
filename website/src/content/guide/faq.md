---
title: Questions and answers
summary: Live streams, other browsers, what gets sent anywhere, and how to get help.
order: 9
group: Reference
---

## Does it work while I am signed in?

Signed-out use is the only supported mode. The add-on does not need or attach your YouTube login. If content requires an account, normal YouTube handles it instead.

## Why is a video still playing normally?

Live and DVR streams, age-restricted videos, members-only uploads, and content made for kids are not switched to direct audio. A failed audio lookup also falls back. Check the popup for the current video's real state. See [The audio-only experience](/youtube-audio/guide/audio/).

## How do I turn it off?

Switch **Audio-only** off in the popup or options page to bring back video. Use **Pause YouTube Audio** in the popup to disable every feature temporarily. Individual blocking, skipping, cleaner, music, and download controls are in the options page. **Reset to defaults** under Advanced restores the original setup.

## Why is the player button missing?

Make sure the add-on is not paused and you are on a YouTube or YouTube Music watch page. There is no player control on browsing or search pages. Reload once if YouTube changed pages while installing the add-on.

## Where did my download go?

Firefox saves the `.m4a` in its configured download location. The button appears only after **Download audio** is enabled in options. See [Save a track](/youtube-audio/guide/download/).

## What leaves my device?

Core playback sends YouTube a credentialless audio lookup, and the selected media streams from Google's media servers. Both services can see your IP address, but the requests carry no YouTube cookies. Optional segment skipping sends SponsorBlock only a four-character hash prefix. The project runs no analytics or server and receives no browsing or playback data. Read [Privacy](/youtube-audio/privacy/) for details.

## Does it support other browsers?

No. Firefox 128 or newer on desktop and Android is supported. The blocking features rely on Firefox network APIs unavailable in the required form on Chrome, Edge, or Safari.

## How do I report a problem?

Open options, go to **Help and feedback**, and review the local diagnostics preview. Copy it or open a [GitHub issue](https://github.com/animeshkundu/youtube-audio/issues). The preview is designed to omit what you watched, searched for, or typed.
