# YouTube Music, loudness and EQ

On YouTube Music, the add-on adds two things people usually pay for: it evens
out the volume between tracks, and it lets you shape the sound with an
equalizer. Both run through one small audio graph, and both leave the rest of
YouTube alone.

<figure class="shot" markdown>
![The Music settings: normalize loudness on, equalizer on, and a five-band slider grid at 60 Hz, 250 Hz, 1 kHz, 4 kHz, and 12 kHz.](../assets/screenshots/options-music.png)
</figure>

## Loudness normalization

Some tracks are mastered loud, some quiet, and playing a mixed playlist usually
means riding the volume knob all evening. Loudness normalization reads the
loudness value YouTube already ships with each track and applies a gentle,
bounded gain so everything lands at roughly the same level. It is on by default.

## The five-band equalizer

Turn the equalizer on and five sliders appear, one each for **60 Hz, 250 Hz,
1 kHz, 4 kHz, and 12 kHz**. Each goes from minus twelve to plus twelve
decibels, so you can add some low-end warmth, brighten the top, or scoop the
middle, whatever suits your headphones and your ears.

The bands are applied in series, right before the loudness stage, so the two
features stack cleanly. Leave every slider at zero and the equalizer is
perfectly flat, which is where it starts.

!!! tip "It only touches YouTube Music"
    Loudness and the equalizer are scoped to YouTube Music, where per-track
    loudness data exists and where people listen to music back to back. On
    regular YouTube they simply stay out of the way.

Next: [saving audio :material-arrow-right:](download.md)
