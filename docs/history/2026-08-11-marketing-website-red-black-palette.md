# Marketing website red and black palette

## Scope

- Replaced the website light and dark colour token values with a red, black, and neutral-grey
  identity.
- Reserved saturated red for the primary install action and brand mark. Secondary accent
  roles now use black-derived neutral greys.
- Preserved every component, layout, route, section, sentence, and deployment setting.
- Added an opt-in `FOCUS_CROP=1` mode to `website/shoot.mjs`. It requires `FOCUS_TARGET`,
  keeps existing focus captures full-page by default, and uses a padded viewport-space clip.
- Left the static aqua favicon and social card unchanged because the request limited colour
  changes to the token layer. Product screenshots also remain unchanged because they show the
  extension rather than the marketing palette.

## Accessibility measurements

All ratios are WCAG contrast ratios computed from the final token values. Text pairs exceed
4.5:1, and boundaries and focus indicators exceed 3:1 against their adjacent surfaces.

| Theme | Token                 | Canvas | Surface | Subtle | Accent surface | Status surface |
| ----- | --------------------- | -----: | ------: | -----: | -------------: | -------------: |
| Light | Content               |  16.29 |   17.76 |  14.49 |          13.20 |          15.92 |
| Light | Muted content         |   7.75 |    8.45 |   6.90 |           6.28 |           7.58 |
| Light | Subtle content        |   5.86 |    6.39 |   5.21 |           4.75 |           5.72 |
| Light | Secondary accent text |   5.86 |    6.39 |   5.21 |           4.75 |           5.72 |
| Dark  | Content               |  18.48 |   17.05 |  14.49 |          13.04 |          13.59 |
| Dark  | Muted content         |  11.71 |   10.80 |   9.18 |           8.26 |           8.61 |
| Dark  | Subtle content        |   9.13 |    8.42 |   7.16 |           6.44 |           6.71 |
| Dark  | Secondary accent text |   9.66 |    8.91 |   7.57 |           6.81 |           7.10 |

Secondary accent text also measures 4.98:1 on its light neutral tile and 6.44:1 on its dark
neutral tile. Accent ink measures 5.93:1, 5.36:1, and 7.68:1 on the light default,
highlight, and hover reds. The dark equivalents measure 5.93:1, 6.99:1, and 4.65:1.
Code content on the image surface measures 18.88:1 in light and 19.22:1 in dark. Selection
content measures 12.58:1 in light and 12.47:1 in dark.

| Theme | Focus on canvas | Surface | Raised | Subtle | Accent surface | Status surface | Image surface | Red CTA |
| ----- | --------------: | ------: | -----: | -----: | -------------: | -------------: | ------------: | ------: |
| Light |            4.89 |    5.33 |   5.33 |   4.35 |           3.96 |           4.78 |          3.54 |    1.11 |
| Dark  |           19.80 |   18.26 |  17.04 |  15.52 |          13.97 |          14.56 |         20.14 |    3.27 |

The light neutral focus ring is intentionally separated from the red CTA by the positive
0.1875rem outline offset, so its adjacent colour is the 4.89:1 canvas rather than the button
fill. The dark white ring clears both the canvas and red fill directly. Captures confirm both
rings remain visible.

| Theme | Status  | Surface | Status surface | Canvas | Brand red |
| ----- | ------- | ------: | -------------: | -----: | --------: |
| Light | Success |    7.30 |           6.55 |   6.70 |      1.23 |
| Light | Warning |    7.06 |           6.33 |   6.47 |      1.19 |
| Light | Danger  |   10.27 |           9.20 |   9.42 |      1.73 |
| Dark  | Success |   10.51 |           8.38 |  11.40 |      1.88 |
| Dark  | Warning |   11.38 |           9.08 |  12.34 |      2.04 |
| Dark  | Danger  |    9.13 |           7.28 |   9.90 |      1.63 |

Status meaning does not depend on these hue or lightness differences. Success is a labelled
dot, while warnings use an amber panel, a left rule or warning glyph, and explanatory text.
The danger role is not currently rendered. Success and danger differ by 1.41:1 in light and
1.15:1 in dark, so their semantic label and shape remain required.

The weakest rendered boundary exceeded 3:1 in both themes. The minimum light focus-to-surface
ratio was 3.54:1 against the image surface, and the minimum dark focus-to-surface ratio was
13.97:1.

