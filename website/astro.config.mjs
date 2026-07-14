import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Deploys to https://animesh.kundus.in/youtube-audio/ (custom domain for animeshkundu.github.io)
// on GitHub Pages. `base` matches the repo name so asset + link paths resolve under the subpath.
export default defineConfig({
  site: 'https://animesh.kundus.in',
  base: '/youtube-audio',
  trailingSlash: 'always',
  integrations: [mdx(), sitemap()],
  build: { format: 'directory' },
});
