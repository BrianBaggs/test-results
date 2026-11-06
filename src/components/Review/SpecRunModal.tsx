import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon, CheckCircleIcon, CircleMinusIcon, CopyIcon, LoaderIcon, PlayIcon, SquareIcon, TerminalIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { plural } from '@/utils/reviewFormat';
import { PHASES, classifyLine, formatDuration, isFinished, jobTitle, summarize } from '@/utils/specFormat';
import { SpecResults } from './SpecResults';
import type { SpecRunState } from './useSpecRun';
import type { SpecJob } from '@/types/review';

const MAX_VISIBLE_LINES = 2000;

/** Live output: follows the end while running, colours pass/fail lines, copyable. */
export const OutputLog: React.FC<{ output: string; running: boolean }> = ({ output, running }) => {
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => output.split('\n'), [output]);
  const hidden = Math.max(0, lines.length - MAX_VISIBLE_LINES);
  const visible = hidden ? lines.slice(hidden) : lines;

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [output, follow]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      toast.success('Output copied.');
    } catch {
      toast.error('Could not copy — select the output and copy it manually.');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="output-pane">
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="size-3.5 accent-primary" />
          Follow output
        </label>
        <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!output} aria-label="Copy output">
          <CopyIcon />
          Copy output
        </Button>
      </div>
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-label="Spec output"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-3 font-mono text-xs leading-5"
      >
        {!output ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            {running && <LoaderIcon className="size-3.5 animate-spin" />}
            {running ? 'Waiting for output…' : 'No output.'}
          </p>
        ) : (
          <>
            {hidden > 0 && <p className="mb-2 text-muted-foreground">… {hidden.toLocaleString()} earlier lines hidden (Copy output has everything)</p>}
            {visible.map((text, i) => {
              const kind = classifyLine(text);
              return (
                <div
                  key={hidden + i}
                  data-kind={kind}
                  className={cn('break-words whitespace-pre-wrap', kind === 'pass' && 'text-success', kind === 'fail' && 'text-destructive', kind === 'skip' && 'text-muted-foreground')}
                >
                  {text || ' '}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};

const Stepper: React.FC<{ job: SpecJob | null }> = ({ job }) => {
  const current = job ? Math.max(0, PHASES.findIndex((p) => p.id === job.status)) : 0;
  return (
    <div className="space-y-4" data-testid="run-progress">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="size-10 shrink-0 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <div>
          <p className="font-semibold">{job ? PHASES[current].label : 'Starting…'}</p>
          <p className="text-sm text-muted-foreground">{job ? PHASES[current].detail : 'Asking your local server to start the run'}</p>
        </div>
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Run progress">
        {PHASES.map((p, i) => {
          const state = !job ? (i === 0 ? 'active' : 'todo') : i < current ? 'done' : i === current ? 'active' : 'todo';
          return (
            <li
              key={p.id}
              data-testid={`phase-${p.id}`}
              data-state={state}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                state === 'done' && 'border-success/40 text-success',
                state === 'active' && 'border-primary/50 bg-primary/5 font-medium text-foreground',
                state === 'todo' && 'border-border/60 text-muted-foreground',
              )}
            >
              {state === 'done' ? <CheckCircleIcon className="size-3.5" /> : state === 'active' ? <LoaderIcon className="size-3.5 animate-spin" /> : <span className="size-3.5 rounded-full border border-current opacity-40" />}
              {p.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const Banner: React.FC<{ job: SpecJob }> = ({ job }) => {
  const sum = summarize(job.results);
  if (job.status === 'passed')
    return (
      <div className="flex items-center gap-3 rounded-lg border border-success/40 bg-success/5 p-4" data-testid="run-banner" data-status="passed">
        <CheckCircleIcon className="size-7 shrink-0 text-success" />
        <div>
          <p className="font-semibold">All specs passed</p>
          <p className="text-sm text-muted-foreground">
            {plural(sum.passed, 'test')} in {plural(sum.files || job.specs.length, 'file')}
            {sum.skipped ? ` · ${sum.skipped} skipped` : ''} · {formatDuration(job.elapsedMs)}
          </p>
        </div>
      </div>
    );
  if (job.status === 'failed')
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4" data-testid="run-banner" data-status="failed">
        <XCircleIcon className="size-7 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold">{sum.tests ? `${plural(sum.failed, 'test')} failed` : 'The run failed'}</p>
          <p className="text-sm text-muted-foreground">
            {sum.tests ? `${sum.passed} passed · ${sum.failed} failed${sum.skipped ? ` · ${sum.skipped} skipped` : ''} · ` : ''}
            {formatDuration(job.elapsedMs)}
            {job.exitCode !== null ? ` · exit code ${job.exitCode}` : ''}
          </p>
        </div>
      </div>
    );
  if (job.status === 'cancelled')
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4" data-testid="run-banner" data-status="cancelled">
        <CircleMinusIcon className="size-7 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-semibold">Run cancelled</p>
          <p className="text-sm text-muted-foreground">Your checkout and test server files were restored.</p>
        </div>
      </div>
    );
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4" data-testid="run-banner" data-status="error">
      <AlertTriangleIcon className="mt-0.5 size-6 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="font-semibold">The run could not finish</p>
        <p className="text-sm break-words text-destructive">{job.error}</p>
        <p className="mt-1 text-sm text-muted-foreground">Everything was cleaned up. Fix the problem above and run again.</p>
      </div>
    </div>
  );
};

type Tab = 'summary' | 'output';

export interface SpecRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: SpecRunState;
  ticketKey: string;
  testServerUp: boolean;
  onRerun: (specs: string[]) => void;
}

export const SpecRunModal: React.FC<SpecRunModalProps> = ({ open, onOpenChange, run, ticketKey, testServerUp, onRerun }) => {
  const { job, output, starting, error } = run;
  const finished = !!job && isFinished(job.status);
  const [picked, setPicked] = useState<{ jobId: string | null; tab: Tab } | null>(null);
  const jobId = job?.id ?? null;
  // The tab you chose applies to this run; a new run starts from the default again.
  const tab: Tab = picked && picked.jobId === jobId ? picked.tab : finished ? 'summary' : 'output';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open || finished || !job) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open, finished, job]);

  const elapsed = job ? (finished ? job.elapsedMs : Math.max(job.elapsedMs, now - Date.parse(job.startedAt))) : 0;
  const specCount = job?.specs.length ?? 0;
  const title = jobTitle(job, starting);
  const sum = summarize(job?.results ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0" data-testid="spec-run-modal">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-4 pr-12">
          {!finished ? (
            <LoaderIcon className="size-5 animate-spin text-primary" aria-hidden="true" />
          ) : job!.status === 'passed' ? (
            <CheckCircleIcon className="size-5 text-success" aria-hidden="true" />
          ) : job!.status === 'cancelled' ? (
            <CircleMinusIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <XCircleIcon className="size-5 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className="text-xs">
              {ticketKey}
              {specCount ? ` · ${plural(specCount, 'spec file')}` : ''}
              {job ? ` · ${formatDuration(elapsed)}` : ''}
            </DialogDescription>
          </div>
          {finished && sum.tests > 0 && (
            <div className="ml-auto flex gap-2 text-xs" data-testid="run-counts">
              <span className="rounded-full border border-success/40 px-2.5 py-1 text-success">✓ {sum.passed} passed</span>
              {sum.failed > 0 && <span className="rounded-full border border-destructive/40 px-2.5 py-1 text-destructive">✗ {sum.failed} failed</span>}
              {sum.skipped > 0 && <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">{sum.skipped} skipped</span>}
            </div>
          )}
        </div>

        <div className="flex gap-1 border-b border-border/60 px-5" role="tablist">
          {(
            [
              ['summary', 'Summary'],
              ['output', 'Output'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setPicked({ jobId, tab: id })}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
                tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {id === 'output' && <TerminalIcon className="size-3.5" />}
              {label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" data-testid="run-start-error">
              <p className="font-semibold">Couldn't start the specs</p>
              <p className="mt-1 break-words">{error}</p>
            </div>
          )}

          {tab === 'summary' ? (
            <div className="space-y-5">
              {!finished ? (
                <Stepper job={job} />
              ) : (
                <>
                  <Banner job={job!} />
                  {job!.warnings.length > 0 && (
                    <ul className="space-y-1 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground" data-testid="run-warnings">
                      {job!.warnings.map((w) => (
                        <li key={w}>• {w}</li>
                      ))}
                    </ul>
                  )}
                  {job!.results && job!.results.length > 0 ? (
                    <SpecResults results={job!.results} />
                  ) : (
                    job!.status !== 'cancelled' &&
                    job!.status !== 'error' && (
                      <p className="text-sm text-muted-foreground" data-testid="no-structured-results">
                        No structured results were produced.{' '}
                        <button type="button" className="text-primary underline" onClick={() => setPicked({ jobId, tab: 'output' })}>
                          See the output
                        </button>{' '}
                        for what happened.
                      </p>
                    )
                  )}
                </>
              )}
            </div>
          ) : (
            <OutputLog output={output} running={!finished} />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {finished ? 'Your checkout and test server files have been restored.' : 'Runs on your test server. Closing this window does not stop the run.'}
          </p>
          <div className="flex gap-2">
            {!finished && job && (
              <Button type="button" variant="outline" onClick={() => void run.cancel()} disabled={job.status === 'cleaning'} className="text-destructive">
                <SquareIcon />
                Cancel run
              </Button>
            )}
            {finished && job && (
              <Button type="button" variant="outline" onClick={() => onRerun(job.specs)} disabled={!testServerUp || run.running} title={testServerUp ? undefined : 'Start the test server with yarn test:server first'}>
                <PlayIcon />
                Run again
              </Button>
            )}
            <Button type="button" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
