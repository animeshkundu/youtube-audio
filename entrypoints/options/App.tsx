import { useMemo, useState } from 'preact/hooks';

import {
  setAdBlockEnabled,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setDownloadEnabled,
  setEnabled,
  setEqualizerBand,
  setForceQualityMax,
  setGhostEnabled,
  setMusicSetting,
  setQualityOfLifeSetting,
  setSegmentSkipCategory,
  setSegmentSkipEnabled,
} from '../../src/shared/config';
import {
  adBlockEnabledSignal,
  aggressiveTelemetrySignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  disableAutoplayNextSignal,
  downloadEnabledSignal,
  enabledSignal,
  equalizerBandsSignal,
  equalizerEnabledSignal,
  forceQualityMaxSignal,
  ghostEnabledSignal,
  hideCommentsSignal,
  hideRecommendationsSignal,
  hideShortsSignal,
  loudnessNormalizationSignal,
  lyricsEnabledSignal,
  segmentSkipCategoriesSignal,
  segmentSkipEnabledSignal,
} from '../../src/shared/settings-signals';
import type { QualityCap } from '../../src/shared/quality-of-life';
import type { SponsorCategory } from '../../src/shared/sponsorblock';
import { Brand, Onboarding, QuickControls, SectionHeader, SettingRow } from '../ui/components';
import { IssueReporter } from '../ui/IssueReporter';

const SEEN_ONBOARDING_KEY = 'seenOnboarding';

export type OptionsActions = {
  setEnabled: typeof setEnabled;
  setAudioOnlyEnabled: typeof setAudioOnlyEnabled;
  setBackgroundPlayEnabled: typeof setBackgroundPlayEnabled;
  setAdBlockEnabled: typeof setAdBlockEnabled;
  setGhostEnabled: typeof setGhostEnabled;
  setSegmentSkipEnabled: typeof setSegmentSkipEnabled;
  setSegmentSkipCategory: typeof setSegmentSkipCategory;
  setQualityOfLifeSetting: typeof setQualityOfLifeSetting;
  setMusicSetting: typeof setMusicSetting;
  setEqualizerBand: typeof setEqualizerBand;
  setForceQualityMax: typeof setForceQualityMax;
  setDownloadEnabled: typeof setDownloadEnabled;
  setAggressiveTelemetry: typeof setAggressiveTelemetry;
  markOnboardingSeen: () => Promise<void>;
  openYouTube: () => void;
};

export const defaultOptionsActions: OptionsActions = {
  setEnabled,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setAdBlockEnabled,
  setGhostEnabled,
  setSegmentSkipEnabled,
  setSegmentSkipCategory,
  setQualityOfLifeSetting,
  setMusicSetting,
  setEqualizerBand,
  setForceQualityMax,
  setDownloadEnabled,
  setAggressiveTelemetry,
  markOnboardingSeen: async () => browser.storage.local.set({ [SEEN_ONBOARDING_KEY]: true }),
  openYouTube: () => void browser.tabs.create({ url: 'https://www.youtube.com/' }),
};

const sponsorRows: readonly [SponsorCategory, string, string][] = [
  ['sponsor', 'Sponsored segments', 'Paid promotions embedded in a video.'],
  ['music_offtopic', 'Non-music segments', 'Talking, credits, and other non-music sections.'],
];

function matchesSearch(query: string, ...text: string[]): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    normalized.length === 0 || text.some((value) => value.toLocaleLowerCase().includes(normalized))
  );
}

