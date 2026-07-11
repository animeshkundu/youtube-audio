/**
 * Integration bench runner for the YouTube Audio extension (Firefox / geckodriver).
 *
 * This is the testability backbone: it loads the REAL built extension against a local,
 * hermetic fixture (tests/e2e/bench/fixture-server.mjs) and observes deterministic,
 * JS-driven signals (DOM markers + the fixture's request log) — no live YouTube, no real
 * media decoding. Per-feature assertions (M1+) plug into the same harness.
 *
 * What it does:
 *   1. Builds the BENCH extension (`BENCH=1 wxt build`), so the content script ALSO matches
 *      the local fixture host, and packages it into a temporary-installable XPI via web-ext.
 *   2. Starts the fixture server on an ephemeral 127.0.0.1 port.
 *   3. Runs two fresh-profile Firefox sessions (A/B):
 *        - control   = fixture page, NO add-on.
 *        - treatment = fixture page, WITH the bench add-on installed as a temporary add-on.
 *   4. Asserts the harness MECHANISMS (not any feature) hold deterministically today:
 *        - control has no content-script marker; treatment does  (proves injection is
 *          observable, the BENCH flag works, and the 127.0.0.1 match is live).
 *        - the fixture request log records the page's telemetry beacons  (proves the
 *          request-observation pattern every feature will reuse).
 *        - the fixture InnerTube /player endpoint returns audio adaptiveFormats + loudnessDb
 *          + adPlacements  (proves the response fixture features will assert against).
 *   5. Emits a JSON PASS/FAIL summary and sets the process exit code.
 *
 * Config via env:
 *   HEADLESS    "1" (default) headless, "0" headful
 *   SKIP_BUILD  "1" reuse an existing bench XPI (dist/youtube-audio-bench.xpi) instead of building
 *   FIREFOX_BIN explicit Firefox binary path (default: geckodriver auto-discovery)
 */

import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';

import { createFixtureServer } from './fixture-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const binDir = join(repoRoot, 'node_modules', '.bin');

// Make sure geckodriver (and wxt/web-ext) resolve even when run via `node` directly.
process.env.PATH = `${binDir}:${process.env.PATH || ''}`;

const HEADLESS = process.env.HEADLESS !== '0';
const SKIP_BUILD = process.env.SKIP_BUILD === '1';
const OUTPUT_DIR = join(repoRoot, '.output', 'firefox-mv2');
const ARTIFACTS_DIR = join(repoRoot, 'dist', 'bench-web-ext-artifacts');
const BENCH_XPI = join(repoRoot, 'dist', 'youtube-audio-bench.xpi');

function log(...a) {
  console.error('[bench]', ...a);
}

/** Build the BENCH extension and package it into a temporary-installable XPI. */
function buildBenchExtension() {
  log('building bench extension (BENCH=1 wxt build -b firefox --mv2)...');
  execFileSync(join(binDir, 'wxt'), ['build', '-b', 'firefox', '--mv2'], {
    cwd: repoRoot,
    env: { ...process.env, BENCH: '1' },
    stdio: 'inherit',
  });

  log('packaging XPI via web-ext...');
  rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  mkdirSync(dirname(BENCH_XPI), { recursive: true });
  execFileSync(
    join(binDir, 'web-ext'),
    ['build', '--source-dir', OUTPUT_DIR, '--artifacts-dir', ARTIFACTS_DIR, '--overwrite-dest'],
    { cwd: repoRoot, stdio: 'ignore' }
  );

  const zip = readdirSync(ARTIFACTS_DIR).find((f) => f.endsWith('.zip'));
  if (!zip) throw new Error('web-ext produced no artifact');
  copyFileSync(join(ARTIFACTS_DIR, zip), BENCH_XPI);
  log('bench XPI ready:', BENCH_XPI);
}

function makeOptions() {
  const options = new firefox.Options();
  if (HEADLESS) options.addArguments('-headless');
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  // Match the existing E2E harness prefs; harmless for the fixture (no real media).
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  options.setPreference('media.autoplay.allow-muted', true);
  options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  return options;
}

