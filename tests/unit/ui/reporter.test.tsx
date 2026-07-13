// @vitest-environment jsdom

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueReporter, type ReporterActions } from '../../../entrypoints/ui/IssueReporter';
import type { ReportBundle } from '../../../src/shared/report';

const bundle: ReportBundle = {
  markdown: '# YouTube Audio diagnostics\n\n- Extension: 0.0.2.5\n',
  environment: {
    extensionVersion: '0.0.2.5',
    browser: 'Firefox',
    browserVersion: '128.0',
    os: 'mac',
    manifestVersion: 2,
  },
  settings: { toggles: {}, forceQualityMax: 'off', equalizerBands: [], segmentSkipCategories: [] },
  stats: { telemetryBlocked: 0, adPruned: 0 },
  events: [],
};

function actions(overrides: Partial<ReporterActions> = {}): ReporterActions {
  return {
    loadReport: vi.fn(async () => bundle),
    copy: vi.fn(async () => undefined),
    openIssue: vi.fn(),
    clearLogs: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function mountReporter(reporterActions: ReporterActions): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  act(() => {
    render(<IssueReporter actions={reporterActions} />, container);
  });
  await settle();
  return container;
}

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('Expected a clickable element');
  act(() => element.click());
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
});

describe('IssueReporter', () => {
  it('previews the assembled report on mount', async () => {
    const reporterActions = actions();
    const container = await mountReporter(reporterActions);
    const preview = container.querySelector('.reporter-preview');
    expect(reporterActions.loadReport).toHaveBeenCalledOnce();
    expect((preview as HTMLTextAreaElement).value).toContain('# YouTube Audio diagnostics');
  });

  it('copies the report to the clipboard', async () => {
    const reporterActions = actions();
    const container = await mountReporter(reporterActions);
    click(container.querySelector('.reporter-btn:not(.is-primary):not(.is-danger)'));
    await settle();
    expect(reporterActions.copy).toHaveBeenCalledWith(bundle.markdown);
    expect(container.textContent).toContain('copied to your clipboard');
  });

  it('opens GitHub only after a successful copy', async () => {
    const reporterActions = actions();
    const container = await mountReporter(reporterActions);
    click(container.querySelector('.reporter-btn.is-primary'));
    await settle();
    expect(reporterActions.copy).toHaveBeenCalledOnce();
    expect(reporterActions.openIssue).toHaveBeenCalledOnce();
    expect((reporterActions.openIssue as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain(
      'github.com/animeshkundu/youtube-audio/issues/new'
    );
  });

  it('does not open GitHub when the copy fails', async () => {
    const reporterActions = actions({
      copy: vi.fn(async () => {
        throw new Error('denied');
      }),
    });
    const container = await mountReporter(reporterActions);
    click(container.querySelector('.reporter-btn.is-primary'));
    await settle();
    expect(reporterActions.copy).toHaveBeenCalledOnce();
    expect(reporterActions.openIssue).not.toHaveBeenCalled();
    expect(container.textContent).toContain('copy it manually');
  });

  it('clears logs and reloads the report', async () => {
    const reporterActions = actions();
    const container = await mountReporter(reporterActions);
    click(container.querySelector('.reporter-btn.is-danger'));
    await settle();
    expect(reporterActions.clearLogs).toHaveBeenCalledOnce();
    expect(reporterActions.loadReport).toHaveBeenCalledTimes(2);
  });
});
