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
const SPONSORBLOCK_ORIGIN = 'https://sponsor.ajay.app/*';
const LRCLIB_ORIGIN = 'https://lrclib.net/*';
const FIREFOX_EXTENSION_ID = process.env.FIREFOX_EXTENSION_ID ?? 'youtube-audio@local';
const SELF_HOSTED_UPDATE_URL = process.env.SELF_HOSTED_UPDATE_URL;

if (SELF_HOSTED_UPDATE_URL && !SELF_HOSTED_UPDATE_URL.startsWith('https://')) {
  throw new Error('SELF_HOSTED_UPDATE_URL must use HTTPS');
}

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
      ...(manifestVersion === 2
        ? [
            ...YOUTUBE_MATCHES,
            '*://*.googlevideo.com/*',
            SPONSORBLOCK_ORIGIN,
            LRCLIB_ORIGIN,
            ...(BENCH ? BENCH_MATCHES : []),
          ]
        : []),
    ],
    host_permissions:
      manifestVersion === 3
        ? [
            ...YOUTUBE_MATCHES,
            '*://*.googlevideo.com/*',
            SPONSORBLOCK_ORIGIN,
            LRCLIB_ORIGIN,
            ...(BENCH ? BENCH_MATCHES : []),
          ]
        : undefined,
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_EXTENSION_ID,
        strict_min_version: '128.0',
        ...(SELF_HOSTED_UPDATE_URL ? { update_url: SELF_HOSTED_UPDATE_URL } : {}),
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {},
    },
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
