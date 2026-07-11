import { render } from 'preact';
import { useState } from 'preact/hooks';

import {
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  initializeSettings,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
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
