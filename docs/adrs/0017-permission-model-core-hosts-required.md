# ADR-0017: Permission model — keep core YouTube hosts required

## Status

**Accepted**

## Date

2026-10-17

## Context

The 1.1.0 workstream asked for the smallest possible install-time permission surface, requesting
each permission exactly when the user turns on the option that needs it. The extension already does
this for its two feature-specific grants (`downloads`, `https://sponsor.ajay.app/*`), which are
declared optional and requested from the enabling gesture (SPEC-013). The open question was whether
the four YouTube content-script host matches and `*://*.googlevideo.com/*` should also move from
required to optional ("per-site permissions"), with runtime content-script registration.

### Problem Statement

Can install-time host permissions be moved to optional without regressing injection, playback, or
the upgrade experience?

### Constraints

- The four YouTube matches are what allow the declarative content scripts to inject at
  `document_start`; without them the extension is inert on the pages it exists to serve.
- Firefox content scripts declared in the manifest only run where host permissions are held; moving
  the matches to optional means runtime registration plus injection into already-open tabs.
- Existing users have the host grants today; a manifest change risks a migration cliff where an
  update leaves the extension silently inert until the user re-grants.
- The logging-out/credentialless invariants and "never disrupt playback" fail-open posture must hold
  throughout any permission change.

## Decision

Keep the four YouTube content-script matches and `*://*.googlevideo.com/*` as required host
permissions. Implement "minimal permissions" as it already is:

- Install requires only `storage`, `webRequest`, `webRequestBlocking`, and the YouTube-family host
  permissions the content scripts need.
- `downloads` and the SponsorBlock origin are optional and requested exactly once, from the gesture
  that turns the dependent feature on; neither is required at install.

The per-site optional-host model from SPEC-028 is retained as a **designed, not-shipped** option.
It is rejected for now because its runtime-registration complexity and migration cliff are not
justified while the only host that could safely move (`googlevideo`, needed solely by the
background download path) is already gated behind the optional `downloads` grant in the
user-visible sense: no media request leaves the device until the user enables a feature.

### Considered Options

1. **Keep hosts required (chosen).** Zero injection risk, no migration cliff, invariant intact.
   Cons: a broad-looking host permission appears at install.
2. **Move all YouTube hosts to optional + runtime registration.** Smallest install surface.
   Cons: migration cliff for existing users, runtime-registration complexity on both MV2 and MV3,
   a reviewer question ("does it work if I deny?"), and a real chance of silent inertness.
3. **Move only `googlevideo` to optional, granted with `downloads`.** Smaller surface, low risk.
   Cons: collides with the AGENTS.md invariant that names `googlevideo` as required; the only
   consumer is the already-gated download path, so the practical privacy gain is small.

## Consequences

### Positive

- Injection, playback, and the upgrade path stay exactly as tested.
- The two genuinely optional grants keep their exactly-once, gesture-bound UX.

### Negative

- The install permission prompt still lists the YouTube family and `googlevideo` hosts.

### Neutral

- Option 3 remains a low-risk candidate for a future release if paired with an ADR that supersedes
  the AGENTS.md invariant and re-checks the download permission flow.

## Related ADRs

- ADR-0010 (hybrid data consent), ADR-0011 (minimize extension data egress), ADR-0006 (distribution)

## References

- `docs/specs/SPEC-013-hybrid-data-consent.md`
- `docs/specs/SPEC-028-per-site-permissions.md`
- `AGENTS.md` (hard invariants: core host permissions)
