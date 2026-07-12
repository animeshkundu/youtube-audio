import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

// Single source of truth for the version: read it from package.json so the packaged manifest,
// the signed XPI filename, and the self-hosted updates.json can never drift apart.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version: string };

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
// Gecko add-on ID. `@local` is a placeholder that signs fine for the self-hosted/unlisted channel
// but is NOT owner-controlled: choose a permanent, distinct ID (recommended: an owner-controlled
// domain form such as youtube-audio@animeshkundu.github.io) BEFORE the first release, since changing
// it after installs exist orphans them (ADR-0002). The bench pins its moz-extension UUID by this
// exact ID (tests/e2e/bench/run-bench.mjs ADDON_ID), so keep the two in lockstep when finalizing.
const FIREFOX_EXTENSION_ID = process.env.FIREFOX_EXTENSION_ID ?? 'youtube-audio@local';
const SELF_HOSTED_UPDATE_URL = process.env.SELF_HOSTED_UPDATE_URL;

if (SELF_HOSTED_UPDATE_URL && !SELF_HOSTED_UPDATE_URL.startsWith('https://')) {
  throw new Error('SELF_HOSTED_UPDATE_URL must use HTTPS');
}

// Extension icons. The PNGs live in public/icon/<size>.png; WXT copies the
// public/ directory to the build root, so the manifest references them by the
// root-relative path icon/<size>.png. Declared explicitly (WXT would also
// auto-discover this naming convention) so the icon set stays visible and
// version-controlled rather than depending on the public-asset scan.
const ICONS = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  96: 'icon/96.png',
  128: 'icon/128.png',
};

// Toolbar action button icon (the small clickable icon shown in the toolbar).
const ACTION_ICON = {
  16: 'icon/16.png',
  32: 'icon/32.png',
};

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
    version,
    icons: ICONS,
    // The popup entrypoint contributes default_title (from its <title>) and
    // default_popup; declaring default_icon here adds the toolbar button icon
    // without clobbering those. MV2 uses browser_action, MV3 uses action.
    ...(manifestVersion === 2
      ? { browser_action: { default_icon: ACTION_ICON } }
      : { action: { default_icon: ACTION_ICON } }),
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
