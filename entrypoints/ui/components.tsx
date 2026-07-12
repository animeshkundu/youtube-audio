import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export type SwitchProps = {
  label: string;
  checked: boolean;
  describedBy?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function Switch({ label, checked, describedBy, disabled = false, onChange }: SwitchProps) {
  return (
    <button
      class={`switch-control${checked ? ' is-on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
    >
      <span class="switch-track" aria-hidden="true">
        <span class="switch-thumb" />
      </span>
      <span class="switch-state" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}

export type SettingRowProps = {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  recommended?: boolean;
  highImpact?: boolean;
  consequence?: string;
  error?: string | null | undefined;
  disabled?: boolean;
  className?: string;
};

export function SettingRow({
  id,
  label,
  description,
  checked,
  onChange,
  recommended = false,
  highImpact = false,
  consequence,
  error,
  disabled = false,
  className = '',
}: SettingRowProps) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;
  return (
    <div
      id={id}
      class={`setting-row${highImpact ? ' is-high-impact' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span class="setting-copy">
        <span class="setting-label">
          {label}
          {recommended && <span class="badge">Recommended</span>}
          {highImpact && <span class="badge high-impact-badge">High impact</span>}
        </span>
        <span class="setting-description" id={descriptionId}>
          {description}
        </span>
        {highImpact && checked && consequence && (
          <span class="setting-consequence">{consequence}</span>
        )}
        {error && (
          <span class="setting-error" id={errorId} role="alert">
            {error}
          </span>
        )}
      </span>
      <Switch
        label={label}
        checked={checked}
        describedBy={describedBy}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

export function SectionHeader({ children }: { children: ComponentChildren }) {
  return <h2 class="section-heading">{children}</h2>;
}

export function Brand({ suffix }: { suffix?: string }) {
  return (
    <span class="brand">
      <span class="brand-mark" aria-hidden="true">
        <span>♪</span>
      </span>
      <span>
        <strong>YouTube Audio</strong>
        {suffix && <small>{suffix}</small>}
      </span>
    </span>
  );
}

export const QUICK_CONTROL_LABELS = {
  enabled: 'YouTube Audio',
  audioOnly: 'Audio-only',
  backgroundPlay: 'Background play',
} as const;

export type QuickControlsProps = {
  enabled: boolean;
  enabledDescription?: string | undefined;
  enabledError?: string | null | undefined;
  audioOnlyEnabled: boolean;
  audioOnlyDescription?: string | undefined;
  audioOnlyError?: string | null | undefined;
  backgroundPlayEnabled: boolean;
  backgroundPlayDescription?: string | undefined;
  backgroundPlayError?: string | null | undefined;
  onEnabledChange: (checked: boolean) => void;
  onAudioOnlyChange: (checked: boolean) => void;
  onBackgroundPlayChange: (checked: boolean) => void;
  showEnabled?: boolean;
  showAudioOnly?: boolean;
  showBackgroundPlay?: boolean;
  layout: 'popup' | 'page';
};

export function QuickControls({
  enabled,
  enabledDescription = enabled
    ? 'Active. Your preferences apply instantly.'
    : 'Paused. YouTube works normally.',
  enabledError,
  audioOnlyEnabled,
  audioOnlyDescription = audioOnlyEnabled
    ? 'On. Saving video data and battery.'
    : 'Off. Video plays normally.',
  audioOnlyError,
  backgroundPlayEnabled,
  backgroundPlayDescription = backgroundPlayEnabled
    ? 'On. Keeps playing when hidden.'
    : 'Off. Follows normal page visibility.',
  backgroundPlayError,
  onEnabledChange,
  onAudioOnlyChange,
  onBackgroundPlayChange,
  showEnabled = true,
  showAudioOnly = true,
  showBackgroundPlay = true,
  layout,
}: QuickControlsProps) {
  const heroDescriptionId = `quick-description-${layout}`;
  const heroErrorId = `quick-error-${layout}`;
  return (
    <section
      class={`quick-controls quick-controls-${layout}`}
      aria-label={showEnabled ? undefined : 'Quick Controls'}
      aria-labelledby={showEnabled ? `quick-title-${layout}` : undefined}
    >
      {showEnabled && (
        <div class="hero-row" onClick={() => onEnabledChange(!enabled)}>
          <span class="hero-copy">
            <span class="now-playing" aria-hidden="true" />
            <span>
              <strong id={`quick-title-${layout}`}>{QUICK_CONTROL_LABELS.enabled}</strong>
              <small id={heroDescriptionId}>{enabledDescription}</small>
              {enabledError && (
                <small class="setting-error" id={heroErrorId} role="alert">
                  {enabledError}
                </small>
              )}
            </span>
          </span>
          <Switch
            label={QUICK_CONTROL_LABELS.enabled}
            checked={enabled}
            describedBy={enabledError ? `${heroDescriptionId} ${heroErrorId}` : heroDescriptionId}
            onChange={onEnabledChange}
          />
        </div>
      )}
      {showAudioOnly && (
        <SettingRow
          id={`audio-only-${layout}`}
          label={QUICK_CONTROL_LABELS.audioOnly}
          description={audioOnlyDescription}
          error={audioOnlyError}
          checked={audioOnlyEnabled}
          onChange={onAudioOnlyChange}
          recommended
        />
      )}
      {showBackgroundPlay && (
        <SettingRow
          id={`background-play-${layout}`}
          label={QUICK_CONTROL_LABELS.backgroundPlay}
          description={backgroundPlayDescription}
          error={backgroundPlayError}
          checked={backgroundPlayEnabled}
          onChange={onBackgroundPlayChange}
          recommended
        />
      )}
    </section>
  );
}

export function StatusRow({
  icon,
  label,
  status,
}: {
  icon: string;
  label: string;
  status: string;
}) {
  return (
    <div class="status-row">
      <span class="status-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      <strong>{status}</strong>
    </div>
  );
}

const ONBOARDING_FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Onboarding({
  onDismiss,
  onOpenYouTube,
}: {
  onDismiss: () => void;
  onOpenYouTube: () => void;
}) {
  const surfaceRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const handledRef = useRef(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const handleOnce = (action: () => void) => {
    if (handledRef.current) return;
    handledRef.current = true;
    action();
  };

  useLayoutEffect(() => {
    initialFocusRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        handleOnce(() => dismissRef.current());
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(surface.querySelectorAll<HTMLElement>(ONBOARDING_FOCUSABLE));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        surface.focus();
        return;
      }

      if (
        event.shiftKey &&
        (document.activeElement === first || !surface.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !surface.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div class="onboarding-backdrop">
      <section
        ref={surfaceRef}
        class="onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-summary onboarding-teaching onboarding-privacy"
        tabIndex={-1}
      >
        <span class="onboarding-mark" aria-hidden="true">
          ♪
        </span>
        <h1 id="onboarding-title">You're all set.</h1>
        <p id="onboarding-summary" class="onboarding-summary">
          Audio-only, background play, and ad blocking are on.
          <strong>Nothing to set up.</strong>
        </p>
        <p id="onboarding-teaching" class="onboarding-teaching">
          While a video plays, tap{' '}
          <span role="img" aria-label="the Audio-only button">
            ♪
          </span>{' '}
          in the player to switch between audio and video.
        </p>
        <div class="onboarding-actions">
          <button
            ref={initialFocusRef}
            class="primary-action"
            type="button"
            onClick={() => handleOnce(onOpenYouTube)}
          >
            Open YouTube
          </button>
          <button class="text-action" type="button" onClick={() => handleOnce(onDismiss)}>
            Explore settings
          </button>
        </div>
        <p id="onboarding-privacy" class="onboarding-privacy">
          Runs without your account, and sends nothing about you anywhere.
        </p>
      </section>
    </div>
  );
}
