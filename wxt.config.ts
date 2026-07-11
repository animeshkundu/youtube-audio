import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

const YOUTUBE_MATCHES = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
];

// Integration-bench flag. When BENCH=1, the content script ALSO matches the local
// fixture host so the extension can be exercised against tests/e2e/bench/fixture-server.mjs.
// Production builds (BENCH unset) never include these hosts. See tests/e2e/bench/.
const BENCH = process.env.BENCH === '1';
const BENCH_MATCHES = ['http://127.0.0.1/*', 'http://localhost/*'];

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  vite: () => ({
    plugins: [preact()],
    // Compile-time flag, ALWAYS defined so it is dead-code-eliminated (to `false`) in
    // production and stripped from the bundle. Never left as an undefined global.
    define: {
      __BENCH__: JSON.stringify(BENCH),
    },
  }),
  manifest: ({ manifestVersion }) => ({
    name: 'YouTube Audio',
    description: 'Listen to YouTube and YouTube Music without downloading video.',
    version: '0.0.2.5',
    permissions: [
      'tabs',
      'webRequest',
      'webRequestBlocking',
      'storage',
      'downloads',
      ...(manifestVersion === 2 ? ['*://*.googlevideo.com/*'] : []),
    ],
    host_permissions: manifestVersion === 3 ? ['*://*.googlevideo.com/*'] : undefined,
    browser_specific_settings: {
      gecko: {
        id: 'youtube-audio@local',
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {},
    },
    // Add with their features, after explicit user disclosure:
    // https://sponsor.ajay.app/*
    // https://lrclib.net/*
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      const contentScript = manifest.content_scripts?.find((entry) =>
        entry.matches?.some((match) => YOUTUBE_MATCHES.includes(match))
      );
      if (contentScript) {
        contentScript.matches = BENCH ? [...YOUTUBE_MATCHES, ...BENCH_MATCHES] : YOUTUBE_MATCHES;
      }
    },
  },
});
