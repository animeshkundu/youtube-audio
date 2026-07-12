import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '../../src/shared/logger';
import {
  assembleReport,
  buildIssueUrl,
  formatDeltaBucket,
  ISSUE_BASE_URL,
  sanitizeEnvironment,
  sanitizeSettingsSnapshot,
} from '../../src/shared/report';

describe('sanitizeEnvironment', () => {
  it('canonicalizes a well-formed environment', () => {
    expect(
      sanitizeEnvironment({
        extensionVersion: '0.0.2.5',
        browser: 'Mozilla Firefox',
        browserVersion: '128.0.2',
        os: 'android',
        manifestVersion: 3,
      })
    ).toEqual({
      extensionVersion: '0.0.2.5',
      browser: 'Firefox',
      browserVersion: '128.0',
      os: 'android',
      manifestVersion: 3,
    });
  });

  it('falls back to safe defaults for junk input', () => {
    expect(
      sanitizeEnvironment({ extensionVersion: 'x', browserVersion: 'nope', os: 'plan9' })
    ).toEqual({
      extensionVersion: 'unknown',
      browser: 'other',
      browserVersion: 'unknown',
      os: 'other',
      manifestVersion: 2,
    });
    expect(sanitizeEnvironment(null).os).toBe('other');
  });
});

describe('sanitizeSettingsSnapshot', () => {
  it('projects only known keys and coerces values', () => {
    const snapshot = sanitizeSettingsSnapshot({
      enabled: true,
      audioOnlyEnabled: false,
      forceQualityMax: '720p',
      equalizerBands: [20, -20, 3, 'x', 1, 9],
      segmentSkipCategories: ['sponsor', 'evil', 'music_offtopic'],
      secretField: 'my-search-history',
    });
    expect(snapshot.toggles.enabled).toBe(true);
    expect(snapshot.toggles.audioOnlyEnabled).toBe(false);
    expect(snapshot.forceQualityMax).toBe('720p');
    expect(snapshot.equalizerBands).toEqual([12, -12, 3, 0, 1]);
    expect(snapshot.segmentSkipCategories).toEqual(['sponsor', 'music_offtopic']);
    expect(JSON.stringify(snapshot)).not.toContain('my-search-history');
  });

  it('defaults an invalid quality cap to off', () => {
    expect(sanitizeSettingsSnapshot({ forceQualityMax: '9000p' }).forceQualityMax).toBe('off');
    expect(sanitizeSettingsSnapshot(null).forceQualityMax).toBe('off');
  });
});

describe('formatDeltaBucket', () => {
  it('buckets deltas and clamps negatives to the smallest bucket', () => {
    expect(formatDeltaBucket(-500)).toBe('<1s');
    expect(formatDeltaBucket(0)).toBe('<1s');
    expect(formatDeltaBucket(2_000)).toBe('1-5s');
    expect(formatDeltaBucket(10_000)).toBe('5-30s');
    expect(formatDeltaBucket(120_000)).toBe('30s-5m');
    expect(formatDeltaBucket(600_000)).toBe('>5m');
  });
});

describe('buildIssueUrl', () => {
  it('is a bare new-issue URL with only a static title and bug label', () => {
    const url = buildIssueUrl();
    expect(url.startsWith(ISSUE_BASE_URL)).toBe(true);
    expect(url).toContain('labels=bug');
    expect(url).not.toContain('body=');
    expect(url.length).toBeLessThan(200);
  });
});

describe('assembleReport', () => {
  const events: StoredEvent[] = [
    { seq: 1, ts: 1_000, ctx: 'page', code: 'playback.status', data: { status: 'fetching' } },
    {
      seq: 2,
      ts: 4_000,
      ctx: 'page',
      code: 'playback.status',
      data: { status: 'fallback', reason: 'no-direct-audio' },
    },
    { seq: 3, ts: 40_000, ctx: 'bg', code: 'sponsor.result', data: { ok: true, count: 2 } },
  ];

  const input = {
    environment: {
      extensionVersion: '0.0.2.5',
      browser: 'Firefox',
      browserVersion: '128.0',
      os: 'mac',
      manifestVersion: 2,
    },
    settings: { enabled: true, adBlockEnabled: true, forceQualityMax: 'off', equalizerBands: [] },
    stats: { telemetryBlocked: 7, adPruned: 1 },
    events,
  };

  it('renders environment, settings, activity, and an ordered events table', () => {
    const bundle = assembleReport(input);
    expect(bundle.markdown).toContain('# YouTube Audio diagnostics');
    expect(bundle.markdown).toContain('Extension: 0.0.2.5');
    expect(bundle.markdown).toContain('Browser: Firefox 128.0');
    expect(bundle.markdown).toContain('Telemetry requests blocked: 7');
    expect(bundle.markdown).toContain('playback.status');
    expect(bundle.markdown).toContain('no-direct-audio');
    const firstRow = bundle.markdown.indexOf('| 1 |');
    const secondRow = bundle.markdown.indexOf('| 2 |');
    expect(firstRow).toBeGreaterThan(-1);
    expect(secondRow).toBeGreaterThan(firstRow);
    expect(bundle.events[0]!.since).toBe('-');
    expect(bundle.events[1]!.since).toBe('1-5s');
    expect(bundle.events[2]!.since).toBe('30s-5m');
  });

  it('never exports an absolute timestamp', () => {
    const bundle = assembleReport(input);
    expect(bundle.markdown).not.toContain('4000');
    expect(bundle.markdown).not.toContain('40000');
    expect(Object.keys(bundle.events[0]!)).not.toContain('ts');
  });

  it('redacts PII if any value ever slipped into an event field', () => {
    const leaky: StoredEvent = {
      seq: 9,
      ts: 5_000,
      ctx: 'page',
      code: 'playback.status',
      data: {
        status: 'fallback',
        reason: 'https://x.googlevideo.com/videoplayback?videoId=dQw4w9WgXcQ' as 'live',
      },
    };
    const bundle = assembleReport({ ...input, events: [leaky] });
    expect(bundle.markdown).not.toContain('dQw4w9WgXcQ');
    expect(bundle.markdown).not.toContain('videoplayback');
  });

  it('handles an empty event list', () => {
    const bundle = assembleReport({ ...input, events: [] });
    expect(bundle.markdown).toContain('_No events recorded yet._');
  });

  it('renders a repeat count for coalesced events', () => {
    const repeated: StoredEvent = {
      seq: 5,
      ts: 1_000,
      ctx: 'page',
      code: 'spa.rearm',
      data: {},
      n: 7,
    };
    const bundle = assembleReport({ ...input, events: [repeated] });
    expect(bundle.markdown).toContain('(x7)');
    expect(bundle.events[0]!.n).toBe(7);
  });
});