| Theme | Boundary token | Canvas | Surface | Raised | Subtle | Accent surface | Status surface |
| ----- | -------------- | -----: | ------: | -----: | -----: | -------------: | -------------: |
| Light | Border         |   4.29 |    4.67 |   4.67 |   3.81 |           3.47 |           4.19 |
| Light | Strong border  |   5.77 |    6.29 |   6.29 |   5.13 |           4.67 |           5.64 |
| Dark  | Border         |   5.01 |    4.62 |   4.32 |   3.93 |           3.54 |           3.69 |
| Dark  | Strong border  |   6.95 |    6.41 |   5.98 |   5.45 |           4.90 |           5.11 |

The decorative border token currently shares the measured regular-border value. Rendered
boundary checks use computed colours against both the component and its outer background.

## Screenshot evidence

Every cell below is a full-page capture of the named route. Mobile is 390x844, tablet is
768x900, and desktop is 1440x900.

These workspace artifacts are gitignored and intentionally not committed. This handoff
supersedes the aqua palette and `core-*` screenshot manifest recorded in the 2026-08-10
marketing website redesign handoff.

| Route          | Light mobile                                             | Light tablet                                             | Light desktop                                             | Dark mobile                                             | Dark tablet                                             | Dark desktop                                             |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Landing        | `.factory-preview/palette-home-mobile-light.png`         | `.factory-preview/palette-home-tablet-light.png`         | `.factory-preview/palette-home-desktop-light.png`         | `.factory-preview/palette-home-mobile-dark.png`         | `.factory-preview/palette-home-tablet-dark.png`         | `.factory-preview/palette-home-desktop-dark.png`         |
| Guide index    | `.factory-preview/palette-guide-mobile-light.png`        | `.factory-preview/palette-guide-tablet-light.png`        | `.factory-preview/palette-guide-desktop-light.png`        | `.factory-preview/palette-guide-mobile-dark.png`        | `.factory-preview/palette-guide-tablet-dark.png`        | `.factory-preview/palette-guide-desktop-dark.png`        |
| Audio guide    | `.factory-preview/palette-audio-mobile-light.png`        | `.factory-preview/palette-audio-tablet-light.png`        | `.factory-preview/palette-audio-desktop-light.png`        | `.factory-preview/palette-audio-mobile-dark.png`        | `.factory-preview/palette-audio-tablet-dark.png`        | `.factory-preview/palette-audio-desktop-dark.png`        |
| Blocking guide | `.factory-preview/palette-blocking-mobile-light.png`     | `.factory-preview/palette-blocking-tablet-light.png`     | `.factory-preview/palette-blocking-desktop-light.png`     | `.factory-preview/palette-blocking-mobile-dark.png`     | `.factory-preview/palette-blocking-tablet-dark.png`     | `.factory-preview/palette-blocking-desktop-dark.png`     |
| Cleaner guide  | `.factory-preview/palette-cleaner-mobile-light.png`      | `.factory-preview/palette-cleaner-tablet-light.png`      | `.factory-preview/palette-cleaner-desktop-light.png`      | `.factory-preview/palette-cleaner-mobile-dark.png`      | `.factory-preview/palette-cleaner-tablet-dark.png`      | `.factory-preview/palette-cleaner-desktop-dark.png`      |
| Download guide | `.factory-preview/palette-download-mobile-light.png`     | `.factory-preview/palette-download-tablet-light.png`     | `.factory-preview/palette-download-desktop-light.png`     | `.factory-preview/palette-download-mobile-dark.png`     | `.factory-preview/palette-download-tablet-dark.png`     | `.factory-preview/palette-download-desktop-dark.png`     |
| FAQ guide      | `.factory-preview/palette-faq-mobile-light.png`          | `.factory-preview/palette-faq-tablet-light.png`          | `.factory-preview/palette-faq-desktop-light.png`          | `.factory-preview/palette-faq-mobile-dark.png`          | `.factory-preview/palette-faq-tablet-dark.png`          | `.factory-preview/palette-faq-desktop-dark.png`          |
| Install guide  | `.factory-preview/palette-install-mobile-light.png`      | `.factory-preview/palette-install-tablet-light.png`      | `.factory-preview/palette-install-desktop-light.png`      | `.factory-preview/palette-install-mobile-dark.png`      | `.factory-preview/palette-install-tablet-dark.png`      | `.factory-preview/palette-install-desktop-dark.png`      |
| Mobile guide   | `.factory-preview/palette-mobile-mobile-light.png`       | `.factory-preview/palette-mobile-tablet-light.png`       | `.factory-preview/palette-mobile-desktop-light.png`       | `.factory-preview/palette-mobile-mobile-dark.png`       | `.factory-preview/palette-mobile-tablet-dark.png`       | `.factory-preview/palette-mobile-desktop-dark.png`       |
| Music guide    | `.factory-preview/palette-music-mobile-light.png`        | `.factory-preview/palette-music-tablet-light.png`        | `.factory-preview/palette-music-desktop-light.png`        | `.factory-preview/palette-music-mobile-dark.png`        | `.factory-preview/palette-music-tablet-dark.png`        | `.factory-preview/palette-music-desktop-dark.png`        |
| Settings guide | `.factory-preview/palette-settings-mobile-light.png`     | `.factory-preview/palette-settings-tablet-light.png`     | `.factory-preview/palette-settings-desktop-light.png`     | `.factory-preview/palette-settings-mobile-dark.png`     | `.factory-preview/palette-settings-tablet-dark.png`     | `.factory-preview/palette-settings-desktop-dark.png`     |
| How it works   | `.factory-preview/palette-how-it-works-mobile-light.png` | `.factory-preview/palette-how-it-works-tablet-light.png` | `.factory-preview/palette-how-it-works-desktop-light.png` | `.factory-preview/palette-how-it-works-mobile-dark.png` | `.factory-preview/palette-how-it-works-tablet-dark.png` | `.factory-preview/palette-how-it-works-desktop-dark.png` |
| Privacy        | `.factory-preview/palette-privacy-mobile-light.png`      | `.factory-preview/palette-privacy-tablet-light.png`      | `.factory-preview/palette-privacy-desktop-light.png`      | `.factory-preview/palette-privacy-mobile-dark.png`      | `.factory-preview/palette-privacy-tablet-dark.png`      | `.factory-preview/palette-privacy-desktop-dark.png`      |

