import { useState } from 'preact/hooks';

import { grantDataConsent } from '../../src/shared/consent';
import { setSegmentSkipEnabled } from '../../src/shared/config';
import { Brand } from '../ui/components';

export type ConsentActions = {
  grant: typeof grantDataConsent;
  setSponsorBlockEnabled: typeof setSegmentSkipEnabled;
  uninstall: () => Promise<void>;
  finish: () => void;
};

export const defaultConsentActions: ConsentActions = {
  grant: grantDataConsent,
  setSponsorBlockEnabled: setSegmentSkipEnabled,
  uninstall: async () => browser.management.uninstallSelf({ showConfirmDialog: true }),
  finish: () => window.close(),
};

export function ConsentPage({ actions = defaultConsentActions }: { actions?: ConsentActions }) {
  const [sponsorBlock, setSponsorBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      // The checkbox is the authoritative answer, even for an upgrader who previously had segment
      // skipping on: SponsorBlock is a third-party transmission and the new model requires an
      // explicit opt-in, so leaving the box unchecked here turns it off on purpose.
      await actions.setSponsorBlockEnabled(sponsorBlock);
      await actions.grant(sponsorBlock);
      actions.finish();
    } catch {
      setError("Couldn't save your choice. No data transmission was enabled. Try again.");
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    setError('');
    try {
      await actions.uninstall();
    } catch {
      setError("Couldn't uninstall automatically. Remove YouTube Audio from Firefox Add-ons.");
      setBusy(false);
    }
  };

  return (
    <main class="consent-shell">
      <section class="consent-card" aria-labelledby="consent-title">
        <Brand />
        <div class="consent-intro">
          <span class="consent-eyebrow">Your choice</span>
          <h1 id="consent-title">Permission to connect to YouTube</h1>
          <p>
            To play just the audio of a video, YouTube Audio needs your permission to ask YouTube
            for that video's audio track. Nothing is sent until you choose Allow.
          </p>
        </div>

        <div class="data-flow" aria-label="Required data transmissions">
          <article>
            <strong>www.youtube.com</strong>
            <p>
              Sends the <b>ID of the video you open</b>, standard page config (<b>VISITOR_DATA</b>),
              and a client descriptor (<b>Android VR</b>) to get the direct audio link.
            </p>
          </article>
          <article>
            <strong>*.googlevideo.com</strong>
            <p>Downloads the audio itself, for playback or for a download you ask for.</p>
          </article>
          <article>
            <strong>i.ytimg.com</strong>
            <p>Downloads the video thumbnail for your lock screen and media controls.</p>
          </article>
        </div>

        <p class="privacy-promise">
          These connections are made anonymously: no cookies, no login, no identity. No analytics,
          and nothing is sent to a developer server. Diagnostics stay on your device and are never
          transmitted.
        </p>

        <label class="sponsor-choice">
          <input
            type="checkbox"
            checked={sponsorBlock}
            disabled={busy}
            onChange={(event) => setSponsorBlock(event.currentTarget.checked)}
          />
          <span>
            <strong>Use SponsorBlock segment skipping</strong>
            <small>
              Optional, off by default. Sends a partial scrambled fingerprint of the video ID (the
              first 16 bits of its SHA-256 hash) to sponsor.ajay.app to find sponsor segments. The
              full video ID never leaves your device; matching happens locally.
            </small>
          </span>
        </label>

        <div class="impact-copy">
          <p>
            <strong>If you allow:</strong> audio-only playback, downloads, artwork, and other
            features that need these connections will work.
          </p>
          <p>
            <strong>If you decline:</strong> YouTube Audio cannot work without them, so it will
            uninstall itself.
          </p>
        </div>

        {error && (
          <p class="consent-error" role="alert">
            {error}
          </p>
        )}

        <div class="consent-actions">
          <button
            type="button"
            class="consent-primary"
            disabled={busy}
            onClick={() => void accept()}
          >
            Allow and continue
          </button>
          <button
            type="button"
            class="consent-decline"
            disabled={busy}
            onClick={() => void decline()}
          >
            Decline and uninstall
          </button>
        </div>
        <p class="review-note">
          You can change your mind later in Settings. Revoking stops all transmission and turns
          these features off, leaving YouTube Audio installed but inactive.{' '}
          <a
            class="privacy-link"
            href="https://animesh.kundus.in/youtube-audio/privacy/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the privacy policy
          </a>
          .
        </p>
      </section>
    </main>
  );
}
