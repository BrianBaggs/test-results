import { CheckCircleIcon, ExternalLinkIcon, RefreshCwIcon, WrenchIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { safeHref } from '@/utils/reviewFormat';
import { CopyCommand } from './CopyCommand';
import type { ReviewStatus } from '@/types/review';

/** Shown instead of the PR list when something required isn't installed yet. */
export const SetupPanel: React.FC<{ status: ReviewStatus; checking: boolean; onCheckAgain: () => void }> = ({ status, checking, onCheckAgain }) => (
  <div className="space-y-4 rounded-xl border border-warning/40 bg-warning/5 p-5" role="region" aria-label="Setup needed" data-testid="setup-panel">
    <div className="flex items-start gap-3">
      <WrenchIcon className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <h3 className="text-lg font-semibold">Install these first</h3>
        <p className="text-sm text-muted-foreground">
          The Review tab runs on tools installed on your machine. Install whatever is marked below, then check again.
        </p>
      </div>
    </div>

    <ul className="space-y-3">
      {status.requirements.map((r) => (
        <li key={r.id} className="space-y-2 rounded-lg border border-border/60 bg-card p-3" data-testid={`requirement-${r.id}`} data-ok={r.ok}>
          <div className="flex items-center gap-2 font-medium">
            {r.ok ? <CheckCircleIcon className="size-4 text-success" /> : <XCircleIcon className="size-4 text-destructive" />}
            {r.label}
            <span className="text-xs font-normal text-muted-foreground">{r.ok ? 'ready' : 'needs setup'}</span>
          </div>
          {!r.ok && (
            <>
              <p className="text-sm text-muted-foreground break-words">{r.fix}</p>
              {r.command && <CopyCommand command={r.command} label={`Copy ${r.label} command`} />}
              {safeHref(r.url) && (
                <a href={safeHref(r.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Install guide <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </>
          )}
        </li>
      ))}
    </ul>

    <Button onClick={onCheckAgain} disabled={checking}>
      <RefreshCwIcon className={checking ? 'animate-spin' : undefined} />
      Check again
    </Button>
  </div>
);
