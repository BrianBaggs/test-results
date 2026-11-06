import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon, CheckCircleIcon, GitMergeIcon, LoaderIcon, RefreshCwIcon, ShieldCheckIcon, Undo2Icon, XCircleIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import { plural } from '@/utils/reviewFormat';
import { ReviewApiError, mergeReview } from '@/utils/reviewApi';
import { CopyCommand } from './CopyCommand';
import { ErrorBanner } from './Feedback';
import type { ReviewDetail } from '@/types/review';

export interface MergeBoxProps {
  detail: ReviewDetail;
  approved: boolean;
  onApprovedChange: (approved: boolean) => void;
  onMerged: () => void;
  onReload: () => void;
  onBusyChange: (busy: boolean) => void;
}

export const MergeBox = React.forwardRef<HTMLDivElement, MergeBoxProps>(({ detail, approved, onApprovedChange, onMerged, onReload, onBusyChange }, ref) => {
  const { ticket } = detail;
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
  const canMerge = !blocked && approved;

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

        {!blocked && (
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="approval">
            {approved ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-success">
                  <ShieldCheckIcon className="size-4" /> You approved these changes.
                </p>
                <Button type="button" variant="ghost" size="sm" disabled={merging} onClick={() => onApprovedChange(false)}>
                  <Undo2Icon />
                  Undo approval
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Read through the changes, then approve to unlock Rebase and merge.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => onApprovedChange(true)}>
                  <ShieldCheckIcon />
                  Approve changes
                </Button>
              </>
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
        {!blocked && !approved && !merging && <p className="text-xs text-muted-foreground">Approve the changes above to enable this button.</p>}
        {merging && (
          <p role="status" className="text-sm text-muted-foreground">
            Rebasing onto {base} and pushing — this can take a few seconds. Please don't close this tab.
          </p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirming && !merging}
        onOpenChange={setConfirming}
        title={`Rebase and merge into ${base}?`}
        description={description}
        confirmLabel="Rebase and merge"
        onConfirm={doMerge}
      />
    </Card>
  );
});
MergeBox.displayName = 'MergeBox';
