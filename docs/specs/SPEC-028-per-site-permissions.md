# SPEC-028: Per-site minimal permissions

**Status:** Decided (see ADR-0017) — the runtime per-site model is designed but not shipped; core YouTube hosts stay required
**Date:** 2026-10-17
**Depends on:** SPEC-013 (consent), ADR-0010 (consent), ADR-0011 (egress), ADR-0017 (decision)
**Relates to:** Issues #21, #28, #33, #37, #40, #47

## 1. Goal

Reduce install-time permissions to `storage` only. YouTube host access (youtube.com family, googlevideo.com) becomes optional, requested per site family on first use. Grants persist ("asked once"). Consent (data transmission) stays a separate mandatory flow. Minimal surface: no new UI beyond the permission prompt itself.

> **Decision (ADR-0017).** This model is designed but **not shipped** in 1.1.0: the four YouTube
> content-script matches and `*://*.googlevideo.com/*` remain required host permissions. The
> feature-specific grants (`downloads`, the SponsorBlock origin) are already optional and requested
> exactly once from the enabling gesture, which is what "minimal permissions by default" means in
> practice for this extension. The sections below are retained as the concrete design should the
> decision be revisited.

## 2. Non-goals

- No runtime content-script registration for core content scripts (keep declarative + optional hosts, per adversarial review consensus).
- No change to the data-consent flow (SPEC-013).
- No Chrome port (separate decision).

## 3. Design

### 3.1 Permission model

**Required at install:**

- `storage` (settings, consent, diagnostics)

**Optional (requested on enable gesture):**

- YouTube family: `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*`
- YouTube Music: `*://music.youtube.com/*`
- Media: `*://*.googlevideo.com/*`
- SponsorBlock: `https://sponsor.ajay.app/*` (already optional)
- Downloads: `downloads` (already optional, desktop-only)
- webRequest/webRequestBlocking: optional, granted silently (no prompt)

### 3.2 Per-site groups

- **YouTube group:** youtube.com, www.youtube.com, m.youtube.com, youtube-nocookie.com (for embeds)
- **YouTube Music group:** music.youtube.com

`*.youtube.com` covers music.youtube.com, so explicit hostnames are required for separation.

### 3.3 Grant flow

1. User visits a YouTube page. Extension is installed but has no host permission.
2. Native YouTube plays normally (fail-open).
3. User clicks the extension icon (popup). Popup detects the site via `activeTab` (silent, no prompt).
4. Popup shows "Enable on YouTube" or "Enable on YouTube Music" card.
5. User clicks → `permissions.request({ origins: [...group hosts...] })` (user gesture required).
6. Firefox shows one doorhanger listing the origins.
7. If granted: content scripts registered at runtime for those hosts; injected into open tabs; persists.
8. If denied: nothing granted; next click asks again.

### 3.4 Runtime registration

- Content scripts registered via `browser.scripting.registerContentScripts` (MV3) or `browser.contentScripts.register` (MV2) after grant.
- Re-register on every background startup (Firefox doesn't persist runtime registrations).
- Inject into already-open tabs via `tabs.executeScript` / `scripting.executeScript`.
- On revoke: unregister scripts, remove host permission, re-ask on next click.

### 3.5 Core host permissions stay required

Per adversarial review consensus: keep the four YouTube match patterns + googlevideo as required host permissions. The per-site model is implemented as a **feature toggle** over granted hosts, not host-permission revocation. This avoids the migration cliff (existing users losing injection on update) and the reviewer question ("does the extension even work if I deny?").

### 3.6 Migration

- Existing 1.1.0 users have required host permissions. On update to 1.2.0, these grants persist (Mozilla: "grants are retained over upgrade").
- New users install with `storage` only; host permissions requested on first enable gesture.
- If grants are somehow lost, the popup re-asks on next click (fail-open).

### 3.7 Fail-open

- No host permission → no content script → native YouTube plays normally.
- Permission denied → nothing granted, next click asks again.
- Permission revoked → scripts unregistered, native playback restored.
- All failures fail open.

## 4. Test strategy

- Unit: permission state machine (granted/denied/revoked).
- Bench: grant → inject → hijack; deny → page untouched; revoke → script gone.
- Matrix: permission combinations (YouTube only, YT Music only, both, neither).
- Manual: headful permission probe (Firefox doorhanger).
- Upgrade: 1.1.0 → 1.2.0 migration test.

## 5. UI (minimal surface)

- Popup: one "Enable on YouTube" / "Enable on YouTube Music" card when on a YouTube page without permission. Single click, single prompt.
- No new onboarding. No settings page changes (permissions are managed via the popup).
- Options page: read-only status showing which site families are enabled.

---

_Spec written per "no spec, no code" rule._
