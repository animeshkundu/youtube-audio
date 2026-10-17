import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/shared/config';
import {
  applyTabAudioOnlyOverride,
  createTabScopeStore,
  GET_TAB_SCOPE_MESSAGE,
  parseTabScopePush,
  parseTabScopeReply,
  parseTabScopeSetMessage,
  resolveTabAudioOnly,
  SET_TAB_SCOPE_MESSAGE,
  TAB_SCOPE_CHANGED_MESSAGE,
} from '../../src/shared/tab-scope';

/**
 * The per-tab scope module holds every decision the popup, background, and content script share
 * (SPEC-012 §5; ADR-0014): the precedence rule, the settings overlay, the in-memory store, and the
 * message parsers. These tests pin those decisions without a browser.
 */

describe('resolveTabAudioOnly', () => {
  it('lets an explicit override win over the global preference in both directions', () => {
    expect(resolveTabAudioOnly(true, false)).toBe(false);
    expect(resolveTabAudioOnly(false, true)).toBe(true);
  });

  it('follows the global preference when there is no override', () => {
    expect(resolveTabAudioOnly(true, null)).toBe(true);
    expect(resolveTabAudioOnly(false, null)).toBe(false);
  });
});

describe('applyTabAudioOnlyOverride', () => {
  it('returns the same snapshot untouched when the tab follows the global preference', () => {
    expect(applyTabAudioOnlyOverride(DEFAULT_SETTINGS, null)).toBe(DEFAULT_SETTINGS);
  });

  it('changes only the audio-only field when an override is present', () => {
    const overridden = applyTabAudioOnlyOverride(DEFAULT_SETTINGS, false);
    expect(overridden.audioOnlyEnabled).toBe(false);
    expect(overridden).toEqual({ ...DEFAULT_SETTINGS, audioOnlyEnabled: false });
  });
});

describe('createTabScopeStore', () => {
  it('starts with every tab following the global preference', () => {
    const store = createTabScopeStore();
    expect(store.get(7)).toBeNull();
    expect(store.size).toBe(0);
    expect(store.entries()).toEqual([]);
  });

  it('stores and returns explicit overrides per tab', () => {
    const store = createTabScopeStore();
    store.set(7, false);
    store.set(9, true);
    expect(store.get(7)).toBe(false);
    expect(store.get(9)).toBe(true);
    expect(store.size).toBe(2);
    expect(store.entries()).toEqual([
      { tabId: 7, audioOnly: false },
      { tabId: 9, audioOnly: true },
    ]);
  });

  it('deletes a tab override when its tab closes', () => {
    const store = createTabScopeStore();
    store.set(7, false);
    store.delete(7);
    expect(store.get(7)).toBeNull();
    expect(store.size).toBe(0);
  });
});

describe('tab-scope messages', () => {
  it('parses a well-formed set message', () => {
    expect(parseTabScopeSetMessage({ type: SET_TAB_SCOPE_MESSAGE, audioOnly: false })).toEqual({
      audioOnly: false,
    });
  });

  it('drops malformed or wrong-type set messages', () => {
    expect(parseTabScopeSetMessage(null)).toBeNull();
    expect(parseTabScopeSetMessage('yta:set-tab-scope')).toBeNull();
    expect(parseTabScopeSetMessage({ type: SET_TAB_SCOPE_MESSAGE, audioOnly: 'yes' })).toBeNull();
    expect(parseTabScopeSetMessage({ type: GET_TAB_SCOPE_MESSAGE, audioOnly: true })).toBeNull();
  });

  it('parses a get reply carrying an explicit override or the follow-global null', () => {
    expect(parseTabScopeReply({ audioOnly: true })).toEqual({ audioOnly: true });
    expect(parseTabScopeReply({ audioOnly: null })).toEqual({ audioOnly: null });
  });

  it('rejects malformed get replies', () => {
    expect(parseTabScopeReply(undefined)).toBeUndefined();
    expect(parseTabScopeReply({})).toBeUndefined();
    expect(parseTabScopeReply({ audioOnly: 'nope' })).toBeUndefined();
  });

  it('parses a scope push and ignores other or malformed messages', () => {
    expect(parseTabScopePush({ type: TAB_SCOPE_CHANGED_MESSAGE, audioOnly: false })).toEqual({
      audioOnly: false,
    });
    expect(parseTabScopePush({ type: TAB_SCOPE_CHANGED_MESSAGE, audioOnly: null })).toEqual({
      audioOnly: null,
    });
    expect(parseTabScopePush({ type: 'yta:status-update', audioOnly: true })).toBeNull();
    expect(parseTabScopePush({ type: TAB_SCOPE_CHANGED_MESSAGE })).toBeNull();
  });
});
