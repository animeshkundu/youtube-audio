import { useEffect, useState } from 'preact/hooks';

import { setBackgroundPlayEnabled, setEnabled } from '../../src/shared/config';
import {
  adBlockEnabledSignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  enabledSignal,
  fallbackQualityCapEnabledSignal,
  forceQualityMaxSignal,
  ghostEnabledSignal,
} from '../../src/shared/settings-signals';
import type { PlaybackUiState } from '../../src/shared/status';
import { resolveTabAudioOnly } from '../../src/shared/tab-scope';
import { Brand, SettingRow, Switch } from '../ui/components';
import { consentSignal } from './consent-state';
import { playbackStatusSignal } from './playback-status';
import { setActiveTabAudioOnly, tabAudioOnlyOverrideSignal } from './tab-scope';

export type PopupActions = {
  setEnabled: typeof setEnabled;
  setBackgroundPlayEnabled: typeof setBackgroundPlayEnabled;
  openOptions: () => void;
  openYouTube: () => void;
  /** SPEC-013: the consent card's action, deep-linking to the options Data & consent section. */
  openConsentSettings: () => void;
  /**
   * Toggle audio-only for the active tab. This is the per-tab scope (SPEC-012 §5; ADR-0014), not
   * the global preference: the hero is a quick control for the tab in front of the user, while the
   * options page keeps editing the global default.
   */
  setTabAudioOnly: (enabled: boolean) => Promise<void>;
  openBlockingSettings: () => void;
};

export const defaultActions: PopupActions = {
  setEnabled,
  setBackgroundPlayEnabled,
  openOptions: () => void browser.runtime.openOptionsPage(),
  openYouTube: () => void browser.tabs.create({ url: 'https://www.youtube.com/' }),
  openConsentSettings: () =>
    void browser.tabs.create({ url: browser.runtime.getURL('/options.html#data-consent') }),
  setTabAudioOnly: setActiveTabAudioOnly,
  openBlockingSettings: () =>
    void browser.tabs.create({
      url: browser.runtime.getURL('/options.html#privacy-blocking'),
    }),
};

function heroStatusCopy(
  status: Exclude<PlaybackUiState, { kind: 'not-youtube' }>,
  fallbackQualityEngaged: boolean
): string {
  switch (status.kind) {
    case 'active':
      return 'Audio-only on. No video loaded, data saved.';
    case 'connecting':
      return 'Checking this tab...';
    case 'fallback':
      if (!fallbackQualityEngaged) {
        return status.reason === 'live'
          ? 'Live stream, playing normally.'
          : "Audio-only isn't available on this video. Playing normally.";
      }
      // SPEC-017: fallback playback is deliberately capped, and Music prefers its song mode. The
      // song wording is the intent, not a per-video outcome report (fail-open by design).
      if (status.reason !== 'live' && status.host === 'music') {
        return "Audio-only isn't available on this video. Playing the song to save data.";
      }
      return status.reason === 'live'
        ? 'Live stream, playing at low quality to save data.'
        : "Audio-only isn't available on this video. Playing at low quality to save data.";
    case 'disabled':
      return 'Audio-only off. Video plays normally.';
    case 'not-a-watch-page':
      return 'Play a video to use audio-only.';
  }
}

