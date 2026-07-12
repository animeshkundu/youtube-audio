#!/usr/bin/env node
/**
 * SETTINGS-PERMUTATION matrix (real Firefox, hermetic fixture).
 *
 * Reuses the run-bench harness (`runSession`) to seed a settings combination via the extension's
 * own options page + storage, drive the fixture watch page, and assert the REAL user-visible
 * OUTCOME of every active feature (not just that a signal fired). Covers the master gate, all-on,
 * all-off, each setting alone, a pairwise covering array over the boolean toggles, the key
 * interactions, and the fallback/edge cases. Deterministic, no live network.
 *
 *   npm run test:matrix
 *   SKIP_BUILD=1 npm run test:matrix   # reuse dist/youtube-audio-bench.xpi
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createFixtureServer } from './fixture-server.mjs';
import { runSession, buildBenchExtension } from './run-bench.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const SKIP_BUILD = process.env.SKIP_BUILD === '1';
const BENCH_XPI = join(repoRoot, 'dist', 'youtube-audio-bench.xpi');
const MV2_MANIFEST = join(repoRoot, '.output', 'firefox-mv2', 'manifest.json');

// Maps a forceQualityMax cap to the YouTube quality label the extension requests.
const QUALITY_LABEL = {
  '144p': 'tiny',
  '240p': 'small',
  '360p': 'medium',
  '480p': 'large',
  '720p': 'hd720',
  '1080p': 'hd1080',
};

// The fixture advertises playerConfig.audioConfig.loudnessDb = -8.5; the extension maps that to a
// GainNode value via loudnessDbToGain = min(2, max(0.5, 10^(-loudnessDb/20))) = 2.0 (clamped).
// Loudness OFF leaves unity gain (1). This lets the audio-graph check assert the actual applied gain,
// not merely that a graph exists.
const FIXTURE_LOUDNESS_DB = -8.5;
const EXPECTED_LOUDNESS_GAIN = Math.min(2, Math.max(0.5, 10 ** (-FIXTURE_LOUDNESS_DB / 20)));

// Every boolean toggle (excludes the master `enabled` and the non-boolean forceQualityMax; both
// are exercised explicitly). Order is stable for the covering array.
const TOGGLES = [
  'audioOnlyEnabled',
  'backgroundPlayEnabled',
  'ghostEnabled',
  'aggressiveTelemetry',
  'adBlockEnabled',
  'segmentSkipEnabled',
  'disableAutoplayNext',
  'hideShorts',
  'hideRecommendations',
  'hideComments',
  'loudnessNormalization',
  'equalizerEnabled',
  'lyricsEnabled',
  'downloadEnabled',
];

/** enabled:true, every feature OFF. Combos are built by overriding this. */
const BASE = Object.freeze({
  enabled: true,
  audioOnlyEnabled: false,
  backgroundPlayEnabled: false,
  ghostEnabled: false,
  aggressiveTelemetry: false,
  adBlockEnabled: false,
  segmentSkipEnabled: false,
  segmentSkipCategories: ['sponsor', 'music_offtopic'],
  forceQualityMax: 'off',
  disableAutoplayNext: false,
  hideShorts: false,
  hideRecommendations: false,
  hideComments: false,
  loudnessNormalization: false,
  equalizerEnabled: false,
  equalizerBands: [0, 0, 0, 0, 0],
  lyricsEnabled: false,
  downloadEnabled: false,
});

const settings = (overrides) => ({ ...BASE, ...overrides });
const reqCount = (log, path) => log.filter((r) => r.path === path).length;
const hijacked = (r) => typeof r.videoSrc === 'string' && r.videoSrc.includes('/videoplayback');

/**
 * Per-feature OUTCOME checks. Each returns null on pass or a string describing the failure.
 * `s` is the seeded settings for this combo, `r` the runSession result, `log` the request log.
 * Audio-only interacts with a few features (no video track), so those are conditional.
 */
