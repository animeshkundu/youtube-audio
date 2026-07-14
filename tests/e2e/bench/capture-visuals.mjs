import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { buildBenchExtension, openBrowserActionPopup } from './run-bench.mjs';
import { createFixtureServer } from './fixture-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const binDir = join(repoRoot, 'node_modules', '.bin');
const visualDir = join(repoRoot, 'dist', 'visual');
const benchXpi = join(repoRoot, 'dist', 'youtube-audio-bench.xpi');

const addonId = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const pinnedUuid = '11111111-2222-4333-8444-555555555555';
const optionsUrl = `moz-extension://${pinnedUuid}/options.html`;
process.env.PATH = `${binDir}:${process.env.PATH || ''}`;

const settings = {
  enabled: true,
  audioOnlyEnabled: true,
  audioArtworkEnabled: true,
  backgroundPlayEnabled: true,
  adBlockEnabled: true,
  segmentSkipEnabled: true,
  downloadEnabled: true,
  loudnessNormalization: true,
  equalizerEnabled: true,
  lyricsEnabled: true,
};

const makeOptions = () => {
  const options = new firefox.Options();
  options.addArguments('-headless', '-remote-allow-system-access');
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  options.setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ [addonId]: pinnedUuid }),
  );
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  options.setPreference('media.autoplay.allow-muted', true);
  options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  return options;
};

const snapshotScript = () => ({
  ready: document.documentElement.getAttribute('data-fixture-ready'),
  status: document.documentElement.dataset.ytaStatus || null,
  audioOnlyTogglePresent: !!document.getElementById('yta-audio-only-toggle'),
  artworkPresent: !!document.querySelector('.yta-audio-artwork'),
});

const savePng = async (filename, base64) => {
  const path = join(visualDir, filename);
  await writeFile(path, base64, 'base64');
  console.error(`[visual] wrote ${path}`);
  return path;
};

const seedSettings = async (driver, nextSettings) => {
  await driver.get(optionsUrl);
  const result = await driver.executeAsyncScript(function (value) {
    const done = arguments[arguments.length - 1];
    browser.storage.local
      .set({ settings: value, seenOnboarding: true })
      .then(() => done({ ok: true }))
      .catch((error) => done({ ok: false, error: String(error) }));
  }, nextSettings);
  if (!result?.ok) throw new Error(`settings seed failed: ${JSON.stringify(result)}`);
};

const capturePopup = async (driver, filename) => {
  const probe = await openBrowserActionPopup(driver);
  console.error(`[visual] popup probe: ${JSON.stringify(probe)}`);

  await driver.setContext('chrome');
  try {
    const popupBrowser = await driver.findElements(
      By.css('browser[src*="moz-extension"][src*="popup"]'),
    );
    if (popupBrowser.length > 0) {
      return savePng(filename, await popupBrowser[0].takeScreenshot(true));
    }
    return savePng(filename, await driver.takeScreenshot());
  } finally {
    await driver.setContext('content');
  }
};

const closeInstallTabs = async (driver, workHandle, handlesBefore) => {
  const deadline = Date.now() + 5000;
  let handles = await driver.getAllWindowHandles();
  while (!handles.some((handle) => !handlesBefore.has(handle)) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    handles = await driver.getAllWindowHandles();
  }
  for (const handle of handles) {
    if (handlesBefore.has(handle)) continue;
    await driver.switchTo().window(handle);
    await driver.close();
  }
  await driver.switchTo().window(workHandle);
};

async function main() {
  await mkdir(visualDir, { recursive: true });
  buildBenchExtension();

  const fixture = createFixtureServer();
  const { origin } = await fixture.start();
  console.error(`[visual] fixture server listening on ${origin}`);

  let driver;
  const written = [];
  const failures = [];
  try {
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(makeOptions()).build();
    await driver.manage().window().setRect({ width: 1280, height: 800, x: 0, y: 0 });

    const workHandle = await driver.getWindowHandle();
    const handlesBefore = new Set(await driver.getAllWindowHandles());
    await driver.installAddon(benchXpi, true);
    await closeInstallTabs(driver, workHandle, handlesBefore);
    await seedSettings(driver, settings);

    await driver.get(`${origin}/watch?v=FIXTURE0001`);
    await driver.wait(until.elementLocated(By.css('video[data-fixture-video]')), 10000);
    await driver.wait(async () => {
      const snapshot = await driver.executeScript(snapshotScript);
      return snapshot.ready === '1' && snapshot.audioOnlyTogglePresent;
    }, 10000);
    await driver.wait(async () => {
      const snapshot = await driver.executeScript(snapshotScript);
      return snapshot.status === 'active' && snapshot.artworkPresent;
    }, 10000);
    await driver.executeScript(() => {
      document.querySelector('#movie_player')?.classList.remove('ytp-hide-controls', 'ended-mode');
    });

    written.push(await savePng('01-watch-artwork.png', await driver.takeScreenshot()));
    written.push(
      await savePng(
        '02-right-controls.png',
        await driver.findElement(By.css('.ytp-right-controls')).takeScreenshot(true),
      ),
    );
    written.push(
      await savePng(
        '03-artwork-overlay.png',
        await driver.findElement(By.css('.yta-audio-artwork')).takeScreenshot(true),
      ),
    );

    try {
      written.push(await capturePopup(driver, '04-popup.png'));
    } catch (error) {
      failures.push({ screenshot: '04-popup.png', error: String(error?.stack || error) });
    }

    await driver.get(optionsUrl);
    await driver.wait(until.elementLocated(By.css('main')), 10000);
    const optionsHeight = await driver.executeScript(() =>
      Math.min(8000, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
    );
    await driver.manage().window().setRect({ width: 1280, height: Number(optionsHeight) + 120 });
    written.push(await savePng('05-options.png', await driver.takeScreenshot()));

    await seedSettings(driver, { ...settings, audioOnlyEnabled: false });
    await driver.manage().window().setRect({ width: 1280, height: 800 });
    await driver.get(`${origin}/watch?v=FIXTURE0001`);
    await driver.wait(async () => {
      const snapshot = await driver.executeScript(snapshotScript);
      return snapshot.ready === '1' && snapshot.audioOnlyTogglePresent;
    }, 10000);
    try {
      written.push(await capturePopup(driver, '06-popup-audio-off.png'));
    } catch (error) {
      failures.push({ screenshot: '06-popup-audio-off.png', error: String(error?.stack || error) });
    }
  } finally {
    if (driver) {
      try {
        await driver.quit();
      } catch {
        // Best-effort cleanup.
      }
    }
    await fixture.close();
  }

  console.log(JSON.stringify({ written, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 2;
  });
}
