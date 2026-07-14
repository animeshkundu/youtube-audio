---
title: Save a track
summary: Turn on the in-player download and save the current audio as a tidy .m4a file.
order: 5
group: Features
---

Audio-only is designed for lighter listening in Firefox. When you also want an offline copy, YouTube Audio can save the current track as one `.m4a` file through Firefox's normal download system.

## Show the download button

Downloading is off by default, so it does not add a control unless you ask for one.

1. Open the full options page from the toolbar popup.
2. Find **Downloads** and turn on **Download audio**.
3. Return to a YouTube or YouTube Music watch page. A save-audio button appears beside the audio button in the player.

Select that button to start. It spins while Firefox fetches the audio, shows a check when the download is ready, and reports a failure instead of leaving unfinished fragments behind. Turn **Download audio** off in options to remove the player button. The popup does not have a separate download switch, though **Pause YouTube Audio** temporarily steps the whole add-on aside.

## What gets saved

The add-on requests a fresh direct audio stream without attaching your YouTube cookies, selects compatible AAC audio, creates a safe filename from the track title, and hands it to Firefox. Your file goes to the download location configured in Firefox.

The result is one standard `.m4a` file. Availability still depends on YouTube returning a suitable direct audio format. If lookup, validation, or download fails, current playback is not changed.

Use downloads only for material you are allowed to save, and follow the rights and rules that apply where you live. Read [Privacy](/youtube-audio/privacy/) for the network details, or see [the settings reference](/youtube-audio/guide/settings/) for every optional control.
