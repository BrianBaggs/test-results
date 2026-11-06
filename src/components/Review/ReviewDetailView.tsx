import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  LoaderIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { defaultDiffMode, plural, safeHref, timeAgo } from '@/utils/reviewFormat';
import type { DiffMode } from '@/utils/reviewFormat';
import { fetchReviewDetail } from '@/utils/reviewApi';
import { readApproved, readViewed, writeApproved, writeViewed } from '@/utils/reviewStorage';
import { FileDiff } from './DiffView';
import { ErrorBanner, Skeleton } from './Feedback';
import { MergeBox } from './MergeBox';
import type { ReviewBranch, ReviewDetail, ReviewFile } from '@/types/review';

type DetailTab = 'conversation' | 'commits' | 'files';

const DIFF_MODE_KEY = 'review-diff-mode';
const MANY_FILES = 15;

function readDiffMode(): DiffMode {
  try {
    const saved = localStorage.getItem(DIFF_MODE_KEY);
    if (saved === 'split' || saved === 'unified') return saved;
  } catch {
    // storage unavailable — fall through to the default
  }
  return defaultDiffMode();
}

const StateChip: React.FC<{ detail: ReviewDetail }> = ({ detail }) => {
  if (detail.unmerged === 0) return <Badge variant="secondary">Already merged</Badge>;
  if (detail.canRebase === false) return <Badge variant="destructive">Conflicts</Badge>;
  if (detail.canRebase === null)
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        Unchecked
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-success/40 text-success">
      Ready to merge
    </Badge>
  );
};

