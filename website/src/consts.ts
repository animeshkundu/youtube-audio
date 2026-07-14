const rawBase = import.meta.env.BASE_URL || '/';
const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;

/** Prefix an internal path with the deploy base so links work on GitHub Pages. */
export const url = (path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}` || '/';
};

export const SITE = {
  name: 'YouTube Audio',
  tagline: 'YouTube, just the sound.',
  description:
    'A Firefox add-on that plays YouTube and YouTube Music as audio only, so your battery and mobile data last longer. No account, no analytics.',
  repo: 'https://github.com/animeshkundu/youtube-audio',
  releases: 'https://github.com/animeshkundu/youtube-audio/releases',
  minFirefox: 128,
};

/** Primary navigation. Home is reached through the logo, so it is not a nav item. */
export const NAV = [
  { label: 'Guide', href: url('/guide/') },
  { label: 'How it works', href: url('/how-it-works/') },
  { label: 'Privacy', href: url('/privacy/') },
];

export const FOOTER_LINKS = [
  {
    heading: 'Product',
    links: [
      { label: 'Install', href: url('/guide/install/') },
      { label: 'Guide', href: url('/guide/') },
      { label: 'How it works', href: url('/how-it-works/') },
      { label: 'Privacy', href: url('/privacy/') },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'Source on GitHub', href: SITE.repo },
      { label: 'Releases', href: SITE.releases },
      { label: 'Report an issue', href: `${SITE.repo}/issues` },
      { label: 'License (GPL-3.0)', href: `${SITE.repo}/blob/master/LICENSE` },
    ],
  },
];

export const DISCLAIMER =
  'Not affiliated with, endorsed by, or sponsored by YouTube or Google. YouTube is a trademark of Google LLC.';
