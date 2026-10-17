# ADR-0016: Chrome port go/no-go evaluation

## Status

**Accepted** (evaluation framework; the port decision itself is deferred until after 1.1.0 soaks)

## Date

2026-10-17

## Context

Chrome's audio-only niche is large ("Audio Only Youtube" reports ~100k installs) and our feature
set (credentialless audio-only, ad/telemetry pruning, segment skipping, loudness/EQ, download,
per-tab scope, a PII-free consent flow) has no single Chrome equivalent. Chrome is, however, an
MV3-only target, and the core of this extension leans on MV2 primitives.

### Problem Statement

Decide, in writing, whether a Chrome port is worth pursuing after 1.1.0, and on what evidence.

### Constraints

- MV2 is the shipping target; MV3 is a capability artifact whose blocking adapter is incomplete.
- Chrome MV3 has no blocking `webRequest` and no `filterResponseData`; `declarativeNetRequest`
  cannot rewrite a response body the way our ad/telemetry pruner does.
- The extension is logged-out-only and credentialless; that constraint must survive a port.
- Every feature must keep a no-human, automated validation path on the target browser.

## Decision

Do not port for 1.1.0. Treat the port as a post-1.1.0 project gated on this evaluation, whose
criteria are:

### Feasibility

1. **Core trick in MV3.** Fetch the credentialless player response and hijack `<video>.src`
   without blocking `webRequest`. (The fetch is page-world; the hijack is a DOM write. Neither
   needs blocking webRequest, so this is expected to work.)
2. **Ad/telemetry pruning.** Determine whether response-body pruning is reachable via
   `declarativeNetRequest` (limited) or whether it must be reduced on Chrome.
3. **Consent.** Confirm the custom consent flow and `management.uninstallSelf` behave on Chrome
   MV3 (accept-or-uninstall, matching AMO's §6.2.2.1 rationale).
4. **Content-script registration.** Confirm `scripting.registerContentScripts` covers the optional
   host model.
5. **Web Audio.** Confirm the audiograph runs in a page/content context (it does; it never needs
   the service worker).

### Effort and market

- Code: manifest, permissions, background lifetime (service worker vs persistent), registration.
- Testing: a Chrome bench (different DOM/behaviour) plus Chrome-specific CI.
- Maintenance: a second browser, permission model, and review process.
- Market: larger than Firefox, but the differentiation only holds if ad/telemetry pruning survives.

### Gate

- **Go** if feasible and effort is under roughly two focused weeks without dropping core features.
- **No-go** if it requires dropping core features or exceeds that effort. Revisit in six months.

## Consequences

### Positive

- Keeps 1.1.0 focused on Firefox reliability; the port question is decided on evidence, not impulse.

### Negative

- Leaves the larger Chrome market unaddressed for at least one more cycle.

### Neutral

- The MV3 artifact continues to build, keeping the door open and the dual-build invariant honest.

## Related ADRs

- ADR-0006 (Firefox AMO distribution), ADR-0012 (media-client table), ADR-0015 (coexistence)

## References

- `docs/research/07-distribution-signing-updates.md`
- `docs/specs/SPEC-028-per-site-permissions.md`
