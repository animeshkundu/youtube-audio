import { render } from 'preact';

import {
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  initializeSettings,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  watchSettings,
} from '../../src/shared/config';
import './style.css';

function Options() {
  return (
    <main>
      <header>
        <span aria-hidden="true">◈</span>
        <div><h1>YouTube Audio</h1><p>Settings</p></div>
      </header>
      <section>
        <h2>Playback</h2>
        <button type="button" onClick={() => void setAudioOnlyEnabled(!audioOnlyEnabledSignal.value)}>
          <span><strong>Audio only</strong><small>Stream a direct audio track on eligible videos.</small></span>
          <span role="switch" aria-checked={audioOnlyEnabledSignal.value}>{audioOnlyEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setBackgroundPlayEnabled(!backgroundPlayEnabledSignal.value)}>
          <span><strong>Background play</strong><small>Keep playback active while the page is hidden.</small></span>
          <span role="switch" aria-checked={backgroundPlayEnabledSignal.value}>{backgroundPlayEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
      </section>
      <section><h2>Compatibility</h2><p>Unsupported videos automatically use normal YouTube playback.</p></section>
    </main>
  );
}

async function start() {
  await initializeSettings();
  watchSettings();
  render(<Options />, document.getElementById('app')!);
}

void start();