| Path                                                                    | Caption                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.factory-preview/detail-desktop-light-00--hero-data-install-.png`      | Primary hero install CTA close-up, light theme, 1440px viewport                     |
| `.factory-preview/detail-desktop-dark-00--hero-data-install-.png`       | Primary hero install CTA close-up, dark theme, 1440px viewport                      |
| `.factory-preview/focus-home-mobile-light-keyboard-focus.png`           | Keyboard-focused primary install CTA and neutral ring, light theme, 390px viewport  |
| `.factory-preview/focus-home-desktop-light-keyboard-focus.png`          | Keyboard-focused primary install CTA and neutral ring, light theme, 1440px viewport |
| `.factory-preview/focus-home-mobile-dark-keyboard-focus.png`            | Keyboard-focused primary install CTA and white ring, dark theme, 390px viewport     |
| `.factory-preview/focus-home-desktop-dark-keyboard-focus.png`           | Keyboard-focused primary install CTA and white ring, dark theme, 1440px viewport    |
| `.factory-preview/detail-desktop-light-01--browser-note.png`            | Warning panel with glyph and explanatory text, light theme, 1440px viewport         |
| `.factory-preview/detail-desktop-dark-01--browser-note.png`             | Warning panel with glyph and explanatory text, dark theme, 1440px viewport          |
| `.factory-preview/detail-desktop-light-02--savings-caveat.png`          | Amber savings caveat with text and left rule, light theme, 1440px viewport          |
| `.factory-preview/detail-desktop-dark-02--savings-caveat.png`           | Amber savings caveat with text and left rule, dark theme, 1440px viewport           |
| `.factory-preview/status-desktop-light-00-figure-has-status-dot-on.png` | Labelled success status row, light theme, 1440px viewport                           |
| `.factory-preview/status-desktop-dark-00-figure-has-status-dot-on.png`  | Labelled success status row, dark theme, 1440px viewport                            |
| `.factory-preview/sections-1440-light-03-y2700.png`                     | Install section viewport detail, light theme, 1440px viewport                       |
| `.factory-preview/sections-1440-dark-03-y2700.png`                      | Install section viewport detail, dark theme, 1440px viewport                        |

## Verification

- The Astro production build generated all 13 routes.
- The `VALIDATE=1` screenshot matrix passed all structural, keyboard, contrast, boundary,
  reduced-motion, overflow, image, and first-viewport assertions for 78 route-theme-width
  combinations.
- The padded focus crop was exercised against the primary hero CTA in both themes at mobile
  and desktop widths, and against a below-fold install action in both themes at mobile width.
- The full-page, section, CTA, focus, warning, caveat, and status captures were visually
  inspected. No muddy neutral, competing aqua accent, clipped focus ring, or unreadable state
  was observed in the inspected captures.
- No extension source, manifest, test, package, lockfile, Astro configuration, or deployment
  file changed.
