import { XCircleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} />
);

export const ErrorBanner: React.FC<{ testId?: string; children: React.ReactNode; actions?: React.ReactNode }> = ({ testId, children, actions }) => (
  <Alert role="alert" className="border-destructive/30 bg-destructive/5" data-testid={testId}>
    <XCircleIcon className="size-4 text-destructive" />
    <AlertDescription className="space-y-3 text-destructive">
      <div className="font-medium break-words">{children}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </AlertDescription>
  </Alert>
);
