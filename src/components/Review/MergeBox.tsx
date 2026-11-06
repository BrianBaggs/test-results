import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon, CheckCircleIcon, GitMergeIcon, LoaderIcon, RefreshCwIcon, ShieldCheckIcon, ThumbsDownIcon, Undo2Icon, XCircleIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { plural } from '@/utils/reviewFormat';
import { ReviewApiError, mergeReview } from '@/utils/reviewApi';
import { CopyCommand } from './CopyCommand';
import { ErrorBanner } from './Feedback';
import type { ReviewDetail, ReviewIssue } from '@/types/review';

export interface MergeBoxProps {
  detail: ReviewDetail;
  /** The ticket as Jira has it now (its Approval checkboxes decide whether merging is allowed). */
  ticket: ReviewIssue;
  onDecide: (decision: 'approved' | 'declined') => void;
  /** Clear the Approval checkboxes again. */
  onClear: () => void;
  clearing: boolean;
  /** Specs are running: merging waits. */
  specsRunning: boolean;
  onMerged: () => void;
  onReload: () => void;
  onBusyChange: (busy: boolean) => void;
}

export const MergeBox = React.forwardRef<HTMLDivElement, MergeBoxProps>(({ detail, ticket, onDecide, onClear, clearing, specsRunning, onMerged, onReload, onBusyChange }, ref) => {
  const approved = ticket.approval === 'approved';
  const declined = ticket.approval === 'declined';
  const [moveToDone, setMoveToDone] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<{ message: string; files: string[] } | null>(null);
  // State updates are async, so a rapid second click (or one during the
  // dialog's closing animation) could otherwise start a second merge. A ref
  // flips synchronously, making "merge once" a hard guarantee.
  const inFlight = useRef(false);

  const alreadyMerged = detail.unmerged === 0;
  const blocked = alreadyMerged || detail.canRebase === false;
  const canMerge = !blocked && approved && !specsRunning;

  // If merging stops being allowed (approval undone, declined, specs started…), the pending confirmation goes away.
  useEffect(() => {
    if (!canMerge) setConfirming(false);
  }, [canMerge]);

  useEffect(() => {
    if (!merging) return;
    onBusyChange(true);
    // Leaving mid-merge would hide the outcome; make the browser ask first.
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      onBusyChange(false);
    };
  }, [merging, onBusyChange]);

  const doMerge = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirming(false);
    setMerging(true);
    setError(null);
    try {
      const result = await mergeReview({ branch: detail.branch, expectedSha: detail.sha, moveToDone, approved: true });
      toast.success(`${ticket.key}: ${plural(result.merged, 'commit')} rebased and merged into ${result.baseBranch}.`);
      if (result.branchDeleted) toast.success(`Branch ${detail.branch} deleted.`);
      if (result.ticketMoved) toast.success(`${result.ticketMoved} moved to Done in Jira.`);
      if (result.warning) toast.warning(result.warning, { duration: 12000 });
      // Stays locked: the page navigates away, so there is no second chance to click.
      onMerged();
    } catch (err) {
      const e = err instanceof ReviewApiError ? err : new ReviewApiError(err instanceof Error ? err.message : 'Merge failed.');
      setError({ message: e.message, files: e.details });
      inFlight.current = false;
      setMerging(false);
    }
  };

  const base = detail.baseBranch;
  let tone: 'ok' | 'bad' | 'warn';
  let headline: string;
  let sub: string | null = null;
  if (alreadyMerged) {
    tone = 'warn';
    headline = `Nothing to merge — ${base} already has these changes.`;
  } else if (detail.canRebase === false) {
    tone = 'bad';
    headline = `This branch has conflicts with ${base} that must be resolved.`;
  } else if (detail.canRebase === null) {
    tone = 'warn';
    headline = `Couldn't pre-check conflicts with ${base}.`;
    sub = 'Merging will still try, and stop without changing anything if the rebase conflicts.';
  } else {
    tone = 'ok';
    headline = `No conflicts with ${base}. Ready to rebase and merge.`;
    sub =
      detail.behind > 0
        ? `${base} has ${plural(detail.behind, 'newer commit')} — your ${plural(detail.unmerged, 'commit')} will be rebased on top automatically, no manual rebase needed.`
        : null;
  }

  const description =
    `This rebases ${plural(detail.unmerged, 'commit')} from ${detail.branch} onto the latest ${base}, pushes the result to origin/${base}, ` +
    `and then deletes the branch ${detail.branch} from origin. ` +
    (moveToDone ? `${ticket.key} will then be moved to Done in Jira. ` : '') +
    'This updates the shared repository and cannot be undone from here.';

  return (
    <Card
      ref={ref}
      id="merge-box"
      data-testid="merge-box"
      className={cn('scroll-mt-24', tone === 'ok' && 'border-success/40', tone === 'bad' && 'border-destructive/40', tone === 'warn' && 'border-warning/40')}
    >
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3" aria-live="polite">
          {tone === 'ok' ? (
            <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          ) : tone === 'bad' ? (
            <XCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          ) : (
            <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-warning" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{headline}</p>
            {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
            {detail.conflicts.length > 0 && (
              <ul className="list-disc pl-5 font-mono text-xs break-all text-destructive" data-testid="conflict-files">
                {detail.conflicts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {detail.canRebase === false && (
          <div className="space-y-1.5 text-sm text-muted-foreground" data-testid="conflict-help">
            <p>Fix it locally (resolve the files above, finish the rebase, then push), and refresh this page:</p>
            <CopyCommand command={`git fetch origin && git checkout ${detail.branch} && git rebase origin/${base}`} label="Copy rebase command" />
          </div>
        )}

        {!alreadyMerged && (
          <div
            className={cn(
              'space-y-3 rounded-lg border p-3',
              approved && 'border-success/40 bg-success/5',
              declined && 'border-destructive/40 bg-destructive/5',
              !approved && !declined && 'border-border/60 bg-muted/30',
            )}
            data-testid="approval"
            data-state={ticket.approval ?? 'none'}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className={cn('flex items-center gap-2 text-sm font-medium', approved && 'text-success', declined && 'text-destructive', !approved && !declined && 'font-normal text-muted-foreground')}>
                {approved ? <ShieldCheckIcon className="size-4" /> : declined ? <ThumbsDownIcon className="size-4" /> : null}
                {approved
                  ? `Approved in Jira. ${ticket.key} has Approved ticked.`
                  : declined
                    ? `Declined in Jira. Merging is blocked until it is approved.`
                    : 'Read through the changes, then approve or decline. Approving unlocks Rebase and merge.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {!approved && (
                  <Button type="button" variant="outline" size="sm" disabled={merging || clearing} onClick={() => onDecide('approved')}>
                    <ShieldCheckIcon />
                    {declined ? 'Approve instead…' : 'Approve…'}
                  </Button>
                )}
                {!declined && (
                  <Button type="button" variant="outline" size="sm" disabled={merging || clearing} onClick={() => onDecide('declined')} className="text-destructive">
                    <ThumbsDownIcon />
                    Decline…
                  </Button>
                )}
                {(approved || declined) && (
                  <Button type="button" variant="ghost" size="sm" disabled={merging || clearing} onClick={onClear}>
                    {clearing ? <LoaderIcon className="animate-spin" /> : <Undo2Icon />}
                    {clearing ? 'Clearing…' : approved ? 'Undo approval' : 'Clear decision'}
                  </Button>
                )}
              </div>
            </div>
            {ticket.reviewInfo && (
              <div className="rounded-md bg-background/70 p-3" data-testid="review-info">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Review information</p>
                <p className="text-sm break-words whitespace-pre-wrap">{ticket.reviewInfo}</p>
              </div>
            )}
          </div>
        )}

        {!blocked && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Merging also deletes the branch <code className="rounded bg-muted px-1 text-xs">{detail.branch}</code> from origin.
            </p>
            <div className="flex items-center gap-2">
              <Checkbox id="move-to-done" checked={moveToDone} disabled={merging} onCheckedChange={(v) => setMoveToDone(v === true)} />
              <Label htmlFor="move-to-done" className="text-sm font-normal">
                Move {ticket.key} to Done in Jira after merging
              </Label>
            </div>
          </div>
        )}

        {error && (
          <ErrorBanner
            testId="merge-error"
            actions={
              <Button type="button" variant="outline" size="sm" onClick={onReload} className="text-foreground">
                <RefreshCwIcon />
                Reload latest changes
              </Button>
            }
          >
            {error.message}
            {error.files.length > 0 && (
              <ul className="mt-1 list-disc pl-5 font-mono text-xs font-normal break-all">
                {error.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </ErrorBanner>
        )}

        {confirming && !merging && canMerge ? (
          // Like GitHub: the first click only asks; nothing is sent until the second.
          <div
            role="group"
            aria-label="Confirm rebase and merge"
            data-testid="merge-confirm"
            className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-3"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setConfirming(false);
            }}
          >
            <p className="text-sm" data-testid="merge-confirm-text">
              {description}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                autoFocus
                // The merge needs two deliberate actions. Two accidents are ruled out here:
                // - holding Enter on "Rebase and merge": its key repeat would otherwise land on this button, which
                //   appears focused, and confirm for you. Only a fresh key press counts.
                // - the second click of a double-click.
                onKeyDown={(e) => {
                  if (e.repeat) e.preventDefault();
                }}
                onClick={(e) => {
                  if (e.detail > 1) return;
                  void doMerge();
                }}
                className="w-full bg-success text-success-foreground hover:bg-success/90 sm:w-auto"
              >
                <GitMergeIcon className="size-5" />
                Confirm rebase and merge
              </Button>
              <Button size="lg" variant="outline" onClick={() => setConfirming(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            disabled={!canMerge || merging}
            aria-busy={merging}
            onClick={() => setConfirming(true)}
            className="w-full bg-success text-success-foreground hover:bg-success/90 sm:w-auto"
          >
            {merging ? <LoaderIcon className="size-5 animate-spin" /> : <GitMergeIcon className="size-5" />}
            {merging ? 'Rebasing and merging…' : 'Rebase and merge'}
          </Button>
        )}
        {!blocked && !approved && !merging && <p className="text-xs text-muted-foreground">{declined ? 'This PR was declined. Approve it above to enable this button.' : 'Approve the changes above to enable this button.'}</p>}
        {!blocked && approved && specsRunning && !merging && <p className="text-xs text-muted-foreground">Specs are running. Merging is available when they finish (or are cancelled).</p>}
        {merging && (
          <p role="status" className="text-sm text-muted-foreground">
            Rebasing onto {base} and pushing — this can take a few seconds. Please don't close this tab.
          </p>
        )}
      </CardContent>
    </Card>
  );
});
MergeBox.displayName = 'MergeBox';
