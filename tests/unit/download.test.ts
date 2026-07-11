import { describe, expect, it } from 'vitest';

import {
  audioExtensionForItag,
  buildAudioFilename,
  isAllowedAudioUrl,
  isSafeDownloadFilename,
  sanitizeDownloadTitle,
} from '../../src/shared/download';

describe('audio download helpers', () => {
  it('maps supported itags to their playable container extension', () => {
    expect(audioExtensionForItag(140)).toBe('.m4a');
    expect(audioExtensionForItag(251)).toBe('.webm');
    expect(audioExtensionForItag(999)).toBe('.m4a');
  });

  it('sanitizes path separators, controls, reserved characters, and empty titles', () => {
    expect(sanitizeDownloadTitle('  Artist / Track: Live?\n  ')).toBe('Artist - Track- Live-');
    expect(sanitizeDownloadTitle('...')).toBe('YouTube audio');
    expect(buildAudioFilename('Artist \\ Track', 251)).toBe('Artist - Track.webm');
  });

  it('bounds canonical filenames and rejects unsafe names', () => {
    const filename = buildAudioFilename('x'.repeat(300), 140);
    expect(filename).toHaveLength(180);
    expect(filename.endsWith('.m4a')).toBe(true);
    expect(isSafeDownloadFilename(filename)).toBe(true);
    expect(isSafeDownloadFilename('../track.m4a')).toBe(false);
    expect(isSafeDownloadFilename('track.mp3')).toBe(false);
  });

  it('allows only HTTPS googlevideo hosts unless an exact bench origin is supplied', () => {
    expect(isAllowedAudioUrl('https://rr1---sn.example.googlevideo.com/videoplayback')).toBe(true);
    expect(isAllowedAudioUrl('https://googlevideo.com/videoplayback')).toBe(true);
    expect(isAllowedAudioUrl('http://rr1.googlevideo.com/videoplayback')).toBe(false);
    expect(isAllowedAudioUrl('https://googlevideo.com.evil.example/videoplayback')).toBe(false);
    expect(isAllowedAudioUrl('https://youtube.com/watch')).toBe(false);
    expect(isAllowedAudioUrl('not a url')).toBe(false);
    expect(isAllowedAudioUrl('http://127.0.0.1:8000/videoplayback', 'http://127.0.0.1:8000')).toBe(true);
    expect(isAllowedAudioUrl('http://127.0.0.1:9000/videoplayback', 'http://127.0.0.1:8000')).toBe(false);
  });
});
