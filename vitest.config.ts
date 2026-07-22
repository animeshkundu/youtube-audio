import { defineConfig } from 'vitest/config';

const isTargetedUnitRun = process.argv.some((argument) =>
  /(?:^|[/\\])tests[/\\]unit[/\\].+\.test\.tsx?$/.test(argument)
);

export default defineConfig({
  // Mirror the build's compile-time bench flag. Production and the unit suite both run with
  // `__BENCH__` false, so any bench-only branch behaves in tests exactly as it does when shipped.
  define: {
    __BENCH__: 'false',
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'preact',
    },
  },
  test: {
    coverage: {
      include: [
        'src/shared/adblock.ts',
        'src/shared/audiograph.ts',
        'src/shared/lyrics.ts',
        'src/shared/innertube.ts',
        'src/shared/logger.ts',
        'src/shared/redact.ts',
        'src/shared/report.ts',
        'src/shared/sponsorblock.ts',
        'src/shared/status.ts',
        'src/shared/telemetry.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Explicit file runs cannot exercise the full coverage include list. Keep their report useful
      // without applying the repository-wide floor; the unfiltered `npm test` gate still enforces it.
      ...(isTargetedUnitRun
        ? {}
        : {
            thresholds: {
              branches: 90,
              functions: 90,
              lines: 90,
              statements: 90,
            },
          }),
    },
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
});
