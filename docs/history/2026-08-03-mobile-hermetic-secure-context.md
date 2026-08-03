# Mobile hermetic fixture secure context

**Date:** 2026-08-03

## Summary

The blocking Fenix fixture probe now maps its local fixture through emulator loopback and proves the
secure-context condition before testing playback.

## Root cause and change

- All five Fenix releases installed the temporary XPI, resolved data consent as granted, ran the
  isolated content script, and recorded the fixture player POST. The first pass reached
  `fallback`/`media-attach-failed` because `10.0.2.2` is intentionally outside the existing BENCH
  media safety allowlist, which accepts only loopback fixture media.
- The probe starts the fixture on the runner, then uses `adb reverse tcp:<port> tcp:<port>` to make the
  same server available as emulator `localhost:<port>`. The page, player response, and media request
  now use that established BENCH-only loopback route; no production match, permission, or playback
  source policy changes.
- Loopback also supplies a secure context without a browser policy override. After each navigation,
  the probe fails with the observed origin and context state unless `crypto.randomUUID` is available.
  The existing consent, `active`, `/videoplayback`, and player-POST assertions remain mandatory.
- Fenix 136 briefly reported the MAIN-world default `disabled` status before the consent-filtered
  settings message reached it. The probe now waits for the required `active` state instead of
  treating any intermediate terminal-looking status as success or failure.
- A Fenix menu tap can leave the browser chrome unchanged while its initial activity settles. The UI
  driver now retries the whole menu-to-Settings route with a fresh accessibility hierarchy and keeps
  the final raw dump if every route fails.
- The earlier action-owned `adb: device offline` exit-code-1 messages occur while it polls
  `sys.boot_completed`; each completed boot before the checked-in runner began. They are a benign
  emulator bootstrap race, not a Fenix UI or fixture failure.

## References

- Android Debug Bridge reverse port forwarding
- Web Cryptography `Crypto.randomUUID()` secure-context requirement
