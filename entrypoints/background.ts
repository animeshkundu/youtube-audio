import { defineBackground } from 'wxt/utils/define-background';

import {
  initializeSettings,
  subscribeSettings,
  watchSettings,
  type ExtensionSettings,
} from '../src/shared/config';
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
    } catch (error) {
      console.error('[YouTube Audio] Background initialization failed', error);
    }
  },
});
