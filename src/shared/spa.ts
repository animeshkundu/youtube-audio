export interface SpaObserver {
  stop(): void;
}

export function observeYouTubeSpa(onNavigate: () => void): SpaObserver {
  const navigationListener = () => onNavigate();
  document.addEventListener('yt-navigate-finish', navigationListener);

  const observer = new MutationObserver(() => {
    // TODO(M1): Dispatch targeted player attachment changes instead of scanning here.
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return {
    stop(): void {
      document.removeEventListener('yt-navigate-finish', navigationListener);
      observer.disconnect();
    },
  };
}
