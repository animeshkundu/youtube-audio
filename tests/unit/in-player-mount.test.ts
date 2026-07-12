// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildStatusUpdateMessage,
  createCoalescedFrameScheduler,
  createDownloadFeedbackController,
  createSegmentToastController,
  installPlayerControls,
  nextStatusRunStart,
  reconcileInPlayerControls,
} from '../../entrypoints/content';

function createDesktopPlayer(): {
  player: HTMLElement;
  rightControls: HTMLElement;
  gear: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <div id="movie_player">
      <div class="ytp-left-controls"><button class="ytp-play-button">Play</button></div>
      <div class="ytp-right-controls">
        <button class="ytp-settings-button">Settings</button>
        <button class="ytp-fullscreen-button">Fullscreen</button>
      </div>
    </div>
  `;
  return {
    player: document.querySelector<HTMLElement>('#movie_player')!,
    rightControls: document.querySelector<HTMLElement>('.ytp-right-controls')!,
    gear: document.querySelector<HTMLButtonElement>('.ytp-settings-button')!,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('nextStatusRunStart', () => {
  it('is strictly monotonic across document lifetimes in a tab', () => {
    window.sessionStorage.removeItem('__yta_run_epoch__');
    const first = nextStatusRunStart();
    const second = nextStatusRunStart();
    expect(second).toBeGreaterThan(first);
  });

  it('does not move backward when the wall clock rolls back', () => {
    window.sessionStorage.removeItem('__yta_run_epoch__');
    const baseline = nextStatusRunStart();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(baseline - 10_000);
    try {
      // A clock rollback between two loads must still yield a strictly-later epoch, so the fresh
      // document's status is never rejected as an older-lifetime straggler.
      expect(nextStatusRunStart()).toBeGreaterThan(baseline);
    } finally {
      spy.mockRestore();
    }
  });

  it('discards a poisoned sessionStorage epoch so a hostile page cannot freeze ordering', () => {
    // 1e308 would make `previous + 1 === previous`, freezing the epoch; it must be rejected.
    window.sessionStorage.setItem('__yta_run_epoch__', String(1e308));
    const value = nextStatusRunStart();
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(nextStatusRunStart()).toBeGreaterThan(value); // still strictly monotonic afterwards
  });
});

describe('in-player observer scheduling', () => {
  it('coalesces many reconcile schedule calls into one execution per frame', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const run = vi.fn();
    const onSchedule = vi.fn();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancelFrame = vi.fn((handle: number) => frames.delete(handle));
    const scheduler = createCoalescedFrameScheduler(run, requestFrame, cancelFrame, onSchedule);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(onSchedule).toHaveBeenCalledTimes(3);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();

    frames.get(1)?.(16);
    expect(run).toHaveBeenCalledOnce();

    scheduler.schedule();
    scheduler.schedule();
    expect(requestFrame).toHaveBeenCalledTimes(2);
    frames.get(2)?.(32);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('disconnects both observers while hidden and reconnects them when visible', () => {
    const instances: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    class FakeMutationObserver {
      observe = vi.fn();
      disconnect = vi.fn();

      constructor(_callback: MutationCallback) {
        instances.push(this);
      }

      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(async () => ({ seenAudioOnlyCoach: true })),
          set: vi.fn(async () => undefined),
        },
      },
    });
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    createDesktopPlayer();

    const cleanup = installPlayerControls('test-nonce');
    expect(instances).toHaveLength(2);
    expect(instances.every((observer) => observer.observe.mock.calls.length === 1)).toBe(true);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(instances[0]?.disconnect).toHaveBeenCalledOnce();
    expect(instances[1]?.disconnect).toHaveBeenCalledOnce();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(instances).toHaveLength(4);
    expect(instances[2]?.observe).toHaveBeenCalledOnce();
    expect(instances[3]?.observe).toHaveBeenCalledOnce();

    cleanup();
    expect(instances[2]?.disconnect).toHaveBeenCalledOnce();
    expect(instances[3]?.disconnect).toHaveBeenCalledOnce();
  });
});

describe('page-world status provenance', () => {
  it('carries the emitted operation videoId and the content-owned generation', () => {
    window.history.replaceState({}, '', '/watch?v=BBBBBBBBBBB');

    expect(
      buildStatusUpdateMessage({ status: 'active', videoId: 'AAAAAAAAAAA' }, 1_000, 7)
    ).toEqual({
      type: 'yta:status-update',
      status: 'active',
      videoId: 'AAAAAAAAAAA',
      runStart: 1_000,
      generation: 7,
    });
  });

  it('ignores any page-supplied generation so a hostile page cannot poison ordering', () => {
    // The `yta:status` event is observable + forgeable by page JS. Ordering must come from the
    // content-owned generation argument, NEVER the event's own field, so a huge forged generation
    // cannot freeze the popup by rejecting genuine lower-generation reports.
    const message = buildStatusUpdateMessage(
      { status: 'active', videoId: 'AAAAAAAAAAA', generation: 999_999_999 },
      1_000,
      3
    );
    expect(message?.generation).toBe(3);
  });

  it('rejects a payload without a valid status', () => {
    expect(buildStatusUpdateMessage({ videoId: 'AAAAAAAAAAA' }, 1_000, 1)).toBeNull();
    expect(buildStatusUpdateMessage(null, 1_000, 1)).toBeNull();
  });
});

describe('reconcileInPlayerControls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the interactive audio toggle in the right cluster immediately before settings', () => {
    const { player, rightControls, gear } = createDesktopPlayer();

    const result = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: false,
      mobile: false,
    });

    expect(result).not.toBeNull();
    expect(result?.audioOnlyButton.parentElement).toBe(rightControls);
    expect(result?.audioOnlyButton.nextElementSibling).toBe(gear);
    expect(result?.audioOnlyButton.getAttribute('aria-pressed')).toBe('true');
    expect(result?.audioOnlyButton.getAttribute('aria-label')).toBe('Toggle audio-only playback');
    expect(result?.audioOnlyButton.disabled).toBe(false);
    expect(result?.audioOnlyButton.querySelector('svg[viewBox="-12 -12 48 48"]')).not.toBeNull();
    expect(document.querySelector('.ytp-left-controls #yta-audio-only-toggle')).toBeNull();
  });

  it('updates pressed state and reconciles repeatedly without duplicates', () => {
    const { player } = createDesktopPlayer();
    const first = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: false,
      mobile: false,
    });
    first?.audioOnlyButton.focus();

    const second = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: false,
      downloadVisible: true,
      mobile: false,
    });

    expect(second?.audioOnlyButton).toBe(first?.audioOnlyButton);
    expect(document.querySelectorAll('#yta-audio-only-toggle')).toHaveLength(1);
    expect(document.querySelectorAll('#yta-download-audio')).toHaveLength(1);
    expect(second?.audioOnlyButton.getAttribute('aria-pressed')).toBe('false');
    expect(second?.downloadButton.hidden).toBe(false);
    expect(document.activeElement).toBe(second?.audioOnlyButton);
  });

  it('stays stable across reconciles when the settings gear is absent (no insertBefore hot loop)', () => {
    // A right-controls cluster with a native control but NO `.ytp-settings-button`. The insertion
    // anchor must never resolve to one of our own buttons: anchoring on a to-be-moved node makes
    // `insertBefore` throw once that node is detached into the fragment, and under the observer that
    // throw re-fires reconcile into a hot loop. Reconcile must instead settle idempotently.
    document.body.innerHTML = `
      <div id="movie_player">
        <div class="ytp-right-controls">
          <button class="ytp-fullscreen-button">Fullscreen</button>
        </div>
      </div>
    `;
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    const rightControls = document.querySelector<HTMLElement>('.ytp-right-controls')!;
    const opts = {
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: true,
      mobile: false,
    };

    const first = reconcileInPlayerControls(opts);
    expect(first?.audioOnlyButton.parentElement).toBe(rightControls);
    expect(first?.downloadButton.parentElement).toBe(rightControls);

    for (let i = 0; i < 4; i += 1) {
      expect(() => reconcileInPlayerControls(opts)).not.toThrow();
    }
    expect(document.querySelectorAll('#yta-audio-only-toggle')).toHaveLength(1);
    expect(document.querySelectorAll('#yta-download-audio')).toHaveLength(1);
    expect(first?.downloadButton.nextElementSibling).toBe(first?.audioOnlyButton);
  });

  it('removes the dead segment status pill and leaves extension controls interactive', () => {
    const { player } = createDesktopPlayer();
    const deadPill = document.createElement('button');
    deadPill.id = 'yta-segment-status';
    deadPill.disabled = true;
    player.append(deadPill);

    const result = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: true,
      mobile: false,
    });

    expect(document.getElementById('yta-segment-status')).toBeNull();
    expect(result?.audioOnlyButton.disabled).toBe(false);
    expect(result?.downloadButton.disabled).toBe(false);
    expect(result?.statusRegion.getAttribute('role')).toBe('status');
  });

  it('shows the Audio only tooltip on keyboard focus and excludes synthetic touch input', () => {
    const { player } = createDesktopPlayer();
    const result = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: false,
      mobile: false,
    });
    const button = result!.audioOnlyButton;
    const tooltip = document.querySelector<HTMLElement>('#yta-audio-only-tooltip')!;

    expect(button.getAttribute('aria-label')).toBe('Toggle audio-only playback');
    expect(tooltip.textContent).toBe('Audio only');
    expect(tooltip.hidden).toBe(true);

    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
    button.focus();
    expect(tooltip.hidden).toBe(false);

    button.blur();
    const touchPointer = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(touchPointer, 'pointerType', { value: 'touch' });
    button.dispatchEvent(touchPointer);
    button.focus();
    expect(tooltip.hidden).toBe(true);

    button.blur();
    const touchHover = new Event('pointerenter');
    Object.defineProperty(touchHover, 'pointerType', { value: 'touch' });
    button.dispatchEvent(touchHover);
    expect(tooltip.hidden).toBe(true);
  });

  it('renders audio-only on and off with a structural slash, not only color', () => {
    const { player } = createDesktopPlayer();
    const onResult = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: true,
      downloadVisible: false,
      mobile: false,
    });
    const slash = onResult?.audioOnlyButton.querySelector<SVGPathElement>('.yta-audio-only-slash');

    expect(onResult?.audioOnlyButton.dataset.audioState).toBe('on');
    expect(onResult?.audioOnlyButton.getAttribute('aria-pressed')).toBe('true');
    expect(slash).not.toBeNull();
    expect(slash?.hasAttribute('hidden')).toBe(true);

    const offResult = reconcileInPlayerControls({
      playerRoot: player,
      audioOnlyActive: false,
      downloadVisible: false,
      mobile: false,
    });

    expect(offResult?.audioOnlyButton.dataset.audioState).toBe('off');
    expect(offResult?.audioOnlyButton.getAttribute('aria-pressed')).toBe('false');
    expect(offResult?.audioOnlyButton.querySelector('.yta-audio-only-slash')).toBe(slash);
    expect(slash?.hasAttribute('hidden')).toBe(false);
  });
});

describe('in-player contextual feedback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts an undoable segment toast that seeks back and dismisses', () => {
    const host = document.createElement('div');
    const video = document.createElement('video');
    document.body.append(host, video);
    video.currentTime = 24.5;
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    host.append(status);
    const controller = createSegmentToastController(
      host,
      (message) => {
        status.textContent = message;
      },
      4_000,
      180
    );

    controller.show('Skipped sponsor', () => {
      video.currentTime = 10;
    });

    expect(controller.toast.parentElement).toBe(host);
    expect(controller.toast.hidden).toBe(false);
    expect(controller.toast.dataset.state).toBe('visible');
    expect(controller.toast.querySelector('.yta-segment-toast__text')?.textContent).toBe(
      'Skipped sponsor'
    );
    expect(status.textContent).toBe('Skipped sponsor');

    const undo = controller.toast.querySelector<HTMLButtonElement>('.yta-segment-toast__undo')!;
    expect(undo.textContent).toBe('Undo');
    undo.click();

    expect(video.currentTime).toBe(10);
    expect(controller.toast.hidden).toBe(true);
    expect(controller.toast.dataset.state).toBe('hidden');
    expect(status.textContent).toBe('Skip undone');
  });

  it('auto-hides the segment toast after its exit transition', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const controller = createSegmentToastController(host, vi.fn(), 4_000, 180);
    controller.show('Skipped music off-topic', vi.fn());

    vi.advanceTimersByTime(3_999);
    expect(controller.toast.dataset.state).toBe('visible');
    expect(controller.toast.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(controller.toast.dataset.state).toBe('exiting');
    expect(controller.toast.hidden).toBe(false);

    vi.advanceTimersByTime(180);
    expect(controller.toast.dataset.state).toBe('hidden');
    expect(controller.toast.hidden).toBe(true);
  });

  it('transitions download feedback from idle to progress and success with announcements', () => {
    const button = document.createElement('button');
    button.innerHTML = '<svg class="yta-player-icon"><path></path></svg>';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    document.body.append(button, status);
    const controller = createDownloadFeedbackController(button, status, 2_400);

    expect(controller.getState()).toEqual({ kind: 'idle' });
    expect(button.dataset.downloadState).toBe('idle');

    expect(controller.transition({ type: 'start' })).toEqual({ kind: 'progress' });
    expect(button.dataset.downloadState).toBe('progress');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.yta-download-progress-indicator')).not.toBeNull();
    expect(status.textContent).toBe('Preparing audio download');

    expect(controller.transition({ type: 'succeed' })).toEqual({ kind: 'success' });
    expect(button.dataset.downloadState).toBe('success');
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.querySelector('.yta-download-success')).not.toBeNull();
    expect(status.textContent).toBe('Audio download started');

    vi.advanceTimersByTime(2_400);
    expect(controller.getState()).toEqual({ kind: 'idle' });
    expect(button.dataset.downloadState).toBe('idle');
  });

  it('transitions download feedback from progress to visible failure and announces the reason', () => {
    const button = document.createElement('button');
    button.innerHTML = '<svg class="yta-player-icon"><path></path></svg>';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    document.body.append(button, status);
    const controller = createDownloadFeedbackController(button, status, 2_400);

    controller.transition({ type: 'start' });
    expect(controller.transition({ type: 'fail', reason: 'Audio is unavailable' })).toEqual({
      kind: 'failure',
      reason: 'Audio is unavailable',
    });

    expect(button.dataset.downloadState).toBe('failure');
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('yta-download-button--failure')).toBe(true);
    expect(button.querySelector('.yta-download-failure')).not.toBeNull();
    expect(button.querySelector('.yta-download-reason')?.textContent).toBe('Audio is unavailable');
    expect(status.textContent).toBe('Audio download failed: Audio is unavailable');
  });
});
