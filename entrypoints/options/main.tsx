import { render } from 'preact';

import {
  adBlockEnabledSignal,
  aggressiveTelemetrySignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  ghostEnabledSignal,
  initializeSettings,
  segmentSkipCategoriesSignal,
  segmentSkipEnabledSignal,
  setAdBlockEnabled,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setGhostEnabled,
  setSegmentSkipCategory,
  setSegmentSkipEnabled,
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
        <h2>Protection</h2>
        <button type="button" onClick={() => void setAdBlockEnabled(!adBlockEnabledSignal.value)}>
          <span><strong>Block ads</strong><small>Remove known ad descriptors from YouTube player responses.</small></span>
          <span role="switch" aria-checked={adBlockEnabledSignal.value}>{adBlockEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setSegmentSkipEnabled(!segmentSkipEnabledSignal.value)}>
          <span><strong>Skip segments</strong><small>Use a private hash-prefix lookup to skip enabled categories.</small></span>
          <span role="switch" aria-checked={segmentSkipEnabledSignal.value}>{segmentSkipEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setSegmentSkipCategory('sponsor', !segmentSkipCategoriesSignal.value.includes('sponsor'))}>
          <span><strong>Sponsored segments</strong><small>Paid promotions embedded in a video.</small></span>
          <span role="switch" aria-checked={segmentSkipCategoriesSignal.value.includes('sponsor')}>{segmentSkipCategoriesSignal.value.includes('sponsor') ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setSegmentSkipCategory('music_offtopic', !segmentSkipCategoriesSignal.value.includes('music_offtopic'))}>
          <span><strong>Non-music segments</strong><small>Talking, credits, or other non-music sections.</small></span>
          <span role="switch" aria-checked={segmentSkipCategoriesSignal.value.includes('music_offtopic')}>{segmentSkipCategoriesSignal.value.includes('music_offtopic') ? 'On' : 'Off'}</span>
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
