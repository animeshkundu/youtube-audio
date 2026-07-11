import { render } from 'preact';

import {
  aggressiveTelemetrySignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  ghostEnabledSignal,
  initializeSettings,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setGhostEnabled,
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
      <section>
        <h2>Privacy</h2>
        <button type="button" onClick={() => void setGhostEnabled(!ghostEnabledSignal.value)}>
          <span><strong>Reduce tracking</strong><small>Block safe first-party quality, ad, and instrumentation telemetry.</small></span>
          <span role="switch" aria-checked={ghostEnabledSignal.value}>{ghostEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setAggressiveTelemetry(!aggressiveTelemetrySignal.value)}>
          <span><strong>Aggressive telemetry blocking</strong><small>Also block watch-time statistics. This may affect history and resume position.</small></span>
          <span role="switch" aria-checked={aggressiveTelemetrySignal.value}>{aggressiveTelemetrySignal.value ? 'On' : 'Off'}</span>
        </button>
      </section>
      <section><h2>Compatibility</h2><p>Unsupported videos and protection errors automatically use normal YouTube behavior.</p></section>
    </main>
  );
}

async function start() {
  await initializeSettings();
  watchSettings();
  render(<Options />, document.getElementById('app')!);
}

void start();
