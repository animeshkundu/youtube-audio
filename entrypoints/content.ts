import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';

import { applyScriptletOperations } from '../src/shared/scriptlets';
import { observeYouTubeSpa } from '../src/shared/spa';

// Compile-time flag injected by wxt.config.ts (vite `define`). `false` in production
// builds, so the marker below is dead-code-eliminated and never runs on real YouTube.
declare const __BENCH__: boolean;

const MATCHES = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
];

export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_start',
  async main() {
    if (__BENCH__) {
      // Observable proof that the content script ran, used only by the integration bench.
      document.documentElement.dataset.ytaBench = '1';
    }
    void applyScriptletOperations;
    void observeYouTubeSpa;
    try {
      await injectScript('/main-world.js');
    } catch (error) {
      console.error('[YouTube Audio] MAIN-world injection failed', error);
    }
  },
});
