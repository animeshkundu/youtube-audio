# ADR-0012: Marketing website identity and scope

## Status

Accepted.

## Date

2026-08-10

## Revised

2026-08-11

## Context

The existing marketing site used a dark-only coral identity, a partial token set, and a
landing page whose first screen did not fully explain the audio-only mechanism, savings
benefit, support boundary, and direct installation path. Secondary routes shared the same
visual shell, so replacing only the hero would leave the public experience inconsistent.

The extension already has a mature neutral surface system with an aqua active-state
accent. The public site should feel intentional without copying the extension UI or
preserving the previous site's layout. The marketing identity needs a separate red and
black palette that gives its primary install action clear visual priority.

## Decision

Rebuild the website token layer, shared shell, and landing page from scratch around neutral
surfaces. The website uses red and black as its marketing identity: near-black and
black-derived neutrals carry structure, while full-strength red is reserved for the primary
install action and true brand moments. Secondary accent roles remain neutral so repeated
labels, links, markers, and icons do not compete with the install action.

Light and dark themes use independently chosen ramp steps. Focus indicators remain neutral
and meet the all-surface contrast contract, including against the near-black product frame.
Status roles remain semantically distinct from brand red and retain text or icon cues so
meaning never depends on hue alone.

The light focus indicator depends on a positive outline offset to keep the neutral ring
adjacent to the surrounding surface instead of the red control fill. Removing that offset is
an accessibility-breaking token change and requires renewed contrast validation.

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

- The marketing site has a disciplined red and black identity with one dominant action.
- Every route receives the same accessible light and dark visual system.
- The install path works in static HTML and remains available from every page.
- The landing page can be evaluated as one visitor journey rather than unrelated sections.

### Negative

- Existing site-specific visual choices are intentionally discarded.
- Shared component and prose styles must be updated together.
- Dark extension screenshots require deliberate framing on the light website theme.
- The aqua extension interface, static favicon, and social preview remain visibly separate
  from the website palette because this website-only token change does not alter extension
  artwork or raw asset colours.

## Related

- SPEC-014: Marketing Website.
- ADR-0006: Firefox AMO Distribution and Beta Channel.
- ADR-0008: Audio Mode Artwork and Egress.
- ADR-0011: Minimize Extension Data Egress.
