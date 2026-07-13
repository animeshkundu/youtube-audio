/**
 * Non-gating M1 live canary. Loads the built extension on a real YouTube watch page and
 * verifies that the page video switches to a direct audio URL and its clock advances.
 *
 * Usage: npm run build:ext && node tests/e2e/probe-m1-canary.mjs
 * Environment: YT_VIDEO (default dQw4w9WgXcQ), HEADLESS=0 for a visible browser.
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const xpi = resolve(root, 'dist', 'youtube-audio.xpi');
const videoId = process.env.YT_VIDEO || 'dQw4w9WgXcQ';
const options = new firefox.Options();
if (process.env.HEADLESS !== '0') options.addArguments('-headless');
options.setPreference('media.autoplay.default', 0);
options.setPreference('media.autoplay.blocking_policy', 0);
options.setPreference('media.autoplay.allow-muted', true);

let driver;
const report = { videoId, srcIsAudio: false, advanced: false, status: null, error: null };
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  await driver.manage().setTimeouts({ script: 60000, pageLoad: 60000 });
  await driver.installAddon(xpi, true);
  await driver.get(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  const observation = await driver.executeAsyncScript(function () {
    const done = arguments[arguments.length - 1];
    const deadline = Date.now() + 30000;
    const poll = () => {
      const video = document.querySelector('video');
      const source = video && (video.currentSrc || video.src || '');
      // Audio-only proof: the src was hijacked to a direct googlevideo media URL AND the
      // element carries no video track (videoWidth === 0), matching the S2 spike result.
      const hijacked = source.includes('googlevideo.com') && source.includes('videoplayback');
      const audioOnly = video && video.videoWidth === 0;
      if (video && hijacked && audioOnly) {
        const start = video.currentTime;
        setTimeout(
          () => done({ source: source.slice(0, 220), videoWidth: video.videoWidth, start, end: video.currentTime }),
          3000
        );
        return;
      }
      if (Date.now() >= deadline) {
        done({
          source: (source || '').slice(0, 220),
          videoWidth: video ? video.videoWidth : null,
          start: video ? video.currentTime : null,
          end: null,
        });
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
  report.srcIsAudio =
    observation.source.includes('googlevideo.com') &&
    observation.source.includes('videoplayback') &&
    observation.videoWidth === 0;
  report.advanced = typeof observation.end === 'number' && observation.end > observation.start;
  report.status = report.srcIsAudio && report.advanced ? 'PASS' : 'FAIL';
  report.observation = observation;
} catch (error) {
  report.status = 'ENVIRONMENTAL_FAILURE';
  report.error = String(error && error.stack ? error.stack : error);
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.status === 'PASS' ? 0 : 1);
