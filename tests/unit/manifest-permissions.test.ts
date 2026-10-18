import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ADR-0018: a fresh install must prompt for `storage` + YouTube hosts only. The ad/telemetry
 * network filters (`webRequest` + `webRequestBlocking`) are optional and requested from the
 * gesture that turns blocking on; downloads and SponsorBlock stay optional as before. Bench
 * builds keep every grant required so hermetic cases run without browser-chrome prompts.
 */
const config = readFileSync(resolve(__dirname, '../../wxt.config.ts'), 'utf8');

describe('minimal install permissions (ADR-0018)', () => {
  it('does not hard-require webRequest or webRequestBlocking at install', () => {
    const lines = config.split('\n');
    // Production required permissions live between `permissions: [` and the closing `],` that
    // precedes the `// Optional in production` comment. Everything else is optional/BENCH/MV3.
    const permStart = lines.findIndex((line) => line.includes('permissions: ['));
    const optionalComment = lines.findIndex((line) => line.includes('// Optional in production'));
    const requiredBlock = lines
      .slice(permStart, optionalComment)
      .filter((line) => !line.includes('BENCH'))
      .join('\n');
    expect(requiredBlock).toContain("'storage'");
    expect(requiredBlock).not.toContain("'webRequest'");
    expect(requiredBlock).not.toContain("'webRequestBlocking'");
  });

  it('declares webRequest + webRequestBlocking as optional in production MV2', () => {
    expect(config).toMatch(/optional_permissions: \[\s*DOWNLOADS_PERMISSION,/s);
    expect(config).toContain("'webRequest'");
    expect(config).toContain("'webRequestBlocking'");
  });

  it('keeps every optional grant required in BENCH builds', () => {
    expect(config).toContain("[DOWNLOADS_PERMISSION, 'webRequest', 'webRequestBlocking']");
  });
});
