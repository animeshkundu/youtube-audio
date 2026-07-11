import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';

import {
  getSettings,
  initializeSettings,
  setAudioOnlyEnabled,
  subscribeSettings,
  watchSettings,
} from '../src/shared/config';

// Compile-time flag injected by wxt.config.ts (vite `define`). `false` in production
// builds, so the marker below is dead-code-eliminated and never runs on real YouTube.
declare const __BENCH__: boolean;

const MATCHES = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
];
const SETTINGS_EVENT = 'yta:settings';
const STATUS_EVENT = 'yta:status';
const BUTTON_ID = 'yta-audio-only-toggle';

export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_start',
  async main() {
    if (__BENCH__) {
      // Observable proof that the content script ran, used only by the integration bench.
      document.documentElement.dataset.ytaBench = '1';
    }

    try {
      const bridgeNonce = crypto.randomUUID();
      await initializeSettings();
      watchSettings();
      subscribeSettings((settings) => {
        window.postMessage({ channel: SETTINGS_EVENT, nonce: bridgeNonce, settings }, location.origin);
        updateToggle(settings.enabled && settings.audioOnlyEnabled);
      });
      document.addEventListener(STATUS_EVENT, updateStatusMarker);
      // Hand the per-load nonce to the MAIN-world script, which reads and clears it on load.
      document.documentElement.dataset.ytaBridge = bridgeNonce;
      await injectScript('/main-world.js');
      window.postMessage(
        { channel: SETTINGS_EVENT, nonce: bridgeNonce, settings: getSettings() },
        location.origin
      );
      installPlayerToggle();
    } catch (error) {
      console.error('[YouTube Audio] Content initialization failed', error);
    }
  },
});

function installPlayerToggle(): void {
  const attach = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const controls = document.querySelector('.ytp-right-controls, .ytp-left-controls');
    if (!controls) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'ytp-button';
    button.title = 'Toggle audio-only playback';
    button.setAttribute('aria-label', 'Toggle audio-only playback');
    button.style.cssText =
      'font-size:20px;line-height:36px;text-align:center;color:#fff;background:transparent;border:0;cursor:pointer;';
    button.textContent = '♪';
    button.addEventListener('click', () => {
      const settings = getSettings();
      void setAudioOnlyEnabled(!settings.audioOnlyEnabled).catch(() => undefined);
    });
    controls.prepend(button);
    updateToggle(getSettings().enabled && getSettings().audioOnlyEnabled);
  };

  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
}

function updateToggle(active: boolean): void {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  button.setAttribute('aria-pressed', String(active));
  button.style.color = active ? '#22d3b4' : '#fff';
  button.title = active ? 'Audio-only is on' : 'Audio-only is off';
}

function updateStatusMarker(event: Event): void {
  if (!__BENCH__) return;
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) return;
  const status = (detail as { status?: unknown }).status;
  if (typeof status === 'string' && status.length <= 24) document.documentElement.dataset.ytaStatus = status;
}
