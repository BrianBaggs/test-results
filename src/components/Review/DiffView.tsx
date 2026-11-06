import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { DiffView as GitDiffView, DiffModeEnum } from '@git-diff-view/react';
// The "pure" stylesheet has no Tailwind dependency, so it can't clash with ours.
import '@git-diff-view/react/styles/diff-view-pure.css';
import { useTheme } from 'next-themes';
import { Badge } from '@/components/ui/badge';
import { buildHunk, langFor } from '@/utils/reviewFormat';
import type { DiffMode } from '@/utils/reviewFormat';
import type { ReviewFile } from '@/types/review';

const STATUS_LABEL: Record<ReviewFile['status'], string> = {
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  modified: 'Modified',
};

/** If the viewer can't handle a diff, show the raw patch instead of a blank card. */
class DiffBoundary extends Component<{ patch: string; resetKey: string; children: ReactNode }, { failedFor: string | null }> {
  state = { failedFor: null as string | null };

  static getDerivedStateFromError() {
    return { failedFor: 'error' };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failedFor) this.setState({ failedFor: null });
  }

  render() {
    if (this.state.failedFor) {
      return (
        <pre className="overflow-x-auto p-3 font-mono text-xs" data-testid="raw-patch">
          {this.props.patch}
        </pre>
      );
    }
    return this.props.children;
  }
}

export interface FileDiffProps {
  file: ReviewFile;
  mode?: DiffMode;
  /** Anchor id so the file index can scroll to this card. */
  id?: string;
  open?: boolean;
  onToggle?: () => void;
  viewed?: boolean;
  onViewedChange?: (viewed: boolean) => void;
}

export const FileDiff: React.FC<FileDiffProps> = ({ file, mode = 'split', id, open: openProp, onToggle, viewed, onViewedChange }) => {
  // Works standalone (uncontrolled) or driven by the page (expand/collapse all).
  const [openState, setOpenState] = useState(true);
  const open = openProp ?? openState;
  const toggle = onToggle ?? (() => setOpenState(!openState));
  const { resolvedTheme } = useTheme();
  const lang = langFor(file.path);

  return (
    <div id={id} className="scroll-mt-24 overflow-hidden rounded-lg border border-border/60 bg-card" data-testid="file-diff" data-viewed={viewed ? 'true' : 'false'}>
      <div className="flex items-center gap-2 bg-muted/50 pr-3 hover:bg-muted">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {open ? <ChevronDownIcon className="size-4 shrink-0" /> : <ChevronRightIcon className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
          <Badge variant="outline">{STATUS_LABEL[file.status]}</Badge>
          <span className="shrink-0 font-mono text-xs text-success">+{file.additions}</span>
          <span className="shrink-0 font-mono text-xs text-destructive">−{file.deletions}</span>
        </button>
        {onViewedChange && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={!!viewed}
              onChange={(e) => onViewedChange(e.target.checked)}
              aria-label={`Viewed ${file.path}`}
              className="size-3.5 accent-primary"
            />
            Viewed
          </label>
        )}
      </div>

      {open && (
        <div className="border-t border-border/60">
          {file.binary ? (
            <p className="p-4 text-sm text-muted-foreground">Binary file not shown.</p>
          ) : !file.patch ? (
            <p className="p-4 text-sm text-muted-foreground">No content changes (mode or rename only).</p>
          ) : (
            <div className="overflow-x-auto" data-testid="diff-body" data-mode={mode}>
              <DiffBoundary patch={file.patch} resetKey={`${file.path}:${mode}`}>
                <GitDiffView
                  data={{
                    oldFile: { fileName: file.oldPath ?? file.path, fileLang: lang },
                    newFile: { fileName: file.path, fileLang: lang },
                    hunks: [buildHunk(file)],
                  }}
                  diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
                  diffViewTheme={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  diffViewHighlight
                  diffViewFontSize={12}
                />
              </DiffBoundary>
            </div>
          )}
          {file.truncated && (
            <p className="border-t border-border/60 bg-warning/10 p-2 text-xs text-foreground">
              This diff is very large and was cut short. View the rest in your editor or on GitHub.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
