import type { PlayerResponse } from './innertube';

export const AUDIO_ARTWORK_CLASS = 'yta-audio-artwork';
const ARTWORK_STYLE_ID = 'yta-audio-artwork-style';
const PLACEHOLDER_WIDTH_THRESHOLD = 120;

// Bundled as source so fallback-edge videos do not require another metadata or image endpoint.
// The placeholder remains a page image load, but it has no network egress.
export const AUDIO_ARTWORK_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#152b2a"/><stop offset="1" stop-color="#0f0f0f"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="320" cy="180" r="74" fill="#22d3b4" fill-opacity=".14"/><path fill="#22d3b4" d="M344 116v105.5a35 35 0 1 1-20-31.6V136l82-18v84.5a35 35 0 1 1-20-31.6v-77l-42 9.2Z"/></svg>'
  );

interface ArtworkThumbnail {
  url: string;
  width: number;
  height: number;
}

export interface ArtworkOverlayOptions {
  artworkUrl: string | null;
  generation: number;
  isCurrent: () => boolean;
  bench?: boolean;
}

/** Selects the widest valid thumbnail without trusting response array order. */
export function pickArtworkUrl(playerResponse: unknown): string | null {
  if (typeof playerResponse !== 'object' || playerResponse === null) return null;
  const thumbnails = (playerResponse as PlayerResponse).videoDetails?.thumbnail?.thumbnails;
  if (!Array.isArray(thumbnails)) return null;

  let best: ArtworkThumbnail | null = null;
  for (const entry of thumbnails) {
    if (typeof entry !== 'object' || entry === null || !isSafeArtworkUrl(entry.url)) continue;
    const width = finiteDimension(entry.width);
    const height = finiteDimension(entry.height);
    const candidate = { url: entry.url, width, height };
    if (
      !best ||
      candidate.width > best.width ||
      (candidate.width === best.width && candidate.height > best.height)
    ) {
      best = candidate;
    }
  }
  return best?.url ?? null;
}

/**
 * Mounts a decorative overlay as the media container's last child. Image work is cancelled by the
 * returned cleanup and guarded again by the owning PlayerHandle generation in MAIN world.
 */
export function showArtworkOverlay(
  mediaElement: HTMLMediaElement,
  options: ArtworkOverlayOptions
): () => void {
  const container = mediaElement.parentElement;
  if (!container) return () => undefined;

  let cancelled = false;
  let overlay: HTMLDivElement | null = null;
  let foreground: HTMLImageElement | null = null;
  let backdrop: HTMLImageElement | null = null;
  const previousPosition = container.style.getPropertyValue('position');
  const previousPositionPriority = container.style.getPropertyPriority('position');
  let ownsPosition = false;

  const isActive = () => !cancelled && options.isCurrent() && overlay?.isConnected === true;
  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (foreground) {
      foreground.onload = null;
      foreground.onerror = null;
      foreground.removeAttribute('src');
    }
    if (backdrop) {
      backdrop.onload = null;
      backdrop.onerror = null;
      backdrop.removeAttribute('src');
    }
    overlay?.remove();
    if (ownsPosition && container.style.position === 'relative') {
      if (previousPosition) {
        container.style.setProperty('position', previousPosition, previousPositionPriority);
      } else {
        container.style.removeProperty('position');
      }
    }
    if (options.bench) delete document.documentElement.dataset.ytaArtwork;
    foreground = null;
    backdrop = null;
    overlay = null;
  };

  try {
    installArtworkStyles(container.ownerDocument);
    if (getComputedStyle(container).position === 'static') {
      container.style.setProperty('position', 'relative');
      ownsPosition = true;
    }

    overlay = container.ownerDocument.createElement('div');
    overlay.className = AUDIO_ARTWORK_CLASS;
    overlay.dataset.generation = String(options.generation);
    overlay.setAttribute('aria-hidden', 'true');

    backdrop = createArtworkImage(container.ownerDocument, 'yta-audio-artwork__backdrop', 'cover');
    foreground = createArtworkImage(container.ownerDocument, 'yta-audio-artwork__art', 'contain');
    overlay.append(backdrop, foreground);
    container.append(overlay);

    const primaryUrl = options.artworkUrl ?? AUDIO_ARTWORK_PLACEHOLDER;
    let usingPlaceholder = primaryUrl === AUDIO_ARTWORK_PLACEHOLDER;
    const load = (url: string) => {
      if (!foreground || !isActive()) return;
      foreground.src = url;
    };
    foreground.onload = () => {
      if (!foreground || !backdrop || !overlay || !isActive()) return;
      if (!usingPlaceholder && foreground.naturalWidth <= PLACEHOLDER_WIDTH_THRESHOLD) {
        usingPlaceholder = true;
        load(AUDIO_ARTWORK_PLACEHOLDER);
        return;
      }
      const resolvedUrl = foreground.currentSrc || foreground.src;
      backdrop.onerror = () => cleanup();
      backdrop.onload = () => {
        if (!foreground || !overlay || !isActive()) return;
        foreground.dataset.loaded = 'true';
        overlay.dataset.visible = 'true';
        if (options.bench) {
          document.documentElement.dataset.ytaArtwork = JSON.stringify({ src: resolvedUrl });
        }
      };
      backdrop.src = resolvedUrl;
    };
    foreground.onerror = () => {
      if (!isActive()) return;
      if (!usingPlaceholder) {
        usingPlaceholder = true;
        load(AUDIO_ARTWORK_PLACEHOLDER);
      } else {
        cleanup();
      }
    };
    load(primaryUrl);
    return cleanup;
  } catch {
    cleanup();
    return () => undefined;
  }
}

function finiteDimension(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isSafeArtworkUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
    );
  } catch {
    return false;
  }
}

function createArtworkImage(
  documentRef: Document,
  className: string,
  fit: 'cover' | 'contain'
): HTMLImageElement {
  const image = documentRef.createElement('img');
  image.className = className;
  image.alt = '';
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  image.style.objectFit = fit;
  image.style.pointerEvents = 'none';
  image.draggable = false;
  return image;
}

function installArtworkStyles(documentRef: Document): void {
  if (documentRef.getElementById(ARTWORK_STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = ARTWORK_STYLE_ID;
  style.textContent = `
    .${AUDIO_ARTWORK_CLASS} {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      background: #0f0f0f;
      opacity: 0;
      transition: opacity 240ms cubic-bezier(.2, 0, 0, 1);
      contain: strict;
    }
    .${AUDIO_ARTWORK_CLASS}[data-visible="true"] { opacity: 1; }
    .yta-audio-artwork__backdrop {
      position: absolute;
      inset: -8%;
      width: 116%;
      height: 116%;
      filter: blur(28px) brightness(.5) saturate(1.1);
      transform: translateZ(0);
    }
    .yta-audio-artwork__art {
      position: absolute;
      inset: 0;
      width: 78%;
      height: 62%;
      margin: auto;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgb(0 0 0 / 50%), 0 16px 48px rgb(0 0 0 / 44%);
      opacity: 0;
      transition: opacity 240ms cubic-bezier(.2, 0, 0, 1);
    }
    .yta-audio-artwork__art[data-loaded="true"] { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .${AUDIO_ARTWORK_CLASS}, .yta-audio-artwork__art { transition-duration: .001ms; }
    }
  `;
  (documentRef.head ?? documentRef.documentElement).append(style);
}
