// Real-YouTube visual capture. Unlike the hermetic fixture bench (deterministic, for regression
// gating), this loads the PRODUCTION extension into a real Firefox against real youtube.com and
// screenshots the actual in-player controls + audio-mode artwork, so we can judge visual fidelity
// the fixture cannot show. Not a CI gate (real YouTube is non-deterministic); a human/dev tool.
//
//   HEADLESS=1   run headless (default: headful, a real window — matches a normal browser)
//   VIDEO_ID=... watch video id (default: "Me at the zoo", not age-restricted, always up)
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const binDir = join(repoRoot, 'node_modules', '.bin');
const OUTPUT_DIR = join(repoRoot, '.output', 'firefox-mv2');
const ARTIFACTS_DIR = join(repoRoot, 'dist', 'real-web-ext-artifacts');
const XPI = join(repoRoot, 'dist', 'youtube-audio-real.xpi');
const OUT = join(repoRoot, 'dist', 'visual-real');
const ADDON_ID = '{580efa7d-66f9-474d-857a-8e2afc6b1181}';
const PINNED_UUID = '11111111-2222-4333-8444-555555555555';
const OPTIONS_URL = `moz-extension://${PINNED_UUID}/options.html`;
const HEADLESS = process.env.HEADLESS === '1';
// Default to a stable HD Vevo music video: music is what users primarily watch, and it renders the
// full HD player + HD badge (and is monetized, so it doubles as an ad-block repro target).
const VIDEO_ID = process.env.VIDEO_ID || 'dQw4w9WgXcQ';

const log = (...a) => console.error('[real]', ...a);

function buildProductionXpi() {
  const env = { ...process.env };
  delete env.BENCH; // production build: no localhost matches, no __BENCH__ branches
  log('building production extension (wxt build -b firefox --mv2)...');
  execFileSync(join(binDir, 'wxt'), ['build', '-b', 'firefox', '--mv2'], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  execFileSync(
    join(binDir, 'web-ext'),
    ['build', '--source-dir', OUTPUT_DIR, '--artifacts-dir', ARTIFACTS_DIR, '--overwrite-dest'],
    { cwd: repoRoot, stdio: 'ignore' }
  );
  const zip = readdirSync(ARTIFACTS_DIR).find((f) => f.endsWith('.zip'));
  if (!zip) throw new Error('web-ext produced no artifact');
  copyFileSync(join(ARTIFACTS_DIR, zip), XPI);
  log('production XPI ready:', XPI);
}

function makeOptions() {
  const options = new firefox.Options();
  if (HEADLESS) options.addArguments('-headless');
  options.addArguments('-remote-allow-system-access');
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: PINNED_UUID }));
  options.setPreference('media.autoplay.default', 0);
  options.setPreference('media.autoplay.blocking_policy', 0);
  options.setPreference('media.autoplay.allow-muted', true);
  options.setPreference('datareporting.policy.dataSubmissionEnabled', false);
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  return options;
}

/** Best-effort: dismiss a EU cookie-consent interstitial if one appears (usually absent on US IPs). */
async function dismissConsent(driver) {
  try {
    const buttons = await driver.findElements(
      By.css('button[aria-label*="Accept"], button[aria-label*="Reject"], form[action*="consent"] button')
    );
    if (buttons.length) {
      await buttons[buttons.length - 1].click();
      await driver.sleep(1500);
      log('dismissed a consent interstitial');
    }
  } catch {
    /* none present */
  }
}

