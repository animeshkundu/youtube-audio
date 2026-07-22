import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  resetSettings,
  setAdBlockEnabled,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setDownloadEnabled,
  setDownloadFormat,
  setDownloadQuality,
  setEnabled,
  setEqualizerBand,
  setForceQualityMax,
  setGhostEnabled,
  setMusicSetting,
  setQualityOfLifeSetting,
  setSegmentSkipCategory,
  setSegmentSkipEnabled,
  type DownloadFormat,
  type DownloadQuality,
} from '../../src/shared/config';
import {
  adBlockEnabledSignal,
  aggressiveTelemetrySignal,
  audioOnlyEnabledSignal,
  backgroundPlayEnabledSignal,
  disableAutoplayNextSignal,
  downloadEnabledSignal,
  downloadFormatSignal,
  downloadQualitySignal,
  enabledSignal,
  equalizerBandsSignal,
  equalizerEnabledSignal,
  forceQualityMaxSignal,
  ghostEnabledSignal,
  hideCommentsSignal,
  hideRecommendationsSignal,
  hideShortsSignal,
  loudnessNormalizationSignal,
  segmentSkipCategoriesSignal,
  segmentSkipEnabledSignal,
} from '../../src/shared/settings-signals';
import type { QualityCap } from '../../src/shared/quality-of-life';
import type { SponsorCategory } from '../../src/shared/sponsorblock';
import {
  Brand,
  Onboarding,
  QuickControls,
  QUICK_CONTROL_LABELS,
  SectionHeader,
  SettingRow,
} from '../ui/components';
import { IssueReporter } from '../ui/IssueReporter';

const SEEN_ONBOARDING_KEY = 'seenOnboarding';
const APPLY_ERROR = "Couldn't apply that change. Try again.";

const OPTION_LABELS = {
  autoplay: 'Disable autoplay next',
  quality: 'Maximum video quality',
  ads: 'Block ads',
  ghost: 'Ghost mode',
  aggressive: 'Aggressive telemetry blocking',
  skip: 'Skip segments',
  shorts: 'Hide Shorts',
  recommendations: 'Hide recommendations',
  comments: 'Hide comments',
  loudness: 'Normalize loudness',
  equalizer: 'Equalizer',
  download: 'Download audio',
  downloadFormat: 'Download format',
  downloadQuality: 'Download quality',
  reset: 'Reset to defaults',
} as const;

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
  setDownloadFormat: typeof setDownloadFormat;
  setDownloadQuality: typeof setDownloadQuality;
  setAggressiveTelemetry: typeof setAggressiveTelemetry;
  resetSettings: typeof resetSettings;
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
  setDownloadFormat,
  setDownloadQuality,
  setAggressiveTelemetry,
  resetSettings,
  markOnboardingSeen: async () => browser.storage.local.set({ [SEEN_ONBOARDING_KEY]: true }),
  openYouTube: () => void browser.tabs.create({ url: 'https://www.youtube.com/' }),
};

const sponsorRows: readonly [SponsorCategory, string, string, string][] = [
  [
    'sponsor',
    'Sponsored segments',
    'Paid promotions are skipped automatically.',
    'Paid promotions play normally.',
  ],
  [
    'music_offtopic',
    'Non-music segments',
    'Talking, credits, and other non-music parts are skipped.',
    'Non-music parts play normally.',
  ],
];

function matchesSearch(query: string, label: string, description: string): boolean {
  if (query.length === 0) return true;
  return `${label} ${description}`.toLocaleLowerCase().includes(query);
}

function stateDescription(checked: boolean, on: string, off: string): string {
  return `${checked ? 'On' : 'Off'}. ${checked ? on : off}`;
}

type Toast = { kind: 'ok' | 'error'; message: string };

