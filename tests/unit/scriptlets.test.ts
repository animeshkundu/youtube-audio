// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyScriptletOperations } from '../../src/shared/scriptlets';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function playerResponseWithAds(): Record<string, unknown> {
  return {
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [] },
    adPlacements: [{ adPlacementRenderer: {} }],
    playerAds: [{ ad: 1 }],
    videoDetails: { title: 'keep' },
  };
}

/** Install just the fetch/Response.json prune operation. */
function installFetchPrune() {
  return applyScriptletOperations([{ id: 'prune-fetched-player-response', args: {} }]);
}

describe('prune-fetched-player-response', () => {
  it('prunes ads from a player response read via fetch().then(r => r.json())', async () => {
    const body = playerResponseWithAds();
    const fakeResponse = { json: () => Promise.resolve(body) } as unknown as Response;
    const mock = vi.fn(async () => fakeResponse) as unknown as typeof fetch;
    globalThis.fetch = mock;

    const result = installFetchPrune();
    expect(result.applied).toBe(1);

    const response = await globalThis.fetch('/youtubei/v1/player?key=abc');
    const parsed = (await response.json()) as Record<string, unknown>;

    // The ad-scheduling fields are gone even though the page used Response.json(), which does not
    // route through the JSON.parse wrap; playback data is preserved.
    expect('adPlacements' in parsed).toBe(false);
    expect('playerAds' in parsed).toBe(false);
    expect(parsed.streamingData).toBeDefined();
    expect((parsed.videoDetails as { title: string }).title).toBe('keep');

    result.cleanup();
    expect(globalThis.fetch).toBe(mock); // wrap removed, original fetch restored
  });

  it('covers /youtubei/v1/next as well', async () => {
    const body = playerResponseWithAds();
    globalThis.fetch = vi.fn(async () => ({
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
    installFetchPrune();
    const parsed = (await (await globalThis.fetch('/youtubei/v1/next')).json()) as Record<
      string,
      unknown
    >;
    expect('adPlacements' in parsed).toBe(false);
  });

  it('leaves non-player fetches untouched', async () => {
    const body = playerResponseWithAds();
    globalThis.fetch = vi.fn(async () => ({
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
    installFetchPrune();

    const parsed = (await (
      await globalThis.fetch('https://example.com/data.json')
    ).json()) as Record<string, unknown>;
    // Not a player endpoint, so the response is returned untouched.
    expect('adPlacements' in parsed).toBe(true);
  });

  it('is fail-open: a rejected fetch still rejects and does not throw synchronously', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    installFetchPrune();
    await expect(globalThis.fetch('/youtubei/v1/player')).rejects.toThrow('network');
  });
});

describe('coexistence: additive chaining instead of a skip', () => {
  const realStringify = JSON.stringify;
  const realParse = JSON.parse;

  afterEach(() => {
    JSON.stringify = realStringify;
    JSON.parse = realParse;
  });

  it('still applies operations when a foreign hook replaced JSON.stringify (red on the old heuristic)', async () => {
    // A plain-function hook, NOT a Proxy: Function.prototype.toString reports any Proxy as
    // "[native code]", so only this shape actually triggered (and actually reds) the old
    // non-native-JSON skip heuristic.
    let foreignCalls = 0;
    const foreignStringify = function foreignStringify(value: unknown) {
      foreignCalls += 1;
      return realStringify(value);
    } as typeof JSON.stringify;
    JSON.stringify = foreignStringify;

    const body = playerResponseWithAds();
    globalThis.fetch = vi.fn(async () => ({
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;

    const result = installFetchPrune();

    expect(result.applied).toBe(1);
    const parsed = (await (await globalThis.fetch('/youtubei/v1/player')).json()) as Record<
      string,
      unknown
    >;
    expect('adPlacements' in parsed).toBe(false);
    expect(parsed.streamingData).toBeDefined();
    // The foreign hook is untouched by this operation and still works.
    JSON.stringify({ a: 1 });
    expect(foreignCalls).toBe(1);
    expect(JSON.stringify).toBe(foreignStringify);
    result.cleanup();
  });

  it('chains through a foreign JSON.parse and leaves a later wrapper in place on cleanup', () => {
    let foreignCalls = 0;
    JSON.parse = function foreignParse(text: string) {
      foreignCalls += 1;
      return realParse(text);
    } as typeof JSON.parse;

    const result = applyScriptletOperations([{ id: 'prune-inline-player-response', args: {} }]);

    expect(result.applied).toBe(1);
    // Parse through the chain: our wrapper must call the foreign original and prune its result.
    const parsed = JSON.parse(
      '{"playabilityStatus":{"status":"OK"},"streamingData":{"adaptiveFormats":[]},' +
        '"adPlacements":[{"adPlacementRenderer":{}}],"videoDetails":{"title":"keep"}}'
    ) as Record<string, unknown>;
    expect(foreignCalls).toBe(1);
    expect('adPlacements' in parsed).toBe(false);

    // A wrapper installed AFTER ours owns the reference; cleanup must not clobber it.
    const later = function laterParse(text: string) {
      return realParse(text);
    } as typeof JSON.parse;
    JSON.parse = later;
    result.cleanup();
    expect(JSON.parse).toBe(later);
  });
});
