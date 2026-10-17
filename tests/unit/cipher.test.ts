import { describe, expect, it } from 'vitest';

import {
  buildSignedAudioUrl,
  decodeSignature,
  extractCipherOperations,
  extractPlayerJsUrl,
  extractSignatureTimestamp,
  parseSignatureCipher,
} from '../../src/shared/cipher';

// Faithful shape of a modern minified base.js cipher: helpers declared as brace-free function
// expressions, then the transform that calls them in order.
const MODERN_BASE_JS = `
var Yd=function(a){a.reverse()};
var XW=function(a,b){a.splice(0,b)};
var Zk=function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c};
Qq=function(a){a=a.split("");Yd(a);XW(a,2);Zk(a,3);return a.join("")};
signatureTimestamp:20456;
`;

const NAMESPACED_BASE_JS = `
Kx.Wx=function(a){a.reverse()};Kx.O7=function(a,b){a.splice(0,b)};Kx.yi=function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c};
var Mq=function(a){a=a.split("");Kx.Wx(a,1);Kx.O7(a,4);Kx.yi(a,5);return a.join("")};
`;

const INLINE_BASE_JS = `
Qq=function(a){a=a.split("");a.reverse();a.splice(0,1);return a.join("")};
`;

describe('extractCipherOperations', () => {
  it('extracts the ordered helper-call transform from a modern bundle', () => {
    expect(extractCipherOperations(MODERN_BASE_JS)).toEqual([
      { kind: 'reverse' },
      { kind: 'splice', count: 2 },
      { kind: 'swap', index: 3 },
    ]);
  });

  it('handles namespaced helper definitions and calls', () => {
    expect(extractCipherOperations(NAMESPACED_BASE_JS)).toEqual([
      { kind: 'reverse' },
      { kind: 'splice', count: 4 },
      { kind: 'swap', index: 5 },
    ]);
  });

  it('extracts an inline transform from an older bundle', () => {
    expect(extractCipherOperations(INLINE_BASE_JS)).toEqual([
      { kind: 'reverse' },
      { kind: 'splice', count: 1 },
    ]);
  });

  it('extracts an assigned inline slice', () => {
    expect(
      extractCipherOperations('Qq=function(a){a=a.split("");a=a.slice(0,2);return a.join("")};')
    ).toEqual([{ kind: 'slice', count: 2 }]);
  });

  it('returns null for bundles it cannot recognise (fail open)', () => {
    expect(extractCipherOperations('')).toBeNull();
    expect(extractCipherOperations(null)).toBeNull();
    expect(extractCipherOperations(42)).toBeNull();
    expect(extractCipherOperations('var a=1;')).toBeNull();
    // A split/join function with no recognised operations.
    expect(extractCipherOperations('Qq=function(a){a=a.split("");return a.join("")};')).toBeNull();
  });
});

describe('decodeSignature', () => {
  it('replays reverse, splice, and swap exactly as the cipher function would', () => {
    const operations = extractCipherOperations(MODERN_BASE_JS)!;
    // "abcdef" -> reverse "fedcba" -> splice(0,2) "dcba" -> swap(0,3) "acbd".
    expect(decodeSignature('abcdef', operations)).toBe('acbd');
  });

  it('applies a no-op on an empty signature and clamps swap indices', () => {
    expect(decodeSignature('', [{ kind: 'swap', index: 5 }])).toBe('');
    // index beyond length wraps modulo length: 7 % 4 = 3.
    expect(decodeSignature('abcd', [{ kind: 'swap', index: 7 }])).toBe('dbca');
  });

  it('applies slice by keeping the leading characters', () => {
    expect(decodeSignature('abcdef', [{ kind: 'slice', count: 3 }])).toBe('abc');
  });
});

describe('parseSignatureCipher', () => {
  it('parses url, s and sp from a signatureCipher query string', () => {
    const parts = parseSignatureCipher(
      'url=https%3A%2F%2Fx.googlevideo.com%2Fvideoplayback%3Fid%3Dabc&sp=sig&s=ABCDEF'
    );
    expect(parts).toEqual({
      url: 'https://x.googlevideo.com/videoplayback?id=abc',
      signature: 'ABCDEF',
      sp: 'sig',
    });
  });

  it('defaults sp to signature and rejects malformed input', () => {
    expect(parseSignatureCipher('url=https%3A%2F%2Fhost%2Fp&s=XYZ')?.sp).toBe('signature');
    expect(parseSignatureCipher('s=XYZ')).toBeNull();
    expect(parseSignatureCipher('url=https://host/p')).toBeNull();
    expect(parseSignatureCipher(null)).toBeNull();
    expect(parseSignatureCipher('')).toBeNull();
  });
});

describe('buildSignedAudioUrl', () => {
  it('decodes the signature and appends it under the sp parameter', () => {
    const operations = extractCipherOperations(MODERN_BASE_JS)!;
    const url = buildSignedAudioUrl(
      'url=https%3A%2F%2Fx.googlevideo.com%2Fvideoplayback%3Fid%3Dabc&sp=sig&s=abcdef',
      operations
    );
    expect(url).toBe('https://x.googlevideo.com/videoplayback?id=abc&sig=acbd');
  });

  it('uses & when the url already carries a query', () => {
    const url = buildSignedAudioUrl('url=https%3A%2F%2Fh%2Fp&sp=signature&s=ab', [
      { kind: 'reverse' },
    ]);
    expect(url).toBe('https://h/p?signature=ba');
  });

  it('returns null for a malformed cipher (fail open)', () => {
    expect(buildSignedAudioUrl('nope', [{ kind: 'reverse' }])).toBeNull();
  });
});

describe('extractSignatureTimestamp', () => {
  it('reads the signatureTimestamp from base.js and rejects junk', () => {
    expect(extractSignatureTimestamp(MODERN_BASE_JS)).toBe(20456);
    expect(extractSignatureTimestamp('signatureTimestamp=1')).toBeNull();
    expect(extractSignatureTimestamp('no timestamp here')).toBeNull();
    expect(extractSignatureTimestamp(undefined)).toBeNull();
  });
});

describe('extractPlayerJsUrl', () => {
  it('pulls the base.js path out of a page or ytcfg payload', () => {
    expect(
      extractPlayerJsUrl(
        'ytcfg.set({"PLAYER_JS_URL":"/s/player/1a2b3c4d/player_ias.vflset/en_US/base.js"});'
      )
    ).toBe('/s/player/1a2b3c4d/player_ias.vflset/en_US/base.js');
    expect(extractPlayerJsUrl('no script url')).toBeNull();
    expect(extractPlayerJsUrl(null)).toBeNull();
  });
});
