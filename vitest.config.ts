import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: [
        'src/shared/adblock.ts',
        'src/shared/innertube.ts',
        'src/shared/sponsorblock.ts',
        'src/shared/telemetry.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    include: ['tests/unit/**/*.test.ts'],
  },
});