function protectionCopy(
  adBlockingActive: boolean,
  ghostActive: boolean,
  ghostSetting: boolean
): string {
  if (adBlockingActive && ghostActive) {
    return 'Ads and trackers blocked. Ghost on.';
  }
  const ghostCopy = ghostActive ? 'Ghost on.' : ghostSetting ? 'Ghost needs access.' : 'Ghost off.';
  return `${adBlockingActive ? 'Ads blocked.' : 'Ads play normally. Turn on ad blocking.'} ${ghostCopy}`;
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

function ConsentCard({ onOpenConsent }: { onOpenConsent: () => void }) {
  // SPEC-013 "no dead switch": while consent is not granted every playback control would be inert,
  // so the popup renders this card instead.
  return (
    <section class="popup-empty-state popup-consent-state" aria-labelledby="popup-consent-title">
      <h1 id="popup-consent-title">Almost there</h1>
      <p class="popup-consent-copy">
        To play audio without video, YouTube Audio needs to ask YouTube for the audio stream.
        Nothing is sent until you say so.
      </p>
      <button class="primary-action" type="button" onClick={onOpenConsent}>
        Review data &amp; consent
      </button>
    </section>
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
  // Whether a fallback would have engaged the SPEC-017 quality cap: the setting is on and the
  // user's own maximum-quality choice is not fighting it.
  const fallbackCapEngaged =
    fallbackQualityCapEnabledSignal.value && forceQualityMaxSignal.value === 'off';

  return (
    <section class={`popup-hero${active ? ' is-active' : ''}`} aria-labelledby="popup-hero-title">
      <div class="popup-hero-row" onClick={() => onChange(!checked)}>
        <span class="popup-hero-copy">
          <h1 id="popup-hero-title">
            Audio-only
            <span class="popup-scope-tag">This tab</span>
          </h1>
          <span class="popup-hero-status" id={statusId} aria-live="polite" aria-atomic="true">
            {active && <span class="now-playing" aria-hidden="true" />}
            <span>{heroStatusCopy(displayStatus, fallbackCapEngaged)}</span>
          </span>
        </span>
        <Switch label="Audio-only" checked={checked} describedBy={statusId} onChange={onChange} />
      </div>
    </section>
  );
}

export function Popup({ actions = defaultActions }: { actions?: PopupActions }) {
  const [error, setError] = useState<string | null>(null);
  const [networkGranted, setNetworkGranted] = useState<boolean | null>(null);
  const apply = (operation: () => Promise<void>) => {
    setError(null);
    void operation().catch(() => setError("Couldn't apply that change. Try again."));
  };
  const playbackStatus = playbackStatusSignal.value;
  const consent = consentSignal.value;
  useEffect(() => {
    try {
      void browser.permissions
        .contains({ permissions: ['webRequest', 'webRequestBlocking'] })
        .then(setNetworkGranted)
        .catch(() => setNetworkGranted(false));
    } catch {
      setNetworkGranted(false);
    }
  }, []);
  // Ad blocking is only real when the setting is on AND the network permission is granted
  // (ADR-0018): the background flips the setting off on revoke, but AND-ing here covers the
  // transient window so the popup never over-claims. Ghost rides the same network grants, so its
  // display is AND-ed too: a fresh install has Ghost on with no grants yet.
  const adBlockingActive = adBlockEnabledSignal.value && networkGranted === true;
  const ghostActive = ghostEnabledSignal.value && networkGranted === true;

  // Consent is resolved over a message round trip; until it lands, show only the header so a
  // denied install never flashes controls that could not take effect.
  if (consent === null) {
    return (
      <main class="popup-shell popup-shell-empty">
        <PopupHeader onOpenOptions={actions.openOptions} compact />
      </main>
    );
  }

  if (!consent.granted) {
    return (
      <main class="popup-shell popup-shell-empty">
        <PopupHeader onOpenOptions={actions.openOptions} compact />
        <ConsentCard onOpenConsent={actions.openConsentSettings} />
      </main>
    );
  }

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
          checked={resolveTabAudioOnly(
            audioOnlyEnabledSignal.value,
            tabAudioOnlyOverrideSignal.value
          )}
          onChange={(checked) => apply(() => actions.setTabAudioOnly(checked))}
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

        <button
          type="button"
          class="popup-protection-line"
          onClick={() =>
            adBlockingActive ? actions.openOptions() : actions.openBlockingSettings()
          }
        >
          <span>{protectionCopy(adBlockingActive, ghostActive, ghostEnabledSignal.value)}</span>
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
