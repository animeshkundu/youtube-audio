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

/**
 * Audio + video adaptive formats for the fixture player response. Finite VOD audio formats carry a
 * `contentLength`; a live/DVR edge stream omits it (that omission is how the extension detects live
 * and declines to hijack). See isLiveStream() in src/shared/innertube.ts.
 */
function fixtureAdaptiveFormats(origin, { live = false, videoId = 'FIXTURE0001' } = {}) {
  const media = (itag, mime) =>
    `${origin}/videoplayback?itag=${itag}&mime=${encodeURIComponent(mime)}&source=fixture&videoId=${encodeURIComponent(videoId)}`;
  const finite = (bytes) => (live ? {} : { contentLength: String(bytes) });
  return [
    {
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 131072,
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      audioSampleRate: '44100',
      approxDurationMs: '215000',
      url: media(140, 'audio/mp4'),
      ...finite(3_500_000),
    },
    {
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      bitrate: 160000,
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      audioSampleRate: '48000',
      approxDurationMs: '215000',
      url: media(251, 'audio/webm'),
      ...finite(4_300_000),
    },
    {
      itag: 137,
      mimeType: 'video/mp4; codecs="avc1.640028"',
      bitrate: 2500000,
      width: 1920,
      height: 1080,
      approxDurationMs: '215000',
      url: media(137, 'video/mp4'),
      ...finite(60_000_000),
    },
  ];
}

/** The full fixture InnerTube /player response. */
function fixturePlayerResponse(origin, videoId, opts = {}) {
  const live = !!opts.live;
  const loginRequired = !!opts.loginRequired;
  return {
    responseContext: { serviceTrackingParams: [] },
    playabilityStatus: loginRequired
      ? { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' }
      : { status: 'OK', playableInEmbed: true },
    videoDetails: {
      videoId: videoId || 'FIXTURE0001',
      title: 'Fixture Watch Page',
      author: 'Fixture Artist',
      lengthSeconds: '215',
      // isLive is deliberately omitted for the live case: the bench exercises the extension's
      // contentLength-based live detection (a live-edge audio format has no contentLength). The
      // explicit isLive===true primary-signal path is covered by unit tests.
    },
    streamingData: {
      expiresInSeconds: '21540',
      adaptiveFormats: fixtureAdaptiveFormats(origin, { live, videoId }),
      serverAbrStreamingUrl: `${origin}/videoplayback?abr=1&source=fixture`,
    },
    // Present so ad-related tests have a real shape to observe.
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
  window.ytInitialPlayerResponse = {
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [] },
    adPlacements: [{ adPlacementRenderer: { config: { kind: 'PRE_ROLL' } } }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: { id: 'fixture-player-ad' } }],
  };
</script>
</head>
<body>
  <div id="content">
    <div id="movie_player" class="html5-video-player ytp-hide-controls ended-mode" tabindex="-1">
      <div class="html5-video-container">
        <video class="video-stream html5-main-video" preload="auto" playsinline
               src="/native-video?mime=video/mp4" data-fixture-video="1"></video>
      </div>
      <div class="ytp-gradient-bottom"></div>
      <div class="ytp-chrome-bottom">
        <div class="ytp-progress-bar-container">
          <div class="ytp-progress-bar" role="slider"></div>
        </div>
        <div class="ytp-chrome-controls ytp-left-controls">
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
  <!-- Distraction-removal targets (custom elements render inline; CSS hides them). -->
  <ytd-reel-shelf-renderer id="fixture-shorts">Shorts shelf</ytd-reel-shelf-renderer>
  <ytd-watch-flexy><div id="secondary">Recommendations</div></ytd-watch-flexy>
  <ytd-comments id="fixture-comments">Comments</ytd-comments>
  <script>
    // Record player quality-API calls so the QoL bench can assert forced quality.
    window.__ytaQualityCalls = [];
    (function () {
      var mp = document.getElementById('movie_player');
      if (mp) {
        mp.setPlaybackQualityRange = function (min, max) {
          window.__ytaQualityCalls.push({ min: min, max: max });
        };
        mp.setPlaybackQuality = function (q) {
          window.__ytaQualityCalls.push({ quality: q });
        };
      }
    })();
  </script>
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

/** Read a request body (best effort) so POSTs complete cleanly and /player can see the videoId. */
function drain(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

/**
 * A tiny valid silent WAV (8 s, 8 kHz, 8-bit mono). Firefox decodes and SEEKS WAV
 * reliably, giving the fixture <video> a real timeline so the segment-skip test can
 * assert an actual currentTime seek. ~64 KB; still no third-party codec dependency.
 */
function silentWav(seconds = 8, sampleRate = 8000) {
  const dataSize = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byte rate
  buffer.writeUInt16LE(1, 32); // block align
  buffer.writeUInt16LE(8, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(128, 44); // silence (8-bit unsigned midpoint)
  return buffer;
}

const FIXTURE_WAV = silentWav();

function sendMedia(res, status, buffer) {
  res.writeHead(status, {
    'content-type': 'audio/wav',
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-length': buffer.length,
  });
  res.end(buffer);
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

    // Always read the body so keep-alive sockets don't stall (and /player can see the videoId).
    const body = method === 'POST' || method === 'PUT' ? await drain(req) : '';

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
      let videoId = url.searchParams.get('v') || url.searchParams.get('videoId') || undefined;
      if (!videoId && body) {
        try {
          videoId = JSON.parse(body).videoId;
        } catch {
          /* ignore malformed bodies */
        }
      }
      // Special video-id prefixes keep edge responses deterministic and hermetic.
      const live = typeof videoId === 'string' && videoId.startsWith('LIVE');
      const loginRequired = typeof videoId === 'string' && videoId.startsWith('AUTH');
      return sendJson(
        res,
        200,
        fixturePlayerResponse(origin, videoId, { live, loginRequired })
      );
    }
    if (path.startsWith('/api/skipSegments/')) {
      const videoId = url.searchParams.get('videoID') || undefined;
      return sendJson(res, 200, fixtureSkipSegments(videoId));
    }
    if (path === '/api/get') {
      return sendJson(res, 200, {
        syncedLyrics: '[00:00.00]Fixture opening\n[00:04.00]Fixture chorus',
        plainLyrics: 'Fixture opening\nFixture chorus',
      });
    }
    if (path === '/videoplayback' || path === '/native-video') {
      // A tiny valid silent WAV gives the <video> a real, seekable timeline so the
      // segment-skip test can assert an actual currentTime seek. Still JS-signal-driven
      // (no third-party codec); the URL resolves and the request is logged.
      return sendMedia(res, 200, FIXTURE_WAV);
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
    console.log(JSON.stringify({ origin, port }));
    console.error(`[fixture] listening on ${origin} (watch page: ${origin}/watch)`);
  });
  const shutdown = () => fixture.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
