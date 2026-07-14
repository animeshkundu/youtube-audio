---
title: Install YouTube Audio
summary: Add it to Firefox on desktop or Android, install the beta channel, or build it from source.
order: 1
group: Start
---

YouTube Audio plays YouTube and YouTube Music as audio only, which can reduce battery use and mobile data when you do not need the picture. It supports **Firefox 128 or newer** on desktop and Android.

## Install the regular release

1. Open [YouTube Audio on Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/youtube-audio/).
2. Choose **Add to Firefox** and approve the permissions.
3. Open a YouTube video while signed out. Audio-only and background play are ready without setup.

The regular AMO release updates automatically through Firefox. Chrome, Edge, and Safari are not supported because the add-on depends on Firefox network controls.

## Install on Android

Open the same AMO page in Firefox for Android and add the extension. Android gets the same features as desktop, arranged for touch. See [On your phone](/youtube-audio/guide/mobile/) for background and lock-screen playback.

## Try a beta or build from source

Signed beta files are installed manually. Download the beta `.xpi` from the project's [GitHub releases](https://github.com/animeshkundu/youtube-audio/releases), then use Firefox's **Install Add-on From File** on desktop or **Install extension from file** on Android. Beta updates are manual.

To try the current source on desktop, clone the [GitHub repository](https://github.com/animeshkundu/youtube-audio), run `npm install` and `npm run build`, then open `about:debugging#/runtime/this-firefox`. Choose **Load Temporary Add-on** and select `manifest.json` inside `.output/firefox-mv2/`. Temporary installs disappear when Firefox closes.

## Your first controls

Use the toolbar popup for **Audio-only**, **Background play**, or **Pause YouTube Audio**. Open the full options page for blocking, skipping, music, cleaner, and download settings. Start with [the audio-only guide](/youtube-audio/guide/audio/) or review [exactly what leaves your browser](/youtube-audio/privacy/).
