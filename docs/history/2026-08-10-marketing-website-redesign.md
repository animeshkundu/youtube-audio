# Marketing website redesign

## Scope

- Rebuilt the Astro marketing website around a complete aqua and neutral token system with
  light and dark themes.
- Replaced the landing page with a six-stage visitor journey: product and audience, real
  product states, savings mechanism and illustrative scale, desktop and Android install
  paths, explicit limits, and exact data handling.
- Made the listed Mozilla Add-ons URL a static primary action in the first viewport and on
  every route.
- Rebuilt the shared header, footer, document layout, guide index, product frames, logo,
  favicon, large social preview, and prose styling without changing routes or the deployment
  framework.
- Corrected guide copy for optional defaults, bounded blocking, SponsorBlock consent,
  download formats and size, quality choices, and temporary source loading.
- Extended the existing screenshot scripts with theme, viewport, JavaScript, user-agent,
  long-headline, keyboard-focus, overflow, heading, landmark, image alternative, reduced
  motion, all-surface token contrast, rendered component-boundary, and tab-order checks.
- Corrected structural borders in both themes so cards, status surfaces, document navigation,
  and section dividers maintain at least 3:1 contrast against their inside and outside
  surfaces.
- Aligned the hero claim with the measured evidence: successful audio-only playback stops
  requesting new video segments and avoids video-track decoding.
- Added positive controls for JavaScript-disabled and user-agent capture contexts, plus a
  broken-image assertion, and corrected the FAQ to name both shipped download formats.

## Safety

- No extension, manifest, permission, test, or build configuration was changed.
- The `/privacy/` route and every existing guide route remain present.
- The site has no client script dependency. Navigation, themes, content, and AMO install
  anchors work in static HTML.
- Marketing copy does not claim lyrics, extension-provided lock-screen artwork, complete
  ad removal, logged-in support, a battery number, or a guaranteed data reduction.
- Savings arithmetic is labelled illustrative and adjacent to its stream-variation and
  fallback caveat.

## Verification

- Clean website dependency install and 13-route Astro production build.
- Static output check for the AMO anchor on every page and base-prefixed internal assets.
- Light and dark structural, image-load, and accessibility validation for all 13 routes at
  390 and 1440 CSS pixels, plus the five core capture routes at 768 CSS pixels.
- Width checks at 320 and 2560 CSS pixels, plus long-headline, unsupported-browser,
  JavaScript-disabled, and keyboard-focus states.
- Forty-five final full-page PNG artifacts remain under `.factory-preview/`, including a
  hovered primary action, with representative landing, guide, privacy, long-headline, and
  wide-screen renders visually inspected.
- Repository TypeScript, ESLint, and 278 Vitest tests passed.

## Screenshot evidence

All captures use reduced-motion mode and the repository's extended `website/shoot.mjs`
validation. The no-JavaScript and unsupported-browser captures are intentionally
byte-identical to their same-size baseline captures because the site has no client script or
user-agent branching. The keyboard-focus and hover captures differ from baseline and show
their visible states. The artifacts remain in the workspace for review and are intentionally
excluded from Git and the Pages build.

After starting `npm run preview` in `website/`, regenerate the committed social card with:

```bash
URL=http://127.0.0.1:4321/youtube-audio/ OUT=public TAG=social-card PATH_=/ \
  WIDTH=1200 HEIGHT=630 OFFSETS=0 COLOR_SCHEME=light node shoot-detail.mjs
mv public/social-card-1200-light-00-y0.png public/social-card.png
```

