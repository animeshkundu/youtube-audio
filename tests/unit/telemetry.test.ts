import { describe, expect, it } from 'vitest';

import { shouldBlock, type TelemetryMode } from '../../src/shared/telemetry';

const conservativeEndpoints = [
  '/api/stats/qoe?event=streamingstats',
  '/api/stats/atr?docid=video',
  '/api/stats/ads',
  '/pagead/conversion/?label=video',
  '/ptracking?cpn=session',
  '/csi_204?c=WEB',
  '/generate_204',
];

const neverBlock = [
  'https://www.youtube.com/youtubei/v1/player?key=api',
  'https://www.youtube.com/youtubei/v1/att/get',
  'https://www.youtube.com/youtubei/v1/att/GenerateIT',
  'https://www.youtube.com/api/jnn/v1/Create',
  'https://www.youtube.com/botguard',
  'https://www.youtube.com/potoken/generate',
  'https://rr1---sn.example.googlevideo.com/videoplayback?mime=audio%2Fwebm',
  'https://www.youtube.com/youtubei/v1/log_event?alt=json',
];

describe('shouldBlock', () => {
  it.each(conservativeEndpoints)('blocks conservative endpoint %s', (path) => {
    expect(shouldBlock(`https://www.youtube.com${path}`, 'conservative')).toBe(true);
  });

  it.each(['youtube.com', 'music.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'])(
    'blocks supported first-party host %s',
    (host) => {
      expect(shouldBlock(`https://${host}/api/stats/qoe`, 'conservative')).toBe(true);
    }
  );

  it.each(neverBlock)('never blocks protected URL %s', (url) => {
    expect(shouldBlock(url, 'conservative')).toBe(false);
    expect(shouldBlock(url, 'aggressive')).toBe(false);
  });

  it.each(['/api/stats/watchtime', '/api/stats/playback?ns=yt'])('gates %s behind aggressive mode', (path) => {
    expect(shouldBlock(`https://www.youtube.com${path}`, 'conservative')).toBe(false);
    expect(shouldBlock(`https://www.youtube.com${path}`, 'aggressive')).toBe(true);
  });

  it.each([
    'not a URL',
    'file:///api/stats/qoe',
    'https://youtube.com.example/api/stats/qoe',
    'https://example.com/api/stats/qoe',
    'https://www.youtube.com/api/stats/qoe-report',
    'https://www.youtube.com/pagead',
    'https://www.youtube.com/watch?q=/api/stats/qoe',
  ])('fails open for malformed, off-host, or near-match URL %s', (url) => {
    expect(shouldBlock(url, 'aggressive')).toBe(false);
  });

  it('accepts only the two explicit policy modes at compile time', () => {
    const modes: TelemetryMode[] = ['conservative', 'aggressive'];
    expect(modes.map((mode) => shouldBlock('https://youtube.com/api/stats/qoe', mode))).toEqual([
      true,
      true,
    ]);
  });
});
