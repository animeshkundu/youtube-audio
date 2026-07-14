import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Consumer-facing guide pages. Deep docs live here as Markdown and inherit the
// site theme through the Doc layout. The public site deliberately carries only
// these pages; specs, ADRs, research, history, and agent instructions stay in
// the GitHub repo for contributors.
const guide = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/guide' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    order: z.number().default(99),
    group: z.string().default('Guide'),
  }),
});

export const collections = { guide };
