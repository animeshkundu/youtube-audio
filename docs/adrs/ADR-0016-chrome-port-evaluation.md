# ADR-0016: Chrome port go/no-go evaluation

**Status:** Draft (evaluation framework)
**Date:** 2026-10-17

## Context

The 1.1.0 plan lists "Chrome port" as a non-goal. The user has requested a written go/no-go evaluation after 1.1.0 ships. This ADR defines the evaluation criteria.

## Evaluation criteria

### Feasibility

1. **MV3 compatibility:** The extension is MV2-primary (blocking webRequest, filterResponseData). Chrome requires MV3. The MV3 artifact builds but the blocking adapter is incomplete. Evaluate whether the core audio-only trick (InnerTube fetch + src hijack) works in MV3 without blocking webRequest.

2. **Permission model:** Chrome's permission model differs. `webRequestBlocking` is not available in MV3 Chrome. `filterResponseData` is not available. Evaluate whether ad/telemetry pruning can be done via `declarativeNetRequest` (limited) or dropped.

3. **Consent:** Chrome has no built-in data-consent. The custom consent flow must work on Chrome. Evaluate whether `management.uninstallSelf` works on Chrome MV3.

4. **Content scripts:** Chrome MV3 supports `scripting.registerContentScripts`. Evaluate whether runtime registration works for optional host permissions.

5. **Web Audio:** Chrome supports Web Audio. Evaluate whether the audiograph works in a service worker context (it doesn't — it needs a page context, which is fine since it runs in the content script).

### Effort

1. **Code changes:** Manifest, permissions, background lifecycle (service worker vs persistent), content script registration, consent flow.
2. **Testing:** Chrome-specific bench (different browser, different DOM, different behavior).
3. **Maintenance:** Two browser targets, two permission models, two review processes.

### Market

1. **Chrome audio-only niche:** ~100k installs for "Audio Only Youtube" (Chrome Web Store). Larger market than Firefox.
2. **Competition:** Music Mode for YouTube (Chrome, blocks video on YT Music). Audio Only Youtube (Chrome, 100k installs, 3.83★).
3. **Differentiation:** Our feature set (audio-only + ad/telemetry pruning + segment skip + EQ/normalization + download + per-tab + consent) is unmatched on Chrome.

### Recommendation

- **If feasible and effort is < 2 weeks:** Go. The Chrome market is 10x the Firefox market.
- **If effort is > 2 weeks or requires dropping core features:** No-go. Stay Firefox-only. Revisit in 6 months.
- **Decision point:** After 1.1.0 ships and soaks.

---

_ADR written as evaluation framework. Decision to be made after 1.1.0 ships._
