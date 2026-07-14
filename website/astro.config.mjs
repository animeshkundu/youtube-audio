import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Deploys to https://animeshkundu.github.io/youtube-audio/ on GitHub Pages.
// `base` must match the repo name so asset + link paths resolve in production.
export default defineConfig({
  site: 'https://animeshkundu.github.io',
  base: '/youtube-audio',
  trailingSlash: 'always',
  integrations: [mdx(), sitemap()],
  build: { format: 'directory' },
});
