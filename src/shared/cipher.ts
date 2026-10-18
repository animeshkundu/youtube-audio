/**
 * Pure YouTube signature-cipher decoding (SPEC-030, Phase B of the audio-only fallback chain).
 *
 * The TVHTML5_SIMPLY_EMBEDDED_PLAYER client can serve age-restricted videos without a login, but it
 * returns `signatureCipher` strings instead of ready `url`s. Turning a cipher into a playable URL
 * requires replaying the transform YouTube's own `base.js` applies to the signature. Rather than
 * evaluate untrusted page script, this module parses the small, stable operation set out of
 * `base.js` (reverse / splice / swap / slice) and replays it as a pure function.
 *
 * Everything here is pure and fail-open: an unparseable bundle, an unknown helper shape, or a
 * malformed cipher returns `null`, and the caller simply skips the client (native playback is
 * never affected). The operation set has been stable for years, but YouTube can change it at any
 * time; a wrong decode yields a URL that 403s on fetch, which the media-error fail-open handler
 * absorbs.
 */

/** One decoded signature transform, in application order. */
export type CipherOperation =
  | { readonly kind: 'reverse' }
  | { readonly kind: 'splice'; readonly count: number }
  | { readonly kind: 'slice'; readonly count: number }
  | { readonly kind: 'swap'; readonly index: number };

export interface SignatureCipherParts {
  readonly url: string;
  readonly signature: string;
  readonly sp: string;
}

const IDENT = '[A-Za-z0-9_$]+';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface FunctionDefinition {
  readonly name: string;
  readonly params: string[];
  readonly body: string;
  readonly start: number;
}

/**
 * Every `name=function(params){body}` whose body contains no braces. Cipher helpers and the cipher
 * transform itself are both brace-free in every observed `base.js`, which keeps this a linear scan
 * rather than a brittle recursive matcher.
 */
function findFunctionDefinitions(source: string): FunctionDefinition[] {
  const definitions: FunctionDefinition[] = [];
  const pattern = new RegExp(`(${IDENT})\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{([^{}]*)\\}`, 'g');
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const params = match[2];
    const body = match[3];
    const start = match.index ?? 0;
    if (!name || params === undefined || body === undefined) continue;
    definitions.push({
      name,
      params: params
        .split(',')
        .map((param) => param.trim())
        .filter((param) => param.length > 0),
      body: body.trim(),
      start,
    });
  }
  return definitions;
}

interface CipherHelpers {
  readonly reverse: string | null;
  readonly splice: string | null;
  readonly swap: string | null;
}

function classifyHelpers(definitions: readonly FunctionDefinition[]): CipherHelpers {
  let reverse: string | null = null;
  let splice: string | null = null;
  let swap: string | null = null;
  for (const definition of definitions) {
    const [first, second] = definition.params;
    if (!first) continue;
    const arg = escapeRegExp(first);
    if (
      definition.params.length === 1 &&
      new RegExp(`^${arg}\\.reverse\\(\\)$`).test(definition.body)
    ) {
      reverse ??= definition.name;
      continue;
    }
    if (!second) continue;
    const secondArg = escapeRegExp(second);
    if (new RegExp(`^${arg}\\.splice\\(0,\\s*${secondArg}\\)$`).test(definition.body)) {
      splice ??= definition.name;
      continue;
    }
    // var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c
    const swapBody = new RegExp(
      `^var\\s+${IDENT}\\s*=\\s*${arg}\\[0\\]\\s*;\\s*${arg}\\[0\\]\\s*=\\s*${arg}\\[${secondArg}%${arg}\\.length\\]\\s*;\\s*${arg}\\[${secondArg}%${arg}\\.length\\]\\s*=\\s*${IDENT}$`
    );
    if (swapBody.test(definition.body)) swap ??= definition.name;
  }
  return { reverse, splice, swap };
}

function findCipherBody(
  definitions: readonly FunctionDefinition[]
): { body: string; arg: string } | null {
  for (const definition of definitions) {
    if (!definition.body.includes('.split("")') || !definition.body.includes('.join("")')) continue;
    const argMatch = new RegExp(`(${IDENT})\\s*=\\s*\\1\\.split\\(\\s*""\\s*\\)`).exec(
      definition.body
    );
    if (argMatch?.[1]) return { body: definition.body, arg: argMatch[1] };
  }
  return null;
}

interface LocatedOperation {
  readonly index: number;
  readonly operation: CipherOperation;
}

/**
 * Extract the signature transform from a `base.js` bundle. Returns the ordered operations, or
 * `null` when the bundle does not carry a shape this module recognises.
 */
