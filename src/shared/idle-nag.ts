/**
 * Idle-nag defeat primitives (SPEC-016): pure, framework-free helpers shared by the page-world
 * implementation. The page world owns the timers, listeners, and player patches; everything here
 * is deterministic, DOM-typed only through `ParentNode`, and unit-testable in isolation.
 */

export const IDLE_NAG_KEEPALIVE_MS = 240_000;
export const IDLE_NAG_JITTER_MS = 30_000;
/**
 * A single short first pass after arming: pages that define their activity clock lazily get the
 * refresh as soon as it exists, and the steady cadence stays low frequency from there on.
 */
export const IDLE_NAG_PRIME_MS = 2_000;

const IDLE_NAG_NODE_NAMES: ReadonlySet<string> = new Set([
  'YT-CONFIRM-DIALOG-RENDERER',
  'YTMUSIC-YOU-THERE-RENDERER',
]);

const RENDERER_SELECTORS = ['yt-confirm-dialog-renderer', 'ytmusic-you-there-renderer'] as const;

const CONFIRM_SELECTORS = [
  'yt-confirm-dialog-renderer #confirm-button',
  'yt-confirm-dialog-renderer tp-yt-paper-button',
  'ytmusic-you-there-renderer button',
  '#confirm-button',
] as const;

const POPUP_CONTAINER_SELECTORS = ['ytd-popup-container', 'ytmusic-popup-container'] as const;

/** True for exactly the two you-there dialog renderer node names. */
export function isIdleNagNodeName(value: unknown): boolean {
  return typeof value === 'string' && IDLE_NAG_NODE_NAMES.has(value);
}

/**
 * Base cadence plus bounded symmetric jitter, always a positive integer. `random` is injectable
 * so tests can pin the boundaries; unusable samples degrade to the base cadence.
 */
export function nextIdleNagDelayMs(random: () => number = Math.random): number {
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  const offset = Math.round((bounded * 2 - 1) * IDLE_NAG_JITTER_MS);
  return Math.max(1, IDLE_NAG_KEEPALIVE_MS + offset);
}

/** First you-there dialog renderer present in the root, or null. Never throws. */
export function findIdleNagRenderer(root: ParentNode): Element | null {
  return queryFirst(root, RENDERER_SELECTORS);
}

/** The confirm control of an open nag dialog, or null. Never throws. */
export function findIdleNagConfirmTarget(root: ParentNode): Element | null {
  return queryFirst(root, CONFIRM_SELECTORS);
}

/** The YouTube popup container used as the dismissal fallback, or null. Never throws. */
export function findIdleNagPopupContainer(root: ParentNode): Element | null {
  return queryFirst(root, POPUP_CONTAINER_SELECTORS);
}

/**
 * Confirms an open nag dialog: clicks its confirm control, else its popup container. Returns
 * whether a click was performed; absent or unclickable targets are a false no-op and never throw.
 */
export function dismissIdleNag(root: ParentNode): boolean {
  const target = findIdleNagConfirmTarget(root) ?? findIdleNagPopupContainer(root);
  if (!target) return false;
  const clickable = target as Partial<HTMLElement>;
  if (typeof clickable.click !== 'function') return false;
  try {
    clickable.click();
    return true;
  } catch {
    return false;
  }
}

function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    try {
      const match = root.querySelector(selector);
      if (match) return match;
    } catch {
      // Unsupported selectors must never break the page.
    }
  }
  return null;
}
