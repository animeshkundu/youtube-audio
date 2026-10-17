import { describe, expect, it } from 'vitest';

import { MEDIA_CLIENTS } from '../../src/shared/innertube';
import { PERSONAS } from '../e2e/probe-live-client-audit.mjs';

/**
 * The live audit probe runs with plain Node (no build step), so it carries its own copy of the
 * pinned personas. This test makes that copy unable to drift: if the table changes, the probe
 * fails here instead of silently auditing the wrong client (SPEC-014, ADR-0012).
 */
describe('live audit probe personas (SPEC-014)', () => {
  it('keeps the probe personas identical to the shipped media-client table', () => {
    expect(PERSONAS.map((entry) => entry.id)).toEqual(MEDIA_CLIENTS.map((entry) => entry.id));
    expect(PERSONAS.map((entry) => entry.client)).toEqual(
      MEDIA_CLIENTS.map((entry) => entry.client)
    );
  });
});
