#!/usr/bin/env node
/**
 * Gating Fenix probe against the local hermetic fixture.
 *
 * The host fixture binds on all interfaces and advertises Android's 10.0.2.2 host alias. The BENCH
 * build alone permits that origin, so production permissions remain unchanged.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ServiceBuilder } from 'selenium-webdriver/firefox.js';

import { seedDataConsent } from '../consent-helper.mjs';
import { createFixtureServer } from '../bench/fixture-server.mjs';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
// The web-ext CLI owns the Android application lifecycle, but its RDP client is the supported
// temporary-add-on protocol implementation. Resolve its package-local module without taking over
// the Marionette session that drives this probe.
const webExtRoot = dirname(require.resolve('web-ext'));
const { connectWithMaxRetries, findFreeTcpPort } = await import(
  pathToFileURL(join(webExtRoot, 'lib/firefox/remote.js')).href
);
const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADDON_ID = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const ADB = process.env.ADB || 'adb';
const PYTHON = process.env.PYTHON || 'python3';
const UI_SCRIPT = fileURLToPath(new URL('./ui.py', import.meta.url));
const GECKO =
  process.env.GECKODRIVER_BIN || process.env.GECKO || `${process.cwd()}/node_modules/.bin/geckodriver`;
const FENIX_PACKAGE = process.env.FENIX_PACKAGE || 'org.mozilla.firefox';
const FIXTURE_HOST = 'localhost';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SESSION_RETRY_ERROR =
  /^Could not launch Android [\w.]+\/org\.mozilla\.fenix\.IntentReceiverActivity: Resource temporarily unavailable \(os error 11\)$/;
const MAX_SESSION_ATTEMPTS = 3;
const MAX_FIXTURE_NAVIGATIONS = 3;
const RDP_SOCKET_WAIT_MS = 30_000;
const RDP_CONNECT_RETRIES = 150;
const RDP_CONNECT_RETRY_INTERVAL_MS = 200;
const REMOTE_XPI_PATH = '/data/local/tmp/youtube-audio-bench.xpi';

function firefoxOptions() {
  const options = new firefox.Options();
  options.enableMobile(FENIX_PACKAGE);
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  options.setPreference('media.autoplay.allow-muted', true);
  return options;
}

async function startAndroidSession(report) {
  for (let attempt = 1; attempt <= MAX_SESSION_ATTEMPTS; attempt += 1) {
    report.sessionAttempts = attempt;
    try {
      return await new Builder()
        .forBrowser('firefox')
        .setFirefoxOptions(firefoxOptions())
        .setFirefoxService(new ServiceBuilder(GECKO).addArguments('--android-storage', 'internal'))
        .build();
    } catch (error) {
      if (
        attempt === MAX_SESSION_ATTEMPTS ||
        !SESSION_RETRY_ERROR.test(String(error?.message ?? error))
      ) {
        throw error;
      }
      await sleep(2_000);
    }
  }
  throw new Error('Android WebDriver session retry loop completed without a session');
}

async function adb(...args) {
  const { stdout } = await execFile(ADB, args, { timeout: 60_000 });
  return stdout;
}

async function enableRemoteDebugging() {
  try {
    const { stdout } = await execFile(PYTHON, [UI_SCRIPT, 'enable-remote-debugging'], {
      env: { ...process.env, ADB },
      timeout: 90_000,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n');
    throw new Error(`Fenix Remote debugging setup failed: ${output || String(error)}`);
  }
}

async function waitForDebuggerSocket() {
  const expectedSuffix = `${FENIX_PACKAGE}/firefox-debugger-socket`;
  const deadline = Date.now() + RDP_SOCKET_WAIT_MS;
  let lastSockets = '';
  let lastAdbFailure = '';

  while (Date.now() < deadline) {
    try {
      lastSockets = await adb('shell', 'cat', '/proc/net/unix');
    } catch (error) {
      lastAdbFailure = [error?.message, error?.stdout, error?.stderr].filter(Boolean).join('\n');
      await sleep(200);
      continue;
    }
    const line = lastSockets
      .split('\n')
      .find((candidate) => candidate.trim().endsWith(expectedSuffix));
    if (line) return line.trim().split(/\s+/).at(-1);
    await sleep(200);
  }

  throw new Error(
    `Firefox Android did not expose ${expectedSuffix} within ${RDP_SOCKET_WAIT_MS}ms: ` +
      `${lastSockets}\nlast adb failure:\n${lastAdbFailure}`
  );
}

async function installAndroidAddonViaRdp() {
  await adb('push', XPI, REMOTE_XPI_PATH);
  const socket = await waitForDebuggerSocket();
  const port = await findFreeTcpPort();
  const socketTarget = socket.startsWith('@')
    ? `localabstract:${socket.slice(1)}`
    : `localfilesystem:${socket}`;
  await adb('forward', `tcp:${port}`, socketTarget);

  let remoteFirefox;
  try {
    remoteFirefox = await connectWithMaxRetries({
      port,
      maxRetries: RDP_CONNECT_RETRIES,
      retryInterval: RDP_CONNECT_RETRY_INTERVAL_MS,
    });
    const result = await remoteFirefox.installTemporaryAddon(REMOTE_XPI_PATH);
    const addonId = result?.addon?.id;
    if (addonId !== ADDON_ID) {
      throw new Error(`RDP installed unexpected add-on: ${JSON.stringify(result)}`);
    }
    return { addonId, socket, port };
  } finally {
    remoteFirefox?.disconnect();
  }
}

async function snapshot(driver) {
  return driver.executeScript(function () {
    const video = document.querySelector('video');
    const currentSrc = video ? video.currentSrc || video.src || '' : '';
    return {
      marker: document.documentElement.dataset.ytaBench || null,
      status: document.documentElement.dataset.ytaStatus || null,
      reason: document.documentElement.dataset.ytaReason || null,
      bridgeNonce: document.documentElement.dataset.ytaBridge || null,
      pageErrors: Array.isArray(window.__fixtureErrors) ? window.__fixtureErrors : null,
      settingsMessages: Array.isArray(window.__fixtureSettingsMessages)
        ? window.__fixtureSettingsMessages
        : null,
      currentSrc: currentSrc.slice(0, 160),
      hijacked: currentSrc.includes('/videoplayback'),
      readyState: video?.readyState ?? null,
    };
  });
}

async function verifyFixtureSecurityContext(driver, fixtureUrl) {
  const expectedOrigin = new URL(fixtureUrl).origin;
  const context = await driver.executeScript(function () {
    return {
      origin: location.origin,
      isSecureContext,
      hasRandomUuid: typeof crypto.randomUUID === 'function',
    };
  });

  if (
    context?.origin !== expectedOrigin ||
    context.isSecureContext !== true ||
    context.hasRandomUuid !== true
  ) {
    throw new Error(
      `fixture did not expose the required secure context: ${JSON.stringify({ expectedOrigin, context })}`
    );
  }

  return context;
}

async function navigateUntilContentScriptAttached(driver, fixtureUrl, report) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_FIXTURE_NAVIGATIONS; attempt += 1) {
    report.fixtureNavigations = attempt;
    await driver.get(fixtureUrl);
    report.fixtureSecurity = await verifyFixtureSecurityContext(driver, fixtureUrl);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      last = await snapshot(driver);
      if (last.marker === '1') return;
      await sleep(250);
    }
  }
  throw new Error(
    `fixture content script did not attach after ${MAX_FIXTURE_NAVIGATIONS} navigations: ${JSON.stringify(last)}`
  );
}

async function waitForTerminalState(driver) {
  const deadline = Date.now() + 60_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await snapshot(driver);
    if (last.marker === '1' && ['active', 'fallback', 'disabled'].includes(last.status)) return last;
    await sleep(500);
  }
  throw new Error(`fixture did not reach a terminal extension state: ${JSON.stringify(last)}`);
}

const report = {
  xpi: XPI,
  fenixPackage: FENIX_PACKAGE,
  geckodriver: GECKO,
  sessionAttempts: 0,
  fixtureNavigations: 0,
  fixtureOrigin: null,
  fixtureSecurity: null,
  fixtureReverse: null,
  addonId: null,
  remoteDebugging: null,
  rdp: null,
  snapshot: null,
  playerRequests: 0,
  consent: null,
  extension: null,
  verdict: 'FAIL',
};

const fixture = createFixtureServer();
let driver;
let fixtureReversePort;
try {
  const { origin, port } = await fixture.start({ hostname: '0.0.0.0', publicHostname: FIXTURE_HOST });
  report.fixtureOrigin = origin;
  await adb('reverse', `tcp:${port}`, `tcp:${port}`);
  fixtureReversePort = port;
  report.fixtureReverse = { device: `tcp:${port}`, host: `tcp:${port}` };

  driver = await startAndroidSession(report);
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 90_000 });

  report.remoteDebugging = await enableRemoteDebugging();
  report.rdp = await installAndroidAddonViaRdp();
  report.addonId = report.rdp.addonId;
  report.consent = await seedDataConsent(driver, OPTIONS_URL);
  report.extension = await driver.executeScript(function () {
    const manifest = browser.runtime.getManifest();
    return {
      id: browser.runtime.id,
      contentScriptMatches: manifest.content_scripts?.map((contentScript) => contentScript.matches) ?? [],
    };
  });
  await navigateUntilContentScriptAttached(driver, `${origin}/watch?v=FIXTURE0001`, report);
  report.snapshot = await waitForTerminalState(driver);
  report.playerRequests = fixture
    .getRequests()
    .filter((request) => request.method === 'POST' && request.path === '/youtubei/v1/player').length;

  report.verdict =
    report.snapshot.status === 'active' &&
    report.snapshot.hijacked &&
    report.playerRequests >= 1
      ? 'PASS'
      : 'FAIL';
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  if (driver) await driver.quit().catch(() => undefined);
  if (fixtureReversePort) {
    await adb('reverse', '--remove', `tcp:${fixtureReversePort}`).catch(() => undefined);
  }
  await fixture.close().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
