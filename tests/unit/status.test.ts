import { describe, expect, it } from 'vitest';

import {
  classifyHost,
  GET_STATUS_MESSAGE,
  isPlaybackStatus,
  isPlaybackUiState,
  isWatchPage,
  markEntryStale,
  parseStatusUpdate,
  parseVideoId,
  reduceStatusUpdate,
  resolveUiState,
  shouldMarkStale,
  STATUS_CHANGED_MESSAGE,
  STATUS_UPDATE_MESSAGE,
  type StatusUpdate,
  type TabStatusEntry,
} from '../../src/shared/status';

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const MUSIC = 'https://music.youtube.com/watch?v=dQw4w9WgXcQ';

function entry(overrides: Partial<TabStatusEntry> = {}): TabStatusEntry {
  return {
    status: 'active',
    videoId: 'dQw4w9WgXcQ',
    runStart: 1_000,
    generation: 1,
    ts: 1_000,
    ...overrides,
  };
}

function update(overrides: Partial<StatusUpdate> = {}): StatusUpdate {
  return { status: 'active', videoId: 'dQw4w9WgXcQ', runStart: 1_000, generation: 1, ...overrides };
}

describe('status: message-type constants', () => {
  it('pins the wire discriminators the three contexts agree on', () => {
    expect(STATUS_UPDATE_MESSAGE).toBe('yta:status-update');
    expect(GET_STATUS_MESSAGE).toBe('yta:get-status');
    expect(STATUS_CHANGED_MESSAGE).toBe('yta:status-changed');
  });
});

describe('classifyHost', () => {
  it('classifies YouTube desktop, mobile, and nocookie hosts as youtube', () => {
    expect(classifyHost('https://www.youtube.com/watch?v=abcdef')).toBe('youtube');
    expect(classifyHost('https://m.youtube.com/watch?v=abcdef')).toBe('youtube');
    expect(classifyHost('https://www.youtube-nocookie.com/embed/abcdef')).toBe('youtube');
    expect(classifyHost('https://youtube.com/')).toBe('youtube');
  });

  it('classifies music.youtube.com as its own music family', () => {
    expect(classifyHost(MUSIC)).toBe('music');
  });

  it('rejects non-YouTube and look-alike hosts', () => {
    expect(classifyHost('https://example.com/watch?v=abcdef')).toBe('not-youtube');
    expect(classifyHost('https://evil-youtube.com/watch?v=abcdef')).toBe('not-youtube');
    expect(classifyHost('https://youtube.com.evil.com/')).toBe('not-youtube');
    expect(classifyHost('not-a-url')).toBe('not-youtube');
    expect(classifyHost(undefined)).toBe('not-youtube');
  });
});

describe('parseVideoId', () => {
  it('extracts a valid ?v= id and rejects the rest', () => {
    expect(parseVideoId(WATCH)).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/watch?v=$$bad$$')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoId('::::')).toBeNull();
    expect(parseVideoId(undefined)).toBeNull();
  });
});

describe('isWatchPage', () => {
  it('is true only for a YouTube-family host with a valid video id', () => {
    expect(isWatchPage(WATCH)).toBe(true);
    expect(isWatchPage(MUSIC)).toBe(true);
    expect(isWatchPage('https://www.youtube.com/feed/subscriptions')).toBe(false);
    expect(isWatchPage('https://example.com/watch?v=dQw4w9WgXcQ')).toBe(false);
  });
});

describe('isPlaybackStatus / isPlaybackUiState', () => {
  it('narrows only the known status vocabulary', () => {
    expect(isPlaybackStatus('active')).toBe(true);
    expect(isPlaybackStatus('fallback')).toBe(true);
    expect(isPlaybackStatus('bogus')).toBe(false);
    expect(isPlaybackStatus(3)).toBe(false);
  });

  it('narrows only well-formed resolved UI states', () => {
    expect(isPlaybackUiState({ kind: 'active' })).toBe(true);
    expect(isPlaybackUiState({ kind: 'fallback', reason: 'live' })).toBe(true);
    expect(isPlaybackUiState({ kind: 'nope' })).toBe(false);
    expect(isPlaybackUiState(null)).toBe(false);
    expect(isPlaybackUiState('active')).toBe(false);
  });
});

