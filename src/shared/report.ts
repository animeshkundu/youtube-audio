/**
 * Assembles the human-readable diagnostic report from a closed-schema environment, a projected
 * settings snapshot, saturating counters, and the bounded event buffer. The report never
 * contains an absolute timestamp: event spacing is rendered as a coarse, non-negative bucket
 * relative to the previous event. `redactText` runs over the finished markdown as a last net.
 */

import type { LogContext, StoredEvent } from './logger';
import { redactText } from './redact';

export interface DiagnosticsEnvironment {
  extensionVersion: string;
  browser: 'Firefox' | 'other';
  browserVersion: string;
  os: string;
  manifestVersion: 2 | 3;
}

export interface DiagnosticsStats {
  telemetryBlocked: number;
  adPruned: number;
}

export interface SettingsSnapshot {
  toggles: Record<string, boolean>;
  forceQualityMax: string;
  downloadFormat: string;
  downloadQuality: string;
  equalizerBands: number[];
  segmentSkipCategories: string[];
}

export interface ReportEvent {
  seq: number;
  ctx: LogContext;
  code: string;
  data: Record<string, string | number | boolean>;
  since: string;
  n?: number;
}

export interface ReportBundle {
  markdown: string;
  environment: DiagnosticsEnvironment;
  settings: SettingsSnapshot;
  stats: DiagnosticsStats;
  events: ReportEvent[];
}

export const ISSUE_BASE_URL = 'https://github.com/animeshkundu/youtube-audio/issues/new';

const OS_VALUES = ['android', 'win', 'mac', 'linux', 'openbsd', 'cros', 'fuchsia'] as const;
const QUALITY_VALUES = ['off', '144p', '240p', '360p', '480p', '720p', '1080p'] as const;
const CATEGORY_VALUES = ['sponsor', 'music_offtopic'] as const;
const DOWNLOAD_FORMAT_VALUES = ['auto', 'm4a', 'opus'] as const;
const DOWNLOAD_QUALITY_VALUES = ['auto', 'high', 'medium', 'low'] as const;
const BOOLEAN_SETTING_KEYS = [
  'enabled',
  'audioOnlyEnabled',
  'backgroundPlayEnabled',
  'ghostEnabled',
  'aggressiveTelemetry',
  'adBlockEnabled',
  'segmentSkipEnabled',
  'disableAutoplayNext',
  'hideShorts',
  'hideRecommendations',
  'hideComments',
  'loudnessNormalization',
  'equalizerEnabled',
  'lyricsEnabled',
  'downloadEnabled',
] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Canonicalize the environment to the closed schema, dropping anything unexpected. */
export function sanitizeEnvironment(raw: unknown): DiagnosticsEnvironment {
  const source = record(raw);
  const version = typeof source.extensionVersion === 'string' ? source.extensionVersion : '';
  const browserName = typeof source.browser === 'string' ? source.browser : '';
  const rawVersion = typeof source.browserVersion === 'string' ? source.browserVersion : '';
  const versionMatch = /^(\d{1,4})(?:\.(\d{1,4}))?/.exec(rawVersion);
  const os = typeof source.os === 'string' ? source.os : '';
  return {
    extensionVersion: /^\d+(\.\d+){0,3}$/.test(version) ? version.slice(0, 24) : 'unknown',
    browser: browserName.includes('Firefox') ? 'Firefox' : 'other',
    browserVersion: versionMatch ? `${versionMatch[1]}.${versionMatch[2] ?? '0'}` : 'unknown',
    os: (OS_VALUES as readonly string[]).includes(os) ? os : 'other',
    manifestVersion: source.manifestVersion === 3 ? 3 : 2,
  };
}

/** Project the settings object to only its known keys, coerced to safe primitive shapes. */
export function sanitizeSettingsSnapshot(raw: unknown): SettingsSnapshot {
  const source = record(raw);
  const toggles: Record<string, boolean> = {};
  for (const key of BOOLEAN_SETTING_KEYS) toggles[key] = source[key] === true;
  const quality = source.forceQualityMax;
  const bands = Array.isArray(source.equalizerBands) ? source.equalizerBands : [];
  const categories = Array.isArray(source.segmentSkipCategories)
    ? source.segmentSkipCategories
    : [];
  return {
    toggles,
    forceQualityMax:
      typeof quality === 'string' && (QUALITY_VALUES as readonly string[]).includes(quality)
        ? quality
        : 'off',
    downloadFormat:
      typeof source.downloadFormat === 'string' &&
      (DOWNLOAD_FORMAT_VALUES as readonly string[]).includes(source.downloadFormat)
        ? source.downloadFormat
        : 'auto',
    downloadQuality:
      typeof source.downloadQuality === 'string' &&
      (DOWNLOAD_QUALITY_VALUES as readonly string[]).includes(source.downloadQuality)
        ? source.downloadQuality
        : 'auto',
    equalizerBands: bands
      .slice(0, 5)
      .map((band) =>
        typeof band === 'number' && Number.isFinite(band) ? Math.min(12, Math.max(-12, band)) : 0
      ),
    segmentSkipCategories: categories.filter(
      (category): category is string =>
        typeof category === 'string' && (CATEGORY_VALUES as readonly string[]).includes(category)
    ),
  };
}

