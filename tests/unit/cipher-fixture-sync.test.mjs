// @vitest-environment node
// Hermetic lockstep between the bench fixture's base.js and the shipped cipher decoder (SPEC-030).
// The bench case `m8:signature-cipher-is-decoded-and-hijacked` asserts the hijacked URL carries
// `sig=dcba`; this test proves that expectation against the real decoder without launching Firefox,
// so a drift in either the fixture bundle or the decoder fails fast here.
import { describe, expect, it } from 'vitest';

import {
  buildSignedAudioUrl,
  decodeSignature,
  extractCipherOperations,
  extractSignatureTimestamp,
} from '../../src/shared/cipher';
import { FIXTURE_BASE_JS } from '../e2e/bench/fixture-server.mjs';

describe('cipher fixture agreement', () => {
  it('decodes the ciphered bench fixture signature the way the fixture expects', () => {
    const operations = extractCipherOperations(FIXTURE_BASE_JS);
    expect(operations).not.toBeNull();
    expect(extractSignatureTimestamp(FIXTURE_BASE_JS)).toBe(12345);
    expect(decodeSignature('abcdef', operations)).toBe('dcba');
    expect(
      buildSignedAudioUrl(
        'url=http%3A%2F%2F127.0.0.1%3A8000%2Fvideoplayback%3FvideoId%3DCIPHER0001&sp=sig&s=abcdef',
        operations
      )
    ).toBe('http://127.0.0.1:8000/videoplayback?videoId=CIPHER0001&sig=dcba');
  });
});
