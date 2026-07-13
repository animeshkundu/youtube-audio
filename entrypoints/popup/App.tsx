import { useState } from 'preact/hooks';

import { setAudioOnlyEnabled, setBackgroundPlayEnabled, setEnabled } from '../../src/shared/config';
import {
  adBlockEnabledSignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  enabledSignal,
  ghostEnabledSignal,
} from '../../src/shared/settings-signals';
import type { PlaybackUiState } from '../../src/shared/status';
import { Brand, SettingRow, Switch } from '../ui/components';
import { playbackStatusSignal } from './playback-status';

export type PopupActions = {
  setEnabled: typeof setEnabled;
  setAudioOnlyEnabled: typeof setAudioOnlyEnabled;
  setBackgroundPlayEnabled: typeof setBackgroundPlayEnabled;
  openOptions: () => void;
  openYouTube: () => void;
};

const defaultActions: PopupActions = {
  setEnabled,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  openOptions: () => void browser.runtime.openOptionsPage(),
  openYouTube: () => void browser.tabs.create({ url: 'https://www.youtube.com/' }),
};

function heroStatusCopy(status: Exclude<PlaybackUiState, { kind: 'not-youtube' }>): string {
  switch (status.kind) {
    case 'active':
      return 'Audio-only on. Video muted, battery saved.';
    case 'connecting':
      return 'Checking this tab...';
    case 'fallback':
      return status.reason === 'live'
        ? 'Live stream, playing normally.'
        : "Audio-only isn't available on this video. Playing normally.";
    case 'disabled':
      return 'Audio-only off. Video plays normally.';
    case 'not-a-watch-page':
      return 'Play a video to use audio-only.';
  }
}

function protectionCopy(): string {
  if (adBlockEnabledSignal.value && ghostEnabledSignal.value) {
    return 'Ads and trackers blocked. Ghost on.';
  }
  return `${adBlockEnabledSignal.value ? 'Ads blocked.' : 'Ad blocking off.'} ${
    ghostEnabledSignal.value ? 'Ghost on.' : 'Ghost off.'
  }`;
}

function PopupHeader({
  onOpenOptions,
  compact = false,
}: {
  onOpenOptions: () => void;
  compact?: boolean;
}) {
  return (
    <header class="popup-header">
      <Brand />
      {!compact && (
        <button
          class="icon-button"
          type="button"
          aria-label="Open settings"
          onClick={onOpenOptions}
        >
          ⚙
        </button>
      )}
    </header>
  );
}

function PlaybackHero({
  status,
  checked,
  onChange,
}: {
  status: Exclude<PlaybackUiState, { kind: 'not-youtube' }>;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  // Never claim audio-only is active when the preference is off OR the extension is paused. Both the
  // audio-only toggle and the global pause flip their signal immediately, before the page-world
  // `disabled` status round-trips back, so gate the displayed active state on the live signals.
  const displayStatus =
    status.kind === 'active' && (!checked || !enabledSignal.value)
      ? { kind: 'disabled' as const }
      : status;
  const active = displayStatus.kind === 'active';
  const statusId = 'audio-only-status';

  return (
    <section class={`popup-hero${active ? ' is-active' : ''}`} aria-labelledby="popup-hero-title">
      <div class="popup-hero-row" onClick={() => onChange(!checked)}>
        <span class="popup-hero-copy">
          <h1 id="popup-hero-title">Audio-only</h1>
          <span class="popup-hero-status" id={statusId}>
            {active && <span class="now-playing" aria-hidden="true" />}
            <span>{heroStatusCopy(displayStatus)}</span>
          </span>
        </span>
        <Switch label="Audio-only" checked={checked} describedBy={statusId} onChange={onChange} />
      </div>
    </section>
  );
}

export function Popup({ actions = defaultActions }: { actions?: PopupActions }) {
  const [error, setError] = useState<string | null>(null);
  const apply = (operation: () => Promise<void>) => {
    setError(null);
    void operation().catch(() => setError("Couldn't apply that change. Try again."));
  };
  const playbackStatus = playbackStatusSignal.value;

  if (playbackStatus.kind === 'not-youtube') {
    return (
      <main class="popup-shell popup-shell-empty">
        <PopupHeader onOpenOptions={actions.openOptions} compact />
        <section class="popup-empty-state" aria-labelledby="popup-empty-title">
          <h1 id="popup-empty-title">Open YouTube to start</h1>
          <button class="primary-action" type="button" onClick={actions.openYouTube}>
            Open YouTube
          </button>
          <button class="empty-settings-action" type="button" onClick={actions.openOptions}>
            Settings
          </button>
        </section>
      </main>
    );
  }

  return (
    <main class="popup-shell">
      <PopupHeader onOpenOptions={actions.openOptions} />

      <div class="popup-content">
        <PlaybackHero
          status={playbackStatus}
          checked={audioOnlyEnabledSignal.value}
          onChange={(checked) => apply(() => actions.setAudioOnlyEnabled(checked))}
        />

        <section class="popup-secondary-card" aria-label="Playback controls">
          <SettingRow
            id="background-play-popup"
            label="Background play"
            description={
              backgroundPlayEnabledSignal.value
                ? 'On. Keeps playing in the background.'
                : 'Off. Follows normal page visibility.'
            }
            checked={backgroundPlayEnabledSignal.value}
            onChange={(checked) => apply(() => actions.setBackgroundPlayEnabled(checked))}
          />
        </section>

        <button type="button" class="popup-protection-line" onClick={actions.openOptions}>
          <span>{protectionCopy()}</span>
          <span aria-hidden="true">›</span>
        </button>

        {error && (
          <p class="error-message" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer class="popup-footer">
        <button
          type="button"
          class="popup-pause-action"
          onClick={() => apply(() => actions.setEnabled(!enabledSignal.value))}
        >
          {enabledSignal.value ? 'Pause YouTube Audio' : 'Resume YouTube Audio'}
        </button>
        <button type="button" onClick={actions.openOptions}>
          Settings
        </button>
      </footer>
    </main>
  );
}
