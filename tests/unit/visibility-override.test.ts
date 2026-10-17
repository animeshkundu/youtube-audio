// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installVisibilityOverride } from '../../src/shared/visibility-override';

const nativeHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')!;
const nativeVisibilityDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  'visibilityState'
)!;

/** Makes the inherited accessors report a hidden tab so the override is observable. */
function stubHiddenPrototype(): void {
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get: () => 'hidden' as DocumentVisibilityState,
  });
}

afterEach(() => {
  Object.defineProperty(Document.prototype, 'hidden', nativeHiddenDescriptor);
  Object.defineProperty(Document.prototype, 'visibilityState', nativeVisibilityDescriptor);
  Reflect.deleteProperty(document, 'hidden');
  Reflect.deleteProperty(document, 'visibilityState');
  vi.restoreAllMocks();
});

describe('installVisibilityOverride', () => {
  it('forces visible values while installed and returns inherited behavior on cleanup', () => {
    stubHiddenPrototype();

    const cleanup = installVisibilityOverride(document);

    expect(document.hidden).toBe(false);
    expect(document.visibilityState).toBe('visible');

    cleanup();

    expect(document.hidden).toBe(true);
    expect(document.visibilityState).toBe('hidden');
    expect(Object.getOwnPropertyDescriptor(document, 'hidden')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(document, 'visibilityState')).toBeUndefined();
  });

  it('adopts an existing own-property override instead of stacking or touching it', () => {
    stubHiddenPrototype();
    const foreignGetter = () => false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: foreignGetter });

    const cleanup = installVisibilityOverride(document);

    // The adopted property keeps its owner; the one without an owner still gets ours.
    expect(Object.getOwnPropertyDescriptor(document, 'hidden')?.get).toBe(foreignGetter);
    expect(document.visibilityState).toBe('visible');

    cleanup();

    expect(Object.getOwnPropertyDescriptor(document, 'hidden')?.get).toBe(foreignGetter);
    expect(Object.getOwnPropertyDescriptor(document, 'visibilityState')).toBeUndefined();
  });

  it('leaves a foreign accessor that patched over ours in place on cleanup', () => {
    stubHiddenPrototype();
    const cleanup = installVisibilityOverride(document);
    const foreignGetter = () => false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: foreignGetter });

    cleanup();

    // Revert only what we installed: the later foreign patch owns the property now.
    expect(Object.getOwnPropertyDescriptor(document, 'hidden')?.get).toBe(foreignGetter);
    expect(Object.getOwnPropertyDescriptor(document, 'visibilityState')).toBeUndefined();
  });

  it('swallows visibilitychange while installed and stops swallowing after cleanup', () => {
    const listener = vi.fn();
    const cleanup = installVisibilityOverride(document);
    document.addEventListener('visibilitychange', listener);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).not.toHaveBeenCalled();

    cleanup();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledOnce();
    document.removeEventListener('visibilitychange', listener);
  });
});
