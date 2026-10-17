import { describe, expect, it } from 'vitest';

import {
  buildTeardownSnapshot,
  isTeardownMessage,
  TEARDOWN_MESSAGE,
} from '../../src/shared/teardown';

describe('isTeardownMessage', () => {
  it('accepts exactly the teardown control message', () => {
    expect(isTeardownMessage({ type: TEARDOWN_MESSAGE })).toBe(true);
  });

  it('rejects malformed and unrelated values', () => {
    expect(isTeardownMessage(null)).toBe(false);
    expect(isTeardownMessage(undefined)).toBe(false);
    expect(isTeardownMessage(TEARDOWN_MESSAGE)).toBe(false);
    expect(isTeardownMessage({})).toBe(false);
    expect(isTeardownMessage({ type: 'yta:other' })).toBe(false);
    expect(isTeardownMessage({ type: 7 })).toBe(false);
  });
});

describe('buildTeardownSnapshot', () => {
  it('forces enabled off and leaves every other field untouched', () => {
    const settings = { enabled: true, audioOnlyEnabled: true, hideShorts: true };
    expect(buildTeardownSnapshot(settings)).toEqual({
      enabled: false,
      audioOnlyEnabled: true,
      hideShorts: true,
    });
  });

  it('keeps an already-disabled snapshot disabled', () => {
    expect(buildTeardownSnapshot({ enabled: false, audioOnlyEnabled: true })).toEqual({
      enabled: false,
      audioOnlyEnabled: true,
    });
  });

  it('does not mutate the input snapshot', () => {
    const settings = { enabled: true, hideComments: true };
    buildTeardownSnapshot(settings);
    expect(settings).toEqual({ enabled: true, hideComments: true });
  });
});