/** Poll an in-process predicate until it returns truthy or the deadline passes. */
async function waitFor(fn, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/**
 * One fresh-profile browser session against the fixture watch page.
 * @param {{ withAddon: boolean, origin: string }} opts
 */
async function runSession({ withAddon, origin }) {
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(makeOptions()).build();
  try {
    let addonId = null;
    if (withAddon) {
      addonId = await driver.installAddon(BENCH_XPI, true);
      log('installed temporary add-on:', addonId);
    }

    const watchUrl = `${origin}/watch?v=FIXTURE0001`;
    await driver.get(watchUrl);

    // Wait for the fixture page to finish loading (it sets data-fixture-ready in its load handler).
    await driver.wait(until.elementLocated(By.css('video[data-fixture-video]')), 10000);
    await driver.wait(async () => {
      const ready = await driver.executeScript(
        'return document.documentElement.getAttribute("data-fixture-ready");'
      );
      return ready === '1';
    }, 10000);

    // The content-script marker (bench build only). Give the isolated-world script a beat.
    const marker = await waitFor(
      () =>
        driver.executeScript('return document.documentElement.getAttribute("data-yta-bench");'),
      withAddon ? 5000 : 1500
    );

    // Fixture completeness: fetch the InnerTube /player fixture from the page and inspect it.
    const player = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      fetch('/youtubei/v1/player?v=FIXTURE0001', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId: 'FIXTURE0001' }),
      })
        .then((r) => r.json())
        .then((j) => {
          const fmts = (j.streamingData && j.streamingData.adaptiveFormats) || [];
          done({
            ok: true,
            audioFormats: fmts.filter((f) => (f.mimeType || '').indexOf('audio/') === 0).length,
            totalFormats: fmts.length,
            loudnessDb:
              j.playerConfig && j.playerConfig.audioConfig
                ? j.playerConfig.audioConfig.loudnessDb
                : null,
            hasAdPlacements: Array.isArray(j.adPlacements) && j.adPlacements.length > 0,
            playabilityStatus: j.playabilityStatus && j.playabilityStatus.status,
          });
        })
        .catch((e) => done({ ok: false, error: String(e) }));
    });

    return { addonId, marker, player };
  } finally {
    try {
      await driver.quit();
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  if (!SKIP_BUILD) {
    buildBenchExtension();
  } else if (!existsSync(BENCH_XPI)) {
    throw new Error(`SKIP_BUILD set but ${BENCH_XPI} does not exist`);
  }

  const fixture = createFixtureServer();
  const { origin, port } = await fixture.start();
  log('fixture server listening on', origin);

  const tests = [];
  const record = (name, pass, detail) => tests.push({ name, pass: !!pass, detail });

  try {
    // --- A: control (no add-on) -----------------------------------------------
    fixture.reset();
    const control = await runSession({ withAddon: false, origin });

    record('control:no-marker-without-extension', control.marker === null, {
      marker: control.marker,
    });

    // Request-log observability: the page's load-time telemetry beacons must be recorded.
    // Poll the in-process log until the telemetry path lands (beacons are async).
    const controlLogged = await waitFor(() => {
      const paths = fixture.getRequests().map((r) => r.path);
      return paths.includes('/youtubei/v1/log_event') ? paths : null;
    }, 5000);
    record('control:request-log-records-telemetry', !!controlLogged, {
      recordedPaths: fixture.getRequests().map((r) => `${r.method} ${r.path}`),
    });

    // --- B: treatment (bench add-on) ------------------------------------------
    fixture.reset();
    const treatment = await runSession({ withAddon: true, origin });

    record('treatment:content-script-marker', treatment.marker === '1', {
      marker: treatment.marker,
      addonId: treatment.addonId,
    });

    // Fixture player endpoint returns the shape features will assert against.
    const p = treatment.player || {};
    record(
      'treatment:fixture-player-endpoint',
      p.ok && p.audioFormats >= 1 && p.hasAdPlacements && typeof p.loudnessDb === 'number',
      p
    );

    // A/B cross-check: the marker is present ONLY with the extension.
    record(
      'ab:marker-differs-control-vs-treatment',
      control.marker === null && treatment.marker === '1',
      { control: control.marker, treatment: treatment.marker }
    );
  } finally {
    await fixture.close();
  }

  const passed = tests.filter((t) => t.pass).length;
  const failed = tests.length - passed;
  const verdict = failed === 0 ? 'PASS' : 'FAIL';

  const summary = {
    bench: 'youtube-audio integration bench',
    headless: HEADLESS,
    fixtureOrigin: origin,
    fixturePort: port,
    benchXpi: BENCH_XPI,
    passed,
    failed,
    total: tests.length,
    verdict,
    tests,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.log(
    JSON.stringify(
      { bench: 'youtube-audio integration bench', verdict: 'ERROR', error: String(err && err.stack ? err.stack : err) },
      null,
      2
    )
  );
  process.exit(2);
});
