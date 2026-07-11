/**
 * Hermetic fixture server for the YouTube Audio integration bench.
 *
 * A tiny node:http server bound to 127.0.0.1 on an ephemeral port. It impersonates
 * just enough of YouTube's surface for the extension to act on, deterministically and
 * without any live network:
 *
 *   GET  /  (and /watch)            -> a fake watch page: a real <video>, a `ytcfg` stub
 *                                      exposing INNERTUBE_API_KEY, and the `.html5-video-player`
 *                                      / `.ytp-*` container classes the extension keys on.
 *   POST /youtubei/v1/player        -> FIXTURE InnerTube player JSON: streamingData.adaptiveFormats
 *                                      (audio itag 140 + 251, one video itag), adPlacements,
 *                                      and playerConfig.audioConfig.loudnessDb.
 *   GET  /api/skipSegments/:hash    -> FIXTURE SponsorBlock segments.
 *   GET  /videoplayback             -> a media stub (googlevideo stand-in).
 *   POST /youtubei/v1/log_event     -> telemetry stub (204).
 *   /api/stats/qoe                  -> telemetry stub (204).
 *
 * Every request (method + path + timestamp) is recorded. The log is how tests assert
 * observable facts about traffic: "telemetry fired 0 times", "a request was blocked",
 * "the player endpoint was hit exactly once".
 *
 *   GET  /__requests                -> JSON snapshot of the request log.
 *   POST /__reset                   -> clear the request log.
 *
 * The introspection endpoints (`/__*`) are intentionally NOT logged, so they never
 * pollute the traffic assertions.
 *
 * Usage as a module:
 *   const fixture = createFixtureServer();
 *   const { origin, port } = await fixture.start();
 *   // ... drive a browser at `${origin}/watch?v=<id>` ...
 *   await fixture.close();
 *
 * Usage standalone (prints the origin and stays up):
 *   node tests/e2e/bench/fixture-server.mjs
 */

import http from 'node:http';

/** Audio + video adaptive formats for the fixture player response. */
function fixtureAdaptiveFormats(origin) {
  const media = (itag, mime) =>
    `${origin}/videoplayback?itag=${itag}&mime=${encodeURIComponent(mime)}&source=fixture`;
  return [
    {
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 131072,
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      audioSampleRate: '44100',
      approxDurationMs: '215000',
      url: media(140, 'audio/mp4'),
    },
    {
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      bitrate: 160000,
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      audioSampleRate: '48000',
      approxDurationMs: '215000',
      url: media(251, 'audio/webm'),
    },
    {
      itag: 137,
      mimeType: 'video/mp4; codecs="avc1.640028"',
      bitrate: 2500000,
      width: 1920,
      height: 1080,
      approxDurationMs: '215000',
      url: media(137, 'video/mp4'),
    },
  ];
}

/** The full fixture InnerTube /player response. */
function fixturePlayerResponse(origin, videoId) {
  return {
    responseContext: { serviceTrackingParams: [] },
    playabilityStatus: { status: 'OK', playableInEmbed: true },
    videoDetails: {
      videoId: videoId || 'FIXTURE0001',
      title: 'Fixture Watch Page',
      lengthSeconds: '215',
      isLive: false,
      isLiveContent: false,
    },
    streamingData: {
      expiresInSeconds: '21540',
      adaptiveFormats: fixtureAdaptiveFormats(origin),
      serverAbrStreamingUrl: `${origin}/videoplayback?abr=1&source=fixture`,
    },
    // Present so ad-related tests have a real shape to observe; the extension does not block ads.
    adPlacements: [
      {
        adPlacementRenderer: {
          config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_START' } },
          renderer: { adBreakServiceRenderer: { prefetchMilliseconds: '5000' } },
        },
      },
    ],
    playerConfig: {
      audioConfig: {
        loudnessDb: -8.5,
        perceptualLoudnessDb: -22.5,
        enablePerFormatLoudness: true,
      },
    },
  };
}

/** Fixture SponsorBlock segments for the hash-prefix privacy endpoint. */
function fixtureSkipSegments(videoId) {
  return [
    {
      videoID: videoId || 'FIXTURE0001',
      hash: '0000fixturehashprefix',
      segments: [
        {
          segment: [0, 5.25],
          category: 'sponsor',
          actionType: 'skip',
          UUID: 'fixture-sponsor-uuid-0001',
          locked: 1,
          votes: 10,
        },
        {
          segment: [180.5, 195.0],
          category: 'outro',
          actionType: 'skip',
          UUID: 'fixture-outro-uuid-0001',
          locked: 0,
          votes: 3,
        },
      ],
    },
  ];
}

