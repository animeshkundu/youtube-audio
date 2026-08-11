# Specification: Marketing Website

## Overview

The YouTube Audio website explains the extension to a first-time visitor, shows the real
product, documents its savings mechanism and limits, and provides a direct path to the
listed Firefox add-on. The site is a static Astro build that remains complete without
JavaScript and supports the existing guide, privacy, and technical routes.

## Goals

- Explain within the first viewport that YouTube Audio plays YouTube and YouTube Music as
  audio only in Firefox, stops requesting new video segments during a successful switch,
  avoids video decoding, and is available from Mozilla Add-ons.
- Present the visitor journey in this order: product and audience, product in use, savings
  mechanism and scale, installation, limitations, and data handling.
- Use only shipped, source-grounded capabilities and state defaults and limitations
  accurately.
- Keep a plain AMO install anchor visible in the first viewport and reachable from every
  page.
- Provide a complete role-based visual token system with light and dark themes.
- Meet WCAG AA contrast, keyboard, landmark, heading, alternative-text, and reduced-motion
  requirements.
- Preserve every existing route and the `/youtube-audio` deployment base.
- Render legibly at 320, 390, 768, 1440, and 2560 CSS pixels without horizontal overflow.

## Non-Goals

- Modifying the extension, its manifest, permissions, behavior, or release process.
- Supporting Chrome, Edge, or Safari.
- Claiming measured battery life, a percentage saving, guaranteed byte savings, complete
  ad removal, logged-in playback, extension-provided lock-screen artwork, or removed
  features.
- Replacing Astro, restructuring the guide information architecture, or changing the
  website deployment workflow.
- Requiring client-side JavaScript for navigation, installation, themes, or core content.

## Technical Design

### Static information architecture

The landing page contains six addressable sections in a fixed narrative order:

1. a compact hero naming the product, audience, mechanism, benefit, and install action;
2. real extension screenshots showing active and fallback states;
3. the audio-only transfer and decode mechanism with illustrative audio-stream arithmetic;
4. separate Firefox desktop and Firefox for Android installation instructions;
5. explicit browser, account, content, and blocking limitations;
6. a bounded disclosure of destinations, optional egress, and local-only data.

The shared header contains a static AMO anchor and uses native HTML disclosure for compact
navigation. The footer repeats the install route. `Base.astro` supplies landmarks, a skip
link, canonical and social metadata with an absolute large-preview image, and the shared
shell without a client script.

### Visual system

`website/src/styles/tokens.css` is the only source of literal colors. It defines:

- a named fluid type scale;
- a 4-pixel-derived spacing scale;
- surface, border, content, accent, and semantic status roles;
- radii, elevation, layout widths, focus rings, state colors, durations, and easing;
- light values by default and dark values under `prefers-color-scheme: dark`.

Components consume only role tokens. Red and black define the marketing identity:
black-derived neutrals carry surfaces, structure, borders, and secondary content, while
full-strength red is reserved for the primary install action and true brand moments.
Repeated labels, links, markers, and icons use neutral secondary accent roles. Product
screenshots retain their dark application surface inside a neutral, tokenized frame in
either website theme; the extension itself remains unchanged.

`--color-border` is the component-boundary token and must maintain at least 3:1 contrast
against every canvas and surface role in both themes. `--color-border-subtle` is decorative
only and must not be the sole visual boundary of a control, card, section, or status surface.
The focus token follows the same all-surface contrast contract.

### Installation and browser support

The primary action is a normal anchor to
`https://addons.mozilla.org/en-US/firefox/addon/youtube-audio/`. Firefox 128 or newer on
desktop and Firefox for Android are the supported browsers. Always-rendered text tells
visitors in another browser to open the page in Firefox without hiding the install action.
GitHub Releases is described only as an alternate source of regular release files.
Temporary loading through `about:debugging` is identified as temporary.

### Savings copy

The site explains the verified mechanism: during a successful hijack, new video segment
requests stop and the browser no longer decodes a video track it will not display. It does
not assign a battery percentage or guaranteed data reduction. For scale, it may show that
128 kbit/s is about 58 MB per hour and 160 kbit/s is about 72 MB per hour, immediately
labelled as illustrative arithmetic. It also states that actual audio streams vary, roughly
50 to 160 kbit/s in repository research, and fallback playback uses normal YouTube.

### Verification tooling

The existing `shoot.mjs`, `shoot-el.mjs`, and `shoot-detail.mjs` accept environment-driven
color scheme, user agent, JavaScript, and viewport options. `shoot.mjs` additionally accepts
long-headline and interaction-state options, continues to produce full-page screenshots by
default, and can run structural, accessibility, contrast, reduced-motion, no-JavaScript,
first-viewport, and overflow assertions. An opt-in `FOCUS_CROP=1` mode requires
`FOCUS_TARGET` and captures a padded close-up of the keyboard-focused target without
changing the existing full-page focus capture contract. `FOCUS_CROP_PAD` controls the
padding in CSS pixels and defaults to 16.

## Error Handling

- Unsupported content and unsuccessful audio acquisition remain described as normal
  YouTube fallback, not an extension error.
- A visitor in an unsupported browser receives useful static guidance and an unchanged AMO
  link.
- Missing client-side JavaScript cannot hide navigation, installation, themes, or content.
- Screenshot and accessibility validation exit nonzero on a failed assertion.
- Images reserve space and retain meaningful alternative text if loading fails.

## Testing Strategy

- Build all 13 Astro routes and inspect the generated static anchors and base-prefixed
  internal links.
- Assert one `h1`, ordered headings, header/nav/main/footer landmarks, meaningful image
  alternatives, visible keyboard focus, reduced motion, no horizontal overflow, and WCAG
  AA contrast in both themes.
- Assert the boundary and focus tokens against every canvas and surface role, and inspect
  rendered card, section, control, and status boundaries against their painted surroundings.
- Use positive controls to assert that JavaScript-disabled and user-agent overrides took
  effect, and fail when any informative image does not load successfully.
- Assert the hero message and install action fit the first 1440x900 and 390x844 viewports,
  including an overlong headline.
- Assert the complete landing journey and AMO anchor remain visible with JavaScript
  disabled.
- Capture the landing page, technical explanation, privacy page, guide index, and install
  guide at mobile, tablet, and desktop widths in both themes.
- Capture 320-pixel, 2560-pixel, long-headline, non-Firefox, and no-JavaScript states.
- Run the website build plus repository typecheck, lint, and unit-test gates.

## Security and Privacy Considerations

- The website has no analytics, account system, or project-operated backend.
- Copy distinguishes project data handling from the credentialless requests made directly
  to YouTube, Google media and thumbnail hosts, and optional SponsorBlock.
- SponsorBlock is described as off by default, separately consented, and limited to a
  16-bit SHA-256 prefix with local matching.
- Diagnostics are described as local-only and never transmitted.
- External links use safe `rel` values where a new browsing context is requested.

## Performance Considerations

- Astro emits static HTML and CSS with no hydration or runtime framework bundle.
- Existing screenshots are reused and lazy-loaded below the first viewport.
- The first product image may load eagerly; remaining images use native lazy loading.
- Layout widths and image dimensions prevent avoidable layout shifts.

## Dependencies

No new package dependency is introduced. The site continues to use Astro, the existing
MDX and sitemap integrations, Inter Variable, and the existing Playwright development
dependency.

## Rollout and Rollback

The redesign ships through the existing GitHub Pages workflow. Rollback is a normal source
revert because no extension, manifest, URL, or storage contract changes. Existing routes,
especially `/privacy/`, remain stable throughout rollout.
