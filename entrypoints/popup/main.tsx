import { render } from 'preact';

import { initializeSettings, watchSettings } from '../../src/shared/config';
import { Popup } from './App';
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
    const app = document.getElementById('app');
    if (app) render(<Popup />, app);
  }
}

void start();