export function extractCipherOperations(baseJs: unknown): CipherOperation[] | null {
  if (typeof baseJs !== 'string' || baseJs.length === 0) return null;
  const definitions = findFunctionDefinitions(baseJs);
  const cipher = findCipherBody(definitions);
  if (!cipher) return null;
  const helpers = classifyHelpers(definitions);
  const { body, arg } = cipher;
  const argPattern = escapeRegExp(arg);
  const located: LocatedOperation[] = [];

  const addMatches = (
    pattern: RegExp,
    build: (match: RegExpExecArray) => CipherOperation | null
  ) => {
    for (const match of body.matchAll(pattern)) {
      const operation = build(match);
      if (operation) located.push({ index: match.index ?? 0, operation });
    }
  };

  // Inline operations (older bundles): a.reverse(); a.splice(0,N); a=a.slice(0,N)
  addMatches(new RegExp(`${argPattern}\\.reverse\\(\\)`, 'g'), () => ({ kind: 'reverse' }));
  addMatches(new RegExp(`${argPattern}\\.splice\\(0,\\s*(\\d+)\\)`, 'g'), (match) => ({
    kind: 'splice',
    count: Number(match[1]),
  }));
  addMatches(
    new RegExp(`${argPattern}\\s*=\\s*${argPattern}\\.slice\\(0,\\s*(\\d+)\\)`, 'g'),
    (match) => ({ kind: 'slice', count: Number(match[1]) })
  );

  // Helper-call operations (modern bundles): H(a); H(a,N); namespaced Kx.H(a,N) tolerated.
  const callBoundary = `(?:^|[^\\w$])`;
  if (helpers.reverse) {
    addMatches(
      new RegExp(
        `${callBoundary}${escapeRegExp(helpers.reverse)}\\s*\\(\\s*${argPattern}\\s*(?:,\\s*\\d+)?\\)`,
        'g'
      ),
      () => ({
        kind: 'reverse',
      })
    );
  }
  if (helpers.splice) {
    addMatches(
      new RegExp(
        `${callBoundary}${escapeRegExp(helpers.splice)}\\s*\\(\\s*${argPattern}\\s*,\\s*(\\d+)\\s*\\)`,
        'g'
      ),
      (match) => ({ kind: 'splice', count: Number(match[1]) })
    );
  }
  if (helpers.swap) {
    addMatches(
      new RegExp(
        `${callBoundary}${escapeRegExp(helpers.swap)}\\s*\\(\\s*${argPattern}\\s*,\\s*(\\d+)\\s*\\)`,
        'g'
      ),
      (match) => ({ kind: 'swap', index: Number(match[1]) })
    );
  }

  if (located.length === 0) return null;
  located.sort((left, right) => left.index - right.index);
  return located.map((entry) => entry.operation);
}

/** Replay the transform on a raw signature. Pure; never throws. */
export function decodeSignature(signature: string, operations: readonly CipherOperation[]): string {
  let chars = Array.from(signature);
  for (const operation of operations) {
    switch (operation.kind) {
      case 'reverse':
        chars.reverse();
        break;
      case 'splice':
        chars.splice(0, operation.count);
        break;
      case 'slice':
        chars = chars.slice(0, operation.count);
        break;
      case 'swap': {
        if (chars.length === 0) break;
        const index = ((operation.index % chars.length) + chars.length) % chars.length;
        const first = chars[0]!;
        chars[0] = chars[index]!;
        chars[index] = first;
        break;
      }
    }
  }
  return chars.join('');
}

/** Parse a `signatureCipher` query string into its `url`, `s` (signature) and `sp` parts. */
export function parseSignatureCipher(value: unknown): SignatureCipherParts | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const params = new URLSearchParams(value);
    const url = params.get('url');
    const signature = params.get('s');
    const sp = params.get('sp') ?? 'signature';
    if (!url || !signature || !sp) return null;
    return { url, signature, sp };
  } catch {
    return null;
  }
}

/** Decode a `signatureCipher` into an attachable URL, or `null` when it cannot be resolved. */
export function buildSignedAudioUrl(
  value: unknown,
  operations: readonly CipherOperation[]
): string | null {
  const parts = parseSignatureCipher(value);
  if (!parts) return null;
  try {
    const signature = decodeSignature(parts.signature, operations);
    const separator = parts.url.includes('?') ? '&' : '?';
    return `${parts.url}${separator}${parts.sp}=${encodeURIComponent(signature)}`;
  } catch {
    return null;
  }
}

/** Extract the `signatureTimestamp` the ciphered player response was signed against. */
export function extractSignatureTimestamp(baseJs: unknown): number | null {
  if (typeof baseJs !== 'string') return null;
  const match = /signatureTimestamp[:=](\d{3,7})/.exec(baseJs);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Extract the `base.js` player script URL from a watch/embed page or an `ytcfg` payload. */
export function extractPlayerJsUrl(source: unknown): string | null {
  if (typeof source !== 'string' || source.length === 0) return null;
  const match = /(\/s\/player\/[A-Za-z0-9_-]{6,}\/[A-Za-z0-9_./-]*base\.js)/.exec(source);
  return match?.[1] ?? null;
}
