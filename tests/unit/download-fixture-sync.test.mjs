// @vitest-environment node
// Lockstep between the download-fixture video details and the m5 bench expectation (SPEC-025).
// A filename-format change once shipped without updating the bench assertion, failing the
// browser lane instead of the unit gate. This test derives the expected m5 filename from the
// REAL builder plus the REAL fixture values and proves the bench asserts exactly that string.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildAudioFilename } from '../../src/shared/download';
import { FIXTURE_VIDEO_AUTHOR, FIXTURE_VIDEO_TITLE } from '../e2e/bench/fixture-server.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('download filename fixture agreement (SPEC-025)', () => {
  it('pins the m5 bench expectation to the builder output for the fixture video', () => {
    const expected = buildAudioFilename(FIXTURE_VIDEO_TITLE, 140, FIXTURE_VIDEO_AUTHOR);
    expect(expected).toBe('Fixture Artist - Fixture Watch Page.m4a');
    const bench = readFileSync(resolve(repoRoot, 'tests/e2e/bench/run-bench.mjs'), 'utf-8');
    expect(bench).toContain(`downloadData?.filename === '${expected}'`);
  });
});
