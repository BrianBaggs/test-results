import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** A shell command to run by hand (never run by the app) with a copy button. */
export const CopyCommand: React.FC<{ command: string; label?: string }> = ({ command, label = 'Copy command' }) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success('Command copied.');
    } catch {
      toast.error('Could not copy — select the command and copy it manually.');
    }
  };
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 rounded-md border border-border/60 bg-muted px-2 py-1.5 text-xs break-all text-foreground">{command}</code>
      <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label}>
        <CopyIcon />
        Copy
      </Button>
    </div>
  );
};