function checkFeature(feature, s, r, log) {
  const want = s[feature];
  switch (feature) {
    case 'audioOnlyEnabled':
      if (want) return r.status === 'active' && hijacked(r) ? null : `audioOnly on: status=${r.status} src=${r.videoSrc}`;
      return hijacked(r) ? `audioOnly off but hijacked: ${r.videoSrc}` : null;
    case 'backgroundPlayEnabled':
      if (want) return r.vis?.swallowed === true ? null : 'background on: visibilitychange not swallowed';
      return r.vis?.received === true ? null : 'background off: visibilitychange should pass through';
    case 'adBlockEnabled':
      if (want) {
        if (r.player?.hasAdPlacements !== false) return 'adBlock on: XHR player still has adPlacements';
        if (r.inlinePlayerResponse?.hasAdPlacements || r.inlinePlayerResponse?.hasPlayerAds)
          return 'adBlock on: inline ytInitialPlayerResponse still has ads';
        return null;
      }
      if (r.player?.hasAdPlacements !== true) return 'adBlock off: XHR adPlacements should be preserved';
      if (!r.inlinePlayerResponse?.hasAdPlacements)
        return 'adBlock off: inline ytInitialPlayerResponse ads should be preserved';
      return null;
    case 'ghostEnabled':
      if (want) return reqCount(log, '/api/stats/qoe') === 0 ? null : 'ghost on: qoe beacon not blocked';
      return reqCount(log, '/api/stats/qoe') >= 1 ? null : 'ghost off: qoe beacon should fire';
    case 'aggressiveTelemetry':
      // Aggressive mode is a sub-mode of ghost (background.ts blockTelemetry requires ghostEnabled)
      // that additionally blocks the /api/stats/watchtime + /playback beacons. It is a no-op
      // without ghost, so only assert when ghost is on. (log_event is never blocked by design.)
      if (!s.ghostEnabled) return null;
      if (want) return reqCount(log, '/api/stats/watchtime') === 0 ? null : 'aggressiveTelemetry on: watchtime beacon not blocked';
      return reqCount(log, '/api/stats/watchtime') >= 1 ? null : 'aggressiveTelemetry off: watchtime beacon should fire';
    case 'segmentSkipEnabled':
      // Reliable signal across combos is that the skip scheduler ARMED (the seek itself races the
      // audio-only hijack and is asserted separately in run-bench with audio-only off).
      if (want) return r.segmentSkip?.armed === '1' || r.segmentSkip?.skipped === true ? null : 'segmentSkip on: scheduler not armed';
      return r.skipArmed === '1' ? 'segmentSkip off: scheduler armed unexpectedly' : null;
    case 'hideShorts':
      return want ? (r.qol?.shortsHidden === true ? null : 'hideShorts on: shorts visible') : (r.qol?.shortsHidden === false ? null : 'hideShorts off: shorts not confirmed visible');
    case 'hideRecommendations':
      return want ? (r.qol?.recsHidden === true ? null : 'hideRecs on: recs visible') : (r.qol?.recsHidden === false ? null : 'hideRecs off: recs not confirmed visible');
    case 'hideComments':
      return want ? (r.qol?.commentsHidden === true ? null : 'hideComments on: comments visible') : (r.qol?.commentsHidden === false ? null : 'hideComments off: comments not confirmed visible');
    case 'lyricsEnabled':
      return want ? (r.lyrics !== null ? null : 'lyrics on: not rendered') : (r.lyrics === null ? null : 'lyrics off: rendered');
    case 'downloadEnabled':
      return want ? (r.downloadButtonVisible === true ? null : 'download on: button hidden') : (r.downloadButtonVisible !== true ? null : 'download off: button visible');
    case 'disableAutoplayNext':
      // The extension clicks the autonav toggle off (only when currently on); the fixture flips its
      // aria-checked on click, so 'false' proves it took effect and 'true' proves it was untouched.
      return want
        ? r.autonavChecked === 'false'
          ? null
          : `disableAutoplayNext on: autonav toggle not turned off (aria-checked=${r.autonavChecked})`
        : r.autonavChecked === 'true'
          ? null
          : `disableAutoplayNext off: autonav toggle should stay on (aria-checked=${r.autonavChecked})`;
    default:
      return null; // loudness/EQ are asserted via checkAudioGraph
  }
}

