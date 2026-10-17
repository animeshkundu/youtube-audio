import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * AMO rejected 1.0.3 for declaring `required: ['none']` while the extension transmits website
 * content. These assertions pin the manifest surface that caused the rejection so a refactor or a
 * careless revert cannot silently reintroduce it. They read `wxt.config.ts` as text because the
 * config is only evaluated by the WXT build; the built manifest is verified separately in CI by
 * `web-ext lint` and the bench's `manifest:` cases.
 */
const config = readFileSync(resolve(__dirname, '../../wxt.config.ts'), 'utf8');

describe('manifest data-collection declaration', () => {
  it('declares websiteContent and never reverts to the rejected "none"', () => {
    expect(config).toContain('data_collection_permissions');
    expect(config).toContain("required: ['websiteContent']");
    expect(config).not.toContain("required: ['none']");
  });

  it('keeps the Firefox 128 floor so the custom-consent lane stays reachable', () => {
    // Raising this to 140 would silently drop Firefox 128-139 and Android 128-141, the exact
    // users the hybrid custom-consent screen exists to serve.
    expect(config).toContain("strict_min_version: '128.0'");
  });

  it('does not request the management permission', () => {
    // `management.uninstallSelf()` explicitly does not require it, and an unjustified permission
    // is a liability on a submission already rejected for over-declaring.
    expect(config).not.toContain("'management'");
  });
});

describe('MV3 capability artifact declarations', () => {
  it('declares webRequestFilterResponse only in the MV3 lane', () => {
    // MV2 (the shipping target) filters responses without a permission; MV3 declares the explicit
    // permission for its capability artifact, and it must never leak into the MV2 manifest.
    expect(config).toMatch(/manifestVersion === 3 \? \['webRequestFilterResponse'\] : \[\]/);
  });
});

describe('per-tab scope command declaration', () => {
  it('declares toggle-audio-only on Alt+Shift+A', () => {
    // The background registers a listener for exactly this command name (SPEC-012 §5; ADR-0014);
    // a rename on either side would silently disable the shortcut, so pin both here.
    expect(config).toContain("'toggle-audio-only'");
    expect(config).toMatch(/default: 'Alt\+Shift\+A'/);
  });
});
