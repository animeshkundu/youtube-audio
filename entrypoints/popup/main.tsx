import { render } from 'preact';

import { initializeSettings, watchSettings } from '../../src/shared/config';
import { Popup } from './App';
import { startPlaybackStatusChannel } from './playback-status';
import '../ui/tokens.css';
import '../ui/components.css';
import './style.css';

async function start() {
  try {
    await initializeSettings();
    watchSettings();
  } finally {
    // Wire the popup to the active tab's real playback status (exposed via `playbackStatusSignal`).
    // The rendered UI does not consume it yet; a follow-up stack renders the honest hero from it.
    startPlaybackStatusChannel();
    const app = document.getElementById('app');
    if (app) render(<Popup />, app);
  }
}

void start();