describe('resolveUiState', () => {
  it('returns not-youtube off a YouTube host', () => {
    expect(resolveUiState('https://example.com/watch?v=dQw4w9WgXcQ', entry())).toEqual({
      kind: 'not-youtube',
    });
  });

  it('returns not-a-watch-page on a YouTube non-watch page', () => {
    expect(resolveUiState('https://www.youtube.com/feed/subscriptions', undefined)).toEqual({
      kind: 'not-a-watch-page',
    });
  });

  it('returns connecting on a watch page with no entry yet', () => {
    expect(resolveUiState(WATCH, undefined)).toEqual({ kind: 'connecting' });
  });

  it('returns connecting when the entry is stale', () => {
    expect(resolveUiState(WATCH, entry({ stale: true }))).toEqual({ kind: 'connecting' });
  });

  it('returns connecting when a watch-page entry is missing videoId provenance', () => {
    const missingVideoId = entry();
    delete missingVideoId.videoId;
    expect(resolveUiState(WATCH, missingVideoId)).toEqual({ kind: 'connecting' });
  });

  it('returns connecting when the entry describes a different video (nav outran the report)', () => {
    expect(resolveUiState(WATCH, entry({ videoId: 'OTHERVIDEO1' }))).toEqual({
      kind: 'connecting',
    });
  });

  it('returns active for a watch page whose entry is active', () => {
    expect(resolveUiState(WATCH, entry({ status: 'active' }))).toEqual({ kind: 'active' });
  });

  it('returns fallback with the reason for a fallback entry', () => {
    expect(resolveUiState(WATCH, entry({ status: 'fallback', reason: 'live' }))).toEqual({
      kind: 'fallback',
      reason: 'live',
    });
    const noReason: TabStatusEntry = {
      status: 'fallback',
      videoId: 'dQw4w9WgXcQ',
      runStart: 1_000,
      generation: 1,
      ts: 1_000,
    };
    expect(resolveUiState(WATCH, noReason)).toEqual({ kind: 'fallback', reason: null });
  });

  it('returns disabled for a disabled entry', () => {
    expect(resolveUiState(WATCH, entry({ status: 'disabled' }))).toEqual({ kind: 'disabled' });
  });

  it('maps the transient fetching/idle statuses to connecting', () => {
    expect(resolveUiState(WATCH, entry({ status: 'fetching' }))).toEqual({ kind: 'connecting' });
    expect(resolveUiState(WATCH, entry({ status: 'idle' }))).toEqual({ kind: 'connecting' });
  });
});

describe('reduceStatusUpdate', () => {
  it('accepts a first report onto an empty tab', () => {
    const next = reduceStatusUpdate(undefined, update({ status: 'fetching' }), 5_000);
    expect(next).toEqual({
      status: 'fetching',
      videoId: 'dQw4w9WgXcQ',
      runStart: 1_000,
      generation: 1,
      ts: 5_000,
    });
  });

  it('drops a superseded straggler: same lifetime, older generation', () => {
    const current = entry({ status: 'active', generation: 2 });
    const next = reduceStatusUpdate(current, update({ status: 'fetching', generation: 1 }), 9_000);
    expect(next).toBe(current); // identity signals "no change" to the caller
  });

  it('accepts a newer generation within the same lifetime', () => {
    const current = entry({ status: 'fetching', generation: 1 });
    const next = reduceStatusUpdate(current, update({ status: 'active', generation: 2 }), 9_000);
    expect(next).not.toBe(current);
    expect(next.status).toBe('active');
    expect(next.generation).toBe(2);
    expect(next.stale).toBeUndefined();
  });

  it('accepts a newer lifetime even at a lower generation (full reload never freezes)', () => {
    const current = entry({ status: 'active', runStart: 1_000, generation: 5 });
    const next = reduceStatusUpdate(
      current,
      update({ status: 'fetching', runStart: 2_000, generation: 0 }),
      9_000
    );
    expect(next).not.toBe(current);
    expect(next.runStart).toBe(2_000);
    expect(next.status).toBe('fetching');
  });

  it('drops a straggler from an older lifetime even at a higher generation', () => {
    const current = entry({ status: 'active', runStart: 2_000, generation: 0 });
    const next = reduceStatusUpdate(
      current,
      update({ status: 'fallback', runStart: 1_000, generation: 9 }),
      9_000
    );
    expect(next).toBe(current);
  });

  it('accepts an equal-tuple status change within one live operation (fetching -> active)', () => {
    const current = entry({ status: 'fetching', runStart: 1_000, generation: 2 });
    const next = reduceStatusUpdate(
      current,
      update({ status: 'active', runStart: 1_000, generation: 2 }),
      9_000
    );
    expect(next).not.toBe(current);
    expect(next.status).toBe('active');
  });

  it('stale entries still require a superseding update before they can be revived', () => {
    const current = entry({ runStart: 9_000, generation: 9, stale: true });
    const obsolete = reduceStatusUpdate(
      current,
      update({ status: 'active', runStart: 1_000, generation: 1 }),
      9_000
    );
    expect(obsolete).toBe(current);

    // An equal-`(runStart, generation)` straggler from the now-unloaded old document must NOT revive
    // a stale entry — only a strictly-newer epoch may. Regression for the `>=` stale-revival gap
    // where a same-tuple duplicate cleared `stale` and restored the prior video's `active` state.
    const equalTuple = reduceStatusUpdate(
      current,
      update({ status: 'active', runStart: 9_000, generation: 9 }),
      9_500
    );
    expect(equalTuple).toBe(current);

    const fresh = reduceStatusUpdate(
      current,
      update({ status: 'fetching', runStart: 10_000, generation: 0 }),
      10_000
    );
    expect(fresh).not.toBe(current);
    expect(fresh.stale).toBeUndefined();
    expect(fresh.ts).toBe(10_000);
  });

  it('omits reason and videoId when absent (non-watch status)', () => {
    const next = reduceStatusUpdate(
      undefined,
      { status: 'disabled', runStart: 3, generation: 0 },
      1
    );
    expect(next).toEqual({ status: 'disabled', runStart: 3, generation: 0, ts: 1 });
  });
});