async function main() {
  buildProductionXpi();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(makeOptions()).build();
  const report = { videoId: VIDEO_ID, headless: HEADLESS, steps: {} };
  try {
    await driver.manage().window().setRect({ width: 1366, height: 900 });
    const workHandle = await driver.getWindowHandle();
    const handlesBefore = new Set(await driver.getAllWindowHandles());
    const addonId = await driver.installAddon(XPI, true);
    log('installed temporary add-on:', addonId);

    // The install opens the onboarding options page in a NEW tab which steals focus. Close it and
    // return to the work tab so it cannot hijack the YouTube navigation. Relies on DEFAULT_SETTINGS
    // (enabled + audioOnlyEnabled + audioArtworkEnabled all on) so the audio-only toggle + artwork
    // show; the download button defaults off and is intentionally not seeded here.
    await driver.sleep(1500);
    for (const handle of await driver.getAllWindowHandles()) {
      if (handlesBefore.has(handle)) continue;
      await driver.switchTo().window(handle);
      // Keep both extension-owned controls measurable in this visual probe. This changes only the
      // temporary Firefox profile used by the capture; production still defaults downloads off.
      await driver.executeAsyncScript(function () {
        const done = arguments[arguments.length - 1];
        browser.storage.local
          .get('settings')
          .then(({ settings = {} }) =>
            browser.storage.local.set({ settings: { ...settings, downloadEnabled: true } })
          )
          .then(() => done(true), (error) => done(String(error)));
      });
      await driver.close();
    }
    await driver.switchTo().window(workHandle);

    await driver.get(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    await dismissConsent(driver);

    // Diagnostic landing capture — where did we actually end up (consent wall? bot check? player)?
    report.landing = { url: await driver.getCurrentUrl(), title: await driver.getTitle() };
    log('landing url:', report.landing.url, '| title:', report.landing.title);
    await driver.sleep(2500);
    writeFileSync(join(OUT, '00-landing.png'), await driver.takeScreenshot(), 'base64');

    // Wait for the native right-controls, then our injected audio-only toggle.
    await driver.wait(until.elementLocated(By.css('.ytp-right-controls')), 30000);
    await driver
      .wait(until.elementLocated(By.css('#yta-audio-only-toggle')), 20000)
      .catch(() => log('audio-only toggle did not appear within 20s'));
    // Give the credentialless fetch + artwork overlay a moment to settle.
    await driver.sleep(6000);

    const save = async (name, png) => {
      writeFileSync(join(OUT, name), png, 'base64');
      log('wrote', name);
    };
    const shot = async (name) => {
      // Element/page screenshots occasionally throw a transient "Unable to capture screenshot";
      // retry once, and never let one failed shot abort the rest of the capture.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await save(name, await driver.takeScreenshot());
          return;
        } catch (e) {
          if (attempt === 1) log('screenshot failed', name, String(e).slice(0, 80));
          else await driver.sleep(600);
        }
      }
    };

    // Reveal the control bar (it auto-hides): move the pointer over the player, then screenshot.
    try {
      const player = await driver.findElement(By.css('#movie_player, .html5-video-player'));
      await driver.actions().move({ origin: player }).perform();
      await driver.sleep(1000);
    } catch {
      /* ignore */
    }

    // Observable state (incl. artwork overlay geometry/visibility to explain the black rectangle).
    report.steps.state = await driver.executeScript(function () {
      const v = document.querySelector('video');
      const toggle = document.getElementById('yta-audio-only-toggle');
      const dl = document.getElementById('yta-download-audio');
      const art = document.querySelector('.yta-audio-artwork');
      const artStyle = art ? getComputedStyle(art) : null;
      return {
        videoSrc: v ? v.currentSrc || v.src : null,
        isGooglevideoAudio: !!(v && (v.currentSrc || v.src).includes('googlevideo.com')),
        togglePresent: !!toggle,
        toggleAriaPressed: toggle ? toggle.getAttribute('aria-pressed') : null,
        toggleRect: toggle ? toggle.getBoundingClientRect().toJSON() : null,
        downloadPresent: !!dl,
        downloadHidden: dl ? dl.hidden : null,
        artworkPresent: !!art,
        artworkVisibleAttr: art ? art.getAttribute('data-visible') : null,
        artworkRect: art ? art.getBoundingClientRect().toJSON() : null,
        artworkZ: artStyle ? artStyle.zIndex : null,
        artworkOpacity: artStyle ? artStyle.opacity : null,
        artworkParent: art && art.parentElement ? art.parentElement.className : null,
        videoParent: v && v.parentElement ? v.parentElement.className : null,
        rightControlsButtons: Array.from(
          document.querySelectorAll('.ytp-right-controls > *')
        ).map((el) => el.id || el.className || el.tagName),
      };
    });

    // Measure the control and SVG boxes plus the visible painted glyph bounds. The latter samples the
    // rendered SVG path geometry via getBBox() transformed into viewport pixels, rather than treating
    // the full (padded) SVG viewport as if it were visible artwork.
    report.steps.iconMetrics = await driver.executeScript(function () {
      const download = document.getElementById('yta-download-audio');
      if (download) download.hidden = false;
      const selectors = [
        '#yta-audio-only-toggle',
        '#yta-download-audio',
        '.ytp-settings-button',
        '.ytp-subtitles-button',
        '.ytp-fullscreen-button',
        '.ytp-play-button',
      ];
      const rectJson = (rect) => ({
        x: rect.x,
        y: rect.y,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
      const paintedBounds = (svg) => {
        const graphics = Array.from(svg.querySelectorAll('path, circle, rect, polygon, polyline, line'))
          .filter((node) => getComputedStyle(node).display !== 'none');
        const points = [];
        for (const node of graphics) {
          try {
            const box = node.getBBox();
            const matrix = node.getScreenCTM();
            if (!matrix || box.width < 0 || box.height < 0) continue;
            for (const [x, y] of [
              [box.x, box.y],
              [box.x + box.width, box.y],
              [box.x, box.y + box.height],
              [box.x + box.width, box.y + box.height],
            ]) {
              const point = new DOMPoint(x, y).matrixTransform(matrix);
              points.push(point);
            }
          } catch {
            // Ignore non-renderable SVG children.
          }
        }
        if (!points.length) return null;
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        return {
          left,
          right,
          top,
          bottom,
          width: right - left,
          height: bottom - top,
          centerX: (left + right) / 2,
          centerY: (top + bottom) / 2,
        };
      };
      return Object.fromEntries(
        selectors.map((selector) => {
          const button = document.querySelector(selector);
          const svg = button && button.querySelector('svg');
          const buttonRect = button && button.getBoundingClientRect();
          const svgRect = svg && svg.getBoundingClientRect();
          const svgStyle = svg && getComputedStyle(svg);
          return [
            selector,
            {
              present: !!button,
              buttonRect: buttonRect ? rectJson(buttonRect) : null,
              buttonCenterY: buttonRect ? buttonRect.top + buttonRect.height / 2 : null,
              svgRect: svgRect ? rectJson(svgRect) : null,
              svgComputedWidth: svgStyle ? svgStyle.width : null,
              svgComputedHeight: svgStyle ? svgStyle.height : null,
              svgCenterY: svgRect ? svgRect.top + svgRect.height / 2 : null,
              viewBox: svg ? svg.getAttribute('viewBox') : null,
              painted: svg ? paintedBounds(svg) : null,
            },
          ];
        })
      );
    });

    // Empirically answer "does ANDROID_VR return video, and is it ad-free / hijackable?" by running
    // the same credentialless fetch the extension does, from the page context (real key + visitorData).
    report.steps.androidVrFormats = await driver.executeAsyncScript(function () {
      const done = arguments[arguments.length - 1];
      try {
        const cfg = window.ytcfg;
        const key = cfg && cfg.get ? cfg.get('INNERTUBE_API_KEY') : null;
        const vd = cfg && cfg.get ? cfg.get('VISITOR_DATA') : null;
        const client = {
          clientName: 'ANDROID_VR',
          clientVersion: '1.65.10',
          deviceMake: 'Oculus',
          deviceModel: 'Quest 3',
          osName: 'Android',
          osVersion: '12L',
          androidSdkVersion: 32,
          hl: 'en',
          gl: 'US',
        };
        if (vd) client.visitorData = vd;
        const vid = new URLSearchParams(location.search).get('v');
        fetch('/youtubei/v1/player?key=' + encodeURIComponent(key) + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client },
            videoId: vid,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        })
          .then((r) => r.json())
          .then((j) => {
            const sd = j.streamingData || {};
            const m = (f) => ({
              itag: f.itag,
              q: f.qualityLabel || f.audioQuality,
              mime: (f.mimeType || '').split(';')[0],
              directUrl: !!f.url,
              cipher: !!f.signatureCipher,
            });
            const adaptive = sd.adaptiveFormats || [];
            done({
              playability: j.playabilityStatus && j.playabilityStatus.status,
              adPlacements: 'adPlacements' in j,
              playerAds: 'playerAds' in j,
              progressive: (sd.formats || []).map(m),
              video: adaptive
                .filter((f) => (f.mimeType || '').startsWith('video/'))
                .map(m)
                .slice(0, 16),
              audio: adaptive.filter((f) => (f.mimeType || '').startsWith('audio/')).map(m),
            });
          })
          .catch((e) => done({ error: String(e) }));
      } catch (e) {
        done({ error: String(e) });
      }
    });

    await shot('10-real-player.png');

    const controls = await driver.findElements(By.css('.ytp-right-controls'));
    if (controls.length) {
      try {
        await save('11-real-right-controls.png', await controls[0].takeScreenshot());
      } catch (e) {
        log('right-controls element shot failed', String(e).slice(0, 80));
      }
    }
    const art = await driver.findElements(By.css('.yta-audio-artwork'));
    if (art.length) {
      try {
        await save('12-real-artwork.png', await art[0].takeScreenshot());
      } catch (e) {
        log('artwork element shot failed (likely 0-size / not visible)', String(e).slice(0, 80));
      }
    }

    // Theater (semi-maximized) and fullscreen (maximized): verify the control + artwork geometry
    // scales flawlessly. Uses YouTube's own size/fullscreen buttons (more reliable than key events).
    const clickIf = async (selector) => {
      const els = await driver.findElements(By.css(selector));
      if (!els.length) return false;
      try {
        await els[0].click();
        return true;
      } catch {
        return false;
      }
    };
    const modeGeo = () =>
      driver.executeScript(function () {
        const toggle = document.getElementById('yta-audio-only-toggle');
        const art = document.querySelector('.yta-audio-artwork');
        const player = document.querySelector('#movie_player, .html5-video-player');
        const gear = document.querySelector('.ytp-settings-button');
        return {
          toggle: toggle ? toggle.getBoundingClientRect().toJSON() : null,
          gear: gear ? gear.getBoundingClientRect().toJSON() : null,
          artwork: art ? art.getBoundingClientRect().toJSON() : null,
          player: player ? player.getBoundingClientRect().toJSON() : null,
          fullscreen: !!document.fullscreenElement,
        };
      });
    const revealAndShoot = async (name) => {
      try {
        const p = await driver.findElement(By.css('#movie_player, .html5-video-player'));
        await driver.actions().move({ origin: p }).perform();
      } catch {
        /* ignore */
      }
      await driver.sleep(700);
      await shot(name);
    };

    if (await clickIf('.ytp-size-button')) {
      await driver.sleep(1500);
      report.steps.theater = await modeGeo();
      await revealAndShoot('14-real-theater.png');
      await clickIf('.ytp-size-button'); // exit theater
      await driver.sleep(1000);
    }
    // Fullscreen: the Fullscreen API needs a TRUSTED gesture, so use an Actions mouse click (trusted,
    // isTrusted=true) with an 'f'-hotkey fallback, and verify document.fullscreenElement engaged.
    try {
      const fsBtn = await driver.findElements(By.css('.ytp-fullscreen-button'));
      if (fsBtn.length) {
        await driver.actions().move({ origin: fsBtn[0] }).pause(200).click().perform();
        await driver.sleep(1500);
        let fs = await driver.executeScript('return !!document.fullscreenElement');
        if (!fs) {
          const player = await driver.findElement(By.css('#movie_player, .html5-video-player'));
          await driver.actions().move({ origin: player }).pause(150).sendKeys('f').perform();
          await driver.sleep(1500);
          fs = await driver.executeScript('return !!document.fullscreenElement');
        }
        log('fullscreen engaged:', fs);
        report.steps.fullscreen = await modeGeo();
        await revealAndShoot('15-real-fullscreen.png');
      }
    } catch (e) {
      log('fullscreen failed', String(e).slice(0, 100));
    }

    // Real verification, not an unconditional pass: the core invariants must actually hold. (A
    // canary/dev tool — audio hijack can legitimately fail on live/age-restricted videos, which is
    // itself signal.) Diagnostics above are collected regardless so a failure is explainable.
    const st = report.steps.state || {};
    report.checks = {
      audioHijacked: st.isGooglevideoAudio === true,
      togglePresent: st.togglePresent === true,
      artworkVisible: st.artworkPresent === true && !!st.artworkRect && st.artworkRect.height > 0,
    };
    report.ok = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.ok = false;
    report.error = String(error && error.stack ? error.stack : error);
    log('ERROR', report.error);
    // Capture whatever is on screen so the failure is diagnosable (consent wall, bot check, etc.).
    try {
      report.errorUrl = await driver.getCurrentUrl();
      report.errorTitle = await driver.getTitle();
      report.bodyText = await driver.executeScript(function () {
        return document.body ? document.body.innerText.slice(0, 600) : null;
      });
      writeFileSync(join(OUT, '99-error-state.png'), await driver.takeScreenshot(), 'base64');
      log('error url:', report.errorUrl, '| bodyText:', (report.bodyText || '').replace(/\n/g, ' '));
    } catch {
      /* driver may be dead */
    }
  } finally {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await driver.quit().catch(() => undefined);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
