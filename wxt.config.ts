import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

const YOUTUBE_MATCHES = [
  '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*',
  '*://music.youtube.com/*',
  '*://m.youtube.com/*',
];

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  vite: () => ({
    plugins: [preact()],
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
      if (contentScript) contentScript.matches = YOUTUBE_MATCHES;
    },
  },
});