const CommitList: React.FC<{ detail: ReviewDetail; compact?: boolean }> = ({ detail, compact }) => (
  <ul className="space-y-2" data-testid={compact ? 'commit-list-compact' : 'commit-list'}>
    {detail.commits.map((c) => (
      <li key={c.sha} className="flex gap-3 rounded-lg border border-border/60 bg-card p-3">
        <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{c.subject}</p>
          {!compact && c.body && <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted-foreground">{c.body}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {c.author} · {timeAgo(c.date)} · <code>{c.sha.slice(0, 10)}</code>
          </p>
        </div>
      </li>
    ))}
  </ul>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; testId: string }> = ({ label, value, testId }) => (
  <div className="rounded-lg border border-border/60 bg-card p-3" data-testid={testId}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
  </div>
);

const Sidebar: React.FC<{ branch: ReviewBranch; detail: ReviewDetail }> = ({ branch, detail }) => {
  const { ticket } = detail;
  const ticketHref = safeHref(ticket.url);
  const rows: Array<[string, React.ReactNode]> = [
    [
      'Ticket',
      ticketHref ? (
        <a href={ticketHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
          {ticket.key} <ExternalLinkIcon className="size-3" />
        </a>
      ) : (
        <span className="font-mono">{ticket.key}</span>
      ),
    ],
    ['Jira status', ticket.status],
    ['Assignee', ticket.assignee ?? '—'],
    ['Last pushed by', branch.author],
    ['Base', <code key="b" className="rounded bg-muted px-1.5 py-0.5 text-xs">{detail.baseBranch}</code>],
    ['Compare', <code key="c" className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">{detail.branch}</code>],
  ];
  return (
    <aside className="space-y-4 text-sm" aria-label="Pull request details" data-testid="pr-sidebar">
      {rows.map(([label, value]) => (
        <div key={label} className="space-y-1 border-b border-border/60 pb-3 last:border-0">
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <div className="break-words">{value}</div>
        </div>
      ))}
    </aside>
  );
};

// ---------------------------------------------------------------------------
// The loaded show page
// ---------------------------------------------------------------------------

const ReviewBody: React.FC<{
  detail: ReviewDetail;
  branch: ReviewBranch;
  onMerged: () => void;
  onReload: () => void;
  onBusyChange: (busy: boolean) => void;
}> = ({ detail, branch, onMerged, onReload, onBusyChange }) => {
  const [tab, setTab] = useState<DetailTab>('conversation');
  const [mode, setModeState] = useState<DiffMode>(readDiffMode);
  const [approved, setApprovedState] = useState(() => readApproved(detail.branch, detail.sha));
  const [viewed, setViewedState] = useState<string[]>(() => readViewed(detail.branch, detail.sha));
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const mergeRef = useRef<HTMLDivElement>(null);

  const files = detail.files;
  const viewedSet = useMemo(() => new Set(viewed), [viewed]);
  const isOpen = (f: ReviewFile) => openOverride[f.path] ?? !(files.length > MANY_FILES || viewedSet.has(f.path));

  const setMode = (m: DiffMode) => {
    setModeState(m);
    try {
      localStorage.setItem(DIFF_MODE_KEY, m);
    } catch {
      // storage unavailable — the choice just won't persist
    }
  };

  const setApproved = (value: boolean) => {
    setApprovedState(value);
    writeApproved(detail.branch, detail.sha, value);
  };

  const setViewed = (f: ReviewFile, value: boolean) => {
    const next = value ? [...new Set([...viewed, f.path])] : viewed.filter((p) => p !== f.path);
    setViewedState(next);
    writeViewed(detail.branch, detail.sha, next);
    // Like GitHub: marking a file viewed folds it away, un-marking opens it.
    setOpenOverride((o) => ({ ...o, [f.path]: !value }));
  };

  const setAllOpen = (open: boolean) => setOpenOverride(Object.fromEntries(files.map((f) => [f.path, open])));

  const jumpToFile = (index: number) => {
    const f = files[index];
    setOpenOverride((o) => ({ ...o, [f.path]: true }));
    requestAnimationFrame(() => document.getElementById(`file-${index}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };

  const goToMerge = () => {
    setTab('conversation');
    // wait for the Conversation tab to be shown before scrolling to the box
    requestAnimationFrame(() => mergeRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }));
  };

  const tabs: Array<[DetailTab, string]> = [
    ['conversation', 'Conversation'],
    ['commits', `Commits (${detail.commits.length})`],
    ['files', `Files changed (${files.length})`],
  ];
  const progress = files.length ? Math.round((viewed.length / files.length) * 100) : 0;

  return (
    <>
      <div className="flex items-end gap-1 overflow-x-auto border-b border-border/60" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
              tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto shrink-0 self-center pr-1 font-mono text-xs">
          <span className="text-success">+{detail.totals.additions}</span> <span className="text-destructive">−{detail.totals.deletions}</span>
        </span>
      </div>

      {/* The merge box stays mounted on every tab (just hidden) so a merge
          in progress is never lost by switching tabs. */}
      <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]', tab !== 'conversation' && 'hidden')} data-testid="conversation">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="pr-stats">
            <Stat label="Files changed" value={files.length} testId="stat-files" />
            <Stat label="Commits" value={detail.commits.length} testId="stat-commits" />
            <Stat label="Additions" value={<span className="text-success">+{detail.totals.additions}</span>} testId="stat-additions" />
            <Stat label="Deletions" value={<span className="text-destructive">−{detail.totals.deletions}</span>} testId="stat-deletions" />
          </div>

          {files.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-card p-4" data-testid="review-progress">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Review progress: {viewed.length} of {plural(files.length, 'file')} viewed
                </p>
                <Button variant="outline" size="sm" onClick={() => setTab('files')}>
                  <FileDiffIcon />
                  {viewed.length === 0 ? 'Start reviewing' : 'Continue reviewing'}
                </Button>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Files viewed" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-success transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <section className="space-y-3" aria-label="Commits">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {plural(detail.commits.length, 'commit')} to be rebased onto {detail.baseBranch}
            </h3>
            <CommitList detail={detail} compact />
          </section>

          <MergeBox
            ref={mergeRef}
            detail={detail}
            approved={approved}
            onApprovedChange={setApproved}
            onMerged={onMerged}
            onReload={onReload}
            onBusyChange={onBusyChange}
          />
        </div>
        <Sidebar branch={branch} detail={detail} />
      </div>

      {tab === 'commits' && <CommitList detail={detail} />}

      {tab === 'files' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing <strong className="text-foreground">{plural(files.length, 'changed file')}</strong> with{' '}
              <span className="font-mono text-success">{detail.totals.additions} additions</span> and{' '}
              <span className="font-mono text-destructive">{detail.totals.deletions} deletions</span>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setAllOpen(true)} disabled={files.length === 0}>
                <ChevronsUpDownIcon />
                Expand all
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAllOpen(false)} disabled={files.length === 0}>
                <ChevronsDownUpIcon />
                Collapse all
              </Button>
              <div className="inline-flex rounded-md border border-border/60 p-0.5" role="group" aria-label="Diff view">
                {(['split', 'unified'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'rounded px-3 py-1 text-xs font-medium capitalize transition-colors',
                      mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {files.length === 0 ? (
            <p className="text-muted-foreground">No file changes.</p>
          ) : (
            <>
              {files.length > 1 && (
                <nav aria-label="Files changed" className="rounded-lg border border-border/60 bg-card p-3" data-testid="file-index">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">Jump to file</p>
                  <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {files.map((f, i) => (
                      <li key={f.path}>
                        <button
                          type="button"
                          onClick={() => jumpToFile(i)}
                          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {viewedSet.has(f.path) ? <CheckIcon className="size-3.5 shrink-0 text-success" /> : <span className="size-3.5 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                          <span className="shrink-0 font-mono text-success">+{f.additions}</span>
                          <span className="shrink-0 font-mono text-destructive">−{f.deletions}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}

              <div className="space-y-4">
                {files.map((f, i) => (
                  <FileDiff
                    key={`${f.oldPath ?? ''}>${f.path}`}
                    id={`file-${i}`}
                    file={f}
                    mode={mode}
                    open={isOpen(f)}
                    onToggle={() => setOpenOverride((o) => ({ ...o, [f.path]: !isOpen(f) }))}
                    viewed={viewedSet.has(f.path)}
                    onViewedChange={(v) => setViewed(f, v)}
                  />
                ))}
              </div>
            </>
          )}

          <div
            className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between"
            data-testid="review-footer"
          >
            <p className="text-sm text-muted-foreground">
              {viewed.length} of {plural(files.length, 'file')} viewed{approved ? ' · you approved these changes' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {!approved && detail.unmerged > 0 && detail.canRebase !== false && (
                <Button variant="outline" onClick={() => setApproved(true)}>
                  <ShieldCheckIcon />
                  Approve changes
                </Button>
              )}
              <Button variant={approved ? 'default' : 'outline'} onClick={goToMerge}>
                <GitMergeIcon />
                Go to merge box
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Loader + header
// ---------------------------------------------------------------------------

const DetailSkeleton: React.FC = () => (
  <div role="status" aria-live="polite" className="space-y-4">
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderIcon className="size-4 animate-spin" /> Loading changes…
    </p>
    <Skeleton className="h-20 w-full" />
    <Skeleton className="h-9 w-72 max-w-full" />
    <Skeleton className="h-48 w-full" />
  </div>
);

export const ReviewDetailView: React.FC<{
  /** Fallback title/ticket while the detail loads. */
  ticketKey: string;
  ticketSummary: string;
  branch: ReviewBranch;
  onBack: () => void;
  onMerged: () => void;
}> = ({ ticketKey, ticketSummary, branch, onBack, onMerged }) => {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchReviewDetail(branch.name).then(
      (d) => !cancelled && setDetail(d),
      (e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load this branch.'),
    );
    return () => {
      cancelled = true;
    };
  }, [branch.name, reloadKey]);

  const reload = () => {
    setDetail(null);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const ticket = detail?.ticket;
  const key = ticket?.key ?? ticketKey;
  const merged = detail?.unmerged === 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
            <ArrowLeftIcon />
            Back to Review
          </Button>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="font-mono text-muted-foreground">{key}</span>
        </nav>

        <h2 className="text-xl font-bold tracking-tight break-words sm:text-2xl">
          {ticket?.summary ?? ticketSummary} <span className="font-mono font-normal text-muted-foreground">#{key}</span>
        </h2>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground">
          <span
            data-testid="pr-state"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
              merged ? 'bg-violet-600 text-white dark:bg-violet-500' : 'bg-success text-success-foreground',
            )}
          >
            {merged ? <GitMergeIcon className="size-4" /> : <GitPullRequestIcon className="size-4" />}
            {merged ? 'Merged' : 'Open'}
          </span>
          {detail && <StateChip detail={detail} />}
          <span>
            <strong className="font-semibold text-foreground">{branch.author}</strong> wants to merge {detail ? plural(detail.commits.length, 'commit') : 'changes'} into
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{detail?.baseBranch ?? 'playwright-main'}</code>
          <span>from</span>
          <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
            <GitBranchIcon className="mr-1 inline size-3" />
            {branch.name}
          </code>
          {safeHref(detail?.branchUrl) && (
            <a href={safeHref(detail?.branchUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              View on GitHub <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </div>

      {error && (
        <ErrorBanner
          testId="detail-error"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={reload} className="text-foreground">
              <RefreshCwIcon />
              Try again
            </Button>
          }
        >
          {error}
        </ErrorBanner>
      )}

      {!detail && !error && <DetailSkeleton />}

      {detail && <ReviewBody key={`${detail.branch}@${detail.sha}`} detail={detail} branch={branch} onMerged={onMerged} onReload={reload} onBusyChange={setBusy} />}
    </div>
  );
};
