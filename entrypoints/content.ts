import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';

import { applyScriptletOperations } from '../src/shared/scriptlets';
import { observeYouTubeSpa } from '../src/shared/spa';

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
    void applyScriptletOperations;
    void observeYouTubeSpa;
    try {
      await injectScript('/main-world.js');
    } catch (error) {
      console.error('[YouTube Audio] MAIN-world injection failed', error);
    }
  },
});
