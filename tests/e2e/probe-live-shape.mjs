#!/usr/bin/env node
/**
 * Confirms the live-stream hijack bug across several live IDs and dumps the live-signal fields
 * (videoDetails.isLive/isLiveContent, hlsManifestUrl/dashManifestUrl, first adaptive format shape)
 * so the fix gates on a reliable signal.
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const ADDON_ID = 'youtube-audio@local';
const UUID = '11111111-2222-4333-8444-555555555555';
const LIVE_IDS = ['X4VbdwhkE10', '7NOSDKb0HlU', 'FWjZ0x2M8og', 'ssf1J2tD-Ak'];
const CLIENT = {
  clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3',
  osName: 'Android', osVersion: '12L', androidSdkVersion: 32,
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  hl: 'en', gl: 'US',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function opts() {
  const v = new firefox.Options();
  if (process.env.HEADLESS !== '0') v.addArguments('-headless');
  v.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
  return v;
}

let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  await driver.get('https://www.youtube.com/?hl=en&gl=US');
  await sleep(2500);
  for (const id of LIVE_IDS) {
    const shape = await driver.executeAsyncScript(function (vid, client) {
      const done = arguments[arguments.length - 1];
      const key = window.ytcfg.get('INNERTUBE_API_KEY');
      const vd = window.ytcfg.get('VISITOR_DATA');
      fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: vd ? Object.assign({}, client, { visitorData: vd }) : client },
          videoId: vid, contentCheckOk: true, racyCheckOk: true }),
      }).then((r) => r.json()).then((j) => {
        const sd = j.streamingData || {};
        const f = (sd.adaptiveFormats || []).find((x) => x && String(x.mimeType || '').indexOf('audio/') === 0) || {};
        const d = j.videoDetails || {};
        done({
          status: j.playabilityStatus && j.playabilityStatus.status,
          isLive: !!d.isLive, isLiveContent: !!d.isLiveContent,
          hasHls: !!sd.hlsManifestUrl, hasDash: !!sd.dashManifestUrl,
          fmtType: f.type || null, targetDurationSec: f.targetDurationSec || null,
          hasUrl: !!f.url, itag: f.itag || null,
        });
      }).catch((e) => done({ error: String(e) }));
    }, id, CLIENT);
    console.log(`${id}: ${JSON.stringify(shape)}`);
  }
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}
