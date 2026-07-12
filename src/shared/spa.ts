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
  const checkForMutationNavigation = () => {
    mutationFrame = null;
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

  const observer = new MutationObserver(scheduleMutationCheck);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  emit('initial');

  return {
    stop(): void {
      stopped = true;
      document.removeEventListener('yt-navigate-finish', navigationListener);
      cancelMutationCheck();
      observer.disconnect();
    },
  };
}
