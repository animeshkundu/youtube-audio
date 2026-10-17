/**
 * Per-tab audio-only scope: the pure vocabulary and logic for the in-memory, tab-keyed override
 * that lets the popup hero and the `Alt+Shift+A` command act on the tab in front of the user while
 * every other surface keeps editing the global preference (SPEC-012 §5; ADR-0014).
 *
 * The background owns the store; content scripts merge their tab's override into the settings
 * snapshot they already push; the popup renders the effective value. Everything here is pure so it
 * can be unit-tested without a browser; the messaging wiring lives in the entrypoints.
 */

import type { ExtensionSettings } from './config';

/** Runtime message-type discriminators for the tab-scope channel. */
export const GET_TAB_SCOPE_MESSAGE = 'yta:get-tab-scope';
export const SET_TAB_SCOPE_MESSAGE = 'yta:set-tab-scope';
export const TAB_SCOPE_CHANGED_MESSAGE = 'yta:tab-scope-changed';

/** A tab's explicit audio-only override; `null` means "follow the global preference". */
export type TabAudioOnlyOverride = boolean | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOverrideValue(value: unknown): value is TabAudioOnlyOverride {
  return typeof value === 'boolean' || value === null;
}

/** Precedence rule: an explicit per-tab override wins over the global audio-only preference. */
export function resolveTabAudioOnly(
  globalAudioOnly: boolean,
  override: TabAudioOnlyOverride
): boolean {
  return override ?? globalAudioOnly;
}

/** Overlay a tab override onto a settings snapshot; audio-only is the only field it may change. */
export function applyTabAudioOnlyOverride(
  settings: ExtensionSettings,
  override: TabAudioOnlyOverride
): ExtensionSettings {
  return override === null ? settings : { ...settings, audioOnlyEnabled: override };
}

/**
 * The in-memory per-tab store. Never persisted by design (ADR-0014): entries live only as long as
 * their tab (the caller prunes on `tabs.onRemoved`) and the background context.
 */
export interface TabScopeStore {
  /** The tab's override, or `null` when the tab follows the global preference. */
  get(tabId: number): TabAudioOnlyOverride;
  set(tabId: number, audioOnly: boolean): void;
  delete(tabId: number): void;
  /** Number of tabs currently carrying an override (bench and diagnostics). */
  readonly size: number;
  /** A snapshot of every override, for diagnostics and the bench (never used for policy). */
  entries(): Array<{ tabId: number; audioOnly: boolean }>;
}

/** Create the background-owned store; a fresh store starts with every tab following the global. */
export function createTabScopeStore(): TabScopeStore {
  const overrides = new Map<number, boolean>();
  return {
    get: (tabId) => overrides.get(tabId) ?? null,
    set: (tabId, audioOnly) => {
      overrides.set(tabId, audioOnly);
    },
    delete: (tabId) => {
      overrides.delete(tabId);
    },
    get size() {
      return overrides.size;
    },
    entries: () => [...overrides.entries()].map(([tabId, audioOnly]) => ({ tabId, audioOnly })),
  };
}

/** Parse the popup's `yta:set-tab-scope` payload; malformed or wrong-type values are dropped. */
export function parseTabScopeSetMessage(value: unknown): { audioOnly: boolean } | null {
  if (!isRecord(value) || value.type !== SET_TAB_SCOPE_MESSAGE) return null;
  return typeof value.audioOnly === 'boolean' ? { audioOnly: value.audioOnly } : null;
}

/** Parse a `yta:get-tab-scope` reply; `undefined` means the reply was malformed and unusable. */
export function parseTabScopeReply(
  value: unknown
): { audioOnly: TabAudioOnlyOverride } | undefined {
  if (!isRecord(value) || !('audioOnly' in value)) return undefined;
  return isOverrideValue(value.audioOnly) ? { audioOnly: value.audioOnly } : undefined;
}

/** Parse a background `yta:tab-scope-changed` push; `null` means not this message or unusable. */
export function parseTabScopePush(value: unknown): { audioOnly: TabAudioOnlyOverride } | null {
  if (!isRecord(value) || value.type !== TAB_SCOPE_CHANGED_MESSAGE) return null;
  return isOverrideValue(value.audioOnly) ? { audioOnly: value.audioOnly } : null;
}