/** Audio graph arms iff loudness OR EQ is on (they share the graph). When armed, the applied
 * GainNode value must equal the loudness-derived gain (loudness on) or unity (loudness off). */
function checkAudioGraph(s, r) {
  const armed = s.loudnessNormalization || s.equalizerEnabled;
  if (!armed) return r.audioGraph === null ? null : 'audio graph should be idle (loudness+EQ off)';
  if (r.audioGraph === null) return 'audio graph should be armed (loudness/EQ)';
  let gain = null;
  try {
    gain = JSON.parse(r.audioGraph).gain;
  } catch {
    /* leave null */
  }
  if (typeof gain !== 'number') return `audio graph armed but exposed no gain (${r.audioGraph})`;
  const expected = s.loudnessNormalization ? EXPECTED_LOUDNESS_GAIN : 1;
  return Math.abs(gain - expected) < 0.01
    ? null
    : `loudness ${s.loudnessNormalization ? 'on' : 'off'}: applied gain ${gain} != expected ${expected}`;
}

/** forceQualityMax: assert the label is requested. Audio-only has no video track, so skip the
 * assertion when audio-only is on (the cap must simply no-op without error - covered by baseline). */
function checkQuality(s, r) {
  if (s.audioOnlyEnabled) return null; // no video track; the cap no-ops (baseline verifies no error)
  const calls = r.qol?.qualityCalls || [];
  if (s.forceQualityMax === 'off')
    return calls.length === 0 ? null : 'forceQuality off: quality forced unexpectedly';
  const label = QUALITY_LABEL[s.forceQualityMax];
  return calls.some((q) => q.max === label || q.quality === label)
    ? null
    : `forceQuality ${s.forceQualityMax}: label ${label} not requested`;
}

/** Which probes a combo needs (side-effecting probes only when their feature is on). */
function probesFor(s) {
  return {
    probePlayerFromPage: true, // adBlock XHR outcome
    probeQol: true, // quality + distraction outcomes
    probeSegmentSkip: !!s.segmentSkipEnabled,
    probeDownload: !!s.downloadEnabled,
  };
}

const tests = [];
const record = (name, failures, detail) =>
  tests.push({ name, pass: failures.length === 0, detail: { ...detail, failures } });

/** Run one combo and assert the full outcome set for every feature + non-interference. */
async function runCombo(name, s, { videoId, fixture } = {}) {
  const r = await runSession({
    withAddon: true,
    seedSettings: s,
    ...probesFor(s),
    videoId,
    origin: fixture.origin,
    resetLog: () => fixture.reset(),
  });
  const log = fixture.getRequests();
  const failures = [];
  if (r.marker !== '1') failures.push(`content script marker missing (marker=${r.marker})`);
  if (!['active', 'fallback', 'disabled'].includes(r.status || '')) failures.push(`non-terminal status ${r.status}`);
  for (const f of TOGGLES) {
    const fail = checkFeature(f, s, r, log);
    if (fail) failures.push(fail);
  }
  const ag = checkAudioGraph(s, r);
  if (ag) failures.push(ag);
  const q = checkQuality(s, r);
  if (q) failures.push(q);
  record(name, failures, { status: r.status, videoSrc: r.videoSrc?.slice(0, 48) });
  return { r, log };
}

/**
 * Deterministic strength-2 covering array over the boolean toggles: a small set of MIXED on/off
 * rows such that for every pair of toggles, all four (off,off)/(off,on)/(on,off)/(on,on)
 * combinations appear in at least one row. This exercises each feature in varied contexts (not just
 * everything-on), which is what catches interaction bugs. Returns rows as {toggle: boolean}.
 */
