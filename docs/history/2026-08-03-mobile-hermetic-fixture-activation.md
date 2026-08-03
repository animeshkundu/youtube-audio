# Mobile hermetic fixture activation

**Date:** 2026-08-03

## Summary

The Fenix hermetic probe now retries the local fixture page when a document never reaches a terminal
extension state after the temporary add-on becomes available.

## Root cause and change

- Fenix release builds accepted the RDP temporary add-on and seeded consent, but the first fixture
  document could consume the page-world bridge nonce before its first settings message was delivered.
- Each retry is a complete local fixture navigation. The probe only accepts a terminal state and still
  requires `active`, `/videoplayback`, and a recorded `POST /youtubei/v1/player` before it passes.
- The RDP socket wait now tolerates transient adb command failures and records the final command
  output if the socket never appears.

## Validation

- Static and unit gates remain unchanged.
- The five-version API-34 Fenix matrix is the integration qualification for the retry path.
