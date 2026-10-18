import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  resolveDataConsent,
  revokeDataConsent,
  setSponsorBlockConsent,
} from '../../src/shared/consent';
import { DOWNLOADS_PERMISSION, SPONSORBLOCK_ORIGIN } from '../../src/shared/permissions';
import {
  resetSettings,
  setAdBlockEnabled,
  setAggressiveTelemetry,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setDownloadEnabled,
  setEnabled,
  setEqualizerBand,
  setFallbackQualityCapEnabled,
  setForceQualityMax,
  setGhostEnabled,
  setIdleNagDefeatEnabled,
  setMusicSetting,
  setQualityOfLifeSetting,
  setVolumeBoostAmount,
  setVolumeBoostEnabled,
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
  fallbackQualityCapEnabledSignal,
  forceQualityMaxSignal,
  ghostEnabledSignal,
  hideAvatarsSignal,
  hideCommentsSignal,
  hideRecommendationsSignal,
  hideShortsSignal,
  hideThumbnailsSignal,
  idleNagDefeatEnabledSignal,
  loudnessNormalizationSignal,
  segmentSkipCategoriesSignal,
  volumeBoostAmountSignal,
  volumeBoostEnabledSignal,
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
// SPEC-013: a denied or failed optional-permission gesture keeps the feature off and says why.
const SPONSOR_PERMISSION_ERROR = "SponsorBlock access wasn't granted.";
const DOWNLOAD_PERMISSION_ERROR = "Download access wasn't granted.";
const NETWORK_PERMISSION_ERROR = "Ad-blocking access wasn't granted.";

const OPTION_LABELS = {
  autoplay: 'Disable autoplay next',
  quality: 'Maximum video quality',
  idleNag: 'Keep long videos playing',
  fallbackQuality: 'Low-quality fallback',
  ads: 'Block ads',
  ghost: 'Ghost mode',
  aggressive: 'Block watch-time stats',
  skip: 'Skip segments',
  shorts: 'Hide Shorts',
  recommendations: 'Hide recommendations',
  comments: 'Hide comments',
  thumbnails: 'Hide thumbnails',
  avatars: 'Hide avatars',
  loudness: 'Normalize loudness',
  equalizer: 'Equalizer',
  volumeBoost: 'Volume boost',
  download: 'Download audio',
  reset: 'Reset to defaults',
} as const;

export type OptionsActions = {
  setEnabled: typeof setEnabled;
  setAudioOnlyEnabled: typeof setAudioOnlyEnabled;
  setBackgroundPlayEnabled: typeof setBackgroundPlayEnabled;
  setIdleNagDefeatEnabled: typeof setIdleNagDefeatEnabled;
  setFallbackQualityCapEnabled: typeof setFallbackQualityCapEnabled;
  setAdBlockEnabled: typeof setAdBlockEnabled;
  setGhostEnabled: typeof setGhostEnabled;
  setSegmentSkipEnabled: typeof setSegmentSkipEnabled;
  setSegmentSkipCategory: typeof setSegmentSkipCategory;
  setQualityOfLifeSetting: typeof setQualityOfLifeSetting;
  setMusicSetting: typeof setMusicSetting;
  setEqualizerBand: typeof setEqualizerBand;
  setVolumeBoostEnabled: typeof setVolumeBoostEnabled;
  setVolumeBoostAmount: typeof setVolumeBoostAmount;
  setForceQualityMax: typeof setForceQualityMax;
  setDownloadEnabled: typeof setDownloadEnabled;
  setAggressiveTelemetry: typeof setAggressiveTelemetry;
  resetSettings: typeof resetSettings;
  resolveDataConsent: typeof resolveDataConsent;
  revokeDataConsent: typeof revokeDataConsent;
  setSponsorBlockConsent: typeof setSponsorBlockConsent;
  openConsent: () => void;
  markOnboardingSeen: () => Promise<void>;
  openYouTube: () => void;
  /** SPEC-013 optional-permission gestures; each resolves false on denial or failure. */
  requestSponsorPermission: () => Promise<boolean>;
  sponsorPermissionGranted: () => Promise<boolean>;
  requestDownloadsPermission: () => Promise<boolean>;
  downloadsPermissionGranted: () => Promise<boolean>;
  requestNetworkPermission: () => Promise<boolean>;
  networkPermissionGranted: () => Promise<boolean>;
  /** The downloads API is absent on Firefox for Android; the row hides entirely there. */
  downloadsAvailable: () => boolean;
};

export const defaultOptionsActions: OptionsActions = {
  setEnabled,
  setAudioOnlyEnabled,
  setBackgroundPlayEnabled,
  setIdleNagDefeatEnabled,
  setFallbackQualityCapEnabled,
  setAdBlockEnabled,
  setGhostEnabled,
  setSegmentSkipEnabled,
  setSegmentSkipCategory,
  setQualityOfLifeSetting,
  setMusicSetting,
  setEqualizerBand,
  setVolumeBoostEnabled,
  setVolumeBoostAmount,
  setForceQualityMax,
  setDownloadEnabled,
  setAggressiveTelemetry,
  resetSettings,
  resolveDataConsent,
  revokeDataConsent,
  setSponsorBlockConsent,
  openConsent: () => void browser.tabs.create({ url: browser.runtime.getURL('/consent.html') }),
  markOnboardingSeen: async () => browser.storage.local.set({ [SEEN_ONBOARDING_KEY]: true }),
  openYouTube: () => void browser.tabs.create({ url: 'https://www.youtube.com/' }),
  requestSponsorPermission: async () => {
    try {
      return await browser.permissions.request({ origins: [SPONSORBLOCK_ORIGIN] });
    } catch {
      return false;
    }
  },
  sponsorPermissionGranted: async () => {
    try {
      return await browser.permissions.contains({ origins: [SPONSORBLOCK_ORIGIN] });
    } catch {
      return false;
    }
  },
  requestDownloadsPermission: async () => {
    try {
      return await browser.permissions.request({ permissions: [DOWNLOADS_PERMISSION] });
    } catch {
      return false;
    }
  },
  downloadsPermissionGranted: async () => {
    try {
      return await browser.permissions.contains({ permissions: [DOWNLOADS_PERMISSION] });
    } catch {
      return false;
    }
  },
  requestNetworkPermission: async () => {
    try {
      return await browser.permissions.request({
        permissions: ['webRequest', 'webRequestBlocking'],
      });
    } catch {
      return false;
    }
  },
  networkPermissionGranted: async () => {
    try {
      return await browser.permissions.contains({
        permissions: ['webRequest', 'webRequestBlocking'],
      });
    } catch {
      return false;
    }
  },
  downloadsAvailable: () => typeof browser.downloads?.download === 'function',
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

// Additional SponsorBlock categories, shown in a collapsed disclosure (minimal surface).
const sponsorExtraRows: readonly [SponsorCategory, string, string, string][] = [
  ['selfpromo', 'Self-promotion', 'Creator self-promo is skipped.', 'Self-promo plays normally.'],
  [
    'interaction',
    'Interaction reminders',
    'Like/subscribe reminders are skipped.',
    'Reminders play normally.',
  ],
  ['intro', 'Intros', 'Intro animations are skipped.', 'Intros play normally.'],
  ['outro', 'Outros', 'Outro/end cards are skipped.', 'Outros play normally.'],
  ['preview', 'Previews', 'Preview/recap segments are skipped.', 'Previews play normally.'],
  ['filler', 'Filler', 'Tangents and filler are skipped.', 'Filler plays normally.'],
  [
    'exclusive_access',
    'Exclusive access',
    'Members-only promos are skipped.',
    'Members-only promos play normally.',
  ],
  ['poi_highlight', 'Highlights', 'Highlight recaps are skipped.', 'Highlights play normally.'],
  ['hook', 'Hooks', 'Hook/intro hooks are skipped.', 'Hooks play normally.'],
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
  const [consentGranted, setConsentGranted] = useState<boolean | null>(null);
  const [sponsorPermission, setSponsorPermission] = useState<boolean | null>(null);
  const [downloadsPermission, setDownloadsPermission] = useState<boolean | null>(null);
  const [networkPermission, setNetworkPermission] = useState<boolean | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const requestIds = useRef<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedQuery = useMemo(() => query.trim().toLocaleLowerCase(), [query]);

  useEffect(() => {
    void actions.resolveDataConsent().then((consent) => setConsentGranted(consent.granted));
    void actions.sponsorPermissionGranted().then(setSponsorPermission);
    void actions.downloadsPermissionGranted().then(setDownloadsPermission);
    void actions.networkPermissionGranted().then(setNetworkPermission);
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, [actions]);

  // Deep-link support (SPEC-013): the popup's consent card opens options.html#data-consent. The
  // target renders client-side, so native anchor scrolling can miss it; scroll explicitly.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView?.({ block: 'start' });
  }, []);

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

  // SPEC-013: optional-permission gestures request access inside the user-action handler (Firefox
  // only honors it there) and only touch settings on a grant. A denial reports under the row.
  const applyPermissionRequest = (
    key: string,
    request: () => Promise<boolean>,
    deniedMessage: string,
    onGranted: () => void | Promise<void>
  ) => {
    apply(key, async () => {
      const granted = await request();
      if (!granted) {
        setErrors((current) => ({ ...current, [key]: deniedMessage }));
        return;
      }
      await onGranted();
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

  const revokeConsent = () => {
    void actions
      .revokeDataConsent()
      .then(() => {
        setConsentGranted(false);
        showToast({ kind: 'ok', message: 'Data consent revoked. Transmission has stopped.' });
      })
      .catch(() => showToast({ kind: 'error', message: "Couldn't revoke consent. Try again." }));
  };

  const enabledDescription = enabledSignal.value
    ? 'Active. Your preferences apply instantly.'
    : 'Paused. YouTube works normally.';
  const audioOnlyDescription = stateDescription(
    audioOnlyEnabledSignal.value,
    'Stops video from loading. Saves data and battery. This is the default for every tab; quick buttons change only the current tab.',
    'Video loads and plays normally. This is the default for every tab; quick buttons change only the current tab.'
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
  const idleNagDescription = backgroundPlayEnabledSignal.value
    ? stateDescription(
        idleNagDefeatEnabledSignal.value,
        "Skips YouTube's idle 'still watching' check while audio plays unattended.",
        "YouTube's idle check behaves normally."
      )
    : `${
        idleNagDefeatEnabledSignal.value ? 'On' : 'Off'
      }, unavailable. Turn on background play to use this.`;
  const fallbackQualityDescription = stateDescription(
    fallbackQualityCapEnabledSignal.value,
    "Plays video at the lowest quality when audio-only isn't available, and YouTube Music plays the song version when one exists. Quality can stay low until you change it.",
    "When audio-only isn't available, video plays at normal quality."
  );
  const adBlockDescription = stateDescription(
    adBlockEnabledSignal.value,
    'Blocks ads before they play.',
    'Off by default. Turn on to block ads before they play.'
  );
  const ghostDescription = stateDescription(
    ghostEnabledSignal.value,
    "Blocks YouTube's tracking. Playback stays normal.",
    "YouTube's normal tracking is allowed."
  );
  const aggressiveDescription = ghostEnabledSignal.value
    ? stateDescription(
        aggressiveTelemetrySignal.value,
        'Also blocks watch-time stats (aggressive telemetry blocking).',
        'Watch history and resume can update normally (aggressive telemetry blocking stays off).'
      )
    : `${aggressiveTelemetrySignal.value ? 'On' : 'Off'}, unavailable. Turn on Ghost mode to use this.`;
  const skipDescription = stateDescription(
    segmentSkipEnabledSignal.value,
    'Sends only a 16-bit video hash prefix to sponsor.ajay.app; matching stays on your device.',
    'No request is sent to sponsor.ajay.app. If enabled, only a 16-bit video hash prefix leaves your device.'
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
  const thumbnailsDescription = stateDescription(
    hideThumbnailsSignal.value,
    'Hides video preview images in feeds and beside the player.',
    'Video thumbnails remain visible.'
  );
  const avatarsDescription = stateDescription(
    hideAvatarsSignal.value,
    'Hides channel pictures in comments and on video pages.',
    'Channel pictures remain visible.'
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
    'Shows a save-audio button in the player. Saved files include artist metadata in the filename (Artist - Title).',
    'Keeps the save-audio button hidden.'
  );
  const volumeBoostDescription = stateDescription(
    volumeBoostEnabledSignal.value,
    'Amplifies audio beyond normal levels (louder). May distort at the highest setting.',
    'Plays audio at normal level.'
  );
  const resetDescription = 'Restore every option to the shipped defaults.';
  const helpDescription = 'Review, copy, export, or clear private on-device diagnostics.';

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
  const idleNagVisible = matchesSearch(normalizedQuery, OPTION_LABELS.idleNag, idleNagDescription);
  const fallbackQualityVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.fallbackQuality,
    fallbackQualityDescription
  );
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
  const thumbnailsVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.thumbnails,
    thumbnailsDescription
  );
  const avatarsVisible = matchesSearch(normalizedQuery, OPTION_LABELS.avatars, avatarsDescription);
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
  const volumeBoostVisible = matchesSearch(
    normalizedQuery,
    OPTION_LABELS.volumeBoost,
    volumeBoostDescription
  );
  // SPEC-013: the row is hidden entirely where the downloads API is absent (Firefox for Android).
  const downloadsSupported = actions.downloadsAvailable();
  const downloadVisible =
    downloadsSupported &&
    matchesSearch(normalizedQuery, OPTION_LABELS.download, downloadDescription);
  const resetVisible = matchesSearch(normalizedQuery, OPTION_LABELS.reset, resetDescription);
  const helpVisible = matchesSearch(normalizedQuery, 'Help and feedback', helpDescription);

  const quickVisible = enabledVisible || audioOnlyVisible || backgroundVisible;
  const playbackVisible =
    autoplayVisible || qualityVisible || idleNagVisible || fallbackQualityVisible;
  const privacyVisible = adBlockVisible || ghostVisible || aggressiveVisible;
  const skippingVisible =
    skipVisible || (segmentSkipEnabledSignal.value && sponsorVisibility.some((visible) => visible));
  const cleanerVisible = shortsVisible || recommendationsVisible || commentsVisible;
  const musicVisible = loudnessVisible || equalizerVisible || volumeBoostVisible;
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
              aria-current={currentSection === id ? 'page' : undefined}
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
                {idleNagVisible && (
                  <SettingRow
                    id="option-idle-nag"
                    label={OPTION_LABELS.idleNag}
                    description={idleNagDescription}
                    error={errors.idleNag}
                    checked={idleNagDefeatEnabledSignal.value}
                    onChange={(checked) =>
                      apply('idleNag', () => actions.setIdleNagDefeatEnabled(checked))
                    }
                    disabled={!backgroundPlayEnabledSignal.value}
                  />
                )}
                {fallbackQualityVisible && (
                  <SettingRow
                    id="option-fallback-quality"
                    label={OPTION_LABELS.fallbackQuality}
                    description={fallbackQualityDescription}
                    error={errors.fallbackQuality}
                    checked={fallbackQualityCapEnabledSignal.value}
                    onChange={(checked) =>
                      apply('fallbackQuality', () => actions.setFallbackQualityCapEnabled(checked))
                    }
                  />
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
                    {...(adBlockEnabledSignal.value
                      ? { consequence: 'May rarely affect playback.' }
                      : {})}
                    checked={adBlockEnabledSignal.value}
                    onChange={(checked) => {
                      if (!checked) {
                        apply('ads', () => actions.setAdBlockEnabled(false));
                        return;
                      }
                      // ADR-0018: network permissions are requested in this same gesture; the
                      // setting persists only on grant. Denial keeps blocking off with a notice.
                      applyPermissionRequest(
                        'ads',
                        actions.requestNetworkPermission,
                        NETWORK_PERMISSION_ERROR,
                        async () => {
                          setNetworkPermission(true);
                          await actions.setAdBlockEnabled(true);
                          showToast({ kind: 'ok', message: 'Ad blocking on.' });
                        }
                      );
                    }}
                    highImpact
                  />
                )}
                {adBlockVisible && adBlockEnabledSignal.value && networkPermission === false && (
                  <div class="action-row permission-notice-row">
                    <span>
                      <strong>Ad-blocking access isn't granted</strong>
                      <small>Blocking is on but can't filter traffic until you grant access.</small>
                    </span>
                    <div class="action-buttons">
                      <button
                        type="button"
                        class="secondary-action"
                        onClick={() =>
                          applyPermissionRequest(
                            'ads',
                            actions.requestNetworkPermission,
                            NETWORK_PERMISSION_ERROR,
                            () => setNetworkPermission(true)
                          )
                        }
                      >
                        Grant access
                      </button>
                    </div>
                  </div>
                )}
                {ghostVisible && (
                  <SettingRow
                    id="option-ghost"
                    label={OPTION_LABELS.ghost}
                    description={ghostDescription}
                    error={errors.ghost}
                    checked={ghostEnabledSignal.value}
                    onChange={(checked) => {
                      if (!checked) {
                        apply('ghost', () => actions.setGhostEnabled(false));
                        return;
                      }
                      // Ghost rides the same network-filter grants as ad blocking (ADR-0018):
                      // request them in this same gesture so "Ghost on" always means filtering.
                      applyPermissionRequest(
                        'ghost',
                        actions.requestNetworkPermission,
                        NETWORK_PERMISSION_ERROR,
                        async () => {
                          setNetworkPermission(true);
                          await actions.setGhostEnabled(true);
                        }
                      );
                    }}
                    recommended
                  />
                )}
                {ghostVisible && ghostEnabledSignal.value && networkPermission === false && (
                  <div class="action-row permission-notice-row">
                    <span>
                      <strong>Ghost access isn't granted</strong>
                      <small>Ghost is on but can't filter traffic until you grant access.</small>
                    </span>
                    <div class="action-buttons">
                      <button
                        type="button"
                        class="secondary-action"
                        onClick={() =>
                          applyPermissionRequest(
                            'ghost',
                            actions.requestNetworkPermission,
                            NETWORK_PERMISSION_ERROR,
                            () => setNetworkPermission(true)
                          )
                        }
                      >
                        Grant access
                      </button>
                    </div>
                  </div>
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
                    onChange={(checked) => {
                      if (!checked) {
                        apply('skip', () => actions.setSegmentSkipEnabled(false));
                        return;
                      }
                      // SPEC-013 double gate: request the optional host permission in this same
                      // gesture, then persist the SponsorBlock consent and the setting.
                      applyPermissionRequest(
                        'skip',
                        actions.requestSponsorPermission,
                        SPONSOR_PERMISSION_ERROR,
                        async () => {
                          setSponsorPermission(true);
                          await actions.setSponsorBlockConsent(true);
                          await actions.setSegmentSkipEnabled(true);
                        }
                      );
                    }}
                  />
                )}
                {skipVisible && segmentSkipEnabledSignal.value && sponsorPermission === false && (
                  <div class="action-row permission-notice-row">
                    <span>
                      <strong>SponsorBlock access isn't granted</strong>
                      <small>Skipping is on but can't fetch segments until you grant access.</small>
                    </span>
                    <div class="action-buttons">
                      <button
                        type="button"
                        class="secondary-action"
                        onClick={() =>
                          applyPermissionRequest(
                            'skip',
                            actions.requestSponsorPermission,
                            SPONSOR_PERMISSION_ERROR,
                            () => setSponsorPermission(true)
                          )
                        }
                      >
                        Grant access
                      </button>
                    </div>
                  </div>
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
                      <details class="advanced-disclosure">
                        <summary>All categories</summary>
                        <div class="dependent-reveal-inner">
                          {sponsorExtraRows.map(([category, label, on, off]) => {
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
                      </details>
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
                {thumbnailsVisible && (
                  <SettingRow
                    id="option-thumbnails"
                    label={OPTION_LABELS.thumbnails}
                    description={thumbnailsDescription}
                    error={errors.thumbnails}
                    checked={hideThumbnailsSignal.value}
                    onChange={(checked) =>
                      apply('thumbnails', () =>
                        actions.setQualityOfLifeSetting('hideThumbnails', checked)
                      )
                    }
                  />
                )}
                {avatarsVisible && (
                  <SettingRow
                    id="option-avatars"
                    label={OPTION_LABELS.avatars}
                    description={avatarsDescription}
                    error={errors.avatars}
                    checked={hideAvatarsSignal.value}
                    onChange={(checked) =>
                      apply('avatars', () =>
                        actions.setQualityOfLifeSetting('hideAvatars', checked)
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
                {volumeBoostVisible && (
                  <SettingRow
                    id="option-volume-boost"
                    label={OPTION_LABELS.volumeBoost}
                    description={volumeBoostDescription}
                    error={errors['volume-boost']}
                    checked={volumeBoostEnabledSignal.value}
                    onChange={(checked) =>
                      apply('volume-boost', () => actions.setVolumeBoostEnabled(checked))
                    }
                  />
                )}
                {volumeBoostEnabledSignal.value && volumeBoostVisible && (
                  <div class="dependent-reveal">
                    <div class="dependent-reveal-inner">
                      <label class="range-control">
                        <span>Boost amount</span>
                        <input
                          type="range"
                          min="1"
                          max="2"
                          step="0.1"
                          value={volumeBoostAmountSignal.value}
                          onChange={(e) => {
                            const value = Number((e.target as HTMLInputElement).value);
                            apply('volume-boost-amount', () => actions.setVolumeBoostAmount(value));
                          }}
                        />
                        <span>{Math.round((volumeBoostAmountSignal.value - 1) * 100)}%</span>
                      </label>
                    </div>
                  </div>
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
                  onChange={(checked) => {
                    if (!checked) {
                      apply('download', () => actions.setDownloadEnabled(false));
                      return;
                    }
                    // SPEC-013 double gate: request the optional downloads permission in this same
                    // gesture, then persist the setting.
                    applyPermissionRequest(
                      'download',
                      actions.requestDownloadsPermission,
                      DOWNLOAD_PERMISSION_ERROR,
                      async () => {
                        setDownloadsPermission(true);
                        await actions.setDownloadEnabled(true);
                      }
                    );
                  }}
                />
                {downloadEnabledSignal.value && downloadsPermission === false && (
                  <div class="action-row permission-notice-row">
                    <span>
                      <strong>Download access isn't granted</strong>
                      <small>The save-audio button can't save files until you grant access.</small>
                    </span>
                    <div class="action-buttons">
                      <button
                        type="button"
                        class="secondary-action"
                        onClick={() =>
                          applyPermissionRequest(
                            'download',
                            actions.requestDownloadsPermission,
                            DOWNLOAD_PERMISSION_ERROR,
                            () => setDownloadsPermission(true)
                          )
                        }
                      >
                        Grant access
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {resetVisible && (
            <section id="advanced-about" class="settings-section">
              <SectionHeader>Advanced/About</SectionHeader>
              <div class="settings-card reset-card">
                <div class="action-row consent-review-row" id="data-consent">
                  <span>
                    <strong>Data &amp; consent</strong>
                    <small>
                      {consentGranted === true
                        ? 'Allowed. YouTube receives video request details and audio requests; SponsorBlock remains a separate choice.'
                        : consentGranted === false
                          ? 'Not allowed. Transmission-dependent features are stopped.'
                          : 'Checking your current consent…'}{' '}
                      <a
                        class="consent-privacy-link"
                        href="https://animesh.kundus.in/youtube-audio/privacy/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Privacy policy
                      </a>
                      .
                    </small>
                  </span>
                  <div class="action-buttons">
                    <button type="button" class="secondary-action" onClick={actions.openConsent}>
                      Review
                    </button>
                    {consentGranted && (
                      <button
                        type="button"
                        class="secondary-action is-danger"
                        onClick={revokeConsent}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
                <div class="action-row reset-row">
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