function coveringArray(names) {
  const n = names.length;
  const targets = new Set();
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1)
      for (const vi of [0, 1]) for (const vj of [0, 1]) targets.add(`${i},${j},${vi},${vj}`);
  // Seeded PRNG (mulberry32) so the generated rows - and thus pass/fail - are reproducible.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gain = (row) => {
    let g = 0;
    for (let i = 0; i < n; i += 1)
      for (let j = i + 1; j < n; j += 1) if (targets.has(`${i},${j},${row[i]},${row[j]}`)) g += 1;
    return g;
  };
  const rows = [];
  while (targets.size > 0 && rows.length < 30) {
    let best = null;
    let bestGain = -1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const row = Array.from({ length: n }, () => (rand() < 0.5 ? 0 : 1));
      const g = gain(row);
      if (g > bestGain) {
        bestGain = g;
        best = row;
      }
    }
    for (let i = 0; i < n; i += 1)
      for (let j = i + 1; j < n; j += 1) targets.delete(`${i},${j},${best[i]},${best[j]}`);
    rows.push(best);
  }
  // targets.size > 0 here means the row cap was hit before every pair was covered; surface it so a
  // silent truncation can't masquerade as full pairwise coverage.
  return {
    uncovered: targets.size,
    rows: rows.map((row) => Object.fromEntries(names.map((name, k) => [name, !!row[k]]))),
  };
}

