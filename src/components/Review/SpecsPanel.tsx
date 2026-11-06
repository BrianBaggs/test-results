import { AlertTriangleIcon, CheckCircleIcon, CircleMinusIcon, FileCogIcon, LoaderIcon, PlayIcon, RefreshCwIcon, TerminalIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { plural } from '@/utils/reviewFormat';
import { formatDuration, groupSupportFiles, splitSpecPath, summarize } from '@/utils/specFormat';
import { CopyCommand } from './CopyCommand';
import type { FileState, SpecRunState, TestServerState } from './useSpecRun';
import type { ReviewDetail } from '@/types/review';

const StateIcon: React.FC<{ state: FileState }> = ({ state }) => {
  switch (state) {
    case 'running':
      return <LoaderIcon className="size-5 animate-spin text-primary" aria-label="Running" />;
    case 'passed':
      return <CheckCircleIcon className="size-5 text-success" aria-label="Passed" />;
    case 'failed':
    case 'error':
      return <XCircleIcon className="size-5 text-destructive" aria-label={state === 'error' ? 'Could not run' : 'Failed'} />;
    case 'cancelled':
    case 'skipped':
      return <CircleMinusIcon className="size-5 text-muted-foreground" aria-label={state === 'skipped' ? 'Skipped' : 'Cancelled'} />;
    default:
      return <span aria-label="Not run yet" className="block size-5 rounded-full border-2 border-dashed border-border" />;
  }
};

/** Red/green light for the local test server. Never starts it: it only tells you how. */
export const TestServerBadge: React.FC<{ server: TestServerState }> = ({ server }) => {
  const state = server.checking && !server.status ? 'checking' : server.up ? 'ok' : 'bad';
  const dot = state === 'ok' ? 'bg-success shadow-[0_0_0_3px] shadow-success/20' : state === 'bad' ? 'bg-destructive shadow-[0_0_0_3px] shadow-destructive/20' : 'animate-pulse bg-muted-foreground/60';
  return (
    <span data-testid="test-server-badge" data-state={state} className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs">
      <span aria-hidden="true" className={cn('size-2.5 rounded-full', dot)} />
      <span className="font-medium">Test server</span>
      <span className="text-muted-foreground">{state === 'checking' ? 'Checking…' : state === 'ok' ? `Running on :${server.status?.port ?? 5017}` : 'Not running'}</span>
    </span>
  );
};

/** Files grouped by what they are, e.g. "Fixtures", "VCR cassettes", "Page objects". */
const SupportFileGroups: React.FC<{ files: string[] }> = ({ files }) => (
  <div className="space-y-3" data-testid="support-groups">
    {groupSupportFiles(files).map((g) => (
      <div key={g.kind} data-testid={`support-group-${g.kind}`}>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          {g.label} ({g.files.length})
        </p>
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {g.files.map((f) => {
            const { dir, name } = splitSpecPath(f.replace(/^spec\/playwright\/playwright\//, ''));
            return (
              <li key={f} className="truncate px-3 py-2 font-mono text-xs" title={f}>
                <span className="text-muted-foreground">{dir}</span>
                <span className="font-semibold">{name}</span>
              </li>
            );
          })}
        </ul>
      </div>
    ))}
  </div>
);

export interface SpecsPanelProps {
  detail: ReviewDetail;
  run: SpecRunState;
  server: TestServerState;
  onRun: (specs: string[] | 'all') => void;
  onOpenOutput: () => void;
}

export const SpecsPanel: React.FC<SpecsPanelProps> = ({ detail, run, server, onRun, onOpenOutput }) => {
  const specs = detail.specs;
  const supportFiles = detail.supportFiles ?? [];
  // Stays visible while re-checking (so you can see it checking); only hidden during the very first check.
  const down = !server.up && (!!server.status || !server.checking);
  const startCommand = server.status?.startCommand ?? 'yarn test:server';
  const blockedReason = run.running ? 'A run is already in progress' : down ? `The test server isn't running — start it with ${startCommand}` : server.checking && !server.status ? 'Checking the test server…' : undefined;
  const disabled = !!blockedReason;
  const last = summarize(run.job?.results ?? null);

  if (specs.length === 0) {
    return (
      <section className="space-y-5" aria-label="Playwright support files" data-testid="support-only-panel">
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
          <FileCogIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold">No specs in this PR</h3>
            <p className="text-sm text-muted-foreground">
              This PR changes {plural(supportFiles.length, 'Playwright support file')} (helpers, page objects, fixtures or cassettes) but adds or changes no spec files, so there is
              nothing to run directly. Read the diff in Files changed; to check it against existing specs, run a few that use these files from your terminal.
            </p>
          </div>
        </div>
        <SupportFileGroups files={supportFiles} />
        {detail.serverCodeChanged.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground" data-testid="server-code-warning">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              This PR also changes {plural(detail.serverCodeChanged.length, 'file')} that run inside the test server (for example{' '}
              <code className="rounded bg-muted px-1">{detail.serverCodeChanged[0]}</code>). Restart your test server from the PR branch to test them.
            </span>
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5" aria-label="Playwright specs" data-testid="specs-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Playwright specs</h3>
          <p className="text-sm text-muted-foreground">
            {plural(specs.length, 'spec file')} added or changed by this PR. Run them against your local test server without leaving the review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TestServerBadge server={server} />
          {run.job && (
            <Button type="button" variant="outline" size="sm" onClick={onOpenOutput}>
              <TerminalIcon />
              {run.running ? 'Live output' : 'Last output'}
            </Button>
          )}
          <Button type="button" onClick={() => onRun('all')} disabled={disabled} title={blockedReason} data-testid="run-all-specs">
            {run.starting ? <LoaderIcon className="animate-spin" /> : <PlayIcon />}
            {run.starting ? 'Starting…' : `Run all (${specs.length})`}
          </Button>
        </div>
      </div>

      {down && (
        <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" data-testid="test-server-down">
          <div className="flex items-start gap-3">
            <XCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-semibold">The test server isn't running</p>
              <p className="text-sm text-muted-foreground">
                Start it in your securicy-app folder (this app never starts it for you), then check again. The green light and the play buttons come on when it's up.
              </p>
            </div>
          </div>
          <CopyCommand command={startCommand} label="Copy test server command" />
          <Button type="button" variant="outline" size="sm" onClick={() => void server.recheck()} disabled={server.checking}>
            <RefreshCwIcon className={cn(server.checking && 'animate-spin')} />
            Check again
          </Button>
        </div>
      )}

      {run.error && !run.job && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="specs-error">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium break-words">{run.error}</p>
            <Button type="button" variant="ghost" size="sm" onClick={run.clearError} className="text-foreground">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {run.job && !run.running && last.tests > 0 && (
        <p className="text-sm" data-testid="specs-last-run">
          Last run:{' '}
          <span className="font-medium text-success">✓ {last.passed} passed</span>
          {last.failed > 0 && <span className="font-medium text-destructive"> · ✗ {last.failed} failed</span>}
          {last.skipped > 0 && <span className="text-muted-foreground"> · {last.skipped} skipped</span>}
          <span className="text-muted-foreground"> · {formatDuration(run.job.elapsedMs)}</span>
        </p>
      )}

      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card" aria-label="Spec files">
        {specs.map((spec) => {
          const { dir, name } = splitSpecPath(spec);
          const state: FileState = run.fileStates[spec] ?? 'idle';
          const result = run.job?.results?.find((r) => r.file === spec);
          return (
            <li key={spec} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto_2.25rem] items-center gap-3 px-4 py-3" data-testid="spec-row" data-state={state}>
              <StateIcon state={state} />
              <p className="min-w-0 truncate font-mono text-xs" title={spec}>
                <span className="text-muted-foreground">{dir}</span>
                <span className="text-sm font-semibold">{name}</span>
              </p>
              <span className="w-28 text-right text-xs text-muted-foreground" data-testid="spec-meta">
                {state === 'running'
                  ? 'Running…'
                  : result
                    ? `${plural(result.tests.length, 'test')} · ${formatDuration(result.durationMs)}`
                    : state === 'error'
                      ? 'Could not run'
                      : state === 'cancelled'
                        ? 'Cancelled'
                        : '—'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                aria-label={`Run ${name}`}
                title={blockedReason ?? `Run ${name}`}
                disabled={disabled}
                onClick={() => onRun([spec])}
              >
                {state === 'running' ? <LoaderIcon className="animate-spin" /> : <PlayIcon />}
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          Fixtures and VCR cassettes this PR changes are copied into your test server's checkout while the specs run, then restored exactly as they were. Specs
          run from a temporary copy of the PR, so your own checkout is never touched.
        </p>
        {supportFiles.length > 0 && (
          <details className="rounded-lg border border-border/60 bg-card p-3" data-testid="support-note">
            <summary className="cursor-pointer text-xs font-medium text-foreground select-none">
              This PR also changes {plural(supportFiles.length, 'support file')} (helpers, fixtures, cassettes…)
            </summary>
            <div className="mt-3">
              <SupportFileGroups files={supportFiles} />
            </div>
          </details>
        )}
        {detail.serverCodeChanged.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-foreground" data-testid="server-code-warning">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              This PR also changes {plural(detail.serverCodeChanged.length, 'file')} that run inside the test server (for example{' '}
              <code className="rounded bg-muted px-1">{detail.serverCodeChanged[0]}</code>). Those are not copied; restart your test server from the PR branch to test them.
            </span>
          </p>
        )}
      </div>
    </section>
  );
};
