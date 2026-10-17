/**
 * Popup consent channel (SPEC-013): resolves the background's consent state on open so the popup
 * can replace its controls with the consent-required card instead of rendering toggles that could
 * not take effect. Null while the answer is in flight; any failure denies, which keeps the honest
 * card visible rather than dead switches.
 */

import { signal } from '@preact/signals';

import {
  DENIED_DATA_CONSENT,
  GET_DATA_CONSENT_MESSAGE,
  parseDataConsentMessage,
  type DataConsentState,
} from '../../src/shared/consent';
import { requireWithin } from '../../src/shared/timers';

const GET_CONSENT_TIMEOUT_MS = 1_500;

/** The popup's resolved consent state; null means "still asking the background". */
export const consentSignal = signal<DataConsentState | null>(null);

/** Asks the background for the resolved state; safe to call once on popup open. */
export async function refreshConsent(): Promise<void> {
  try {
    const reply = await requireWithin(
      browser.runtime.sendMessage({ type: GET_DATA_CONSENT_MESSAGE }) as Promise<unknown>,
      GET_CONSENT_TIMEOUT_MS,
      'consent-timeout'
    );
    consentSignal.value = parseDataConsentMessage(reply) ?? DENIED_DATA_CONSENT;
  } catch {
    consentSignal.value = DENIED_DATA_CONSENT;
  }
}
