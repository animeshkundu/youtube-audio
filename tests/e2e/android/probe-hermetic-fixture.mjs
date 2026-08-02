#!/usr/bin/env node
/**
 * Gating Fenix probe against the local hermetic fixture.
 *
 * The host fixture binds on all interfaces and advertises Android's 10.0.2.2 host alias. The BENCH
 * build alone permits that origin, so production permissions remain unchanged.
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { ServiceBuilder } from 'selenium-webdriver/firefox.js';

import { seedDataConsent } from '../consent-helper.mjs';
import { createFixtureServer } from '../bench/fixture-server.mjs';

const XPI = process.argv[2] || 'dist/youtube-audio-bench.xpi';
const ADDON_ID = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const GECKO =
  process.env.GECKODRIVER_BIN || process.env.GECKO || `${process.cwd()}/node_modules/.bin/geckodriver`;
const FENIX_PACKAGE = process.env.FENIX_PACKAGE || 'org.mozilla.firefox';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SESSION_RETRY_ERROR =
  /^Could not launch Android [\w.]+\/org\.mozilla\.fenix\.IntentReceiverActivity: Resource temporarily unavailable \(os error 11\)$/;
const MAX_SESSION_ATTEMPTS = 3;
const MAX_FIXTURE_NAVIGATIONS = 3;

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

async function snapshot(driver) {
  return driver.executeScript(function () {
    const video = document.querySelector('video');
    const currentSrc = video ? video.currentSrc || video.src || '' : '';
    return {
      marker: document.documentElement.dataset.ytaBench || null,
      status: document.documentElement.dataset.ytaStatus || null,
      reason: document.documentElement.dataset.ytaReason || null,
      currentSrc: currentSrc.slice(0, 160),
      hijacked: currentSrc.includes('/videoplayback'),
      readyState: video?.readyState ?? null,
    };
  });
}

async function navigateUntilContentScriptAttached(driver, fixtureUrl, report) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_FIXTURE_NAVIGATIONS; attempt += 1) {
    report.fixtureNavigations = attempt;
    await driver.get(fixtureUrl);
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
  addonId: null,
  snapshot: null,
  playerRequests: 0,
  verdict: 'FAIL',
};

const fixture = createFixtureServer();
let driver;
try {
  const { origin } = await fixture.start({ hostname: '0.0.0.0', publicHostname: '10.0.2.2' });
  report.fixtureOrigin = origin;

  driver = await startAndroidSession(report);
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 90_000 });

  report.addonId = await driver.installAddon(XPI, true);
  await seedDataConsent(driver, OPTIONS_URL);
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
  await fixture.close().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
