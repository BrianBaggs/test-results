import type { GhStatus, MergeResult, ReviewBranch, ReviewDetail, ReviewFile, ReviewList, ReviewStatus, ReviewTicket } from '../types/review';

export const SHA = 'a'.repeat(40);

export const branch = (over: Partial<ReviewBranch> = {}): ReviewBranch => ({
  name: 'AT-727-add-test',
  sha: SHA,
  author: 'Brian Baggs',
  date: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  files: 3,
  additions: 120,
  deletions: 4,
  ahead: 1,
  behind: 0,
  unmerged: 1,
  ...over,
});

export const ticket = (over: Partial<ReviewTicket> = {}): ReviewTicket => ({
  key: 'AT-727',
  summary: 'Add tests for comments carrying over',
  status: 'Review',
  assignee: 'Brian Baggs',
  url: 'https://securicyapp.atlassian.net/browse/AT-727',
  branches: [branch()],
  ...over,
});

export const list = (over: Partial<ReviewList> = {}): ReviewList => ({
  baseBranch: 'playwright-main',
  baseSha: 'b'.repeat(40),
  repoWebUrl: 'https://github.com/carbidesecure/securicy-app',
  jira: { error: null, errorKind: null },
  tickets: [ticket()],
  fetchedAt: new Date().toISOString(),
  ...over,
});

export const status = (over: Partial<ReviewStatus> = {}): ReviewStatus => ({
  ok: true,
  repoPath: '/Users/qa/Dev/securicy-app',
  baseBranch: 'playwright-main',
  remote: 'origin',
  remoteUrl: 'git@github.com:carbidesecure/securicy-app.git',
  repoWebUrl: 'https://github.com/carbidesecure/securicy-app',
  requirements: [
    { id: 'git', label: 'Git', ok: true, fix: '' },
    { id: 'acli', label: 'Atlassian CLI (acli)', ok: true, fix: '' },
    { id: 'repo', label: 'securicy-app checkout', ok: true, fix: '' },
    { id: 'remote', label: '"origin" remote', ok: true, fix: '' },
  ],
  problems: [],
  ...over,
});

export const gh = (over: Partial<GhStatus> = {}): GhStatus => ({
  state: 'ready',
  account: 'BrianBaggs',
  host: 'github.com',
  detail: 'Signed in to github.com as BrianBaggs.',
  ...over,
});

export const file = (over: Partial<ReviewFile> = {}): ReviewFile => ({
  path: 'spec/recurring.spec.ts',
  oldPath: null,
  status: 'added',
  binary: false,
  additions: 2,
  deletions: 0,
  truncated: false,
  patch: '@@ -0,0 +1,2 @@\n+first line\n+second line',
  ...over,
});

export const detail = (over: Partial<ReviewDetail> = {}): ReviewDetail => ({
  branch: 'AT-727-add-test',
  ticket: { key: 'AT-727', summary: 'Add tests for comments carrying over', status: 'Review', assignee: 'Brian Baggs', url: 'https://securicyapp.atlassian.net/browse/AT-727' },
  sha: SHA,
  baseBranch: 'playwright-main',
  baseSha: 'b'.repeat(40),
  ahead: 1,
  behind: 0,
  unmerged: 1,
  canRebase: true,
  conflicts: [],
  commits: [{ sha: 'c'.repeat(40), author: 'Brian Baggs', date: new Date().toISOString(), subject: 'AT-727 Add tests', body: 'Longer description' }],
  files: [file()],
  totals: { additions: 2, deletions: 0 },
  branchUrl: 'https://github.com/carbidesecure/securicy-app/tree/AT-727-add-test',
  ...over,
});

export const mergeResult = (over: Partial<MergeResult> = {}): MergeResult => ({
  merged: 1,
  baseBranch: 'playwright-main',
  newBaseSha: 'd'.repeat(40),
  branchDeleted: true,
  ticketMoved: null,
  warning: null,
  ...over,
});
