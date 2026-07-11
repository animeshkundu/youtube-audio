#!/usr/bin/env node
/**
 * LIVE-SIGNAL AUDIT — resolves the cross-lab review's finding 2 empirically.
 * Harvests a diverse corpus live, fetches each ANDROID_VR player response, and buckets by:
 *   currently-live  (videoDetails.isLive === true)
 *   ex-live VOD     (isLive!==true && isLiveContent===true)  <- the finding-2 risk class
 *   normal VOD      (neither)
 * For each, records manifest presence (hls/dash) and whether the BEST audio format has a
 * contentLength. Question answered: does an ex-live VOD ever carry a manifest url (which would make
 * the manifest-presence secondary signal false-positive)? And is audio `contentLength` a cleaner,
 * direct "is this a finite/hijackable file" signal than manifest presence?
 *
 * Usage: node tests/e2e/probe-live-signal-audit.mjs
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3',
  osName: 'Android', osVersion: '12L', androidSdkVersion: 32,
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  hl: 'en', gl: 'US',
};
// Queries chosen to surface ex-live VODs (completed premieres / past broadcasts / concert replays)
// alongside currently-live and normal VOD.
const LIVE_FILTER = 'EgJAAQ%3D%3D';
const QUERIES = [
  { q: 'live now news', n: 4, live: true },
  { q: 'lofi hip hop radio', n: 3, live: true },
  { q: 'full concert live performance', n: 5 },
  { q: 'premiere official music video', n: 5 },
  { q: 'world cup full match replay', n: 4 },
  { q: 'gameplay stream vod', n: 4 },
  { q: 'official music video', n: 4 },
  { q: 'podcast full episode', n: 3 },
  { q: '24/7 live stream', n: 3, live: true },
];
const SEEDS = ['X4VbdwhkE10', '7NOSDKb0HlU', 'Bu4ztj3R32k', 'dQw4w9WgXcQ', 'jfKfPfyJRdk'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function opts() {
  const v = new firefox.Options();
  if (process.env.HEADLESS !== '0') v.addArguments('-headless');
  v.setPreference('intl.accept_languages', 'en-US, en');
  return v;
}

async function harvest(driver) {
  const ids = new Set();
  for (const { q, n, live } of QUERIES) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US` +
      (live ? `&sp=${LIVE_FILTER}` : '');
    try {
      await driver.get(url);
      await sleep(2000);
      const found = await driver.executeScript(function () {
        const out = [], re = /"videoId":"([a-zA-Z0-9_-]{11})"/g, s = document.documentElement.innerHTML;
        let m; while ((m = re.exec(s)) !== null) out.push(m[1]);
        return out;
      });
      let added = 0;
      for (const id of found) { if (added >= n) break; if (!ids.has(id)) { ids.add(id); added += 1; } }
    } catch { /* skip */ }
  }
  for (const s of SEEDS) ids.add(s);
  return [...ids];
}

async function shape(driver, videoId) {
  return driver.executeAsyncScript(function (id, client) {
    const done = arguments[arguments.length - 1];
    const key = window.ytcfg && window.ytcfg.get('INNERTUBE_API_KEY');
    const vd = window.ytcfg && window.ytcfg.get('VISITOR_DATA');
    if (!key) return done({ ok: false, error: 'no-key' });
    fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: vd ? Object.assign({}, client, { visitorData: vd }) : client },
        videoId: id, contentCheckOk: true, racyCheckOk: true }),
    }).then((r) => r.json()).then((j) => {
      const sd = j.streamingData || {};
      const fmts = sd.adaptiveFormats || [];
      const audio = fmts.filter((f) => f && String(f.mimeType || '').indexOf('audio/') === 0)
        .sort((a, b) => (b.itag === 251 ? 2 : b.itag === 140 ? 1 : 0) - (a.itag === 251 ? 2 : a.itag === 140 ? 1 : 0));
      const best = audio[0] || {};
      const d = j.videoDetails || {};
      done({
        ok: true, status: j.playabilityStatus && j.playabilityStatus.status,
        isLive: !!d.isLive, isLiveContent: !!d.isLiveContent,
        hasHls: typeof sd.hlsManifestUrl === 'string' && sd.hlsManifestUrl.length > 0,
        hasDash: typeof sd.dashManifestUrl === 'string' && sd.dashManifestUrl.length > 0,
        hlsEmpty: sd.hlsManifestUrl === '', dashEmpty: sd.dashManifestUrl === '',
        audioItag: best.itag || null,
        audioHasContentLength: !!(best.contentLength && Number(best.contentLength) > 0),
        audioUrlHasSq: typeof best.url === 'string' && best.url.indexOf('/sq/') >= 0,
        audioHasUrl: typeof best.url === 'string' && best.url.length > 0,
      });
    }).catch((e) => done({ ok: false, error: String(e) }));
  }, videoId, ANDROID_VR_CLIENT);
}

const rows = [];
let driver;
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts()).build();
  await driver.manage().setTimeouts({ script: 60_000, pageLoad: 60_000 });
  const corpus = await harvest(driver);
  await driver.get('https://www.youtube.com/?hl=en&gl=US');
  await sleep(2500);
  for (const id of corpus) {
    const s = await shape(driver, id);
    if (s.ok && s.status === 'OK') rows.push({ id, ...s });
    await sleep(300);
  }
} finally {
  if (driver) await driver.quit().catch(() => undefined);
}

const bucket = (r) => (r.isLive ? 'currently-live' : r.isLiveContent ? 'ex-live-VOD' : 'normal-VOD');
const buckets = { 'currently-live': [], 'ex-live-VOD': [], 'normal-VOD': [] };
for (const r of rows) buckets[bucket(r)].push(r);

console.log(`\nAudited ${rows.length} playable videos.\n`);
for (const [name, list] of Object.entries(buckets)) {
  const withManifest = list.filter((r) => r.hasHls || r.hasDash).length;
  const withContentLen = list.filter((r) => r.audioHasContentLength).length;
  console.log(`== ${name}: ${list.length} ==`);
  console.log(`   manifest(hls|dash) present: ${withManifest}/${list.length}`);
  console.log(`   audio contentLength present: ${withContentLen}/${list.length}`);
  for (const r of list) {
    console.log(`   ${r.id} isLive=${r.isLive?'Y':'n'} isLiveContent=${r.isLiveContent?'Y':'n'} ` +
      `hls=${r.hasHls?'Y':r.hlsEmpty?'∅':'n'} dash=${r.hasDash?'Y':r.dashEmpty?'∅':'n'} ` +
      `itag=${r.audioItag} contentLen=${r.audioHasContentLength?'Y':'n'} sq=${r.audioUrlHasSq?'Y':'n'}`);
  }
  console.log('');
}
// The finding-2 red flag: an ex-live VOD with a manifest url (manifest-signal false-positive)
const fp = buckets['ex-live-VOD'].filter((r) => r.hasHls || r.hasDash);
console.log(`FINDING-2 CHECK — ex-live VODs carrying a manifest url: ${fp.length}` +
  (fp.length ? ` (${fp.map((r) => r.id).join(',')}) -> manifest signal WOULD false-positive` : ' -> manifest signal safe'));
const liveNoCL = buckets['currently-live'].filter((r) => !r.audioHasContentLength).length;
const vodAllCL = [...buckets['ex-live-VOD'], ...buckets['normal-VOD']].every((r) => r.audioHasContentLength);
console.log(`CONTENTLENGTH SIGNAL — currently-live lacking contentLength: ${liveNoCL}/${buckets['currently-live'].length}; ` +
  `all VOD (incl ex-live) have contentLength: ${vodAllCL}`);
