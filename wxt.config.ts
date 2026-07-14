import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

// Single source of truth for the base version: read it from package.json so the packaged
// manifest and the signed XPI filename can never drift apart.
const { version: baseVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version: string };

// Optional pre-release suffix appended to the base version at build time (ADR-0006). A beta build
// sets e.g. BETA_SUFFIX=b1 so the manifest carries a Firefox-toolkit pre-release version
// (`0.0.2.5b1`) that sorts BELOW the clean listed version (`0.0.2.5`). AMO rejects hyphens, so the
// suffix attaches directly with no `-`. Production builds set no BETA_SUFFIX and get the clean
// version; package.json stays the single base. Only the toolkit forms `a`/`b`/`pre`/`rc` + a number
// are accepted so a malformed suffix can never produce an unsortable or AMO-rejected version.
const BETA_SUFFIX = process.env.BETA_SUFFIX ?? '';
if (BETA_SUFFIX && !/^(a|b|pre|rc)\d+$/.test(BETA_SUFFIX)) {
  throw new Error(
    'BETA_SUFFIX must be a Firefox pre-release suffix like b1, a2, pre1, or rc3 (no hyphen; AMO rejects hyphens)'
  );
}
const version = `${baseVersion}${BETA_SUFFIX}`;

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
// Permanent Gecko add-on ID: a single identity for AMO-listed production and the unlisted beta
// channel (ADR-0006, which supersedes ADR-0002's two-identity model). AMO is the sole update
// authority, so production builds omit `update_url`. The bench pins its moz-extension UUID by this
// exact ID (tests/e2e/bench/run-bench.mjs ADDON_ID), so keep the two in lockstep. The env override
// exists only for local experiments.
const FIREFOX_EXTENSION_ID =
  process.env.FIREFOX_EXTENSION_ID ?? '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
// Dormant optional capability (ADR-0006): the self-hosted `update_url` path is RETIRED for
// production and set by no workflow. AMO is the sole update authority, so listed and beta builds
// both omit `update_url`. The flag is retained only for a hypothetical local desktop-only
// self-update experiment; it must never be set when signing a listed build.
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
