import { render } from 'preact';

import {
  enabledSignal,
  initializeSettings,
  setEnabled,
  watchSettings,
} from '../../src/shared/config';
import './style.css';

function Options() {
  return (
    <main>
      <header>
        <span aria-hidden="true">◈</span>
        <div>
          <h1>YouTube Audio</h1>
          <p>Settings</p>
        </div>
      </header>
      <section>
        <h2>Quick controls</h2>
        <button type="button" onClick={() => void setEnabled(!enabledSignal.value)}>
          <span>
            <strong>Protection</strong>
            <small>Apply YouTube Audio features when they become available.</small>
          </span>
          <span role="switch" aria-checked={enabledSignal.value}>
            {enabledSignal.value ? 'On' : 'Off'}
          </span>
        </button>
      </section>
      <section>
        <h2>Foundation ready</h2>
        <p>Playback, privacy, skipping, music, and download controls arrive in later milestones.</p>
      </section>
    </main>
  );
}

async function start() {
  await initializeSettings();
  watchSettings();
  render(<Options />, document.getElementById('app')!);
}

void start();
