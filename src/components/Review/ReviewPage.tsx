import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangleIcon, GitPullRequestIcon, LoaderIcon, RefreshCwIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { plural } from '@/utils/reviewFormat';
import { computeLights } from '@/utils/reviewLights';
import { fetchGhStatus, fetchReviewList, fetchReviewStatus } from '@/utils/reviewApi';
import { ErrorBanner, Skeleton } from './Feedback';
import { PullRequestTable } from './PullRequestTable';
import { ReviewDetailView } from './ReviewDetailView';
import { SetupPanel } from './SetupPanel';
import { StatusBar } from './StatusBar';
import type { GhStatus, ReviewBranch, ReviewList, ReviewStatus, ReviewTicket } from '@/types/review';

interface Selection {
  ticket: ReviewTicket;
  branch: ReviewBranch;
}

const GH_CHECK_FAILED: GhStatus = { state: 'error', account: null, host: null, detail: 'Could not check the GitHub CLI status.' };

const ListSkeleton: React.FC = () => (
  <div role="status" aria-live="polite" className="space-y-3">
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderIcon className="size-4 animate-spin" /> Fetching from origin and Jira…
    </p>
    {[0, 1, 2].map((i) => (
      <div key={i} className="space-y-3 rounded-xl border border-border/60 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    ))}
  </div>
);

export const ReviewPage: React.FC = () => {
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [list, setList] = useState<ReviewList | null>(null);
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);

  const load = useCallback(async (): Promise<void> => {
    // The GitHub CLI light is informational and slower (it asks GitHub), so it
    // never holds up the page and can never fail it.
    void fetchGhStatus().then(setGh, () => setGh(GH_CHECK_FAILED));
    try {
      const st = await fetchReviewStatus();
      setStatus(st);
      setList(st.ok ? await fetchReviewList() : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tickets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // `load` only sets state after awaiting the network, never synchronously.
    void load();
  }, [load]);

  const refresh = () => {
    setLoading(true);
    setGh(null);
    void load();
  };

  if (selection) {
    return (
      <ReviewDetailView
        // A new branch (or a refresh after a merge) starts from a clean state.
        key={`${selection.branch.name}@${selection.branch.sha}`}
        ticketKey={selection.ticket.key}
        ticketSummary={selection.ticket.summary}
        branch={selection.branch}
        onBack={() => setSelection(null)}
        onMerged={() => {
          setSelection(null);
          refresh();
        }}
      />
    );
  }

  const base = list?.baseBranch ?? status?.baseBranch ?? 'playwright-main';
  const setupNeeded = !!status && !status.ok;
  const tickets = list?.tickets ?? [];
  const openCount = tickets.reduce((n, t) => n + t.branches.filter((b) => b.unmerged > 0).length, 0);
  const lights = computeLights(status, list, gh, !!error && !list);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
                <GitPullRequestIcon className="size-6 text-primary" />
                Review
              </CardTitle>
              <p className="pt-1 text-muted-foreground">
                Every ticket in the AT board's Review column appears here as a pull request. Open one to read the code and approve it, then{' '}
                <strong>Rebase and merge</strong> into <code className="rounded bg-muted px-1 text-xs">{base}</code>. Each merge is rebased on the
                latest {base} for you, the branch is deleted, and the ticket moves to Done.
              </p>
            </div>
            <Button variant="outline" onClick={refresh} disabled={loading} className="w-full sm:w-auto">
              <RefreshCwIcon className={cn(loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <StatusBar lights={lights} />

          {error && (
            <ErrorBanner
              testId="review-error"
              actions={
                <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading} className="text-foreground">
                  <RefreshCwIcon />
                  Try again
                </Button>
              }
            >
              {error}
            </ErrorBanner>
          )}

          {setupNeeded && <SetupPanel status={status} checking={loading} onCheckAgain={refresh} />}

          {list?.jira.error && (
            <Alert role="alert" className="border-warning/40 bg-warning/5" data-testid="jira-warning">
              <AlertTriangleIcon className="size-4 text-warning" />
              <AlertDescription className="break-words">
                <span className="font-medium">Couldn't read the Review column from Jira, so there is nothing to show.</span> {list.jira.error}
              </AlertDescription>
            </Alert>
          )}

          {loading && !list && !setupNeeded && !error && <ListSkeleton />}

          {list && !list.jira.error && tickets.length === 0 && (
            <p className="py-8 text-center text-muted-foreground" data-testid="review-empty">
              Nothing is in the Review column right now. 🎉
            </p>
          )}

          {tickets.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold" aria-live="polite">
                {openCount} Open
                <span className="font-normal text-muted-foreground"> · {plural(tickets.length, 'ticket')} in the Review column</span>
              </p>
              <PullRequestTable tickets={tickets} base={base} onOpen={(ticket, branch) => setSelection({ ticket, branch })} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
