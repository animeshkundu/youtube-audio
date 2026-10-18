// @vitest-environment node
// Lockstep between the live audit probe's TVHTML5 mirroring and the shipped code (SPEC-030).
// The probe runs under plain Node with no build step, so it carries its own copies of the
// TVHTML5 request extras and the base.js extraction patterns; this test proves those copies
// agree with src/shared/innertube.ts (request body) and src/shared/cipher.ts (sts + player
// script extraction) instead of silently drifting from what the extension actually sends.
import { describe, expect, it } from 'vitest';

import { extractPlayerJsUrl, extractSignatureTimestamp } from '../../src/shared/cipher';
import { TVHTML5_CLIENT, VISIONOS_CLIENT, buildPlayerRequest } from '../../src/shared/innertube';
import { FIXTURE_BASE_JS } from '../e2e/bench/fixture-server.mjs';
import {
  PERSONAS,
  TVHTML5_EMBED_URL,
  buildPlayerBody,
  extractProbePlayerJsUrl,
  extractProbeSignatureTimestamp,
} from '../e2e/probe-live-client-audit.mjs';

const VIDEO_ID = 'dQw4w9WgXcQ';
const VISITOR = 'CgtQU1Jndk5DRSjlzNDY5EgZpbml0aWFsKlBDSlNT';
const SIGNATURE_TIMESTAMP = 12345;

function persona(id) {
  const entry = PERSONAS.find((candidate) => candidate.id === id);
  expect(entry).toBeDefined();
  return entry;
}

describe('live audit probe TVHTML5 mirroring (SPEC-030)', () => {
  it('sends a TVHTML5 body identical to the shipped builder', () => {
    expect(
      buildPlayerBody(persona('tvhtml5'), VIDEO_ID, {
        visitorData: VISITOR,
        signatureTimestamp: SIGNATURE_TIMESTAMP,
        embedUrl: TVHTML5_EMBED_URL,
      })
    ).toEqual(
      buildPlayerRequest(TVHTML5_CLIENT, VIDEO_ID, VISITOR, {
        signatureTimestamp: SIGNATURE_TIMESTAMP,
        embedUrl: TVHTML5_EMBED_URL,
      })
    );
  });

  it('leaves non-TVHTML5 bodies identical to the shipped builder', () => {
    expect(buildPlayerBody(persona('visionos'), VIDEO_ID, { visitorData: VISITOR })).toEqual(
      buildPlayerRequest(VISIONOS_CLIENT, VIDEO_ID, VISITOR)
    );
  });

  it('keeps every extras combination identical to the shipped builder', () => {
    // The sts gate itself lives in the probe's network layer (extras ride only with a finite
    // sts); the builder stays a faithful copy of buildPlayerRequest for every combination.
    expect(
      buildPlayerBody(persona('tvhtml5'), VIDEO_ID, {
        visitorData: VISITOR,
        signatureTimestamp: null,
        embedUrl: TVHTML5_EMBED_URL,
      })
    ).toEqual(
      buildPlayerRequest(TVHTML5_CLIENT, VIDEO_ID, VISITOR, { embedUrl: TVHTML5_EMBED_URL })
    );
  });

  it('extracts the sts and player script exactly like the shipped decoder', () => {
    expect(extractProbeSignatureTimestamp(FIXTURE_BASE_JS)).toBe(SIGNATURE_TIMESTAMP);
    expect(extractProbeSignatureTimestamp(FIXTURE_BASE_JS)).toBe(
      extractSignatureTimestamp(FIXTURE_BASE_JS)
    );
    const snippet =
      '<script>var ytcfg={PLAYER_JS_URL:"/s/player/abcdef12/working/base.js"};</script>';
    expect(extractProbePlayerJsUrl(snippet)).toBe('/s/player/abcdef12/working/base.js');
    expect(extractProbePlayerJsUrl(snippet)).toBe(extractPlayerJsUrl(snippet));
    expect(extractProbePlayerJsUrl('')).toBeNull();
    expect(extractProbeSignatureTimestamp(null)).toBeNull();
  });
});
