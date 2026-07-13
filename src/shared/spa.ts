export interface SpaNavigation {
  url: string;
  reason: 'initial' | 'navigation' | 'url-change' | 'player-change';
}

export interface SpaObserver {
  stop(): void;
}

/**
 * How long the mutation-driven navigation check waits before its timer fallback fires when the
 * animation-frame path is starved (hidden tab or Firefox-for-Android rAF throttling). Kept short so
 * a native element swap is re-hijacked promptly, but long enough to coalesce a burst of mutations
 * into one lookup. On a visible tab rAF wins the race and cancels this timer, so it is a no-op there.
 */
const MUTATION_CHECK_MS = 100;

export function observeYouTubeSpa(onNavigate: (navigation: SpaNavigation) => void): SpaObserver {
  let lastUrl = location.href;
  let lastVideo = document.querySelector('video');
  let scheduled = false;
  let mutationFrame: number | null = null;
  let mutationTimer: number | null = null;
  let stopped = false;

  const emit = (reason: SpaNavigation['reason']) => {
    if (stopped || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!stopped) onNavigate({ url: location.href, reason });
    });
  };

  const cancelMutationCheck = () => {
    if (mutationFrame !== null) cancelAnimationFrame(mutationFrame);
    if (mutationTimer !== null) clearTimeout(mutationTimer);
    mutationFrame = null;
    mutationTimer = null;
  };
  // Compare the current URL / <video> against the last seen and emit on a real change. Called both
  // from the rAF-deferred mutation path and, immediately, from the history hooks below.
  const detectNavigation = () => {
    if (stopped) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      emit('url-change');
    }
    const video = document.querySelector('video');
    if (video !== lastVideo) {
      lastVideo = video;
      emit('player-change');
    }
  };
  const checkForMutationNavigation = () => {
    cancelMutationCheck();
    detectNavigation();
  };
  const scheduleMutationCheck = () => {
    if (stopped || mutationFrame !== null || mutationTimer !== null) return;
    // rAF batches the check with paint on a visible tab, but it is suspended when the tab is hidden
    // and Firefox for Android throttles it to a single frame shortly after load. That would strand
    // the identity check below, which is the only signal that catches a native <video> element swap:
    // the mobile audio reclaim REPLACES the element (old one detached, a fresh one installed with the
    // native source) rather than re-sourcing it in place, so the property-setter guard never sees it.
    // Arm a bounded timer alongside rAF so the check still runs when rAF is starved; whichever fires
    // first cancels the other, so a visible tab keeps the paint-aligned fast path unchanged.
    mutationFrame = requestAnimationFrame(checkForMutationNavigation);
    mutationTimer = window.setTimeout(checkForMutationNavigation, MUTATION_CHECK_MS);
  };

  // This path stays independent of rAF so navigation is detected even while a hidden tab's frames
  // are suspended. It also absorbs any queued mutation check with the same latest DOM state.
  const navigationListener = () => {
    if (stopped) return;
    cancelMutationCheck();
    lastUrl = location.href;
    lastVideo = document.querySelector('video');
    emit('navigation');
  };
  document.addEventListener('yt-navigate-finish', navigationListener);

  // YouTube Music changes songs via history.pushState/replaceState and frequently does NOT fire
  // `yt-navigate-finish`, while its shadow-DOM-heavy player update may not trip the light-DOM
  // MutationObserver below, so the `?v=` change would otherwise go undetected and per-song features
  // (e.g. synced lyrics) would never re-arm. Wrap the history methods (and listen for popstate) to
  // run the URL check immediately. Fail-open: the page's original method is always invoked first.
  const wrapHistory = (name: 'pushState' | 'replaceState'): (() => void) => {
    const original = history[name];
    if (typeof original !== 'function') return () => undefined;
    const patched: History['pushState'] = function (this: History, data, unused, url) {
      const result = original.call(this, data, unused, url);
      try {
        detectNavigation();
      } catch {
        // Never let navigation detection break the page's own router.
      }
      return result;
    };
    history[name] = patched;
    return () => {
      if (history[name] === patched) history[name] = original;
    };
  };
  const restorePushState = wrapHistory('pushState');
  const restoreReplaceState = wrapHistory('replaceState');
  const onPopState = () => detectNavigation();
  window.addEventListener('popstate', onPopState);

  const observer = new MutationObserver(scheduleMutationCheck);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  emit('initial');

  return {
    stop(): void {
      stopped = true;
      document.removeEventListener('yt-navigate-finish', navigationListener);
      restorePushState();
      restoreReplaceState();
      window.removeEventListener('popstate', onPopState);
      cancelMutationCheck();
      observer.disconnect();
    },
  };
}
