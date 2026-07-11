import { render } from 'preact';
import { useState } from 'preact/hooks';

import {
  enabledSignal,
  initializeSettings,
  setEnabled,
  watchSettings,
} from '../../src/shared/config';
import './style.css';

function Popup() {
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    try {
      await setEnabled(!enabledSignal.value);
    } catch {
      setError('Could not save this change.');
    }
  }

  return (
    <main class="popup">
      <header>
        <span class="mark" aria-hidden="true">
          ◈
        </span>
        <strong>YouTube Audio</strong>
      </header>
      <button class="hero" type="button" onClick={toggle}>
        <span>
          <strong>Protection</strong>
          <small>{enabledSignal.value ? 'On · ready for YouTube' : 'Off'}</small>
        </span>
        <span
          class={`switch ${enabledSignal.value ? 'is-on' : ''}`}
          role="switch"
          aria-checked={enabledSignal.value}
          aria-label="Enable YouTube Audio"
        >
          <span />
        </span>
      </button>
      {error && <p class="error">{error}</p>}
      <button class="settings" type="button" onClick={() => browser.runtime.openOptionsPage()}>
        Settings →
      </button>
    </main>
  );
}

async function start() {
  try {
    await initializeSettings();
    watchSettings();
  } finally {
    render(<Popup />, document.getElementById('app')!);
  }
}

void start();
