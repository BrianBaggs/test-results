import { useState } from 'react';
import { CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, CircleMinusIcon, XCircleIcon } from 'lucide-react';
import { CopyCommand } from './CopyCommand';
import { cn } from '@/lib/utils';
import { formatDuration, splitSpecPath } from '@/utils/specFormat';
import type { SpecFileResult, SpecTestResult } from '@/types/review';

const TestIcon: React.FC<{ status: SpecTestResult['status'] | SpecFileResult['status'] }> = ({ status }) =>
  status === 'passed' ? (
    <CheckCircleIcon className="size-4 shrink-0 text-success" aria-label="Passed" />
  ) : status === 'skipped' ? (
    <CircleMinusIcon className="size-4 shrink-0 text-muted-foreground" aria-label="Skipped" />
  ) : (
    <XCircleIcon className="size-4 shrink-0 text-destructive" aria-label="Failed" />
  );

/** The failure: Playwright's message, the code frame around the failing line, and the full stack. */
const ErrorBlock: React.FC<{ test: SpecTestResult }> = ({ test }) => {
  const e = test.error;
  if (!e) return null;
  const full = [e.message, e.snippet, e.stack].filter(Boolean).join('\n\n');
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="spec-error">
      <pre className="font-mono text-xs break-words whitespace-pre-wrap text-destructive">{e.message}</pre>
      {e.snippet && <pre className="overflow-x-auto rounded-md bg-background/70 p-2 font-mono text-xs whitespace-pre">{e.snippet}</pre>}
      {e.stack && e.stack !== e.message && (
        <details className="group" open>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">Stack trace</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-background/70 p-2 font-mono text-xs whitespace-pre" data-testid="spec-stack">
            {e.stack}
          </pre>
        </details>
      )}
      <CopyCommand command={full} label="Copy error" />
    </div>
  );
};

const FileResult: React.FC<{ result: SpecFileResult; defaultOpen: boolean }> = ({ result, defaultOpen }) => {
  const [open, setOpen] = useState(defaultOpen);
  const { dir, name } = splitSpecPath(result.file);
  const failed = result.tests.filter((t) => t.status !== 'passed' && t.status !== 'skipped').length;
  return (
    <li className="overflow-hidden rounded-lg border border-border/60 bg-card" data-testid="result-file" data-status={result.status}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        {open ? <ChevronDownIcon className="size-4 shrink-0" /> : <ChevronRightIcon className="size-4 shrink-0" />}
        <TestIcon status={result.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-muted-foreground">{dir}</span>
          <span className="font-semibold">{name}</span>
        </span>
        <span className={cn('shrink-0 text-xs', failed > 0 ? 'text-destructive' : 'text-muted-foreground')}>
          {failed > 0 ? `${failed} failed · ` : ''}
          {result.tests.length} {result.tests.length === 1 ? 'test' : 'tests'}
        </span>
        <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">{formatDuration(result.durationMs)}</span>
      </button>
      {open && (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {result.tests.map((t, i) => (
            <li key={`${t.title}:${i}`} className="px-3 py-2.5" data-testid="result-test" data-status={t.status}>
              <div className="flex items-start gap-3">
                <TestIcon status={t.status} />
                <p className="min-w-0 flex-1 text-sm break-words">
                  {t.title}
                  {t.line !== null && <span className="ml-2 font-mono text-xs text-muted-foreground">:{t.line}</span>}
                  {t.status === 'timedOut' && <span className="ml-2 text-xs text-destructive">timed out</span>}
                </p>
                <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">{formatDuration(t.durationMs)}</span>
              </div>
              <ErrorBlock test={t} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

export const SpecResults: React.FC<{ results: SpecFileResult[] }> = ({ results }) => (
  <ul className="space-y-2" data-testid="spec-results">
    {[...results]
      .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed') || a.file.localeCompare(b.file))
      .map((r) => (
        <FileResult key={r.file} result={r} defaultOpen={r.status === 'failed' || results.length <= 3} />
      ))}
  </ul>
);