/** The fake YouTube watch page. Static except for the origin-derived beacon target. */
function watchPageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fixture Watch Page</title>
<script>
  // Minimal ytcfg stub. The extension reads INNERTUBE_API_KEY (and clientName/version) from here.
  window.ytcfg = (function () {
    var data = {
      INNERTUBE_API_KEY: 'FIXTURE_INNERTUBE_API_KEY',
      INNERTUBE_CONTEXT_CLIENT_NAME: 1,
      INNERTUBE_CLIENT_VERSION: '2.99999999.00.00',
      LOGGED_IN: false,
      PLAYER_JS_URL: '/s/player/fixture/player_ias.vflset/en_US/base.js',
    };
    return {
      data_: data,
      get: function (key, def) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : def; },
      set: function (obj) { if (obj) Object.assign(data, obj); },
    };
  })();
  window.ytInitialPlayerResponse = { playabilityStatus: { status: 'OK' } };
</script>
</head>
<body>
  <div id="content">
    <div id="movie_player" class="html5-video-player ytp-hide-controls ended-mode" tabindex="-1">
      <div class="html5-video-container">
        <video class="video-stream html5-main-video" preload="none" playsinline
               data-fixture-video="1"></video>
      </div>
      <div class="ytp-gradient-bottom"></div>
      <div class="ytp-chrome-bottom">
        <div class="ytp-progress-bar-container">
          <div class="ytp-progress-bar" role="slider"></div>
        </div>
        <div class="ytp-chrome-controls">
          <button class="ytp-play-button ytp-button" aria-label="Play"></button>
          <div class="ytp-time-display">
            <span class="ytp-time-current">0:00</span>
            <span class="ytp-time-separator"> / </span>
            <span class="ytp-time-duration">3:35</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    // On load the fixture page fires the same telemetry beacons a real watch page emits.
    // The bench uses this to prove the request log records traffic (and, for features,
    // to assert the extension blocked them: "telemetry fired 0 times").
    window.addEventListener('load', function () {
      try {
        fetch('/youtubei/v1/log_event?fixture=1', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'streaming_stats', fixture: true }),
        }).catch(function () {});
      } catch (e) {}
      try {
        fetch('/api/stats/qoe?event=streamingstats&fixture=1').catch(function () {});
      } catch (e) {}
      document.documentElement.setAttribute('data-fixture-ready', '1');
    });
  </script>
</body>
</html>`;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    'content-type': contentType || 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Drain a request body (best effort) so POSTs complete cleanly. */
function drain(req) {
  return new Promise((resolve) => {
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
    });
    req.on('end', () => resolve(size));
    req.on('error', () => resolve(size));
  });
}

export function createFixtureServer() {
  /** @type {{ method: string, path: string, query: string, ts: number }[]} */
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '127.0.0.1';
    const origin = `http://${host}`;
    const url = new URL(req.url || '/', origin);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Introspection endpoints are control-plane; never record them.
    const isIntrospection = path.startsWith('/__');
    if (!isIntrospection) {
      requests.push({ method, path, query: url.search, ts: Date.now() });
    }

    // Always drain the body so keep-alive sockets don't stall.
    if (method === 'POST' || method === 'PUT') await drain(req);

    // --- Introspection -----------------------------------------------------
    if (path === '/__requests') {
      return sendJson(res, 200, { count: requests.length, requests });
    }
    if (path === '/__reset') {
      requests.length = 0;
      return sendJson(res, 200, { ok: true });
    }

    // --- Fake YouTube surface ---------------------------------------------
    if (path === '/' || path === '/watch' || path === '/index.html') {
      return sendText(res, 200, watchPageHtml(), 'text/html; charset=utf-8');
    }
    if (path === '/youtubei/v1/player') {
      const videoId = url.searchParams.get('v') || url.searchParams.get('videoId') || undefined;
      return sendJson(res, 200, fixturePlayerResponse(origin, videoId));
    }
    if (path.startsWith('/api/skipSegments/')) {
      const videoId = url.searchParams.get('videoID') || undefined;
      return sendJson(res, 200, fixtureSkipSegments(videoId));
    }
    if (path === '/videoplayback') {
      // Media stub. Not a decodable stream (the bench uses JS-driven signals, not real
      // media decoding); it exists so the URL resolves and the request is logged.
      return sendText(res, 200, 'FIXTURE_MEDIA_STUB', 'application/octet-stream');
    }
    if (path === '/youtubei/v1/log_event' || path.startsWith('/api/stats/')) {
      // Telemetry endpoints: succeed with no content.
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      return res.end();
    }

    // --- Fallback ----------------------------------------------------------
    return sendText(res, 404, 'fixture: not found', 'text/plain; charset=utf-8');
  });

  return {
    server,
    /** Start listening on an ephemeral 127.0.0.1 port. Resolves with { origin, port }. */
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          resolve({ origin: `http://127.0.0.1:${port}`, port });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    getRequests() {
      return requests.slice();
    },
    reset() {
      requests.length = 0;
    },
  };
}

// Standalone entry: start and stay up, printing the origin for manual poking.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = createFixtureServer();
  fixture.start().then(({ origin, port }) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ origin, port }));
    console.error(`[fixture] listening on ${origin} (watch page: ${origin}/watch)`);
  });
  const shutdown = () => fixture.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
