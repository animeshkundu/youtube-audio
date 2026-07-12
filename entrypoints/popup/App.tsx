import { useState } from 'preact/hooks';

import { setAudioOnlyEnabled, setBackgroundPlayEnabled, setEnabled } from '../../src/shared/config';
import {
  adBlockEnabledSignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  enabledSignal,
  ghostEnabledSignal,
  segmentSkipEnabledSignal,
} from '../../src/shared/settings-signals';
import { Brand, QuickControls, SectionHeader, StatusRow } from '../ui/components';

export type PopupActions = {
  setEnabled: typeof setEnabled;
  setAudioOnlyEnabled: typeof setAudioOnlyEnabled;
  setBackgroundPlayEnabled: typeof setBackgroundPlayEnabled;
  openOptions: () => void;
};

const defaultActions: PopupActions = {
  setEnabled,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  openOptions: () => void browser.runtime.openOptionsPage(),
};

export function Popup({ actions = defaultActions }: { actions?: PopupActions }) {
  const [error, setError] = useState<string | null>(null);
  const apply = (operation: () => Promise<void>) => {
    setError(null);
    void operation().catch(() => setError("Couldn't apply that change. Try again."));
  };

  const segmentStatus = segmentSkipEnabledSignal.value ? 'Ready' : 'Off';
  const protectionCount = [adBlockEnabledSignal.value, ghostEnabledSignal.value].filter(
    Boolean
  ).length;

  return (
    <main class="popup-shell">
      <header class="popup-header">
        <Brand />
        <button
          class="icon-button"
          type="button"
          aria-label="Open settings"
          onClick={actions.openOptions}
        >
          ⌘
        </button>
      </header>

      <div class="popup-content">
        <QuickControls
          enabled={enabledSignal.value}
          audioOnlyEnabled={audioOnlyEnabledSignal.value}
          backgroundPlayEnabled={backgroundPlayEnabledSignal.value}
          onEnabledChange={(checked) => apply(() => actions.setEnabled(checked))}
          onAudioOnlyChange={(checked) => apply(() => actions.setAudioOnlyEnabled(checked))}
          onBackgroundPlayChange={(checked) =>
            apply(() => actions.setBackgroundPlayEnabled(checked))
          }
          layout="popup"
        />

        <SectionHeader>Current page</SectionHeader>
        <div class="status-card">
          <StatusRow
            icon="♪"
            label="Audio-only"
            status={audioOnlyEnabledSignal.value ? 'Active' : 'Off'}
          />
          <StatusRow icon="↗" label="Segment skipping" status={segmentStatus} />
        </div>

        <SectionHeader>Protecting you</SectionHeader>
        <div class="status-card">
          <StatusRow
            icon="✓"
            label="Ads and tracking"
            status={protectionCount === 2 ? 'On' : `${protectionCount} of 2`}
          />
        </div>
        <button type="button" class="popup-report-link" onClick={actions.openOptions}>
          Something not working? Report an issue
        </button>
        {error && (
          <p class="error-message" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer class="popup-footer">
        <span>{enabledSignal.value ? 'Protection active' : 'Protection paused'}</span>
        <button type="button" onClick={actions.openOptions}>
          Settings →
        </button>
      </footer>
    </main>
  );
}
