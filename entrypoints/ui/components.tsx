import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export type SwitchProps = {
  label: string;
  checked: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
};

export function Switch({ label, checked, describedBy, onChange }: SwitchProps) {
  return (
    <button
      class={`switch-control${checked ? ' is-on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
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
  className?: string;
};

export function SettingRow({
  id,
  label,
  description,
  checked,
  onChange,
  recommended = false,
  className = '',
}: SettingRowProps) {
  const descriptionId = `${id}-description`;
  return (
    <div
      id={id}
      class={`setting-row ${className}`.trim()}
      role="group"
      onClick={() => onChange(!checked)}
    >
      <span class="setting-copy">
        <span class="setting-label">
          {label}
          {recommended && (
            <span class="badge" aria-hidden="true">
              Recommended
            </span>
          )}
        </span>
        <span class="setting-description" id={descriptionId}>
          {description}
        </span>
      </span>
      <Switch label={label} checked={checked} describedBy={descriptionId} onChange={onChange} />
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

export type QuickControlsProps = {
  enabled: boolean;
  audioOnlyEnabled: boolean;
  backgroundPlayEnabled: boolean;
  onEnabledChange: (checked: boolean) => void;
  onAudioOnlyChange: (checked: boolean) => void;
  onBackgroundPlayChange: (checked: boolean) => void;
  layout: 'popup' | 'page';
};

export function QuickControls({
  enabled,
  audioOnlyEnabled,
  backgroundPlayEnabled,
  onEnabledChange,
  onAudioOnlyChange,
  onBackgroundPlayChange,
  layout,
}: QuickControlsProps) {
  return (
    <section
      class={`quick-controls quick-controls-${layout}`}
      aria-labelledby={`quick-title-${layout}`}
    >
      <div class="hero-row" onClick={() => onEnabledChange(!enabled)}>
        <span class="hero-copy">
          <span class="now-playing" aria-hidden="true" />
          <span>
            <strong id={`quick-title-${layout}`}>YouTube Audio</strong>
            <small>
              {enabled
                ? 'Active · your preferences apply instantly'
                : 'Paused · YouTube works normally'}
            </small>
          </span>
        </span>
        <Switch label="YouTube Audio" checked={enabled} onChange={onEnabledChange} />
      </div>
      <SettingRow
        id={`audio-only-${layout}`}
        label="Audio-only"
        description={
          audioOnlyEnabled ? 'On · saving video data and battery' : 'Off · video plays normally'
        }
        checked={audioOnlyEnabled}
        onChange={onAudioOnlyChange}
        recommended
      />
      <SettingRow
        id={`background-play-${layout}`}
        label="Background play"
        description={
          backgroundPlayEnabled
            ? 'On · keeps playing when hidden'
            : 'Off · follows normal page visibility'
        }
        checked={backgroundPlayEnabled}
        onChange={onBackgroundPlayChange}
        recommended
      />
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