/** Render a non-negative inter-event delta as a coarse bucket. Never exposes absolute time. */
export function formatDeltaBucket(deltaMs: number): string {
  const delta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
  if (delta < 1_000) return '<1s';
  if (delta < 5_000) return '1-5s';
  if (delta < 30_000) return '5-30s';
  if (delta < 300_000) return '30s-5m';
  return '>5m';
}

/** The bare GitHub new-issue URL. Carries only a static title and the bug label. */
export function buildIssueUrl(): string {
  const params = new URLSearchParams({ labels: 'bug', title: 'YouTube Audio: issue report' });
  return `${ISSUE_BASE_URL}?${params.toString()}`;
}

function formatDetail(data: Record<string, string | number | boolean>): string {
  const parts = Object.entries(data).map(([key, value]) => `${key}=${String(value)}`);
  // The values are already closed-schema, but run the defensive scrub over the event detail
  // (the only place a value could ever carry a URL- or id-shaped string) as belt and suspenders.
  return redactText(parts.join(' '));
}

function toReportEvents(events: readonly StoredEvent[]): ReportEvent[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  let previous: number | null = null;
  return ordered.map((event) => {
    const since = previous === null ? '-' : formatDeltaBucket(event.ts - previous);
    previous = event.ts;
    return {
      seq: event.seq,
      ctx: event.ctx,
      code: event.code,
      data: event.data,
      since,
      ...(typeof event.n === 'number' && event.n > 1 ? { n: event.n } : {}),
    };
  });
}

export interface ReportInput {
  environment: unknown;
  settings: unknown;
  stats: unknown;
  events: readonly StoredEvent[];
}

/** Build the report bundle: canonical environment, projected settings, and a redacted markdown. */
export function assembleReport(input: ReportInput): ReportBundle {
  const environment = sanitizeEnvironment(input.environment);
  const settings = sanitizeSettingsSnapshot(input.settings);
  const statsSource = record(input.stats);
  const stats: DiagnosticsStats = {
    telemetryBlocked: toCount(statsSource.telemetryBlocked),
    adPruned: toCount(statsSource.adPruned),
  };
  const events = toReportEvents(input.events);

  const lines: string[] = [];
  lines.push('# YouTube Audio diagnostics');
  lines.push('');
  lines.push('This report was built on your device. It contains no video identifiers, URLs, or');
  lines.push('search terms, only feature outcomes and your settings.');
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push(`- Extension: ${environment.extensionVersion}`);
  lines.push(`- Browser: ${environment.browser} ${environment.browserVersion}`);
  lines.push(`- OS: ${environment.os}`);
  lines.push(`- Manifest: v${environment.manifestVersion}`);
  lines.push('');
  lines.push('## Settings');
  lines.push('');
  for (const [key, value] of Object.entries(settings.toggles)) {
    lines.push(`- ${key}: ${value ? 'on' : 'off'}`);
  }
  lines.push(`- forceQualityMax: ${settings.forceQualityMax}`);
  lines.push(`- downloadFormat: ${settings.downloadFormat}`);
  lines.push(`- downloadQuality: ${settings.downloadQuality}`);
  lines.push(`- equalizerBands: ${settings.equalizerBands.join(', ') || 'flat'}`);
  lines.push(`- segmentSkipCategories: ${settings.segmentSkipCategories.join(', ') || 'none'}`);
  lines.push('');
  lines.push('## Activity');
  lines.push('');
  lines.push(`- Telemetry requests blocked: ${stats.telemetryBlocked}`);
  lines.push(`- Ad responses pruned: ${stats.adPruned}`);
  lines.push('');
  lines.push('## Recent events');
  lines.push('');
  if (events.length === 0) {
    lines.push('_No events recorded yet._');
  } else {
    lines.push('| # | +time | ctx | event | detail |');
    lines.push('| - | ----- | --- | ----- | ------ |');
    for (const event of events) {
      const detail = event.n
        ? `${formatDetail(event.data)} (x${event.n})`
        : formatDetail(event.data);
      lines.push(`| ${event.seq} | ${event.since} | ${event.ctx} | ${event.code} | ${detail} |`);
    }
  }
  lines.push('');

  const markdown = lines.join('\n');
  return { markdown, environment, settings, stats, events };
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.trunc(value), 1_000_000);
}
