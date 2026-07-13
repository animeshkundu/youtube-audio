export interface SpaNavigation {
  url: string;
  reason: 'initial' | 'navigation' | 'url-change' | 'player-change';
}

export interface SpaObserver {
  stop(): void;
}

export function observeYouTubeSpa(onNavigate: (navigation: SpaNavigation) => void): SpaObserver {
  let lastUrl = location.href;
  let lastVideo = document.querySelector('video');
  let scheduled = false;
  let mutationFrame: number | null = null;
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
    mutationFrame = null;
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
    mutationFrame = null;
    detectNavigation();
  };
  const scheduleMutationCheck = () => {
    if (stopped || mutationFrame !== null) return;
    mutationFrame = requestAnimationFrame(checkForMutationNavigation);
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
