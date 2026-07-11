export type TelemetryMode = 'conservative' | 'aggressive';

type TelemetryEndpoint = {
  path: string;
  mode: TelemetryMode;
};

const SUPPORTED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export const TELEMETRY_ENDPOINTS: readonly TelemetryEndpoint[] = [
  // Playback quality diagnostics: formats, buffering, dropped frames, and bandwidth.
  { path: '/api/stats/qoe', mode: 'conservative' },
  // Ad attribution reports; not required to serve or play media.
  { path: '/api/stats/atr', mode: 'conservative' },
  // Ad impression statistics; not required to serve or play media.
  { path: '/api/stats/ads', mode: 'conservative' },
  // Ad serving and measurement paths; page playback does not consume their response.
  { path: '/pagead/', mode: 'conservative' },
  // Legacy playback tracking beacon, isolated from media and InnerTube APIs.
  { path: '/ptracking', mode: 'conservative' },
  // Client-side instrumentation timing probe; no playback payload is returned.
  { path: '/csi_204', mode: 'conservative' },
  // Connectivity/timing probe whose normal response carries no content.
  { path: '/generate_204', mode: 'conservative' },
  // Playback position heartbeat. Blocking can impair resume position, so it is opt-in.
  { path: '/api/stats/watchtime', mode: 'aggressive' },
  // Playback-start statistics. Blocking can impair history and resume, so it is opt-in.
  { path: '/api/stats/playback', mode: 'aggressive' },
];

/** Return whether a first-party YouTube URL is safe to cancel under the selected policy. */
export function shouldBlock(url: string, mode: TelemetryMode): boolean {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !SUPPORTED_HOSTS.has(parsed.hostname)) {
      return false;
    }

    return TELEMETRY_ENDPOINTS.some(
      (endpoint) =>
        (endpoint.mode === 'conservative' || mode === 'aggressive') &&
        matchesPath(parsed.pathname, endpoint.path)
    );
  } catch {
    return false;
  }
}

function matchesPath(pathname: string, endpointPath: string): boolean {
  if (endpointPath.endsWith('/')) return pathname.startsWith(endpointPath);
  return pathname === endpointPath || pathname.startsWith(`${endpointPath}/`);
}
