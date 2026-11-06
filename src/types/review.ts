// Mirrors the JSON returned by server/reviewGit.ts. server/ and src/ are
// separate TS projects and can't import each other, so the shapes are
// repeated here — keep them in sync.

export interface ReviewBranch {
  name: string;
  sha: string;
  author: string;
  date: string;
  files: number;
  additions: number;
  deletions: number;
  ahead: number;
  behind: number;
  /** Commits whose change the base branch doesn't have yet (0 = already merged). */
  unmerged: number;
}

/** A Jira ticket in the AT board's Review column. */
export interface ReviewIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  /** The AT board's Reviewer field (empty when unset). */
  reviewers: string[];
  /** The AT board's Approval checkboxes (null when neither is ticked). */
  approval: 'approved' | 'declined' | null;
  /** The AT board's Review Information text. */
  reviewInfo: string;
  url: string | null;
}

export interface ReviewTicket extends ReviewIssue {
  branches: ReviewBranch[];
}

export interface ReviewList {
  baseBranch: string;
  baseSha: string;
  repoWebUrl: string | null;
  jira: { error: string | null; errorKind: 'not-installed' | 'not-authenticated' | 'blocked' | 'failed' | null };
  tickets: ReviewTicket[];
  fetchedAt: string;
}

interface ReviewCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

export interface ReviewFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'deleted' | 'renamed' | 'modified';
  binary: boolean;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
}

export interface ReviewDetail {
  branch: string;
  ticket: ReviewIssue;
  sha: string;
  baseBranch: string;
  baseSha: string;
  ahead: number;
  behind: number;
  unmerged: number;
  canRebase: boolean | null;
  conflicts: string[];
  commits: ReviewCommit[];
  files: ReviewFile[];
  /** Playwright specs this PR adds or changes (the ones that can be run). */
  specs: string[];
  /** Changed files that run inside the test server; not copied by a spec run. */
  serverCodeChanged: string[];
  /** Other Playwright files changed (helpers, page objects, fixtures, cassettes): nothing to run. */
  supportFiles: string[];
  totals: { additions: number; deletions: number };
  branchUrl: string | null;
}

export interface MergeResult {
  merged: number;
  baseBranch: string;
  newBaseSha: string;
  branchDeleted: boolean;
  ticketMoved: string | null;
  warning: string | null;
}

interface Requirement {
  id: 'git' | 'acli' | 'repo' | 'remote';
  label: string;
  ok: boolean;
  fix: string;
  command?: string;
  url?: string;
}

export interface ReviewStatus {
  ok: boolean;
  repoPath: string;
  baseBranch: string;
  remote: string;
  remoteUrl: string | null;
  repoWebUrl: string | null;
  requirements: Requirement[];
  problems: string[];
}

export interface GhStatus {
  state: 'ready' | 'not-installed' | 'not-authenticated' | 'error';
  account: string | null;
  host: string | null;
  detail: string;
  command?: string;
  url?: string;
}

type SpecTestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';

interface SpecError {
  message: string;
  stack: string;
  snippet: string;
}

export interface SpecTestResult {
  title: string;
  line: number | null;
  status: SpecTestStatus;
  durationMs: number;
  error: SpecError | null;
}

export interface SpecFileResult {
  file: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  tests: SpecTestResult[];
}

export type SpecJobStatus = 'preparing' | 'syncing' | 'running' | 'cleaning' | 'passed' | 'failed' | 'cancelled' | 'error';

export interface SpecJob {
  id: string;
  branch: string;
  sha: string;
  status: SpecJobStatus;
  specs: string[];
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  output: string;
  nextOffset: number;
  truncated: boolean;
  results: SpecFileResult[] | null;
  error: string | null;
  warnings: string[];
  serverCodeChanged: string[];
  exitCode: number | null;
}

export interface TestServerStatus {
  up: boolean;
  host: string;
  port: number;
  startCommand: string;
  activeJob: { id: string; branch: string; status: SpecJobStatus } | null;
}
