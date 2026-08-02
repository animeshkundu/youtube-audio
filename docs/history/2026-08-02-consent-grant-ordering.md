# Consent grant ordering across Firefox versions

**Date:** 2026-08-02

## Root cause

The background treated every `dataTransmissionConsent` storage change as revocation-sensitive. Seeding a well-formed grant therefore called `denyThenResolve()`, publishing a denied snapshot before the resolved grant. Tab broadcasts are asynchronous and older Firefox releases can deliver the denied push after MAIN world has initialized from the grant, disabling the page after its player request but before audio hijack. Firefox 152 happened to deliver the same broadcasts in the opposite order, hiding the race.

A direct Firefox 140 extension-page probe ruled out capability detection and native permission state: `runtime.getBrowserInfo()` returned `140.0`, `runtime.getPlatformInfo()` returned `mac`, and `permissions.getAll()` returned `data_collection: ["websiteContent"]`; the background resolver reported a granted Firefox-owned state. This isolates the defect to post-seed publication ordering rather than version detection or missing built-in consent.

## Fix

- Classify only a well-formed stored `granted` record as additive and re-resolve it without a transient denial, matching the existing `permissions.onAdded` rule.
- Keep storage removal, revocation, malformed replacement, and `permissions.onRemoved` on the deny-first path.
- Keep the consent resolution generation guard unchanged.
- Make the E2E seeding assertion query the authoritative background-owned `yta:get-data-consent` resolver until it reports granted or the bounded deadline expires. It no longer duplicates resolver logic in the harness, so seed-success/resolve-denied fails loudly.

## Validation

The consent unit suite covers additive grant classification separately from revocation, malformed records, and removal. The full static gates and Firefox 139/140/142/latest hermetic benches are the required completion gates.
