# Mobile hermetic fixture secure context

**Date:** 2026-08-03

## Summary

The blocking Fenix fixture probe now makes the emulator's local host alias a secure context in its
ephemeral WebDriver profile and proves that condition before testing playback.

## Root cause and change

- All five Fenix releases installed the temporary XPI, resolved data consent as granted, and ran the
  isolated content script. The BENCH marker was present, but the bridge nonce, settings message,
  playback status, media hijack, and fixture player request were absent.
- The local Android fixture uses `http://10.0.2.2:<port>`. Unlike the desktop loopback fixture, that
  hostname is not potentially trustworthy by default. Content initialization calls
  `crypto.randomUUID()` to make its bridge nonce, so it stopped before injecting MAIN world.
- The probe now sets `dom.securecontext.allowlist=10.0.2.2` only in the throwaway Fenix automation
  profile. Firefox's implementation applies this comma-separated preference to HTTP and WebSocket
  hostnames; it deliberately does not require or accept a port.
- After each fixture navigation, the probe fails with the observed origin and context state unless the
  document is secure and exposes `crypto.randomUUID`. The existing consent, `active`,
  `/videoplayback`, and player-POST assertions remain mandatory.

## References

- Firefox implementation: `dom/security/nsMixedContentBlocker.cpp`,
  `IsPotentiallyTrustworthyOrigin`
- Firefox preference coverage: `dom/security/test/unit/test_isOriginPotentiallyTrustworthy.js`
- Web Cryptography `Crypto.randomUUID()` secure-context requirement
