import { CircleDashedIcon, ExternalLinkIcon, GitMergeIcon, GitPullRequestIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { plural, safeHref, timeAgo } from '@/utils/reviewFormat';
import type { ReviewBranch, ReviewTicket } from '@/types/review';

const MERGED_COLOR = 'text-violet-600 dark:text-violet-400';

/** `git diff --stat`-style summary: "3 files  +120 −4". */
const DiffStat: React.FC<{ branch: ReviewBranch }> = ({ branch }) => (
  <span className="inline-flex flex-wrap items-center gap-x-2 font-mono text-xs" data-testid="diff-stat">
    <span className="text-muted-foreground">{plural(branch.files, 'file')}</span>
    <span className="text-success">+{branch.additions}</span>
    <span className="text-destructive">−{branch.deletions}</span>
  </span>
);

const Meta: React.FC<{ branch: ReviewBranch }> = ({ branch }) => (
  <span className="text-xs text-muted-foreground">
    {branch.author} · {timeAgo(branch.date)}
  </span>
);

export const PullRequestTable: React.FC<{
  tickets: ReviewTicket[];
  base: string;
  onOpen: (ticket: ReviewTicket, branch: ReviewBranch) => void;
}> = ({ tickets, base, onOpen }) => (
  <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
    <Table data-testid="review-table">
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableHead className="w-full">Pull request</TableHead>
          <TableHead className="hidden md:table-cell">Branch</TableHead>
          <TableHead className="hidden lg:table-cell">Last pushed</TableHead>
          <TableHead className="hidden sm:table-cell">Changes</TableHead>
          <TableHead className="hidden md:table-cell">Commits</TableHead>
          <TableHead className="hidden sm:table-cell">
            <span className="sr-only">Open</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.flatMap((ticket) => {
          if (ticket.branches.length === 0) {
            return [
              <TableRow key={ticket.key} data-testid="review-ticket" className="hover:bg-transparent">
                <TableCell colSpan={6}>
                  <div className="flex items-start gap-3">
                    <CircleDashedIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold break-words">{ticket.summary}</span>
                        <Badge variant="secondary">{ticket.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <TicketLink ticket={ticket} /> · No branch starting with <code className="rounded bg-muted px-1">{ticket.key}-</code> has been pushed to
                        origin yet.
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>,
            ];
          }
          return ticket.branches.map((branch) => {
            const merged = branch.unmerged === 0;
            const open = () => onOpen(ticket, branch);
            return (
              <TableRow key={`${ticket.key}:${branch.name}`} data-testid="review-ticket" onClick={open} className="cursor-pointer">
                <TableCell className="max-w-0 min-w-64 whitespace-normal">
                  <div className="flex items-start gap-3">
                    {merged ? (
                      <GitMergeIcon className={cn('mt-0.5 size-5 shrink-0', MERGED_COLOR)} />
                    ) : (
                      <GitPullRequestIcon className="mt-0.5 size-5 shrink-0 text-success" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open();
                        }}
                        aria-label={`Review ${ticket.key}`}
                        className="rounded-sm text-left font-semibold break-words hover:text-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {ticket.summary}
                      </button>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <TicketLink ticket={ticket} />
                        <Badge variant="secondary">{ticket.status}</Badge>
                        {merged && <Badge variant="secondary">Already in {base}</Badge>}
                      </div>
                      {/* small screens fold the hidden columns under the title */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
                        <code title={branch.name} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                          {branch.name}
                        </code>
                        <span className="sm:hidden">
                          <DiffStat branch={branch} />
                        </span>
                        <Meta branch={branch} />
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <code title={branch.name} className="block max-w-60 truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                    {branch.name}
                  </code>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="flex flex-col">
                    <span className="text-sm">{branch.author}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(branch.date)}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <DiffStat branch={branch} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-sm">{merged ? '—' : plural(branch.unmerged, 'commit')}</span>
                    {!merged && branch.behind > 0 && (
                      <Badge variant="outline" className="border-warning/40 whitespace-nowrap text-warning">
                        {branch.behind} behind — auto-rebased
                      </Badge>
                    )}
                  </div>
                </TableCell>
                {/* on phones the whole row (and its title) is the tap target */}
                <TableCell className="hidden text-right sm:table-cell">
                  <Button
                    size="sm"
                    variant={merged ? 'outline' : 'default'}
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                  >
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            );
          });
        })}
      </TableBody>
    </Table>
  </div>
);

const TicketLink: React.FC<{ ticket: ReviewTicket }> = ({ ticket }) => {
  const href = safeHref(ticket.url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-0.5 font-mono font-medium text-primary hover:underline"
    >
      #{ticket.key}
      <ExternalLinkIcon className="size-3" />
    </a>
  ) : (
    <span className="font-mono font-medium">#{ticket.key}</span>
  );
};
