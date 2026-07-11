import { render } from 'preact';
import { useState } from 'preact/hooks';

import {
  adBlockEnabledSignal,
  aggressiveTelemetrySignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  disableAutoplayNextSignal,
  ghostEnabledSignal,
  hideShortsSignal,
  initializeSettings,
  segmentSkipEnabledSignal,
  setAdBlockEnabled,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setGhostEnabled,
  setQualityOfLifeSetting,
  setSegmentSkipEnabled,
  watchSettings,
} from '../../src/shared/config';
import './style.css';

type ToggleProps = {
  label: string;
  description: string;
  active: boolean;
  onToggle: () => Promise<void>;
};

function Toggle({ label, description, active, onToggle }: ToggleProps) {
  return (
    <button class="hero" type="button" onClick={() => void onToggle()}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span class={`switch ${active ? 'is-on' : ''}`} role="switch" aria-checked={active}>
        <span />
      </span>
    </button>
  );
}

function Popup() {
  const [error, setError] = useState<string | null>(null);
  const apply = async (operation: () => Promise<void>) => {
    setError(null);
    try {
      await operation();
    } catch {
      setError('Could not save this change.');
    }
  };

  return (
    <main class="popup">
      <header>
        <span class="mark" aria-hidden="true">◈</span>
        <strong>YouTube Audio</strong>
      </header>
      <Toggle
        label="Audio only"
        description="Stop video bytes, keep native controls"
        active={audioOnlyEnabledSignal.value}
        onToggle={() => apply(() => setAudioOnlyEnabled(!audioOnlyEnabledSignal.value))}
      />
      <Toggle
        label="Background play"
        description="Keep playing when YouTube is hidden"
        active={backgroundPlayEnabledSignal.value}
        onToggle={() => apply(() => setBackgroundPlayEnabled(!backgroundPlayEnabledSignal.value))}
      />
      <Toggle
        label="Block ads"
        description="Remove known player ad descriptors"
        active={adBlockEnabledSignal.value}
        onToggle={() => apply(() => setAdBlockEnabled(!adBlockEnabledSignal.value))}
      />
      <Toggle
        label="Skip segments"
        description="Privately skip sponsors and non-music"
        active={segmentSkipEnabledSignal.value}
        onToggle={() => apply(() => setSegmentSkipEnabled(!segmentSkipEnabledSignal.value))}
      />
      <Toggle
        label="Disable autoplay next"
        description="Stop YouTube from starting another video"
        active={disableAutoplayNextSignal.value}
        onToggle={() =>
          apply(() =>
            setQualityOfLifeSetting('disableAutoplayNext', !disableAutoplayNextSignal.value)
          )
        }
      />
      <Toggle
        label="Hide Shorts"
        description="Remove Shorts shelves and cards"
        active={hideShortsSignal.value}
        onToggle={() => apply(() => setQualityOfLifeSetting('hideShorts', !hideShortsSignal.value))}
      />
      <Toggle
        label="Reduce tracking"
        description="Block safe first-party telemetry"
        active={ghostEnabledSignal.value}
        onToggle={() => apply(() => setGhostEnabled(!ghostEnabledSignal.value))}
      />
      <Toggle
        label="Aggressive privacy"
        description="May affect history and resume position"
        active={aggressiveTelemetrySignal.value}
        onToggle={() => apply(() => setAggressiveTelemetry(!aggressiveTelemetrySignal.value))}
      />
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
