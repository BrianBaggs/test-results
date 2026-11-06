import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangleIcon, CopyIcon, ExternalLinkIcon, LoaderIcon, ShieldCheckIcon, ThumbsDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { safeHref } from '@/utils/reviewFormat';
import { submitReviewDecision } from '@/utils/reviewApi';
import type { ReviewDetail, ReviewIssue } from '@/types/review';

const MAX_REVIEW_INFO = 5000;

export interface ReviewDecisionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which button was pressed. */
  decision: 'approved' | 'declined';
  detail: ReviewDetail;
  ticket: ReviewIssue;
  /** Called with the ticket as Jira now has it, after a verified save. */
  onDecided: (ticket: ReviewIssue) => void;
}

/**
 * Approve or decline: a text box for the review information, then one click
 * ticks Approved/Declined on the AT ticket and saves the text into its Review
 * Information field. Declining needs a reason. If Jira can't be updated the
 * typed text is kept and a manual fallback (copy + open the ticket) is offered.
 */
export const ReviewDecisionModal: React.FC<ReviewDecisionModalProps> = (props) => {
  // Mounted fresh each time it opens, so the text box always starts from the ticket's current review information.
  return props.open ? <DecisionDialog {...props} /> : null;
};

const DecisionDialog: React.FC<ReviewDecisionModalProps> = ({ onOpenChange, decision, detail, ticket, onDecided }) => {
  const declining = decision === 'declined';
  const [info, setInfo] = useState(ticket.reviewInfo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const trimmed = info.trim();
  const tooLong = info.length > MAX_REVIEW_INFO;
  const missingReason = declining && !trimmed;
  const invalid = tooLong || missingReason;
  const ticketUrl = safeHref(ticket.url);

  const submit = async () => {
    setTouched(true);
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await submitReviewDecision({ branch: detail.branch, expectedSha: detail.sha, decision, info: trimmed || undefined });
      toast.success(`${ticket.key} ${declining ? 'declined' : 'approved'} in Jira.`);
      onDecided(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review to Jira.');
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(trimmed);
      toast.success('Review text copied.');
    } catch {
      toast.error('Could not copy — select the text and copy it manually.');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (saving ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-xl" data-testid="decision-modal" onInteractOutside={(e) => saving && e.preventDefault()} onEscapeKeyDown={(e) => saving && e.preventDefault()}>
        <div className="flex items-start gap-3 pr-6">
          <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', declining ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>
            {declining ? <ThumbsDownIcon className="size-5" /> : <ShieldCheckIcon className="size-5" />}
          </span>
          <div className="space-y-1">
            <DialogTitle>{declining ? `Decline ${ticket.key}` : `Approve ${ticket.key}`}</DialogTitle>
            <DialogDescription>
              This ticks <strong>{declining ? 'Declined' : 'Approved'}</strong> on {ticket.key} in Jira and saves your notes in its <strong>Review Information</strong> field.
              {declining ? ' A declined PR can\'t be merged.' : ''}
            </DialogDescription>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="review-info">
              Review information{declining ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
            </Label>
            <span className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')} data-testid="review-info-count">
              {info.length.toLocaleString()} / {MAX_REVIEW_INFO.toLocaleString()}
            </span>
          </div>
          <Textarea
            id="review-info"
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={7}
            disabled={saving}
            autoFocus
            aria-invalid={touched && invalid}
            aria-describedby="review-info-help"
            placeholder={declining ? 'What needs to change? e.g. the cleanup step is missing in afterAll; tag @critical…' : 'Anything worth noting for the author (optional)…'}
            className="resize-y"
          />
          <p id="review-info-help" className={cn('text-xs', touched && invalid ? 'text-destructive' : 'text-muted-foreground')} data-testid="review-info-help">
            {touched && missingReason
              ? 'Say why you are declining so the author knows what to fix.'
              : touched && tooLong
                ? `Review information is limited to ${MAX_REVIEW_INFO.toLocaleString()} characters.`
                : 'Plain text. Line breaks are kept.'}
          </p>
        </div>

        {error && (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="decision-error">
            <p className="flex items-start gap-2 font-medium break-words text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
            <p className="text-muted-foreground">Your text is still here. You can retry, or do it by hand in Jira:</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!trimmed}>
                <CopyIcon />
                Copy review text
              </Button>
              {ticketUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={ticketUrl} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon />
                    Open {ticket.key} in Jira
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={declining ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={saving || (touched && invalid)}
            aria-busy={saving}
            className={cn(!declining && 'bg-success text-success-foreground hover:bg-success/90')}
          >
            {saving ? <LoaderIcon className="animate-spin" /> : declining ? <ThumbsDownIcon /> : <ShieldCheckIcon />}
            {saving ? 'Saving to Jira…' : declining ? 'Decline and save to Jira' : 'Approve and save to Jira'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
