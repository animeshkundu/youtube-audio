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
