import { signal } from '@preact/signals';

export interface ExtensionSettings {
  enabled: boolean;
}

const STORAGE_KEY = 'settings';
const DEFAULT_SETTINGS: ExtensionSettings = { enabled: true };

export const enabledSignal = signal(DEFAULT_SETTINGS.enabled);

export async function initializeSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const candidate = stored[STORAGE_KEY];
  const settings = isSettings(candidate) ? candidate : DEFAULT_SETTINGS;
  enabledSignal.value = settings.enabled;
  return settings;
}

export async function setEnabled(enabled: boolean): Promise<void> {
  const previous = enabledSignal.value;
  enabledSignal.value = enabled;

  try {
    await browser.storage.local.set({ [STORAGE_KEY]: { enabled } });
  } catch (error) {
    enabledSignal.value = previous;
    throw error;
  }
}

export function watchSettings(): () => void {
  const listener = (changes: Record<string, browser.storage.StorageChange>) => {
    const candidate = changes[STORAGE_KEY]?.newValue;
    if (isSettings(candidate)) enabledSignal.value = candidate.enabled;
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

function isSettings(value: unknown): value is ExtensionSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    'enabled' in value &&
    typeof value.enabled === 'boolean'
  );
}