export function Options({
  actions = defaultOptionsActions,
  showOnboardingInitially = false,
}: {
  actions?: OptionsActions;
  showOnboardingInitially?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(showOnboardingInitially);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState('quick-controls');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const requestIds = useRef<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedQuery = useMemo(() => query.trim().toLocaleLowerCase(), [query]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    []
  );

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    void actions.markOnboardingSeen().catch(() => undefined);
  };

  const apply = (key: string, operation: () => Promise<void>) => {
    const requestId = (requestIds.current[key] ?? 0) + 1;
    requestIds.current[key] = requestId;
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    void operation().catch(() => {
      if (requestIds.current[key] === requestId) {
        setErrors((current) => ({ ...current, [key]: APPLY_ERROR }));
      }
    });
  };

  const showToast = (nextToast: Toast) => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setToast(nextToast);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3200);
  };

  const confirmReset = () => {
    setConfirmingReset(false);
    void actions
      .resetSettings()
      .then(() => showToast({ kind: 'ok', message: 'Settings reset to defaults.' }))
      .catch(() =>
        showToast({ kind: 'error', message: "Couldn't reset settings. Nothing was changed." })
      );
  };

  const enabledDescription = enabledSignal.value
    ? 'Active. Your preferences apply instantly.'
    : 'Paused. YouTube works normally.';
  const audioOnlyDescription = stateDescription(
    audioOnlyEnabledSignal.value,
    'Stops video from loading. Saves data and battery.',
    'Video loads and plays normally.'
  );
  const backgroundDescription = stateDescription(
    backgroundPlayEnabledSignal.value,
    'Keeps playing when YouTube is hidden.',
    'Playback follows normal page visibility.'
  );
  const autoplayDescription = stateDescription(
    disableAutoplayNextSignal.value,
    'Stops YouTube from starting the next video.',
    'YouTube can start the next video.'
  );
  const qualityDescription =
    forceQualityMaxSignal.value === 'off'
      ? 'Automatic. YouTube chooses quality when video is enabled.'
      : `${forceQualityMaxSignal.value} maximum when video is enabled.`;
  const adBlockDescription = stateDescription(
    adBlockEnabledSignal.value,
    'Blocks ads before they play.',
    'YouTube may play ads normally.'
  );
  const ghostDescription = stateDescription(
    ghostEnabledSignal.value,
    "Blocks YouTube's tracking. Playback stays normal.",
    "YouTube's normal tracking is allowed."
  );
  const aggressiveDescription = ghostEnabledSignal.value
    ? stateDescription(
        aggressiveTelemetrySignal.value,
        'Also blocks watch-time stats.',
        'Watch history and resume can update normally.'
      )
    : `${aggressiveTelemetrySignal.value ? 'On' : 'Off'}, unavailable. Turn on Ghost mode to use this.`;
  const skipDescription = stateDescription(
    segmentSkipEnabledSignal.value,
    'Skips sponsored and non-music parts. Lookups are anonymous.',
    'Every part of the video plays.'
  );
  const shortsDescription = stateDescription(
    hideShortsSignal.value,
    'Removes Shorts shelves and cards.',
    'Shorts remain visible.'
  );
  const recommendationsDescription = stateDescription(
    hideRecommendationsSignal.value,
    'Removes related videos beside the watch page.',
    'Related videos remain visible.'
  );
  const commentsDescription = stateDescription(
    hideCommentsSignal.value,
    'Removes comments and their mobile entry point.',
    'Comments remain visible.'
  );
  const loudnessDescription = stateDescription(
    loudnessNormalizationSignal.value,
    'Keeps volume more consistent between tracks.',
    'Tracks use their original volume levels.'
  );
  const equalizerDescription = stateDescription(
    equalizerEnabledSignal.value,
    'Shapes sound with five frequency bands.',
    'Plays sound without equalizer adjustments.'
  );
  const downloadDescription = stateDescription(
    downloadEnabledSignal.value,
    'Shows a save-audio button in the player.',
    'Keeps the save-audio button hidden.'
  );
  const resetDescription = 'Restore every option to the shipped defaults.';
  const helpDescription =
    'Review private on-device diagnostics, copy them, or report a playback issue.';

  const enabledVisible = matchesSearch(
    normalizedQuery,
    QUICK_CONTROL_LABELS.enabled,
    enabledDescription
  );
  const audioOnlyVisible = matchesSearch(
    normalizedQuery,
    QUICK_CONTROL_LABELS.audioOnly,
    audioOnlyDescription
  );
  const backgroundVisible = matchesSearch(
    normalizedQuery,
    QUICK_CONTROL_LABELS.backgroundPlay,
    backgroundDescription
  );
  const autoplayVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.autoplay,
    autoplayDescription
  );
  const qualityVisible = matchesSearch(normalizedQuery, OPTION_LABELS.quality, qualityDescription);
  const adBlockVisible = matchesSearch(normalizedQuery, OPTION_LABELS.ads, adBlockDescription);
  const ghostVisible = matchesSearch(normalizedQuery, OPTION_LABELS.ghost, ghostDescription);
  const aggressiveVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.aggressive,
    aggressiveDescription
  );
  const skipVisible = matchesSearch(normalizedQuery, OPTION_LABELS.skip, skipDescription);
  const sponsorVisibility = sponsorRows.map(([category, label, on, off]) => {
    const checked = segmentSkipCategoriesSignal.value.includes(category);
    return matchesSearch(normalizedQuery, label, stateDescription(checked, on, off));
  });
  const shortsVisible = matchesSearch(normalizedQuery, OPTION_LABELS.shorts, shortsDescription);
  const recommendationsVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.recommendations,
    recommendationsDescription
  );
  const commentsVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.comments,
    commentsDescription
  );
  const loudnessVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.loudness,
    loudnessDescription
  );
  const equalizerVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.equalizer,
    equalizerDescription
  );
  const downloadVisible =
    matchesSearch(normalizedQuery, OPTION_LABELS.download, downloadDescription) ||
    matchesSearch(
      normalizedQuery,
      OPTION_LABELS.downloadFormat,
      'Choose a direct YouTube audio source without transcoding.'
    ) ||
    matchesSearch(
      normalizedQuery,
      OPTION_LABELS.downloadQuality,
      'Pick the closest available source bitrate.'
    );
  const resetVisible = matchesSearch(normalizedQuery, OPTION_LABELS.reset, resetDescription);
  const helpVisible = matchesSearch(normalizedQuery, 'Help and feedback', helpDescription);

  const quickVisible = enabledVisible || audioOnlyVisible || backgroundVisible;
  const playbackVisible = autoplayVisible || qualityVisible;
  const privacyVisible = adBlockVisible || ghostVisible || aggressiveVisible;
  const skippingVisible =
    skipVisible || (segmentSkipEnabledSignal.value && sponsorVisibility.some((visible) => visible));
  const cleanerVisible = shortsVisible || recommendationsVisible || commentsVisible;
  const musicVisible = loudnessVisible || equalizerVisible;
  const sections = [
    { id: 'quick-controls', label: 'Quick Controls', visible: quickVisible },
    { id: 'playback', label: 'Playback', visible: playbackVisible },
    { id: 'privacy-blocking', label: 'Privacy & Blocking', visible: privacyVisible },
    { id: 'skipping', label: 'Skipping', visible: skippingVisible },
    { id: 'cleaner-youtube', label: 'Cleaner YouTube', visible: cleanerVisible },
    { id: 'music', label: 'Music', visible: musicVisible },
    { id: 'downloads', label: 'Downloads', visible: downloadVisible },
    { id: 'advanced-about', label: 'Advanced/About', visible: resetVisible },
    { id: 'help-feedback', label: 'Help & feedback', visible: helpVisible },
  ];
  const visibleSections = sections.filter((section) => section.visible);
  const visibleSectionIds = visibleSections.map((section) => section.id).join('|');
  const currentSection = visibleSections.some((section) => section.id === activeSection)
    ? activeSection
    : visibleSections[0]?.id;

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const nearest = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        if (nearest?.target.id) setActiveSection(nearest.target.id);
      },
      { rootMargin: '-88px 0px -65% 0px', threshold: [0, 0.1] }
    );
    visibleSections.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, [visibleSectionIds, showOnboarding]);

  if (showOnboarding) {
    return (
      <div class="options-app options-app-onboarding">
        <Onboarding
          onDismiss={dismissOnboarding}
          onOpenYouTube={() => {
            dismissOnboarding();
            actions.openYouTube();
          }}
        />
      </div>
    );
  }

  return (
    <div class="options-app">
      <header class="options-header">
        <Brand suffix="Settings" />
        <label class="search-field">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
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
          {visibleSections.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={currentSection === id ? 'true' : undefined}
              onClick={() => setActiveSection(id)}
            >
              <span class="nav-indicator" aria-hidden="true">
                ●
              </span>
              {label}
            </a>
          ))}
        </nav>

        <main class="settings-content">
          {quickVisible && (
            <section id="quick-controls" class="settings-section pinned-section">
              <SectionHeader>Quick Controls</SectionHeader>
              <QuickControls
                enabled={enabledSignal.value}
                enabledDescription={enabledDescription}
                enabledError={errors.enabled}
                audioOnlyEnabled={audioOnlyEnabledSignal.value}
                audioOnlyDescription={audioOnlyDescription}
                audioOnlyError={errors.audioOnly}
                backgroundPlayEnabled={backgroundPlayEnabledSignal.value}
                backgroundPlayDescription={backgroundDescription}
                backgroundPlayError={errors.background}
                onEnabledChange={(checked) => apply('enabled', () => actions.setEnabled(checked))}
                onAudioOnlyChange={(checked) =>
                  apply('audioOnly', () => actions.setAudioOnlyEnabled(checked))
                }
                onBackgroundPlayChange={(checked) =>
                  apply('background', () => actions.setBackgroundPlayEnabled(checked))
                }
                showEnabled={enabledVisible}
                showAudioOnly={audioOnlyVisible}
                showBackgroundPlay={backgroundVisible}
                layout="page"
              />
            </section>
          )}

          {playbackVisible && (
            <section id="playback" class="settings-section">
              <SectionHeader>Playback</SectionHeader>
              <div class="settings-card">
                {autoplayVisible && (
                  <SettingRow
                    id="option-autoplay"
                    label={OPTION_LABELS.autoplay}
                    description={autoplayDescription}
                    error={errors.autoplay}
                    checked={disableAutoplayNextSignal.value}
                    onChange={(checked) =>
                      apply('autoplay', () =>
                        actions.setQualityOfLifeSetting('disableAutoplayNext', checked)
                      )
                    }
                  />
                )}
                {qualityVisible && (
                  <label class="select-row">
                    <span>
                      <strong>{OPTION_LABELS.quality}</strong>
                      <small id="option-quality-description">{qualityDescription}</small>
                      {errors.quality && (
                        <small class="setting-error" id="option-quality-error" role="alert">
                          {errors.quality}
                        </small>
                      )}
                    </span>
                    <select
                      aria-label={OPTION_LABELS.quality}
                      aria-describedby={
                        errors.quality
                          ? 'option-quality-description option-quality-error'
                          : 'option-quality-description'
                      }
                      value={forceQualityMaxSignal.value}
                      onChange={(event) => {
                        const quality = event.currentTarget.value as QualityCap;
                        apply('quality', () => actions.setForceQualityMax(quality));
                      }}
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

          {privacyVisible && (
            <section id="privacy-blocking" class="settings-section">
              <SectionHeader>Privacy &amp; Blocking</SectionHeader>
              <div class="settings-card">
                {adBlockVisible && (
                  <SettingRow
                    id="option-ads"
                    label={OPTION_LABELS.ads}
                    description={adBlockDescription}
                    error={errors.ads}
                    consequence="May rarely affect playback."
                    checked={adBlockEnabledSignal.value}
                    onChange={(checked) => apply('ads', () => actions.setAdBlockEnabled(checked))}
                    highImpact
                  />
                )}
                {ghostVisible && (
                  <SettingRow
                    id="option-ghost"
                    label={OPTION_LABELS.ghost}
                    description={ghostDescription}
                    error={errors.ghost}
                    checked={ghostEnabledSignal.value}
                    onChange={(checked) => apply('ghost', () => actions.setGhostEnabled(checked))}
                    recommended
                  />
                )}
                {aggressiveVisible && (
                  <SettingRow
                    id="option-aggressive"
                    label={OPTION_LABELS.aggressive}
                    description={aggressiveDescription}
                    error={errors.aggressive}
                    consequence="Your history and resume-where-you-left-off may stop working."
                    checked={aggressiveTelemetrySignal.value}
                    onChange={(checked) =>
                      apply('aggressive', () => actions.setAggressiveTelemetry(checked))
                    }
                    disabled={!ghostEnabledSignal.value}
                    className="nested-row"
                    highImpact
                  />
                )}
              </div>
            </section>
          )}

          {skippingVisible && (
            <section id="skipping" class="settings-section">
              <SectionHeader>Skipping</SectionHeader>
              <div class="settings-card">
                {skipVisible && (
                  <SettingRow
                    id="option-skip"
                    label={OPTION_LABELS.skip}
                    description={skipDescription}
                    error={errors.skip}
                    checked={segmentSkipEnabledSignal.value}
                    onChange={(checked) =>
                      apply('skip', () => actions.setSegmentSkipEnabled(checked))
                    }
                  />
                )}
                {segmentSkipEnabledSignal.value && sponsorVisibility.some(Boolean) && (
                  <div class="dependent-reveal">
                    <div class="dependent-reveal-inner">
                      {sponsorRows.map(([category, label, on, off], index) => {
                        if (!sponsorVisibility[index]) return null;
                        const checked = segmentSkipCategoriesSignal.value.includes(category);
                        const key = `category-${category}`;
                        return (
                          <SettingRow
                            key={category}
                            id={`option-${category}`}
                            label={label}
                            description={stateDescription(checked, on, off)}
                            error={errors[key]}
                            checked={checked}
                            onChange={(nextChecked) =>
                              apply(key, () =>
                                actions.setSegmentSkipCategory(category, nextChecked)
                              )
                            }
                            className="nested-row"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {cleanerVisible && (
            <section id="cleaner-youtube" class="settings-section">
              <SectionHeader>Cleaner YouTube</SectionHeader>
              <div class="settings-card">
                {shortsVisible && (
                  <SettingRow
                    id="option-shorts"
                    label={OPTION_LABELS.shorts}
                    description={shortsDescription}
                    error={errors.shorts}
                    checked={hideShortsSignal.value}
                    onChange={(checked) =>
                      apply('shorts', () => actions.setQualityOfLifeSetting('hideShorts', checked))
                    }
                  />
                )}
                {recommendationsVisible && (
                  <SettingRow
                    id="option-recommendations"
                    label={OPTION_LABELS.recommendations}
                    description={recommendationsDescription}
                    error={errors.recommendations}
                    checked={hideRecommendationsSignal.value}
                    onChange={(checked) =>
                      apply('recommendations', () =>
                        actions.setQualityOfLifeSetting('hideRecommendations', checked)
                      )
                    }
                  />
                )}
                {commentsVisible && (
                  <SettingRow
                    id="option-comments"
                    label={OPTION_LABELS.comments}
                    description={commentsDescription}
                    error={errors.comments}
                    checked={hideCommentsSignal.value}
                    onChange={(checked) =>
                      apply('comments', () =>
                        actions.setQualityOfLifeSetting('hideComments', checked)
                      )
                    }
                  />
                )}
              </div>
            </section>
          )}

          {musicVisible && (
            <section id="music" class="settings-section">
              <SectionHeader>Music</SectionHeader>
              <div class="settings-card">
                {loudnessVisible && (
                  <SettingRow
                    id="option-loudness"
                    label={OPTION_LABELS.loudness}
                    description={loudnessDescription}
                    error={errors.loudness}
                    checked={loudnessNormalizationSignal.value}
                    onChange={(checked) =>
                      apply('loudness', () =>
                        actions.setMusicSetting('loudnessNormalization', checked)
                      )
                    }
                  />
                )}
                {equalizerVisible && (
                  <SettingRow
                    id="option-equalizer"
                    label={OPTION_LABELS.equalizer}
                    description={equalizerDescription}
                    error={errors.equalizer}
                    checked={equalizerEnabledSignal.value}
                    onChange={(checked) =>
                      apply('equalizer', () => actions.setMusicSetting('equalizerEnabled', checked))
                    }
                  />
                )}
              </div>
              {equalizerEnabledSignal.value && equalizerVisible && (
                <div class="dependent-reveal">
                  <div class="dependent-reveal-inner">
                    <div class="advanced-disclosure equalizer-bands">
                      <div class="disclosure-title">Equalizer bands</div>
                      <div class="range-grid">
                        {[60, 250, 1000, 4000, 12000].map((frequency, index) => {
                          const errorKey = `equalizer-band-${index}`;
                          const descriptionId = `${errorKey}-description`;
                          const errorId = `${errorKey}-error`;
                          return (
                            <label key={frequency} class="range-control">
                              <span>
                                {frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}
                              </span>
                              <input
                                aria-label={`${frequency} Hz gain`}
                                aria-describedby={
                                  errors[errorKey] ? `${descriptionId} ${errorId}` : descriptionId
                                }
                                type="range"
                                min="-12"
                                max="12"
                                step="1"
                                value={equalizerBandsSignal.value[index] ?? 0}
                                onInput={(event) => {
                                  const gain = Number(event.currentTarget.value);
                                  apply(errorKey, () => actions.setEqualizerBand(index, gain));
                                }}
                              />
                              <output id={descriptionId}>
                                {equalizerBandsSignal.value[index] ?? 0} dB
                              </output>
                              {errors[errorKey] && (
                                <span class="setting-error range-error" id={errorId} role="alert">
                                  {errors[errorKey]}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {downloadVisible && (
            <section id="downloads" class="settings-section">
              <SectionHeader>Downloads</SectionHeader>
              <div class="settings-card">
                <SettingRow
                  id="option-download"
                  label={OPTION_LABELS.download}
                  description={downloadDescription}
                  error={errors.download}
                  checked={downloadEnabledSignal.value}
                  onChange={(checked) =>
                    apply('download', () => actions.setDownloadEnabled(checked))
                  }
                />
                {downloadEnabledSignal.value && (
                  <>
                    <label class="select-row">
                      <span>
                        <strong>{OPTION_LABELS.downloadFormat}</strong>
                        <small id="option-download-format-description">
                          Choose a direct YouTube audio source without transcoding.
                        </small>
                        {errors.downloadFormat && (
                          <small
                            class="setting-error"
                            id="option-download-format-error"
                            role="alert"
                          >
                            {errors.downloadFormat}
                          </small>
                        )}
                      </span>
                      <select
                        aria-label={OPTION_LABELS.downloadFormat}
                        aria-describedby={
                          errors.downloadFormat
                            ? 'option-download-format-description option-download-format-error'
                            : 'option-download-format-description'
                        }
                        value={downloadFormatSignal.value}
                        onChange={(event) => {
                          const format = event.currentTarget.value as DownloadFormat;
                          apply('downloadFormat', () => actions.setDownloadFormat(format));
                        }}
                      >
                        <option value="auto">Auto (compatible M4A)</option>
                        <option value="m4a">M4A (AAC)</option>
                        <option value="opus">Opus (WebM)</option>
                      </select>
                    </label>
                    <label class="select-row">
                      <span>
                        <strong>{OPTION_LABELS.downloadQuality}</strong>
                        <small id="option-download-quality-description">
                          Pick the closest available source bitrate.
                        </small>
                        {errors.downloadQuality && (
                          <small
                            class="setting-error"
                            id="option-download-quality-error"
                            role="alert"
                          >
                            {errors.downloadQuality}
                          </small>
                        )}
                      </span>
                      <select
                        aria-label={OPTION_LABELS.downloadQuality}
                        aria-describedby={
                          errors.downloadQuality
                            ? 'option-download-quality-description option-download-quality-error'
                            : 'option-download-quality-description'
                        }
                        value={downloadQualitySignal.value}
                        onChange={(event) => {
                          const quality = event.currentTarget.value as DownloadQuality;
                          apply('downloadQuality', () => actions.setDownloadQuality(quality));
                        }}
                      >
                        <option value="auto">Auto</option>
                        <option value="high">High (best available)</option>
                        <option value="medium">Medium (~70-130 kbps)</option>
                        <option value="low">Low (~48-64 kbps)</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            </section>
          )}

          {resetVisible && (
            <section id="advanced-about" class="settings-section">
              <SectionHeader>Advanced/About</SectionHeader>
              <div class="settings-card reset-card">
                <div class="action-row">
                  <span>
                    <strong>{OPTION_LABELS.reset}</strong>
                    <small>{resetDescription}</small>
                  </span>
                  <button
                    type="button"
                    class="secondary-action"
                    onClick={() => setConfirmingReset(true)}
                  >
                    {OPTION_LABELS.reset}
                  </button>
                </div>
                {confirmingReset && (
                  <div class="reset-confirmation" role="group" aria-label="Confirm reset">
                    <p>Reset every setting to its default value?</p>
                    <div>
                      <button
                        type="button"
                        class="text-action"
                        onClick={() => setConfirmingReset(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        class="secondary-action is-danger"
                        onClick={confirmReset}
                      >
                        Confirm reset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {helpVisible && <IssueReporter />}

          {visibleSections.length === 0 && (
            <div class="empty-search" role="status">
              <p>No settings match “{query.trim()}”.</p>
              <button type="button" class="text-action" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <p
          class={`options-toast is-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          {toast.message}
        </p>
      )}
    </div>
  );
}

export async function hasSeenOnboarding(): Promise<boolean> {
  const stored = await browser.storage.local.get(SEEN_ONBOARDING_KEY);
  return stored[SEEN_ONBOARDING_KEY] === true;
}
