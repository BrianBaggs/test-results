import type { SpecFileResult, SpecJob, SpecJobStatus } from '@/types/review';

export const isFinished = (status: SpecJobStatus): boolean => status === 'passed' || status === 'failed' || status === 'cancelled' || status === 'error';

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/** `spec/.../e2e/tasks/a.spec.ts` -> { dir: 'tasks/', name: 'a.spec.ts' } (the shared prefix is dropped). */
export function splitSpecPath(path: string): { dir: string; name: string } {
  const trimmed = path.replace(/^spec\/playwright\/playwright\/e2e\//, '');
  const i = trimmed.lastIndexOf('/');
  return i < 0 ? { dir: '', name: trimmed } : { dir: trimmed.slice(0, i + 1), name: trimmed.slice(i + 1) };
}

export interface ResultSummary {
  files: number;
  filesPassed: number;
  filesFailed: number;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
}

export function summarize(results: SpecFileResult[] | null): ResultSummary {
  const out: ResultSummary = { files: 0, filesPassed: 0, filesFailed: 0, tests: 0, passed: 0, failed: 0, skipped: 0 };
  for (const f of results ?? []) {
    out.files++;
    if (f.status === 'failed') out.filesFailed++;
    else out.filesPassed++;
    for (const t of f.tests) {
      out.tests++;
      if (t.status === 'passed') out.passed++;
      else if (t.status === 'skipped') out.skipped++;
      else out.failed++;
    }
  }
  return out;
}

/** What each phase of a run is doing, in order, for the progress stepper. */
export const PHASES: Array<{ id: SpecJobStatus; label: string; detail: string }> = [
  { id: 'preparing', label: 'Preparing', detail: 'Checking out the PR in a temporary folder' },
  { id: 'syncing', label: 'Syncing fixtures', detail: 'Copying the PR\'s fixtures and cassettes to your test server' },
  { id: 'running', label: 'Running specs', detail: 'Playwright is running against your test server' },
  { id: 'cleaning', label: 'Cleaning up', detail: 'Restoring your checkout and removing temporary files' },
];

export function jobTitle(job: Pick<SpecJob, 'status'> | null, starting: boolean): string {
  if (!job) return starting ? 'Starting…' : 'Specs';
  switch (job.status) {
    case 'passed':
      return 'Specs passed';
    case 'failed':
      return 'Specs failed';
    case 'cancelled':
      return 'Run cancelled';
    case 'error':
      return 'Run could not finish';
    default:
      return 'Running specs';
  }
}

export interface OutputLine {
  text: string;
  kind: 'pass' | 'fail' | 'skip' | 'plain';
}

/** Classify Playwright's `list` reporter lines for colouring. */
export function classifyLine(text: string): OutputLine['kind'] {
  if (/^\s*(?:✓|✔|ok\b)/.test(text)) return 'pass';
  if (/^\s*(?:✘|✗|×|x\s|\d+\)\s)/.test(text) || /\b\d+ failed\b/.test(text)) return 'fail';
  if (/^\s*(?:-\s|○)/.test(text) || /\b\d+ skipped\b/.test(text)) return 'skip';
  return 'plain';
}

export type SupportKind = 'cassettes' | 'fixtures' | 'pages' | 'helpers' | 'authentication' | 'other';

const SUPPORT_LABELS: Record<SupportKind, string> = {
  cassettes: 'VCR cassettes',
  fixtures: 'Fixtures',
  pages: 'Page objects',
  helpers: 'Helpers and support code',
  authentication: 'Login state',
  other: 'Other files',
};

/** What kind of Playwright support file is this? */
function classifySupportFile(path: string): SupportKind {
  if (path.includes('/vcr_cassettes/')) return 'cassettes';
  if (path.startsWith('spec/fixtures/') || path.includes('/fixtures/')) return 'fixtures';
  if (path.includes('/authentication/')) return 'authentication';
  if (path.includes('/pages/') || path.includes('/components/')) return 'pages';
  if (path.includes('/support/') || path.includes('/utils/') || path.includes('/app_commands/') || /e2e_helper|helpers?\.[a-z]+$/.test(path)) return 'helpers';
  return 'other';
}

/** Group support files by kind, in a stable, useful order. */
export function groupSupportFiles(paths: string[]): Array<{ kind: SupportKind; label: string; files: string[] }> {
  const order: SupportKind[] = ['helpers', 'pages', 'fixtures', 'cassettes', 'authentication', 'other'];
  return order
    .map((kind) => ({ kind, label: SUPPORT_LABELS[kind], files: paths.filter((p) => classifySupportFile(p) === kind).sort() }))
    .filter((g) => g.files.length > 0);
}
