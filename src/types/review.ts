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

export interface ReviewCommit {
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

export interface Requirement {
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
