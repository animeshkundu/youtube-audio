# ADR-0018: Ad blocking opt-in; network filter permissions optional

## Status

**Accepted**

## Date

2026-10-17

## Context

ADR-0017 kept the YouTube host matches required and defined "minimal permissions" as
`storage` + `webRequest` + `webRequestBlocking` + hosts at install, with `downloads` and the
SponsorBlock origin optional. Review for the 1.1.0 line then asked for less: ad blocking should
not run by default, and the install prompt should not carry the network-filter capabilities
(`webRequest`, `webRequestBlocking`) for users who never turn blocking on.

The filter listeners (`blockTelemetry`, `filterPlayerResponse` in
`entrypoints/background.ts`) previously registered unconditionally at startup; on a build
without the permissions that registration throws, so the listeners must be synced with the
live grants instead.

## Decision

- `adBlockEnabled` defaults to **false**. Ghost mode stays on (it is the telemetry posture,
  not ad filtering); "Block ads" is an explicit opt-in.
- `webRequest` + `webRequestBlocking` move from required to **optional** (MV2
  `optional_permissions`; MV3 artifact keeps building). Bench builds keep them required so
  hermetic runs need no prompts.
- The background registers the two `onBeforeRequest` listeners only when
  `permissions.contains({ permissions: ['webRequest', 'webRequestBlocking'] })` holds, and
  re-syncs on `permissions.onAdded` / `onRemoved`. A revoke flips `adBlockEnabled` off so the
  UI never claims blocking that cannot run. Registration failure never throws to startup.
- The options "Block ads" toggle requests both permissions in the same user gesture (the
  SPEC-013 pattern used by SponsorBlock/downloads): grant enables and toasts; denial keeps the
  toggle off with an inline "Grant access" recovery row; no re-nagging (`contains` check).
- The popup protection line reflects setting **AND** permission, deep-links to
  `options.html#privacy-blocking` when blocking is off, and never over-claims during the
  transient revoke window.

### Upgrade edge

Existing installs already hold the grants (Firefox preserves previously-granted permissions),
so blocking keeps working for them. A build without the grants while the setting is on
surfaces the "Grant access" row instead of pretending to filter.

## Consequences

### Positive

- Fresh installs prompt for `storage` + YouTube hosts only. The ad-block capability is asked
  for exactly once, by the gesture that needs it.
- "Fail open" extends to permissions: absent grants mean absent filtering, never broken pages.

### Negative

- One more runtime permission prompt in the product (only when the user opts into blocking).
- Background listener state is now dynamic; the bench pins the required-grant lane so hermetic
  coverage is unaffected.

### Neutral

- Host permissions stay required per ADR-0017. Telemetry blocking (`ghostEnabled`) rides the
  same network grants by construction; its copy already explains the trade-off.

## Related ADRs

- ADR-0017 (hosts stay required), ADR-0010 (hybrid consent), ADR-0011 (minimize egress)

## References

- `docs/specs/SPEC-013-hybrid-data-consent.md`
- `docs/specs/SPEC-004-m2b-ad-block.md`
- `tests/unit/manifest-permissions.test.ts`
