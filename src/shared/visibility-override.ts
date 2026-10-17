/**
 * Background-play visibility override (SPEC-019, ADR-0015): forces `document.hidden` and
 * `document.visibilityState` to report visible while YouTube's own visibility listeners are
 * swallowed, so playback continues in a backgrounded tab.
 *
 * Coexistence-first: an own-property override that already exists on the target (another extension,
 * or the page) is adopted rather than stacked, and teardown restores a property only while the
 * accessor installed there is still the one we installed. A later foreign patch owns the property
 * and survives our cleanup. Every step is fail-open.
 */

interface VisibilityOverrideCandidate {
  name: 'hidden' | 'visibilityState';
  getter: () => boolean | DocumentVisibilityState;
}

interface InstalledVisibilityProperty {
  name: VisibilityOverrideCandidate['name'];
  getter: VisibilityOverrideCandidate['getter'];
}

export function installVisibilityOverride(target: Document): () => void {
  const candidates: readonly VisibilityOverrideCandidate[] = [
    { name: 'hidden', getter: () => false },
    { name: 'visibilityState', getter: () => 'visible' },
  ];
  const installed: InstalledVisibilityProperty[] = [];

  for (const candidate of candidates) {
    let existing: PropertyDescriptor | undefined;
    try {
      existing = Object.getOwnPropertyDescriptor(target, candidate.name);
    } catch {
      continue;
    }
    // Adoption (ADR-0015): an own property, of any kind, means someone already owns this name.
    // Ours would add nothing but teardown risk, so it is left completely untouched.
    if (existing) continue;
    try {
      Object.defineProperty(target, candidate.name, {
        configurable: true,
        get: candidate.getter,
      });
      installed.push({ name: candidate.name, getter: candidate.getter });
    } catch {
      // This property keeps native behavior; the rest of the override stays armed.
    }
  }

  const swallow = (event: Event) => event.stopImmediatePropagation();
  let listenerAdded = false;
  try {
    target.addEventListener('visibilitychange', swallow, true);
    listenerAdded = true;
  } catch {
    // A target that refuses listeners keeps the property overrides only.
  }

  return () => {
    if (listenerAdded) target.removeEventListener('visibilitychange', swallow, true);
    for (const entry of installed) {
      try {
        const current = Object.getOwnPropertyDescriptor(target, entry.name);
        // Revert only what we installed (ADR-0015): a foreign accessor patched over ours owns the
        // property now, and a deleted property stays deleted.
        if (current?.get !== entry.getter) continue;
        delete (target as unknown as Record<string, unknown>)[entry.name];
      } catch {
        // Teardown is best effort and must not interrupt page code.
      }
    }
  };
}
