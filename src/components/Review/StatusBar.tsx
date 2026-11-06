import { ExternalLinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeHref } from '@/utils/reviewFormat';
import { CopyCommand } from './CopyCommand';

import type { Light, LightState } from '@/utils/reviewLights';

const DOT: Record<LightState, string> = {
  ok: 'bg-success shadow-[0_0_0_3px] shadow-success/20',
  warn: 'bg-warning shadow-[0_0_0_3px] shadow-warning/20',
  bad: 'bg-destructive shadow-[0_0_0_3px] shadow-destructive/20',
  checking: 'animate-pulse bg-muted-foreground/60',
};

const STATE_WORD: Record<LightState, string> = { ok: 'Ready', warn: 'Needs attention', bad: 'Not ready', checking: 'Checking' };

export const StatusBar: React.FC<{ lights: Light[] }> = ({ lights }) => {
  const needsAttention = lights.filter((l) => l.hint);
  return (
    <div className="space-y-3" data-testid="status-bar">
      <ul className="flex flex-wrap gap-2" aria-label="Tool status">
        {lights.map((l) => (
          <li
            key={l.id}
            data-testid={`light-${l.id}`}
            data-state={l.state}
            title={l.hint?.message ?? `${l.label}: ${l.text}`}
            className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs"
          >
            <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', DOT[l.state])} />
            <span className="font-medium">{l.label}</span>
            <span className="text-muted-foreground">{l.text}</span>
            <span className="sr-only">{STATE_WORD[l.state]}</span>
          </li>
        ))}
      </ul>

      {needsAttention.length > 0 && (
        <ul className="space-y-3" data-testid="status-hints">
          {needsAttention.map((l) => (
            <li key={l.id} className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-semibold">{l.label}:</span> <span className="break-words">{l.hint!.message}</span>
              </p>
              {l.hint!.command && <CopyCommand command={l.hint!.command} label={`Copy ${l.label} command`} />}
              {safeHref(l.hint!.url) && (
                <a href={safeHref(l.hint!.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Install guide <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
