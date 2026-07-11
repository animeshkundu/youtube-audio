import { defineBackground } from 'wxt/utils/define-background';

import {
  initializeSettings,
  subscribeSettings,
  watchSettings,
  type ExtensionSettings,
} from '../src/shared/config';
import { pruneAdsFromPlayerResponse } from '../src/shared/adblock';
import { getExtensionPlatform } from '../src/shared/platform';
import { shouldBlock } from '../src/shared/telemetry';
import { loadRescueConfig } from '../src/shared/rescue';
import { getSponsorSegments } from '../src/shared/sponsorblock';

declare const __BENCH__: boolean;

const YOUTUBE_REQUESTS = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
  ...(__BENCH__ ? ['http://127.0.0.1/*', 'http://localhost/*'] : []),
];
const PLAYER_RESPONSE_REQUESTS = [
  '*://*.youtube.com/youtubei/v1/player*',
  '*://*.youtube.com/youtubei/v1/next*',
  '*://*.youtube-nocookie.com/youtubei/v1/player*',
  '*://*.youtube-nocookie.com/youtubei/v1/next*',
  ...(__BENCH__
    ? [
        'http://127.0.0.1/youtubei/v1/player*',
        'http://127.0.0.1/youtubei/v1/next*',
        'http://localhost/youtubei/v1/player*',
        'http://localhost/youtubei/v1/next*',
      ]
    : []),
];

let settings: ExtensionSettings;

function asBenchYouTubeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = 'www.youtube.com';
  parsed.port = '';
  parsed.protocol = 'https:';
  return parsed.href;
}

function blockTelemetry(details: browser.webRequest._OnBeforeRequestDetails): browser.webRequest.BlockingResponse {
  try {
    if (!settings.enabled || !settings.ghostEnabled) return {};
    const policyUrl = __BENCH__ ? asBenchYouTubeUrl(details.url) : details.url;
    return shouldBlock(policyUrl, settings.aggressiveTelemetry ? 'aggressive' : 'conservative')
      ? { cancel: true }
      : {};
  } catch {
    return {};
  }
}

function filterPlayerResponse(details: browser.webRequest._OnBeforeRequestDetails): void {
  try {
    if (!settings.enabled || !settings.adBlockEnabled || details.method !== 'POST') return;
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const chunks: Uint8Array[] = [];
    let settled = false;

    filter.ondata = (event) => {
      if (!settled) chunks.push(new Uint8Array(event.data.slice(0)));
    };
    filter.onstop = () => {
      if (settled) return;
      settled = true;
      const original = joinChunks(chunks);
      try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(original);
        const pruned = pruneAdsFromPlayerResponse(json);
        filter.write(pruned === json ? original : new TextEncoder().encode(pruned));
      } catch {
        filter.write(original);
      } finally {
        filter.close();
      }
    };
    filter.onerror = () => {
      if (settled) return;
      settled = true;
      try {
        filter.write(joinChunks(chunks));
      } catch {
        // The channel may already be closed; never surface the response-filter failure.
      }
      try {
        filter.disconnect();
      } catch {
        // Disconnecting an already-closed channel is harmless to the page.
      }
    };
  } catch {
    // Unsupported APIs, invalid request IDs, and setup failures leave the response untouched.
  }
}

function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export default defineBackground({
  persistent: { firefox: true },
  async main() {
    try {
      getExtensionPlatform();
      void loadRescueConfig;
      void getSponsorSegments;
      settings = await initializeSettings();
      subscribeSettings((nextSettings) => {
        settings = nextSettings;
      });
      watchSettings();
      browser.webRequest.onBeforeRequest.addListener(
        blockTelemetry,
        { urls: YOUTUBE_REQUESTS },
        ['blocking']
      );
      browser.webRequest.onBeforeRequest.addListener(
        filterPlayerResponse,
        { urls: PLAYER_RESPONSE_REQUESTS, types: ['xmlhttprequest'] }
      );
    } catch (error) {
      console.error('[YouTube Audio] Background initialization failed', error);
    }
  },
});