describe('markEntryStale', () => {
  it('marks an entry stale so the resolver reads it as connecting (onUpdated url-change clears)', () => {
    const fresh = entry({ status: 'active' });
    const stale = markEntryStale(fresh);
    expect(stale.stale).toBe(true);
    expect(fresh.stale).toBeUndefined(); // pure: original untouched
    expect(resolveUiState(WATCH, stale)).toEqual({ kind: 'connecting' });
  });
});

describe('shouldMarkStale', () => {
  const watchEntry = entry({ videoId: 'dQw4w9WgXcQ' });

  it("marks stale on a document reload ('loading'), regardless of url", () => {
    expect(shouldMarkStale(watchEntry, { status: 'loading' })).toBe(true);
  });

  it('marks stale when the url navigates to a different video', () => {
    expect(
      shouldMarkStale(watchEntry, { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' })
    ).toBe(true);
  });

  it('does NOT mark stale when the url still points at the same video (param rewrite / SPA report race)', () => {
    // The regression this fixes: YouTube rewrites the watch url with &t=/list during playback, or the
    // content script already reported the new video before onUpdated fires. Marking that stale would
    // reject the same operation's own `active` report and strand the popup on `connecting`.
    expect(
      shouldMarkStale(watchEntry, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=RDxyz',
      })
    ).toBe(false);
  });

  it('marks stale when the url leaves the watch page', () => {
    expect(shouldMarkStale(watchEntry, { url: 'https://www.youtube.com/feed/subscriptions' })).toBe(
      true
    );
  });

  it('ignores events with neither a url nor a loading status', () => {
    expect(shouldMarkStale(watchEntry, { status: 'complete' })).toBe(false);
  });

  it('marks stale when the entry has no videoId to match against', () => {
    const noVideoId = entry();
    delete noVideoId.videoId;
    expect(shouldMarkStale(noVideoId, { url: WATCH })).toBe(true);
  });

  it('keeps a same-video entry live so its equal-generation active report lands (end-to-end)', () => {
    // fetching(R,G) accepted -> onUpdated fires for the SAME video -> NOT marked stale -> active(R,G)
    // still supersedes an equal, non-stale generation. Without shouldMarkStale, this stuck at connecting.
    const fetching = entry({
      status: 'fetching',
      videoId: 'dQw4w9WgXcQ',
      runStart: 1_000,
      generation: 3,
    });
    expect(shouldMarkStale(fetching, { url: WATCH })).toBe(false);
    const active = reduceStatusUpdate(
      fetching,
      update({ status: 'active', videoId: 'dQw4w9WgXcQ', runStart: 1_000, generation: 3 }),
      9_000
    );
    expect(active.status).toBe('active');
  });
});

describe('parseStatusUpdate', () => {
  it('accepts a well-formed update and normalizes optional fields', () => {
    expect(
      parseStatusUpdate({
        type: STATUS_UPDATE_MESSAGE,
        status: 'fallback',
        reason: 'live',
        videoId: 'dQw4w9WgXcQ',
        runStart: 1_700_000_000_000,
        generation: 3,
      })
    ).toEqual({
      status: 'fallback',
      reason: 'live',
      videoId: 'dQw4w9WgXcQ',
      runStart: 1_700_000_000_000,
      generation: 3,
    });
  });

  it('rejects a wrong type or a non-object', () => {
    expect(parseStatusUpdate({ type: 'other', status: 'active', generation: 0 })).toBeNull();
    expect(parseStatusUpdate(null)).toBeNull();
    expect(parseStatusUpdate('active')).toBeNull();
  });

  it('rejects an unknown status', () => {
    expect(
      parseStatusUpdate({ type: STATUS_UPDATE_MESSAGE, status: 'bogus', generation: 0 })
    ).toBeNull();
  });

  it('drops an over-long reason and an invalid video id, and floors bad runStart/generation to 0', () => {
    const parsed = parseStatusUpdate({
      type: STATUS_UPDATE_MESSAGE,
      status: 'active',
      reason: 'x'.repeat(200),
      videoId: '$$bad$$',
      runStart: -5,
      generation: -4,
    });
    expect(parsed).toEqual({ status: 'active', runStart: 0, generation: 0 });
  });

  it('floors a non-integer runStart/generation to 0', () => {
    const parsed = parseStatusUpdate({
      type: STATUS_UPDATE_MESSAGE,
      status: 'active',
      runStart: 1.5,
      generation: 1.5,
    });
    expect(parsed).toEqual({ status: 'active', runStart: 0, generation: 0 });
  });
});
