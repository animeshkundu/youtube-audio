/**
 * Own-property patch helper (SPEC-019, ADR-0015). Installs a value on a page-owned object,
 * verifies the write actually took, and returns a teardown that restores the previous state only
 * while the installed value is still ours. A later patch owns the property and survives our
 * cleanup; a previous value that was inherited is restored by deleting the own property.
 */

export function installValuePatch<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K]
): (() => void) | null {
  let hadOwnProperty = false;
  let previous: T[K] | undefined;
  try {
    hadOwnProperty = Object.prototype.hasOwnProperty.call(target, key);
    previous = target[key];
    target[key] = value;
  } catch {
    return null;
  }
  // An intercepted write (frozen object, setter that ignores the value) never took.
  if (target[key] !== value) return null;

  return () => {
    try {
      if (target[key] !== value) return; // a later patch owns the property now
      if (hadOwnProperty) target[key] = previous as T[K];
      else Reflect.deleteProperty(target, key);
    } catch {
      // Teardown is best effort; the page keeps whatever state it has.
    }
  };
}
