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

  const emit = (reason: SpaNavigation['reason']) => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      onNavigate({ url: location.href, reason });
    });
  };

  const navigationListener = () => {
    lastUrl = location.href;
    lastVideo = document.querySelector('video');
    emit('navigation');
  };
  document.addEventListener('yt-navigate-finish', navigationListener);

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      emit('url-change');
    }
    const video = document.querySelector('video');
    if (video !== lastVideo) {
      lastVideo = video;
      emit('player-change');
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  emit('initial');

  return {
    stop(): void {
      document.removeEventListener('yt-navigate-finish', navigationListener);
      observer.disconnect();
    },
  };
}