export function Options({
  actions = defaultOptionsActions,
  showOnboardingInitially = false,
}: {
  actions?: OptionsActions;
  showOnboardingInitially?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(showOnboardingInitially);
  const normalizedQuery = useMemo(() => query.trim().toLocaleLowerCase(), [query]);
  const dismissOnboarding = () => {
    setShowOnboarding(false);
    void actions.markOnboardingSeen();
  };
  const settingVisible = (...text: string[]) => matchesSearch(normalizedQuery, ...text);
  const sectionVisible = (...text: string[]) =>
    normalizedQuery.length === 0 || settingVisible(...text);

  return (
    <div class="options-app">
      <header class="options-header">
        <Brand suffix="Settings" />
        <label class="search-field">
          <span class="search-icon" aria-hidden="true">
            ⌕
          </span>
          <span class="visually-hidden">Search settings</span>
          <input
            type="search"
            value={query}
            placeholder="Search settings…"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </header>

      <div class="options-layout">
        <nav class="settings-nav" aria-label="Settings sections">
          {[
            'Quick Controls',
            'Playback',
            'Protection & Ghost',
            'Enhancers',
            'Music',
            'Advanced',
            'Help & feedback',
          ].map((label) => (
            <a
              key={label}
              href={`#${label.toLocaleLowerCase().replaceAll(' ', '-').replace('&-', '')}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <main class="settings-content">
          {sectionVisible('quick controls audio only background play') && (
            <section id="quick-controls" class="settings-section pinned-section">
              <SectionHeader>Quick Controls</SectionHeader>
              <QuickControls
                enabled={enabledSignal.value}
                audioOnlyEnabled={audioOnlyEnabledSignal.value}
                backgroundPlayEnabled={backgroundPlayEnabledSignal.value}
                onEnabledChange={(checked) => void actions.setEnabled(checked)}
                onAudioOnlyChange={(checked) => void actions.setAudioOnlyEnabled(checked)}
                onBackgroundPlayChange={(checked) => void actions.setBackgroundPlayEnabled(checked)}
                layout="page"
              />
            </section>
          )}

          {sectionVisible('playback audio only background autoplay quality') && (
            <section id="playback" class="settings-section">
              <SectionHeader>Playback</SectionHeader>
              <div class="settings-card">
                {settingVisible('disable autoplay next video') && (
                  <SettingRow
                    id="option-autoplay"
                    label="Disable autoplay next"
                    description="Turn off YouTube's native Up next control."
                    checked={disableAutoplayNextSignal.value}
                    onChange={(checked) =>
                      void actions.setQualityOfLifeSetting('disableAutoplayNext', checked)
                    }
                  />
                )}
                {settingVisible('maximum video quality data saver resolution') && (
                  <label class="select-row">
                    <span>
                      <strong>Maximum video quality</strong>
                      <small>Cap adaptive quality when video is enabled.</small>
                    </span>
                    <select
                      aria-label="Maximum video quality"
                      value={forceQualityMaxSignal.value}
                      onChange={(event) =>
                        void actions.setForceQualityMax(event.currentTarget.value as QualityCap)
                      }
                    >
                      {['off', '144p', '240p', '360p', '480p', '720p', '1080p'].map((quality) => (
                        <option key={quality} value={quality}>
                          {quality === 'off' ? 'Automatic' : quality}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </section>
          )}

          {sectionVisible('protection ghost ads telemetry trackers privacy') && (
            <section id="protection-ghost" class="settings-section">
              <SectionHeader>Protection & Ghost</SectionHeader>
              <div class="settings-card">
                {settingVisible('block ads protection') && (
                  <SettingRow
                    id="option-ads"
                    label="Block ads"
                    description="Remove known ad interruptions from player responses."
                    checked={adBlockEnabledSignal.value}
                    onChange={(checked) => void actions.setAdBlockEnabled(checked)}
                  />
                )}
                {settingVisible('ghost reduce tracking telemetry privacy') && (
                  <SettingRow
                    id="option-ghost"
                    label="Ghost mode"
                    description="Reduce safe first-party quality and instrumentation tracking."
                    checked={ghostEnabledSignal.value}
                    onChange={(checked) => void actions.setGhostEnabled(checked)}
                    recommended
                  />
                )}
              </div>
            </section>
          )}

          {sectionVisible(
            'enhancers skip segments shorts recommendations comments distraction'
          ) && (
            <section id="enhancers" class="settings-section">
              <SectionHeader>Enhancers</SectionHeader>
              <div class="settings-card">
                {settingVisible('skip segments sponsor non-music') && (
                  <SettingRow
                    id="option-skip"
                    label="Skip segments"
                    description="Privately look up and skip enabled categories."
                    checked={segmentSkipEnabledSignal.value}
                    onChange={(checked) => void actions.setSegmentSkipEnabled(checked)}
                  />
                )}
                {segmentSkipEnabledSignal.value &&
                  sponsorRows
                    .filter(([, label, description]) => settingVisible('skip', label, description))
                    .map(([category, label, description]) => (
                      <SettingRow
                        key={category}
                        id={`option-${category}`}
                        label={label}
                        description={description}
                        checked={segmentSkipCategoriesSignal.value.includes(category)}
                        onChange={(checked) =>
                          void actions.setSegmentSkipCategory(category, checked)
                        }
                        className="nested-row"
                      />
                    ))}
                {settingVisible('hide shorts distraction') && (
                  <SettingRow
                    id="option-shorts"
                    label="Hide Shorts"
                    description="Remove Shorts shelves and cards."
                    checked={hideShortsSignal.value}
                    onChange={(checked) =>
                      void actions.setQualityOfLifeSetting('hideShorts', checked)
                    }
                  />
                )}
                {settingVisible('hide recommendations related videos distraction') && (
                  <SettingRow
                    id="option-recommendations"
                    label="Hide recommendations"
                    description="Remove related videos beside the watch page."
                    checked={hideRecommendationsSignal.value}
                    onChange={(checked) =>
                      void actions.setQualityOfLifeSetting('hideRecommendations', checked)
                    }
                  />
                )}
                {settingVisible('hide comments distraction') && (
                  <SettingRow
                    id="option-comments"
                    label="Hide comments"
                    description="Remove the comments section and mobile entry point."
                    checked={hideCommentsSignal.value}
                    onChange={(checked) =>
                      void actions.setQualityOfLifeSetting('hideComments', checked)
                    }
                  />
                )}
              </div>
            </section>
          )}

          {sectionVisible('music loudness equalizer lyrics bands') && (
            <section id="music" class="settings-section">
              <SectionHeader>Music</SectionHeader>
              <div class="settings-card">
                {settingVisible('normalize loudness volume music') && (
                  <SettingRow
                    id="option-loudness"
                    label="Normalize loudness"
                    description="Keep track volume consistent using YouTube's loudness value."
                    checked={loudnessNormalizationSignal.value}
                    onChange={(checked) =>
                      void actions.setMusicSetting('loudnessNormalization', checked)
                    }
                  />
                )}
                {settingVisible('equalizer music sound bands') && (
                  <SettingRow
                    id="option-equalizer"
                    label="Equalizer"
                    description="Apply the five-band sound profile below."
                    checked={equalizerEnabledSignal.value}
                    onChange={(checked) =>
                      void actions.setMusicSetting('equalizerEnabled', checked)
                    }
                  />
                )}
                {settingVisible('synced lyrics music lrclib') && (
                  <SettingRow
                    id="option-lyrics"
                    label="Synced lyrics"
                    description="Opt in to an anonymous LRCLIB lookup."
                    checked={lyricsEnabledSignal.value}
                    onChange={(checked) => void actions.setMusicSetting('lyricsEnabled', checked)}
                  />
                )}
              </div>
              {equalizerEnabledSignal.value && settingVisible('equalizer music sound bands') && (
                <details class="advanced-disclosure" open={normalizedQuery.length > 0}>
                  <summary>Equalizer bands</summary>
                  <div class="range-grid">
                    {[60, 250, 1000, 4000, 12000].map((frequency, index) => (
                      <label key={frequency}>
                        <span>
                          {frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}
                        </span>
                        <input
                          aria-label={`${frequency} Hz gain`}
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={equalizerBandsSignal.value[index] ?? 0}
                          onInput={(event) =>
                            void actions.setEqualizerBand(index, Number(event.currentTarget.value))
                          }
                        />
                        <output>{equalizerBandsSignal.value[index] ?? 0} dB</output>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}

          {sectionVisible('advanced download aggressive telemetry privacy') && (
            <section id="advanced" class="settings-section">
              <SectionHeader>Advanced</SectionHeader>
              <details class="advanced-disclosure" open={normalizedQuery.length > 0}>
                <summary>Power-user controls</summary>
                <div class="settings-card disclosure-card">
                  {settingVisible('download audio save advanced') && (
                    <SettingRow
                      id="option-download"
                      label="Download audio"
                      description="Show an explicit save button inside the player."
                      checked={downloadEnabledSignal.value}
                      onChange={(checked) => void actions.setDownloadEnabled(checked)}
                    />
                  )}
                  {settingVisible(
                    'aggressive telemetry blocking privacy history resume advanced'
                  ) && (
                    <SettingRow
                      id="option-aggressive"
                      label="Aggressive telemetry blocking"
                      description="Also block watch-time statistics; history and resume may be affected."
                      checked={aggressiveTelemetrySignal.value}
                      onChange={(checked) => void actions.setAggressiveTelemetry(checked)}
                    />
                  )}
                </div>
              </details>
            </section>
          )}
          {sectionVisible('help feedback report issue diagnostics logs bug') && <IssueReporter />}
        </main>
      </div>

      {showOnboarding && (
        <Onboarding
          onDismiss={dismissOnboarding}
          onOpenYouTube={() => {
            dismissOnboarding();
            actions.openYouTube();
          }}
        />
      )}
    </div>
  );
}

export async function hasSeenOnboarding(): Promise<boolean> {
  const stored = await browser.storage.local.get(SEEN_ONBOARDING_KEY);
  return stored[SEEN_ONBOARDING_KEY] === true;
}
