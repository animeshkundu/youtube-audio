import { render } from 'preact';

import { initializeSettings, watchSettings } from '../../src/shared/config';
import { Popup } from './App';
import { refreshConsent } from './consent-state';
import { startPlaybackStatusChannel } from './playback-status';
import { startTabScopeChannel } from './tab-scope';
import '../ui/tokens.css';
import '../ui/components.css';
import './style.css';

async function start() {
  try {
    await initializeSettings();
    watchSettings();
  } finally {
    // Wire the popup to the active tab's real playback status and its per-tab audio-only scope.
    startPlaybackStatusChannel();
    startTabScopeChannel();
    // SPEC-013: resolve consent so a denied install gets the consent card, never dead controls.
    void refreshConsent();
    const app = document.getElementById('app');
    if (app) render(<Popup />, app);
  }
}

void start();
