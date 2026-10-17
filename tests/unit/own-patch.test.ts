import { describe, expect, it } from 'vitest';

import { installValuePatch } from '../../src/shared/own-patch';

class PageObject {
  method(): string {
    return 'original';
  }
}

interface PatchablePageObject {
  method: () => string;
}

describe('installValuePatch', () => {
  it('installs an own property and deletes it again when the value was inherited', () => {
    const target = new PageObject();
    const patched = () => 'patched';

    const restore = installValuePatch(target, 'method', patched);

    expect(target.method).toBe(patched);
    expect(Object.prototype.hasOwnProperty.call(target, 'method')).toBe(true);

    restore?.();

    expect(Object.prototype.hasOwnProperty.call(target, 'method')).toBe(false);
    expect(target.method()).toBe('original');
  });

  it('restores a previous own value', () => {
    const target = new PageObject();
    const first = () => 'first';
    const second = () => 'second';
    (target as unknown as PatchablePageObject).method = first;

    const restore = installValuePatch(target, 'method', second);
    restore?.();

    expect(target.method).toBe(first);
  });

  it('leaves a later patch in place on teardown', () => {
    const target = new PageObject();
    const ours = () => 'ours';
    const theirs = () => 'theirs';

    const restore = installValuePatch(target, 'method', ours);
    (target as unknown as PatchablePageObject).method = theirs;

    restore?.();

    // Revert only what we installed: the later patch owns the property now.
    expect(target.method).toBe(theirs);
  });

  it('returns null instead of throwing when the target cannot take the patch', () => {
    const frozen = Object.freeze(new PageObject());

    expect(installValuePatch(frozen, 'method', () => 'no')).toBeNull();
    expect(frozen.method()).toBe('original');
  });
});