async function main() {
  if (!SKIP_BUILD) buildBenchExtension();
  else if (!existsSync(BENCH_XPI)) throw new Error(`SKIP_BUILD set but ${BENCH_XPI} missing`);

  // Manifest icon OUTCOME (the icon bug was invisible to page-context tests).
  try {
    const manifest = JSON.parse(readFileSync(MV2_MANIFEST, 'utf-8'));
    const failures = [];
    if (!manifest.icons || Object.keys(manifest.icons).length === 0) failures.push('manifest.icons empty');
    const actionIcon = manifest.browser_action?.default_icon || manifest.action?.default_icon;
    if (!actionIcon || Object.keys(actionIcon).length === 0) failures.push('toolbar default_icon missing');
    for (const rel of Object.values(manifest.icons || {})) {
      if (!existsSync(join(dirname(MV2_MANIFEST), rel))) failures.push(`icon file missing: ${rel}`);
    }
    record('manifest:icons-declared-and-present', failures, { icons: Object.keys(manifest.icons || {}) });
  } catch (e) {
    record('manifest:icons-declared-and-present', [`could not read built manifest: ${e}`], {});
  }

  const fixture = createFixtureServer();
  const { origin } = await fixture.start();
  const ctx = { fixture: { ...fixture, origin } };

  try {
    // --- Global states -----------------------------------------------------
    // Master gate: enabled=false with every feature on -> nothing happens.
    {
      const s = settings(Object.fromEntries(TOGGLES.map((t) => [t, true])));
      s.enabled = false;
      s.forceQualityMax = '1080p';
      const r = await runSession({ withAddon: true, seedSettings: s, ...probesFor(s), origin, resetLog: () => fixture.reset() });
      const log = fixture.getRequests();
      const failures = [];
      if (hijacked(r)) failures.push('master-gate: hijacked despite enabled=false');
      if (r.downloadButtonVisible === true) failures.push('master-gate: download button shown');
      if (r.qol?.shortsHidden === true || r.qol?.recsHidden === true || r.qol?.commentsHidden === true) failures.push('master-gate: distractions hidden');
      if (r.audioGraph !== null) failures.push('master-gate: audio graph armed');
      if (r.lyrics !== null) failures.push('master-gate: lyrics rendered');
      if (r.vis?.swallowed === true) failures.push('master-gate: visibility swallowed despite disabled');
      if (r.skipArmed === '1') failures.push('master-gate: segment skip armed despite disabled');
      if ((r.qol?.qualityCalls || []).length > 0) failures.push('master-gate: quality forced despite disabled');
      if (reqCount(log, '/api/stats/qoe') === 0) failures.push('master-gate: telemetry blocked despite disabled');
      if (r.player?.hasAdPlacements === false) failures.push('master-gate: ads pruned despite disabled');
      record('global:master-gate-enabled-false-does-nothing', failures, { status: r.status });
    }

    // All features on together.
    await runCombo('global:all-on', settings(Object.fromEntries([...TOGGLES.map((t) => [t, true]), ['forceQualityMax', '1080p']])), ctx);
    // Enabled, every feature off.
    await runCombo('global:all-off', settings({}), ctx);

    // --- Singles: each toggle alone ---------------------------------------
    for (const t of TOGGLES) {
      await runCombo(`single:${t}`, settings({ [t]: true }), ctx);
    }
    await runCombo('single:forceQualityMax-1080p', settings({ forceQualityMax: '1080p' }), ctx);
    // Quality-cap enum beyond 1080p: each value maps to a distinct YouTube label (checkQuality
    // asserts the exact label is requested), so a regression collapsing the enum is caught.
    await runCombo('single:forceQualityMax-480p', settings({ forceQualityMax: '480p' }), ctx);
    await runCombo('single:forceQualityMax-720p', settings({ forceQualityMax: '720p' }), ctx);

    // --- Key interactions --------------------------------------------------
    await runCombo('pair:audioOnly+adBlock', settings({ audioOnlyEnabled: true, adBlockEnabled: true }), ctx);
    await runCombo('pair:audioOnly+loudness+eq', settings({ audioOnlyEnabled: true, loudnessNormalization: true, equalizerEnabled: true }), ctx);
    // EQ with NON-ZERO bands: the applied biquad gains must match the configured bands (a flat-band
    // test would false-pass even if the filters ignored the bands entirely).
    {
      const bands = [6, -4, 2, -2, 5];
      const s = settings({ equalizerEnabled: true, equalizerBands: bands });
      const r = await runSession({ withAddon: true, seedSettings: s, origin, resetLog: () => fixture.reset() });
      const failures = [];
      let eqGains = null;
      try {
        eqGains = JSON.parse(r.audioGraph || '{}').eqGains;
      } catch {
        /* leave null */
      }
      if (!Array.isArray(eqGains)) failures.push('eq on: audio graph did not expose filter gains');
      else if (!bands.every((b, i) => Math.abs((eqGains[i] ?? 999) - b) < 0.001))
        failures.push(`eq on: filter gains ${JSON.stringify(eqGains)} do not match bands ${JSON.stringify(bands)}`);
      record('feature:equalizer-applies-configured-band-gains', failures, { eqGains });
    }
    // EQ off (loudness on so the graph still arms): every band gain must be neutralized to 0.
    {
      const s = settings({ equalizerEnabled: false, equalizerBands: [6, -4, 2, -2, 5], loudnessNormalization: true });
      const r = await runSession({ withAddon: true, seedSettings: s, origin, resetLog: () => fixture.reset() });
      const failures = [];
      let eqGains = null;
      try {
        eqGains = JSON.parse(r.audioGraph || '{}').eqGains;
      } catch {
        /* leave null */
      }
      if (!Array.isArray(eqGains) || !eqGains.every((g) => g === 0))
        failures.push(`eq off: filter gains should all be 0, got ${JSON.stringify(eqGains)}`);
      record('feature:equalizer-off-zeroes-band-gains', failures, { eqGains });
    }
    await runCombo('pair:audioOnly+background', settings({ audioOnlyEnabled: true, backgroundPlayEnabled: true }), ctx);
    await runCombo('pair:ghost+aggressiveTelemetry', settings({ ghostEnabled: true, aggressiveTelemetry: true }), ctx);
    await runCombo('pair:all-three-distractions', settings({ hideShorts: true, hideRecommendations: true, hideComments: true }), ctx);
    // Edge: audio-only has no video track; a quality cap must no-op gracefully (no error).
    await runCombo('edge:forceQuality+audioOnly-graceful', settings({ audioOnlyEnabled: true, forceQualityMax: '1080p' }), ctx);
    // Segment-skip seek needs audio-only off (matches run-bench); assert the actual seek here.
    {
      const s = settings({ segmentSkipEnabled: true, adBlockEnabled: true });
      const r = await runSession({ withAddon: true, seedSettings: s, probeSegmentSkip: true, probePlayerFromPage: true, origin, resetLog: () => fixture.reset() });
      const log = fixture.getRequests();
      const failures = [];
      if (r.segmentSkip?.skipped !== true) failures.push('segmentSkip+adBlock: skip did not seek');
      if (r.player?.hasAdPlacements !== false) failures.push('segmentSkip+adBlock: ads not pruned');
      record('pair:segmentSkip+adBlock-seek-and-prune', failures, { segmentSkip: r.segmentSkip });
    }

    // SponsorBlock CATEGORY filtering (the extension re-filters received segments client-side via
    // selectSegments). The fixture always returns a 'sponsor' [0,5.25] + 'outro' segment. Only-sponsor
    // selected -> the sponsor segment is skipped; only-music_offtopic selected (no matching segment)
    // -> the sponsor segment is deliberately left alone. This proves per-category filtering, not a
    // blanket skip-everything (a blanket regression would fail the negative case).
    {
      const s = settings({ segmentSkipEnabled: true, segmentSkipCategories: ['sponsor'] });
      const r = await runSession({ withAddon: true, seedSettings: s, probeSegmentSkip: true, origin, resetLog: () => fixture.reset() });
      record(
        'category:only-sponsor-selected-skips-sponsor',
        r.segmentSkip?.skipped === true ? [] : [`sponsor selected: segment not skipped (${JSON.stringify(r.segmentSkip)})`],
        { segmentSkip: r.segmentSkip },
      );
    }
    {
      const s = settings({ segmentSkipEnabled: true, segmentSkipCategories: ['music_offtopic'] });
      const r = await runSession({ withAddon: true, seedSettings: s, probeSegmentSkip: true, origin, resetLog: () => fixture.reset() });
      record(
        'category:only-musicofftopic-selected-leaves-sponsor-alone',
        r.segmentSkip?.skipped !== true ? [] : ['music_offtopic selected: sponsor segment skipped anyway (category filter ignored)'],
        { segmentSkip: r.segmentSkip },
      );
    }

    // SPA re-arm: YouTube is a single-page app; the extension must re-apply features after an in-page
    // navigation (yt-navigate-finish) with no full reload. Assert audio-only re-hijacks on BOTH the
    // first watch page AND the SPA-navigated second video (a regression that only arms on hard load
    // would leave the second video playing full video).
    {
      const s = settings({ audioOnlyEnabled: true });
      const r = await runSession({ withAddon: true, seedSettings: s, probeSpaRearm: true, origin, resetLog: () => fixture.reset() });
      const failures = [];
      const first = r.spaRearm?.first;
      const second = r.spaRearm?.second;
      if (!(first?.status === 'active' && hijacked(first))) failures.push(`spa: first nav not armed (${JSON.stringify(first)})`);
      if (!(second?.status === 'active' && hijacked(second))) failures.push(`spa: second nav did not re-arm (${JSON.stringify(second)})`);
      record('spa:audioOnly-rearms-across-in-page-navigation', failures, { first, second });
    }

    // --- Download assembly outcome (range-aware fixture, media > 4 MiB chunk) --------------
    {
      const s = settings({ downloadEnabled: true });
      const r = await runSession({
        withAddon: true,
        seedSettings: s,
        probeDownload: true,
        origin,
        resetLog: () => fixture.reset(),
      });
      const log = fixture.getRequests();
      const ranges = log
        .filter((x) => x.path === '/videoplayback' && x.responseStatus === 206 && x.contentRange)
        .map((x) => /bytes (\d+)-(\d+)\/(\d+)/.exec(x.contentRange))
        .filter(Boolean)
        .map((m) => ({ start: +m[1], end: +m[2], total: +m[3] }));
      const failures = [];
      if (!r.download) failures.push('download: no completion marker (assembly failed before save)');
      if (ranges.length < 2)
        failures.push(`download: expected multiple range requests (multi-chunk concat), got ${ranges.length}`);
      // The ranges must contiguously cover [0, total): proof the whole file was assembled as one.
      const total = ranges[0]?.total;
      const sorted = ranges.slice().sort((a, b) => a.start - b.start);
      let covered = 0;
      let contiguous = sorted.length > 0 && sorted[0].start === 0;
      for (const seg of sorted) {
        if (seg.start > covered) contiguous = false;
        covered = Math.max(covered, seg.end + 1);
      }
      if (!contiguous || covered !== total)
        failures.push(`download: ranges do not contiguously cover [0,${total}) (covered ${covered})`);
      record('download:assembles-full-file-via-multiple-ranges', failures, {
        rangeRequests: ranges.length,
        total,
        covered,
      });
    }

    // --- Edge fallbacks ----------------------------------------------------
    // Live: audio-only falls back AND ad-block still prunes.
    await (async () => {
      const s = settings({ audioOnlyEnabled: true, adBlockEnabled: true });
      const r = await runSession({ withAddon: true, seedSettings: s, probePlayerFromPage: true, videoId: 'LIVESTREAM01', origin, resetLog: () => fixture.reset() });
      const failures = [];
      if (r.status !== 'fallback') failures.push(`live: expected fallback, got ${r.status}`);
      if (hijacked(r)) failures.push('live: hijacked a live stream');
      if (r.player?.hasAdPlacements !== false) failures.push('live: ads not pruned');
      record('edge:live-fallback-still-prunes-ads', failures, { status: r.status, reason: r.reason });
    })();
    // Kids/auth: audio-only falls back.
    await (async () => {
      const s = settings({ audioOnlyEnabled: true });
      const r = await runSession({ withAddon: true, seedSettings: s, videoId: 'AUTH00000001', origin, resetLog: () => fixture.reset() });
      const failures = [];
      if (r.status !== 'fallback') failures.push(`auth: expected fallback, got ${r.status}`);
      if (hijacked(r)) failures.push('auth: hijacked a login-required video');
      record('edge:auth-required-falls-back', failures, { status: r.status, reason: r.reason });
    })();
    // Kids / made-for-kids (UNPLAYABLE via credentialless ANDROID_VR): audio-only falls back.
    await (async () => {
      const s = settings({ audioOnlyEnabled: true });
      const r = await runSession({
        withAddon: true,
        seedSettings: s,
        videoId: 'KIDS00000001',
        origin,
        resetLog: () => fixture.reset(),
      });
      const failures = [];
      if (r.status !== 'fallback') failures.push(`kids: expected fallback, got ${r.status}`);
      if (hijacked(r)) failures.push('kids: hijacked an unplayable video');
      record('edge:kids-unplayable-falls-back', failures, { status: r.status, reason: r.reason });
    })();

    // --- Covering array: every toggle pair appears in all 4 on/off combinations ----------
    const cover = coveringArray(TOGGLES);
    record(
      'coverage:covering-array-covers-all-toggle-pairs',
      cover.uncovered === 0
        ? []
        : [`${cover.uncovered} toggle pairs never reached all 4 on/off combos (row cap hit)`],
      { rows: cover.rows.length, toggles: TOGGLES.length },
    );
    for (const row of cover.rows) {
      const active = TOGGLES.filter((t) => row[t]);
      await runCombo(`cover:${active.join('+') || 'baseline'}`, settings(row), ctx);
    }
  } finally {
    await fixture.close();
  }

  const passed = tests.filter((t) => t.pass).length;
  const failed = tests.length - passed;
  const verdict = failed === 0 ? 'PASS' : 'FAIL';
  console.log(
    JSON.stringify({ suite: 'settings-permutation matrix', passed, failed, total: tests.length, verdict, failures: tests.filter((t) => !t.pass) }, null, 2)
  );
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.log(JSON.stringify({ suite: 'settings-permutation matrix', verdict: 'ERROR', error: String(err?.stack || err) }, null, 2));
  process.exit(2);
});
