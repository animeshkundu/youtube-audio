import { useEffect, useRef, useState } from 'preact/hooks';

import { clearDiagnostics, requestDiagnosticsReport } from '../../src/shared/diagnostics';
import { buildIssueUrl, type ReportBundle } from '../../src/shared/report';
import { SectionHeader } from './components';

export type ReporterActions = {
  loadReport: () => Promise<ReportBundle | null>;
  copy: (text: string) => Promise<void>;
  openIssue: (url: string) => void;
  clearLogs: () => Promise<void>;
};

export const defaultReporterActions: ReporterActions = {
  loadReport: () => requestDiagnosticsReport(),
  copy: (text) => navigator.clipboard.writeText(text),
  openIssue: (url) => void browser.tabs.create({ url }),
  clearLogs: () => clearDiagnostics(),
};

type Status = { kind: 'idle' | 'ok' | 'error'; message: string };

const IDLE: Status = { kind: 'idle', message: '' };

export function IssueReporter({ actions = defaultReporterActions }: { actions?: ReporterActions }) {
  const [report, setReport] = useState<ReportBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>(IDLE);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  const load = () => {
    setLoading(true);
    void actions
      .loadReport()
      .then((bundle) => setReport(bundle))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Load once when the reporter mounts; the actions are stable for the page lifetime.
    load();
  }, []);

  const markdown = report?.markdown ?? '';
  const hasReport = markdown.length > 0;

  const selectPreview = () => {
    const element = previewRef.current;
    if (element) {
      element.focus();
      element.select();
    }
  };

  const copy = async (): Promise<boolean> => {
    try {
      await actions.copy(markdown);
      setStatus({ kind: 'ok', message: 'Diagnostics copied to your clipboard.' });
      return true;
    } catch {
      setStatus({
        kind: 'error',
        message: 'Could not copy automatically. Select the text below and copy it manually.',
      });
      selectPreview();
      return false;
    }
  };

  const openIssue = async () => {
    if (!hasReport) return;
    // Copy first, and only open GitHub if the copy succeeded, so the user is never sent to the
    // issue page believing the diagnostics are on their clipboard when they are not.
    if (await copy()) actions.openIssue(buildIssueUrl());
  };

  const clear = () => {
    void actions.clearLogs().then(() => {
      setStatus(IDLE);
      load();
    });
  };

  return (
    <section id="help-feedback" class="settings-section">
      <SectionHeader>Help &amp; feedback</SectionHeader>
      <div class="settings-card issue-reporter">
        <p class="reporter-note">
          This report is built on your device. It contains no video identifiers, URLs, or search
          terms, only feature outcomes and your settings. Nothing is sent automatically: review it,
          copy it, then open a GitHub issue and paste it in.
        </p>
        <textarea
          ref={previewRef}
          class="reporter-preview"
          readOnly
          rows={12}
          aria-label="Diagnostic report preview"
          value={loading ? 'Building report…' : markdown || 'No diagnostics recorded yet.'}
        />
        <div class="reporter-actions">
          <button
            type="button"
            class="reporter-btn is-primary"
            onClick={() => void openIssue()}
            disabled={!hasReport}
          >
            Open a GitHub issue
          </button>
          <button
            type="button"
            class="reporter-btn"
            onClick={() => void copy()}
            disabled={!hasReport}
          >
            Copy diagnostics
          </button>
          <button type="button" class="reporter-btn" onClick={load}>
            Refresh
          </button>
          <button type="button" class="reporter-btn is-danger" onClick={clear}>
            Clear logs
          </button>
        </div>
        {status.kind !== 'idle' && (
          <p class={`reporter-status is-${status.kind}`} role="status">
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
