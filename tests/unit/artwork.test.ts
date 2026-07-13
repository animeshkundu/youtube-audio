// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  AUDIO_ARTWORK_CLASS,
  AUDIO_ARTWORK_PLACEHOLDER,
  pickArtworkUrl,
  showArtworkOverlay,
} from '../../src/shared/artwork';

/** Build a player response carrying a thumbnail set (the only shape pickArtworkUrl reads). */
function responseWithThumbnails(thumbnails: unknown): unknown {
  return { videoDetails: { thumbnail: { thumbnails } } };
}

describe('pickArtworkUrl', () => {
  it('selects the widest valid thumbnail regardless of array order', () => {
    const response = responseWithThumbnails([
      { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 },
      { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg', width: 1280, height: 720 },
      { url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120, height: 90 },
    ]);
    expect(pickArtworkUrl(response)).toBe('https://i.ytimg.com/vi/x/maxresdefault.jpg');
  });

  it('returns null when there is no thumbnail data', () => {
    expect(pickArtworkUrl(null)).toBeNull();
    expect(pickArtworkUrl({})).toBeNull();
    expect(pickArtworkUrl({ videoDetails: {} })).toBeNull();
    expect(pickArtworkUrl(responseWithThumbnails([]))).toBeNull();
    expect(pickArtworkUrl(responseWithThumbnails('nope'))).toBeNull();
  });

  it('skips unsafe (non-https) thumbnail URLs and returns null when none remain', () => {
    const response = responseWithThumbnails([
      { url: 'http://evil.example/leak.jpg', width: 1280, height: 720 },
      { url: 'ftp://x/y.jpg', width: 800, height: 600 },
      { url: 'javascript:alert(1)', width: 999, height: 999 },
    ]);
    expect(pickArtworkUrl(response)).toBeNull();
  });

  it('prefers a safe wide thumbnail over an unsafe wider one', () => {
    const response = responseWithThumbnails([
      { url: 'http://evil.example/huge.jpg', width: 4000, height: 3000 },
      { url: 'https://i.ytimg.com/vi/x/sd.jpg', width: 640, height: 480 },
    ]);
    expect(pickArtworkUrl(response)).toBe('https://i.ytimg.com/vi/x/sd.jpg');
  });
});

describe('showArtworkOverlay', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getElementById('yta-audio-artwork-style')?.remove();
  });

  function mountVideo(): HTMLVideoElement {
    const container = document.createElement('div');
    const video = document.createElement('video');
    container.append(video);
    document.body.append(container);
    return video;
  }

  it('mounts a pointer-events-none overlay as the media container last child', () => {
    const video = mountVideo();
    const cleanup = showArtworkOverlay(video, {
      artworkUrl: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
      generation: 1,
      isCurrent: () => true,
    });
    const overlay = video.parentElement?.querySelector(`.${AUDIO_ARTWORK_CLASS}`);
    expect(overlay).toBeTruthy();
    expect(overlay).toBe(video.parentElement?.lastElementChild);
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    // The overlay never intercepts pointer events: the container carries pointer-events:none via the
    // injected class, and each image sets it inline as a defense in depth.
    const art = overlay?.querySelector('img.yta-audio-artwork__art') as HTMLImageElement | null;
    expect(art?.style.pointerEvents).toBe('none');
    cleanup();
  });

  it('cleanup removes the overlay and clears image sources', () => {
    const video = mountVideo();
    const cleanup = showArtworkOverlay(video, {
      artworkUrl: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
      generation: 1,
      isCurrent: () => true,
    });
    expect(video.parentElement?.querySelector(`.${AUDIO_ARTWORK_CLASS}`)).toBeTruthy();
    cleanup();
    expect(video.parentElement?.querySelector(`.${AUDIO_ARTWORK_CLASS}`)).toBeNull();
  });

  it('falls back to the bundled placeholder when no artwork URL is available', () => {
    const video = mountVideo();
    const cleanup = showArtworkOverlay(video, {
      artworkUrl: null,
      generation: 1,
      isCurrent: () => true,
    });
    const art = video.parentElement?.querySelector(
      `.${AUDIO_ARTWORK_CLASS} img.yta-audio-artwork__art`
    ) as HTMLImageElement | null;
    expect(art?.getAttribute('src')).toBe(AUDIO_ARTWORK_PLACEHOLDER);
    // The placeholder is an inline data: URL, so it is a page image with no network egress.
    expect(AUDIO_ARTWORK_PLACEHOLDER.startsWith('data:image/svg+xml')).toBe(true);
    cleanup();
  });

  it('is a fail-open no-op when the media element has no container', () => {
    const orphan = document.createElement('video');
    const cleanup = showArtworkOverlay(orphan, {
      artworkUrl: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
      generation: 1,
      isCurrent: () => true,
    });
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('mounts into the player root and after the video container on the real YouTube layout', () => {
    // Real YouTube nests the <video> inside a zero-height `.html5-video-container` within the
    // `.html5-video-player` root. The overlay must land in the PLAYER ROOT (which has the real box),
    // inserted right AFTER the video container so it paints above the video but below the control
    // chrome that follows it in DOM order — never inside the zero-height wrapper (the black-rect bug).
    const player = document.createElement('div');
    player.className = 'html5-video-player';
    const videoContainer = document.createElement('div');
    videoContainer.className = 'html5-video-container';
    const video = document.createElement('video');
    videoContainer.append(video);
    const chrome = document.createElement('div');
    chrome.className = 'ytp-chrome-bottom';
    player.append(videoContainer, chrome);
    document.body.append(player);

    const cleanup = showArtworkOverlay(video, {
      artworkUrl: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
      generation: 1,
      isCurrent: () => true,
    });

    const overlay = player.querySelector(`.${AUDIO_ARTWORK_CLASS}`);
    expect(overlay).toBeTruthy();
    expect(overlay?.parentElement).toBe(player); // mounted in the player root, not the 0-height wrapper
    expect(videoContainer.querySelector(`.${AUDIO_ARTWORK_CLASS}`)).toBeNull();
    expect(videoContainer.nextElementSibling).toBe(overlay); // above the video
    expect(chrome.previousElementSibling).toBe(overlay); // below the control chrome
    cleanup();
    expect(player.querySelector(`.${AUDIO_ARTWORK_CLASS}`)).toBeNull();
  });
});