| Path                                                                  | Caption                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.factory-preview/core-home-mobile-light.png`                         | Landing page, 390x844 mobile, light theme                           |
| `.factory-preview/core-home-tablet-light.png`                         | Landing page, 768x900 tablet, light theme                           |
| `.factory-preview/core-home-desktop-light.png`                        | Landing page, 1440x900 desktop, light theme                         |
| `.factory-preview/core-home-mobile-dark.png`                          | Landing page, 390x844 mobile, dark theme                            |
| `.factory-preview/core-home-tablet-dark.png`                          | Landing page, 768x900 tablet, dark theme                            |
| `.factory-preview/core-home-desktop-dark.png`                         | Landing page, 1440x900 desktop, dark theme                          |
| `.factory-preview/core-how-it-works-mobile-light.png`                 | How it works, 390x844 mobile, light theme                           |
| `.factory-preview/core-how-it-works-tablet-light.png`                 | How it works, 768x900 tablet, light theme                           |
| `.factory-preview/core-how-it-works-desktop-light.png`                | How it works, 1440x900 desktop, light theme                         |
| `.factory-preview/core-how-it-works-mobile-dark.png`                  | How it works, 390x844 mobile, dark theme                            |
| `.factory-preview/core-how-it-works-tablet-dark.png`                  | How it works, 768x900 tablet, dark theme                            |
| `.factory-preview/core-how-it-works-desktop-dark.png`                 | How it works, 1440x900 desktop, dark theme                          |
| `.factory-preview/core-privacy-mobile-light.png`                      | Privacy page, 390x844 mobile, light theme                           |
| `.factory-preview/core-privacy-tablet-light.png`                      | Privacy page, 768x900 tablet, light theme                           |
| `.factory-preview/core-privacy-desktop-light.png`                     | Privacy page, 1440x900 desktop, light theme                         |
| `.factory-preview/core-privacy-mobile-dark.png`                       | Privacy page, 390x844 mobile, dark theme                            |
| `.factory-preview/core-privacy-tablet-dark.png`                       | Privacy page, 768x900 tablet, dark theme                            |
| `.factory-preview/core-privacy-desktop-dark.png`                      | Privacy page, 1440x900 desktop, dark theme                          |
| `.factory-preview/core-guide-mobile-light.png`                        | Guide index, 390x844 mobile, light theme                            |
| `.factory-preview/core-guide-tablet-light.png`                        | Guide index, 768x900 tablet, light theme                            |
| `.factory-preview/core-guide-desktop-light.png`                       | Guide index, 1440x900 desktop, light theme                          |
| `.factory-preview/core-guide-mobile-dark.png`                         | Guide index, 390x844 mobile, dark theme                             |
| `.factory-preview/core-guide-tablet-dark.png`                         | Guide index, 768x900 tablet, dark theme                             |
| `.factory-preview/core-guide-desktop-dark.png`                        | Guide index, 1440x900 desktop, dark theme                           |
| `.factory-preview/core-guide-install-mobile-light.png`                | Install guide, 390x844 mobile, light theme                          |
| `.factory-preview/core-guide-install-tablet-light.png`                | Install guide, 768x900 tablet, light theme                          |
| `.factory-preview/core-guide-install-desktop-light.png`               | Install guide, 1440x900 desktop, light theme                        |
| `.factory-preview/core-guide-install-mobile-dark.png`                 | Install guide, 390x844 mobile, dark theme                           |
| `.factory-preview/core-guide-install-tablet-dark.png`                 | Install guide, 768x900 tablet, dark theme                           |
| `.factory-preview/core-guide-install-desktop-dark.png`                | Install guide, 1440x900 desktop, dark theme                         |
| `.factory-preview/layout-home-narrow-light.png`                       | Landing page, 320x844 narrow state, light theme                     |
| `.factory-preview/layout-home-narrow-dark.png`                        | Landing page, 320x844 narrow state, dark theme                      |
| `.factory-preview/layout-home-wide-light.png`                         | Landing page, 2560x900 wide state, light theme                      |
| `.factory-preview/layout-home-wide-dark.png`                          | Landing page, 2560x900 wide state, dark theme                       |
| `.factory-preview/awkward-home-mobile-light-long-headline.png`        | Landing page, 390x844 mobile, light theme, long headline            |
| `.factory-preview/awkward-home-desktop-light-long-headline.png`       | Landing page, 1440x900 desktop, light theme, long headline          |
| `.factory-preview/awkward-home-mobile-light-unsupported-browser.png`  | Landing page, 390x844 mobile, light theme, non-Firefox user agent   |
| `.factory-preview/awkward-home-desktop-light-unsupported-browser.png` | Landing page, 1440x900 desktop, light theme, non-Firefox user agent |
| `.factory-preview/awkward-home-mobile-light-nojs.png`                 | Landing page, 390x844 mobile, light theme, JavaScript disabled      |
| `.factory-preview/awkward-home-desktop-light-nojs.png`                | Landing page, 1440x900 desktop, light theme, JavaScript disabled    |
| `.factory-preview/awkward-guide-install-mobile-light-nojs.png`        | Install guide, 390x844 mobile, light theme, JavaScript disabled     |
| `.factory-preview/awkward-guide-install-desktop-light-nojs.png`       | Install guide, 1440x900 desktop, light theme, JavaScript disabled   |
| `.factory-preview/state-home-mobile-dark-keyboard-focus.png`          | Landing page, 390x844 mobile, dark theme, keyboard focus            |
| `.factory-preview/state-home-desktop-dark-keyboard-focus.png`         | Landing page, 1440x900 desktop, dark theme, keyboard focus          |
| `.factory-preview/state-home-desktop-light-hover.png`                 | Landing page, 1440x900 desktop, light theme, install action hovered |

## Follow-up

The public AMO listing copy and the extension consent-screen artwork wording are managed
outside this website-only change and should be reconciled separately with the shipped
implementation.
