#!/usr/bin/env node
/**
 * Persistent-profile qualification for the Firefox 139 -> 140 data-consent boundary.
 *
 * CI runs this script in two separate jobs:
 *   UPGRADE_PHASE=seed   Firefox 139 Developer Edition creates granted and revoked profiles.
 *   UPGRADE_PHASE=verify Firefox 140 Developer Edition reopens those exact profiles.
 *
 * The XPI is placed in each profile's extensions directory before Firefox starts. This is a
 * non-temporary installation: no WebDriver Addon:Install command is used, and the profile survives
 * the clean browser shutdown and artifact handoff between jobs.
 */

import { Builder, until, By } from 'selenium-webdriver';
import firefox, { ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { buildBenchExtension } from './run-bench.mjs';
import { createFixtureServer } from './fixture-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const phase = process.env.UPGRADE_PHASE;
const firefoxBinary = process.env.FIREFOX_BIN;
const profilesRoot = resolve(process.env.UPGRADE_PROFILES_DIR || join(repoRoot, 'dist', 'upgrade-profiles'));
const xpi = join(repoRoot, 'dist', 'youtube-audio-bench.xpi');
const addonId = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const pinnedUuid = '11111111-2222-4333-8444-555555555555';
const optionsUrl = `moz-extension://${pinnedUuid}/options.html`;
const consentKey = 'dataTransmissionConsent';

if (!['seed', 'verify'].includes(phase)) {
  throw new Error('UPGRADE_PHASE must be seed or verify');
}
if (!firefoxBinary) throw new Error('FIREFOX_BIN is required');

const profilePath = (decision) => join(profilesRoot, decision);

function prepareProfile(decision) {
  const profile = profilePath(decision);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(join(profile, 'extensions'), { recursive: true });
  cpSync(xpi, join(profile, 'extensions', `${addonId}.xpi`));
  writeFileSync(
    join(profile, 'user.js'),
    [
      'user_pref("xpinstall.signatures.required", false);',
      'user_pref("extensions.autoDisableScopes", 0);',
      'user_pref("extensions.enabledScopes", 15);',
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [addonId]: pinnedUuid }))});`,
      '',
    ].join('\n')
  );
  return profile;
}

function createOptions(profile) {
  const options = new firefox.Options();
  options.setBinary(firefoxBinary);
  options.addArguments('-headless', '-profile', profile, '--marionette-port', '2828');
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  options.setPreference('media.autoplay.allow-muted', true);
  return options;
}

async function openDriver(profile) {
  return new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(createOptions(profile))
    .setFirefoxService(new ServiceBuilder().addArguments('--allow-system-access'))
    .build();
}

async function readExtensionState(driver) {
  await driver.get(optionsUrl);
  return driver.executeAsyncScript(
    function (storageKey) {
      const done = arguments[arguments.length - 1];
      Promise.all([browser.permissions.getAll(), browser.storage.local.get(storageKey)])
        .then(([permissions, stored]) =>
          done({
            ok: true,
            permissions,
            consent: stored[storageKey] ?? null,
            browserVersion: navigator.userAgent,
          })
        )
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    consentKey
  );
}

async function writeConsent(driver, decision) {
  await driver.get(optionsUrl);
  return driver.executeAsyncScript(
    function (storageKey, nextDecision) {
      const done = arguments[arguments.length - 1];
      const consent = {
        version: 1,
        decision: nextDecision,
        sponsorBlockAllowed: nextDecision === 'granted',
      };
      browser.storage.local
        .set({ [storageKey]: consent })
        .then(() => browser.storage.local.get(storageKey))
        .then((stored) => done({ ok: true, consent: stored[storageKey] }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    consentKey,
    decision
  );
}

async function probePlayback(driver, fixture) {
  fixture.reset();
  await driver.get(`${fixture.origin}/watch?v=FIXTURE0001`);
  await driver.wait(until.elementLocated(By.css('video')), 10000);
  await driver.wait(
    async () =>
      (await driver.executeScript(
        "return document.documentElement.getAttribute('data-fixture-ready')"
      )) === '1',
    10000
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
  const page = await driver.executeScript(function () {
    const video = document.querySelector('video');
    return {
      marker: document.documentElement.dataset.ytaBench || null,
      status: document.documentElement.dataset.ytaStatus || null,
      videoSrc: video?.currentSrc || video?.src || null,
    };
  });
  const requests = fixture.getRequests();
  return {
    ...page,
    playerPost: requests.some(
      (request) => request.method === 'POST' && request.path === '/youtubei/v1/player'
    ),
  };
}

async function runProfile(decision, fixture) {
  const profile = phase === 'seed' ? prepareProfile(decision) : profilePath(decision);
  if (!existsSync(profile)) throw new Error(`Persistent profile is missing: ${profile}`);
  const driver = await openDriver(profile);
  try {
    const before = await readExtensionState(driver);
    if (!before?.ok) throw new Error(`Extension did not load: ${JSON.stringify(before)}`);
    const written = phase === 'seed' ? await writeConsent(driver, decision) : null;
    if (phase === 'seed' && (!written?.ok || written.consent?.decision !== decision)) {
      throw new Error(`Could not seed ${decision}: ${JSON.stringify(written)}`);
    }
    const extension = await readExtensionState(driver);
    const playback = await probePlayback(driver, fixture);
    const active =
      playback.marker === '1' &&
      playback.status === 'active' &&
      playback.videoSrc?.includes('/videoplayback') &&
      playback.playerPost;
    const inert =
      playback.marker === '1' &&
      playback.status === 'disabled' &&
      !playback.videoSrc?.includes('/videoplayback') &&
      !playback.playerPost;
    return { decision, extension, playback, active, inert };
  } finally {
    await driver.quit();
  }
}

async function main() {
  if (phase === 'seed') buildBenchExtension();
  else if (!existsSync(xpi)) {
    // The profile contains the installed XPI, but keeping the artifact alongside it makes the
    // handoff inspectable and guards against an incomplete artifact upload.
    throw new Error(`Upgrade artifact is missing ${xpi}`);
  }

  const server = createFixtureServer();
  // `start()` resolves with { origin, port }; the server object itself carries neither, so the
  // probe below needs the resolved value rather than the factory's return.
  const { origin } = await server.start();
  const fixture = { ...server, origin };
  try {
    const granted = await runProfile('granted', fixture);
    const revoked = await runProfile('revoked', fixture);
    const pass =
      phase === 'seed'
        ? granted.active && revoked.inert
        : granted.active &&
          granted.extension.consent?.decision === 'granted' &&
          granted.extension.permissions?.data_collection?.includes('websiteContent') &&
          revoked.inert &&
          revoked.extension.consent?.decision === 'revoked';
    const answer =
      phase === 'seed'
        ? 'Firefox 139 baseline prepared: granted works; revoked stays inert.'
        : granted.active
          ? 'NOT BRICKED: the Firefox 139 custom grant remains functional after opening the same profile in Firefox 140.'
          : 'BRICKED: the Firefox 139 custom grant becomes inert after opening the same profile in Firefox 140.';
    console.log(
      JSON.stringify(
        {
          suite: 'Firefox 139 to 140 persistent-profile consent upgrade',
          phase,
          verdict: pass ? 'PASS' : 'FAIL',
          answer,
          granted,
          revoked,
        },
        null,
        2
      )
    );
    process.exit(pass ? 0 : 1);
  } finally {
    await fixture.close();
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        suite: 'Firefox 139 to 140 persistent-profile consent upgrade',
        phase,
        verdict: 'ERROR',
        answer: 'NO EMPIRICAL ANSWER: the persistent-profile qualification could not complete.',
        error: String(error?.stack || error),
      },
      null,
      2
    )
  );
  process.exit(2);
});
