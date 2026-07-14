# Questions and troubleshooting

## Everyday questions

??? question "Does it work while I am signed into YouTube?"
    It is built for signed-out use, and that is the only supported mode. It
    never reads or touches your account. If a particular video needs a login to
    play at all, it falls back to normal YouTube.

??? question "Why did a video keep playing as normal video?"
    Some videos cannot be served as a plain audio stream: live streams,
    members-only uploads, age-restricted videos, and anything made for kids. In
    those cases the add-on hands you back to normal YouTube on purpose. The
    popup will tell you exactly why.

??? question "The audio button is not in the player."
    Make sure the add-on is not paused (check the popup), and that you are on a
    watch page. On a page that is not a video, there is nothing to control yet.

??? question "I hid recommendations but my comments disappeared too."
    They should not, and current versions are careful to hide only the
    recommendations rail. If you still see this, the diagnostics reporter in
    settings is the fastest way to get it looked at.

??? question "Where do my downloads go?"
    Wherever Firefox saves downloads. The file is a single `.m4a`, named from the
    track, that opens in any music app. See [Saving audio](download.md).

## Making it behave

??? question "Something feels off. How do I report it?"
    Open settings, scroll to **Help and feedback**, and use the reporter. It
    builds a readable log you can check word for word before sending, and it
    contains nothing personal. See [Privacy](privacy.md).

??? question "How do I start fresh?"
    Settings has a **Reset to defaults** button under Advanced. It restores every
    option to how it shipped, and asks you to confirm first.

??? question "I want the plain YouTube experience for a moment."
    Use **Pause YouTube Audio** at the bottom of the popup. It steps the whole
    add-on aside until you switch it back on, without changing any of your
    settings.

## For the curious

??? question "Chrome, Edge, or Safari?"
    Not today. The blocking and response-editing this relies on need Firefox's
    network APIs, which those browsers' current extension platforms do not
    offer. Firefox desktop and Firefox for Android are the supported targets.

??? question "How does the audio-only trick actually work?"
    It asks YouTube's own player API for a direct audio stream without your
    cookies, then points the page's video element at it. The long version, with
    diagrams, is in [How it works](../architecture/README.md).

??? question "Is it really open source?"
    Yes, GPL-3.0, built in the open. The
    [architecture](../architecture/README.md), [decisions](../adrs/README.md),
    and [research](../research/01-disable-video-audio-only.md) that shaped it are
    all published here too.
