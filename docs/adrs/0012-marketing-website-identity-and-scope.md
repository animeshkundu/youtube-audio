# ADR-0012: Marketing website identity and scope

## Status

Accepted.

## Date

2026-08-10

## Context

The existing marketing site used a dark-only coral identity, a partial token set, and a
landing page whose first screen did not fully explain the audio-only mechanism, savings
benefit, support boundary, and direct installation path. Secondary routes shared the same
visual shell, so replacing only the hero would leave the public experience inconsistent.

The extension already has a mature neutral surface system with an aqua active-state
accent. The public site should feel related to the shipped product without copying the
extension UI or preserving the previous site's layout.

## Decision

Rebuild the website token layer, shared shell, and landing page from scratch around neutral
surfaces and the extension's aqua accent. Aqua may carry primary marketing actions in
addition to active-state meaning. Rebuild the logo and favicon with the same role-based
identity.

Restyle the how-it-works, privacy, guide index, and guide-entry routes through the new
shared layouts and tokens while preserving their routes and information architecture.
Keep Astro, the `/youtube-audio` base path, trailing-slash output, and the existing Pages
deployment.

The install path is a static AMO anchor. Themes use `prefers-color-scheme`; core content,
navigation, and installation do not depend on JavaScript.

The role system distinguishes structural boundaries from decorative separators.
`--color-border` and the focus token must reach at least 3:1 against every canvas and
surface role in each theme. `--color-border-subtle` may be used only where the separator is
decorative and does not identify a component or state. Automated checks cover both the
token matrix and rendered boundaries so a valid token pair cannot mask an invalid use.

## Consequences

### Positive

- The marketing site and extension share a recognizable product identity.
- Every route receives the same accessible light and dark visual system.
- The install path works in static HTML and remains available from every page.
- The landing page can be evaluated as one visitor journey rather than unrelated sections.

### Negative

- Existing site-specific visual choices are intentionally discarded.
- Shared component and prose styles must be updated together.
- Dark extension screenshots require deliberate framing on the light website theme.

## Related

- SPEC-014: Marketing Website.
- ADR-0006: Firefox AMO Distribution and Beta Channel.
- ADR-0008: Audio Mode Artwork and Egress.
- ADR-0011: Minimize Extension Data Egress.
