---
title: Install YouTube Audio
summary: Add it to Firefox on desktop or Android, use a regular release file, or load a temporary source build.
order: 1
group: Start
---

YouTube Audio plays YouTube and YouTube Music as audio only, which can reduce battery use and mobile data when you do not need the picture. It supports **Firefox 128 or newer** on desktop and Android.

## Install the regular release

1. Open [YouTube Audio on Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/youtube-audio/).
2. Choose **Add to Firefox** and approve the permissions.
3. Open a YouTube video while signed out. Audio-only and background play are ready without setup.

The regular AMO release updates automatically through Firefox. Chrome, Edge, and Safari are not supported because the add-on depends on Firefox network controls.

## Install on Android

Open the same AMO page in Firefox for Android and add the extension. Android gets the same features as desktop, arranged for touch. See [On your phone](../mobile/) for background and lock-screen playback.

## Use a release file or build from source

Regular release `.xpi` files are also available from the project's
[GitHub Releases](https://github.com/animeshkundu/youtube-audio/releases). Install a release
file manually only if you understand that Firefox may require a signed package and that the
Mozilla Add-ons listing is the normal update path.

To try the current source on desktop, clone the
[GitHub repository](https://github.com/animeshkundu/youtube-audio), run `npm install` and
`npm run build`, then open `about:debugging#/runtime/this-firefox`. Choose **Load Temporary
Add-on** and select `manifest.json` inside `.output/firefox-mv2/`. This is a temporary
development load, not a permanent installation, and it disappears when Firefox closes.

## Your first controls

Use the toolbar popup for **Audio-only**, **Background play**, or **Pause YouTube Audio**. Open the full options page for blocking, skipping, music, cleaner, and download settings. Start with [the audio-only guide](../audio/) or review [exactly what leaves your browser](../../privacy/).
