import { render } from 'preact';

import {
  adBlockEnabledSignal,
  aggressiveTelemetrySignal,
  disableAutoplayNextSignal,
  forceQualityMaxSignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  ghostEnabledSignal,
  hideCommentsSignal,
  hideRecommendationsSignal,
  hideShortsSignal,
  equalizerBandsSignal,
  equalizerEnabledSignal,
  initializeSettings,
  loudnessNormalizationSignal,
  lyricsEnabledSignal,
  segmentSkipCategoriesSignal,
  segmentSkipEnabledSignal,
  setAdBlockEnabled,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setEqualizerBand,
  setForceQualityMax,
  setGhostEnabled,
  setMusicSetting,
  setQualityOfLifeSetting,
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
        <h2>YouTube Music</h2>
        <button type="button" onClick={() => void setMusicSetting('loudnessNormalization', !loudnessNormalizationSignal.value)}>
          <span><strong>Normalize loudness</strong><small>Use YouTube's per-track loudness value for consistent volume.</small></span>
          <span role="switch" aria-checked={loudnessNormalizationSignal.value}>{loudnessNormalizationSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setMusicSetting('equalizerEnabled', !equalizerEnabledSignal.value)}>
          <span><strong>Equalizer</strong><small>Apply the five-band profile below.</small></span>
          <span role="switch" aria-checked={equalizerEnabledSignal.value}>{equalizerEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
        {[60, 250, 1000, 4000, 12000].map((frequency, index) => (
          <label key={frequency}>
            <span><strong>{frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}</strong><small>{equalizerBandsSignal.value[index] ?? 0} dB</small></span>
            <input type="range" min="-12" max="12" step="1" value={equalizerBandsSignal.value[index] ?? 0} onInput={(event) => void setEqualizerBand(index, Number(event.currentTarget.value))} />
          </label>
        ))}
        <button type="button" onClick={() => void setMusicSetting('lyricsEnabled', !lyricsEnabledSignal.value)}>
          <span><strong>Synced lyrics</strong><small>Opt in to sending track, artist, and duration anonymously to LRCLIB.</small></span>
          <span role="switch" aria-checked={lyricsEnabledSignal.value}>{lyricsEnabledSignal.value ? 'On' : 'Off'}</span>
        </button>
      </section>
      <section>
        <h2>Quality of life</h2>
        <label>
          <span><strong>Maximum video quality</strong><small>Cap YouTube's adaptive quality to save data.</small></span>
          <select value={forceQualityMaxSignal.value} onChange={(event) => void setForceQualityMax(event.currentTarget.value as typeof forceQualityMaxSignal.value)}>
            <option value="off">Off</option><option value="144p">144p</option><option value="240p">240p</option><option value="360p">360p</option><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option>
          </select>
        </label>
        <button type="button" onClick={() => void setQualityOfLifeSetting('disableAutoplayNext', !disableAutoplayNextSignal.value)}>
          <span><strong>Disable autoplay next</strong><small>Turn off YouTube's native Up next control.</small></span>
          <span role="switch" aria-checked={disableAutoplayNextSignal.value}>{disableAutoplayNextSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setQualityOfLifeSetting('hideShorts', !hideShortsSignal.value)}>
          <span><strong>Hide Shorts</strong><small>Hide Shorts shelves and cards on desktop and mobile.</small></span>
          <span role="switch" aria-checked={hideShortsSignal.value}>{hideShortsSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setQualityOfLifeSetting('hideRecommendations', !hideRecommendationsSignal.value)}>
          <span><strong>Hide recommendations</strong><small>Hide related videos beside the watch page.</small></span>
          <span role="switch" aria-checked={hideRecommendationsSignal.value}>{hideRecommendationsSignal.value ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => void setQualityOfLifeSetting('hideComments', !hideCommentsSignal.value)}>
          <span><strong>Hide comments</strong><small>Hide the comments section and mobile entry point.</small></span>
          <span role="switch" aria-checked={hideCommentsSignal.value}>{hideCommentsSignal.value ? 'On' : 'Off'}</span>
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
