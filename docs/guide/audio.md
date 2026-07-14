# The audio-only experience

This is the heart of it. YouTube Audio plays the sound of a video and stops the
video itself from downloading, so a long listen costs you a fraction of the
battery and data it normally would.

## What actually changes

When you open a video, the add-on quietly fetches a direct audio stream and
points the page's own player at it. The native player stays exactly where it is,
with all its usual controls. What goes away is the video download: the bytes
that were being pulled just to draw pixels you were not watching.

<figure class="shot" markdown>
![Audio mode shows the track artwork on a soft gradient instead of a black video rectangle.](../assets/screenshots/player-artwork.png)
<figcaption>In audio mode the player shows the track's artwork instead of a black rectangle. Shown on the project's local test page rather than a real video.</figcaption>
</figure>

Because the real player is still in charge, everything you already know keeps
working: the scrubber, the play and pause button, keyboard shortcuts, the
timeline, all of it.

## The button in the player

You do not have to open anything to switch. There is a small audio button right
next to YouTube's own controls, styled to match them. Tap it to move between
audio and video, and the first time you do, a short tooltip points it out.

Switching back to video drops you at the exact spot you were listening, playing
if you were playing, paused if you were paused. No jump to the start, no frozen
player, even if you flip it on and off quickly.

## Background and lock-screen play

Normally YouTube pauses or throttles a tab you are not looking at. With
background play on, the sound keeps going when you switch tabs or lock your
phone, and your usual OS and lock-screen media controls keep working, because
the add-on leaves the native media session untouched.

<figure class="frame-popup" markdown>
![The popup with audio-only on and background play on for the current video.](../assets/screenshots/popup-panel-active.png)
</figure>

Both **Audio-only** and **Background play** sit right at the top of the popup, so
they are one tap away. They are on out of the box.

## When it steps aside

Some videos cannot be served as a plain audio stream, and the add-on does not
pretend otherwise. Live streams, members-only uploads, age-restricted videos,
and anything made for kids fall back to normal YouTube playback. Nothing breaks,
and the popup tells you what happened so you are never guessing.

<figure class="frame-popup" markdown>
![The popup being honest about a live stream: it is playing normally.](../assets/screenshots/popup-panel-fallback.png)
</figure>

There is more on that honesty in [the popup and settings](settings.md), and the
full mechanism is in [How it works](../architecture/README.md).

Next: [blocking ads, trackers, and sponsors :material-arrow-right:](blocking.md)
