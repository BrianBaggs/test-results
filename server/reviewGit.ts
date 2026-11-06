import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { AcliError, MAX_REVIEW_INFO_CHARS } from './acli.ts';
import { redactSecrets, stripUrlCredentials } from './redact.ts';
import { ReviewError } from './reviewError.ts';
import { createSpecRunService } from './specRun.ts';
import { planOverlay } from './serverOverlay.ts';
import { isRunnableSpecPath } from './specRunner.ts';
import type { AcliErrorKind } from './acli.ts';
import { createGhChecker } from './ghStatus.ts';
import type { GhChecker, GhStatus } from './ghStatus.ts';
import { FORBIDDEN_BASE_BRANCHES, TEMP_WORKTREE_PREFIX, createGitGuard } from './gitGuard.ts';
import type { JiraClient, JiraIssue } from './acli.ts';

/**
 * Local "pull request"-style review of QA branches, driven entirely by the
 * `git` CLI that is already authenticated on this machine. Nothing here talks
 * to the GitHub API: fetch/push go through whatever remote auth (SSH key or
 * credential helper) the developer's git is already set up with.
 *
 * "Rebase and merge" mirrors GitHub's button: replay the branch's commits on
 * top of the base branch, then fast-forward the base branch to the result.
 * GUARD RAIL: every git command is validated by ./gitGuard.ts before it runs —
 * only checkout (temp worktree), rebase and the fast-forward merge push, plus
 * read-only inspection, and only for AT-### branches. See that file.
 *
 * It happens in a throw-away worktree, so the developer's own checkout
 * (current branch, uncommitted work) is never touched.
 */

export interface ReviewConfig {
  repoPath: string;
  baseBranch: string;
  remote: string;
  /** Jira project key; also the branch-name prefix (e.g. `AT-727-...`). */
  projectKey: string;
  /** The Rails test server's checkout (defaults to repoPath). */
  serverRepoPath?: string;
  /** Port the QA test server listens on (default 5017). */
  testServerPort?: number;
}

export interface BranchInfo {
  name: string;
  sha: string;
  author: string;
  date: string;
  /** Commits on the branch that the base branch doesn't have (by SHA). */
  ahead: number;
  /** Commits on the base branch that the branch doesn't have. */
  behind: number;
  /** `git diff --shortstat base...branch`: files changed / lines added / lines removed. */
  files: number;
  additions: number;
  deletions: number;
  /**
   * Commits whose *change* isn't in the base yet (git cherry / patch-id). A
   * branch that was already rebase-merged has `ahead > 0` (rebasing rewrote
   * the SHAs) but `unmerged === 0`.
   */
  unmerged: number;
}

interface ReviewTicket {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  url: string | null;
  branches: BranchInfo[];
}

export interface ReviewList {
  baseBranch: string;
  baseSha: string;
  repoWebUrl: string | null;
  /** Set when the Review column couldn't be read from Jira — then `tickets` is empty. */
  jira: { error: string | null; errorKind: AcliErrorKind | null };
  tickets: ReviewTicket[];
  fetchedAt: string;
}

export interface ReviewStatus {
  ok: boolean;
  repoPath: string;
  baseBranch: string;
  remote: string;
  remoteUrl: string | null;
  repoWebUrl: string | null;
  /** One entry per thing that has to be installed/configured, with how to fix it. */
  requirements: Requirement[];
  problems: string[];
}

export interface Requirement {
  id: 'git' | 'acli' | 'repo' | 'remote';
  label: string;
  ok: boolean;
  /** What's wrong and what to do (empty when ok). */
  fix: string;
  /** A command to run to fix it, if there is one. */
  command?: string;
  /** A page with install instructions, if there is one. */
  url?: string;
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
  /** Unified-diff hunks only (no `diff --git` header). */
  patch: string;
  truncated: boolean;
}

export interface ReviewDetail {
  branch: string;
  /** The Jira ticket (in the Review column) this branch belongs to. */
  ticket: JiraIssue;
  sha: string;
  baseBranch: string;
  baseSha: string;
  ahead: number;
  behind: number;
  unmerged: number;
  /** null = couldn't be determined (e.g. git older than 2.38). */
  canRebase: boolean | null;
  conflicts: string[];
  commits: ReviewCommit[];
  files: ReviewFile[];
  /** Playwright specs this PR adds or changes — the ones that can be run. */
  specs: string[];
  /** Changed files that run inside the test server (not copied by a spec run). */
  serverCodeChanged: string[];
  /** Other Playwright files this PR changes (helpers, page objects, fixtures, cassettes…): nothing to run, but worth knowing. */
  supportFiles: string[];
  totals: { additions: number; deletions: number };
  branchUrl: string | null;
}

export interface MergeResult {
  merged: number;
  baseBranch: string;
  newBaseSha: string;
  /** The AT-### branch was deleted from the remote after the merge. */
  branchDeleted: boolean;
  /** Ticket key moved to done in Jira, or null if that wasn't requested / didn't happen. */
  ticketMoved: string | null;
  warning: string | null;
}

export { ReviewError } from './reviewError.ts';

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_BUFFER = 64 * 1024 * 1024;

function runGit(args: string[], cwd: string, timeoutMs = 60_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      // quotePath=false keeps non-ASCII file names readable in diff headers.
      ['-c', 'core.quotePath=false', ...args],
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        timeout: timeoutMs,
        // Never hang waiting on a credentials prompt there's no terminal for;
        // LC_ALL=C keeps git's messages stable so failures can be recognised.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1;
        // ENOENT (git missing) / timeouts have a non-numeric code; keep the
        // reason visible instead of an empty stderr.
        const extra = typeof (err as NodeJS.ErrnoException).code === 'number' ? '' : String(err.message);
        resolve({ code, stdout, stderr: `${stderr}${extra}` });
      },
    );
  });
}

function firstLines(text: string, n = 6): string {
  return redactSecrets(text.trim().split('\n').slice(0, n).join('\n')) || 'unknown error';
}

// ---------------------------------------------------------------------------
// helpers (exported for tests)
// ---------------------------------------------------------------------------

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * The web page for a remote, for "View on GitHub" links. Understands scp-style
 * (`git@host:o/r.git`), `ssh://git@host[:port]/o/r.git` and `https://host[:port]/o/r.git`.
 * Any credentials embedded in the URL are dropped, never copied into the link.
 */
export function toWebUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const url = stripUrlCredentials(remoteUrl.trim());
  const scp = /^git@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(url);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = /^ssh:\/\/git@([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const http = /^(https?):\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  return http ? `${http[1]}://${http[2]}/${http[3]}` : null;
}

/**
 * Only plain ref-name characters; no leading dash (option injection), no `..`
 * (range syntax), no whitespace. The caller still has to confirm the ref
 * actually exists on the remote.
 */
export function isSafeBranchName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
    !name.includes('..') &&
    !name.endsWith('/') &&
    !name.endsWith('.lock')
  );
}

export function branchMatchesKey(branch: string, key: string): boolean {
  return branch === key || branch.startsWith(`${key}-`) || branch.startsWith(`${key}/`);
}

const PER_FILE_PATCH_LIMIT = 300_000;
/** The whole response for one review stays bounded however large the branch is. */
export const TOTAL_PATCH_LIMIT = 5_000_000;

/** Split `git diff` output into one entry per file. */
export function parseDiff(raw: string, perFileLimit = PER_FILE_PATCH_LIMIT, totalLimit = TOTAL_PATCH_LIMIT): ReviewFile[] {
  if (!raw.trim()) return [];
  const chunks = raw.split(/^diff --git /m).slice(1);
  const files = chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const header = lines[0];
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let status: ReviewFile['status'] = 'modified';
    let binary = false;
    let firstHunk = -1;

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('@@')) {
        firstHunk = i;
        break;
      }
      if (l.startsWith('new file mode')) status = 'added';
      else if (l.startsWith('deleted file mode')) status = 'deleted';
      else if (l.startsWith('rename from ')) {
        status = 'renamed';
        oldPath = l.slice('rename from '.length);
      } else if (l.startsWith('rename to ')) newPath = l.slice('rename to '.length);
      else if (l.startsWith('--- ') && l !== '--- /dev/null') oldPath = oldPath ?? l.slice(4).replace(/^a\//, '');
      else if (l.startsWith('+++ ') && l !== '+++ /dev/null') newPath = newPath ?? l.slice(4).replace(/^b\//, '');
      else if (l.startsWith('Binary files ') || l.startsWith('GIT binary patch')) binary = true;
    }

    if (!newPath && status !== 'deleted') newPath = pathFromHeader(header);
    const path = newPath ?? oldPath ?? pathFromHeader(header);
    const finalOld = status === 'renamed' ? oldPath : null;

    let additions = 0;
    let deletions = 0;
    let patch = '';
    if (firstHunk >= 0) {
      const body = lines.slice(firstHunk);
      for (const l of body) {
        if (l.startsWith('+')) additions++;
        else if (l.startsWith('-')) deletions++;
      }
      patch = body.join('\n').replace(/\n+$/, '');
    }
    let truncated = false;
    if (patch.length > perFileLimit) {
      patch = patch.slice(0, patch.lastIndexOf('\n', perFileLimit) >>> 0 || perFileLimit);
      truncated = true;
    }
    return { path, oldPath: finalOld, status, binary, additions, deletions, patch, truncated };
  });
  return capTotalPatchSize(files, totalLimit);
}

/** Once the running total passes the limit, later files keep their counts but lose their patch. */
function capTotalPatchSize(files: ReviewFile[], limit: number): ReviewFile[] {
  let used = 0;
  return files.map((f) => {
    if (used + f.patch.length > limit) return { ...f, patch: '', truncated: f.patch.length > 0 || f.truncated };
    used += f.patch.length;
    return f;
  });
}

function pathFromHeader(header: string): string {
  // `a/P b/P` — when both sides are the same path the midpoint is unambiguous
  // even if P contains spaces.
  const len = header.length;
  if ((len - 5) % 2 === 0) {
    const p = (len - 5) / 2;
    if (header.startsWith('a/') && header.slice(2, 2 + p) === header.slice(p + 5)) return header.slice(2, 2 + p);
  }
  const m = /^a\/(.*) b\/(.*)$/.exec(header);
  return m ? m[2] : header;
}

/** " 3 files changed, 12 insertions(+), 1 deletion(-)" -> numbers (all 0 for an empty diff). */
export function parseShortStat(text: string): { files: number; additions: number; deletions: number } {
  const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
  return { files: num(/(\d+) files? changed/), additions: num(/(\d+) insertions?\(\+\)/), deletions: num(/(\d+) deletions?\(-\)/) };
}

/** Quote for a POSIX shell, only when needed, so a copied command can't be split or expanded. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Is `bin` an executable file somewhere on PATH? (No process is spawned.) */
export function findOnPath(bin: string, pathEnv: string = process.env.PATH ?? ''): boolean {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, bin)).isFile()) return true;
    } catch {
      // not in this directory
    }
  }
  return false;
}

/**
 * Turn a failed `git fetch` into something a QA engineer can act on. The
 * common cause on a fresh machine is that git isn't signed in to GitHub.
 */
export function explainFetchFailure(stderr: string, repoPath: string, remote: string): string {
  const text = stderr.trim();
  if (/permission denied \(publickey\)|host key verification failed/i.test(text)) {
    return `Git couldn't sign in to GitHub over SSH. Make sure \`git fetch\` works in ${repoPath} (add your SSH key to GitHub), then refresh.`;
  }
  if (/authentication failed|could not read (username|password)|invalid username or password|terminal prompts disabled/i.test(text)) {
    return `Git isn't signed in to GitHub. Run \`gh auth login\` (or set up a credential helper), confirm \`git fetch\` works in ${repoPath}, then refresh.`;
  }
  if (/could not resolve host|unable to access|network is unreachable|timed out|operation timed out/i.test(text)) {
    return `Couldn't reach GitHub (${remote}). Check your internet/VPN connection, then refresh.`;
  }
  return `git fetch ${remote} failed: ${firstLines(text)}`;
}

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

export interface ReviewServiceDeps {
  /** Jira via acli. Required: only tickets in the AT Review column are ever shown or merged. */
  jira: JiraClient;
  /** Injectable for tests: is this executable installed? Defaults to a PATH lookup. */
  findExecutable?: (bin: string) => boolean;
  /** Injectable for tests: the `gh auth status` checker. */
  gh?: GhChecker;
  /** Injectable for tests: probe, spawn, env, kill grace for spec runs. */
  specRun?: Partial<Pick<Parameters<typeof createSpecRunService>[0], 'probe' | 'spawnImpl' | 'env' | 'killGraceMs' | 'keepJobs'>>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function createReviewService(config: ReviewConfig, deps: ReviewServiceDeps) {
  const jiraClient: JiraClient = deps.jira;
  const { repoPath, baseBranch, remote, projectKey } = config;
  const baseRef = `${remote}/${baseBranch}`;
  // Exactly `AT-123`, `AT-123-...` or `AT-123/...`, case-sensitive (same rule as gitGuard).
  const branchPrefixRe = new RegExp(`^${projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+(?=$|[-/])`);

  // One merge at a time: two overlapping rebase+push runs would race on the
  // base branch.
  let lock: Promise<unknown> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  if (FORBIDDEN_BASE_BRANCHES.includes(baseBranch.toLowerCase())) {
    throw new Error(`"${baseBranch}" can never be the review merge target. Set REVIEW_BASE_BRANCH to the QA branch (e.g. playwright-main).`);
  }
  const assertAllowedGitCommand = createGitGuard({ remote, baseBranch, projectKey });

  // The ONLY way this module runs git: every command is checked first.
  const git = async (args: string[], cwd = repoPath, timeout?: number): Promise<ExecResult> => {
    assertAllowedGitCommand(args, cwd);
    return runGit(args, cwd, timeout);
  };
  const mustGit = async (args: string[], cwd: string, what: string, timeoutMs?: number): Promise<string> => {
    const r = await git(args, cwd, timeoutMs);
    if (r.code !== 0) throw new ReviewError(502, `${what} failed: ${firstLines(r.stderr || r.stdout)}`);
    return r.stdout;
  };

  async function remoteUrl(): Promise<string | null> {
    const r = await git(['remote', 'get-url', remote]);
    // A remote can carry a token in its URL's userinfo part; never expose it.
    return r.code === 0 ? stripUrlCredentials(r.stdout.trim()) : null;
  }

  const isInstalled = deps.findExecutable ?? ((bin: string) => findOnPath(bin));

  const ghChecker = deps.gh ?? createGhChecker({ findExecutable: isInstalled });
  const ghStatus = (): Promise<GhStatus> => ghChecker.check();

  async function status(): Promise<ReviewStatus> {
    const requirements: Requirement[] = [];
    const add = (r: Requirement) => requirements.push(r);

    const gitInstalled = isInstalled('git');
    add({
      id: 'git',
      label: 'Git',
      ok: gitInstalled,
      fix: gitInstalled ? '' : "Git isn't installed (or isn't on your PATH). Install it, then check again.",
      command: gitInstalled ? undefined : 'brew install git',
      url: gitInstalled ? undefined : 'https://git-scm.com/downloads',
    });

    {
      const acliInstalled = isInstalled('acli');
      add({
        id: 'acli',
        label: 'Atlassian CLI (acli)',
        ok: acliInstalled,
        fix: acliInstalled
          ? ''
          : "The Atlassian CLI isn't installed (or isn't on your PATH). This page uses it to read the Review column and move tickets to Done. Install it, run `acli auth login`, then check again.",
        command: acliInstalled ? undefined : 'brew tap atlassian/homebrew-acli && brew install acli',
        url: acliInstalled ? undefined : 'https://developer.atlassian.com/cloud/acli/guides/install-acli/',
      });
    }

    const repoFound = existsSync(join(repoPath, '.git'));
    add({
      id: 'repo',
      label: 'securicy-app checkout',
      ok: repoFound,
      fix: repoFound
        ? ''
        : `No git repository was found at ${repoPath}. Clone securicy-app there, or set REVIEW_REPO_PATH in your .env file to where it lives and restart \`npm run dev\`.`,
      command: repoFound ? undefined : `git clone git@github.com:carbidesecure/securicy-app.git ${shellQuote(repoPath)}`,
    });

    let url: string | null = null;
    if (gitInstalled && repoFound) {
      url = await remoteUrl();
      add({
        id: 'remote',
        label: `"${remote}" remote`,
        ok: !!url,
        fix: url ? '' : `The repository at ${repoPath} has no "${remote}" remote. Point it at GitHub with \`git remote add ${remote} <url>\`.`,
      });
    }

    const missing = requirements.filter((r) => !r.ok);
    return {
      ok: missing.length === 0,
      repoPath,
      baseBranch,
      remote,
      remoteUrl: url,
      repoWebUrl: toWebUrl(url),
      requirements,
      problems: missing.map((r) => r.fix),
    };
  }

  async function assertReady(): Promise<void> {
    const s = await status();
    if (!s.ok) throw new ReviewError(503, s.problems.join(' '));
  }

  async function fetchRemote(): Promise<void> {
    const r = await git(['fetch', '--prune', '--quiet', remote], repoPath, 120_000);
    if (r.code !== 0) throw new ReviewError(502, explainFetchFailure(r.stderr || r.stdout, repoPath, remote));
  }

  async function revParse(ref: string, cwd = repoPath): Promise<string | null> {
    const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async function requireBase(): Promise<string> {
    const sha = await revParse(baseRef);
    if (!sha) throw new ReviewError(503, `Base branch "${baseRef}" was not found. Check REVIEW_BASE_BRANCH in your .env file.`);
    return sha;
  }

  async function branchInfo(name: string, sha: string, author: string, date: string): Promise<BranchInfo> {
    const [counts, cherry, stat] = await Promise.all([
      git(['rev-list', '--left-right', '--count', `${baseRef}...${remote}/${name}`]),
      git(['cherry', baseRef, `${remote}/${name}`]),
      git(['diff', '--shortstat', `${baseRef}...${remote}/${name}`]),
    ]);
    const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
    const unmerged = cherry.stdout.split('\n').filter((l) => l.startsWith('+')).length;
    return { name, sha, author, date, ...parseShortStat(stat.stdout), ahead: ahead || 0, behind: behind || 0, unmerged };
  }

  async function remoteBranches(): Promise<Array<{ name: string; sha: string; author: string; date: string; subject: string }>> {
    const SEP = '\x1f';
    const out = await mustGit(
      [
        'for-each-ref',
        `--format=%(refname:strip=3)${SEP}%(objectname)${SEP}%(authorname)${SEP}%(committerdate:iso-strict)${SEP}%(subject)`,
        `refs/remotes/${remote}/`,
      ],
      repoPath,
      'git for-each-ref',
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, sha, author, date, subject] = l.split(SEP);
        return { name, sha, author, date, subject };
      })
      .filter((b) => b.name !== 'HEAD' && branchPrefixRe.test(b.name));
  }

  async function list(): Promise<ReviewList> {
    await assertReady();
    await fetchRemote();
    const baseSha = await requireBase();
    const branches = await remoteBranches();
    const url = toWebUrl(await remoteUrl());

    // ONLY tickets that Jira says are in the AT Review column are ever shown.
    // If Jira can't be read there is nothing to show — never fall back to
    // listing branches, since a branch alone says nothing about the board.
    let jiraError: string | null = null;
    let jiraErrorKind: AcliErrorKind | null = null;
    let tickets: ReviewTicket[] = [];
    try {
      const issues = await jiraClient.listReviewIssues();
      tickets = await mapLimit(issues, 6, async (issue) => {
        const matching = branches.filter((b) => branchMatchesKey(b.name, issue.key));
        const infos = await Promise.all(matching.map((b) => branchInfo(b.name, b.sha, b.author, b.date)));
        return { ...issue, branches: infos };
      });
    } catch (err) {
      jiraError = err instanceof Error ? err.message : String(err);
      jiraErrorKind = err instanceof AcliError ? err.kind : 'failed';
    }

    return {
      baseBranch,
      baseSha,
      repoWebUrl: url,
      jira: { error: jiraError, errorKind: jiraErrorKind },
      tickets,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * The Jira ticket behind a branch, but only if it is in the Review column
   * right now. Used before showing a diff and again before merging.
   */
  async function requireReviewTicket(branch: string): Promise<JiraIssue> {
    const key = branchPrefixRe.exec(branch)![0];
    try {
      const issue = await jiraClient.findReviewIssue(key);
      if (!issue) {
        throw new ReviewError(404, `${key} isn't in the Review column of the ${projectKey} board, so it can't be reviewed or merged here.`);
      }
      return issue;
    } catch (err) {
      if (err instanceof AcliError && err.kind !== 'blocked') throw new ReviewError(err.kind === 'failed' ? 502 : 503, err.message);
      throw err;
    }
  }

  function assertReviewable(branch: unknown): asserts branch is string {
    if (!isSafeBranchName(branch)) throw new ReviewError(400, 'Invalid branch name.');
    if (!branchPrefixRe.test(branch)) {
      throw new ReviewError(400, `Only ${projectKey}-### ticket branches can be reviewed here.`);
    }
  }

  async function detail(branch: unknown): Promise<ReviewDetail> {
    assertReviewable(branch);
    await assertReady();
    const baseSha = await requireBase();
    const sha = await revParse(`${remote}/${branch}`);
    if (!sha) throw new ReviewError(404, `Branch "${branch}" was not found on ${remote}. Try refreshing.`);
    const ticket = await requireReviewTicket(branch);

    const SEP = '\x1f';
    const REC = '\x1e';
    const [info, log, diff, mt, url] = await Promise.all([
      branchInfo(branch, sha, '', ''),
      mustGit(
        ['log', '--reverse', '--max-count=200', `--format=%H${SEP}%an${SEP}%aI${SEP}%s${SEP}%b${REC}`, `${baseRef}..${remote}/${branch}`],
        repoPath,
        'git log',
      ),
      mustGit(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', `${baseRef}...${remote}/${branch}`], repoPath, 'git diff'),
      git(['merge-tree', '--write-tree', '--name-only', '--no-messages', baseRef, `${remote}/${branch}`]),
      remoteUrl(),
    ]);

    const commits: ReviewCommit[] = log
      .split(REC)
      .map((r) => r.replace(/^\n/, ''))
      .filter((r) => r.trim())
      .map((r) => {
        const [csha, author, date, subject, body] = r.split(SEP);
        return { sha: csha, author, date, subject, body: (body ?? '').trim() };
      });

    const files = parseDiff(diff);
    const changed = files.map((f) => ({ path: f.path, status: f.status }));
    const specs = changed.filter((f) => f.status !== 'deleted' && isRunnableSpecPath(f.path)).map((f) => f.path);
    const serverCodeChanged = planOverlay(changed).serverCodeChanged;
    const supportFiles = changed.filter((f) => f.status !== 'deleted' && f.path.startsWith('spec/') && !isRunnableSpecPath(f.path)).map((f) => f.path);

    let canRebase: boolean | null = null;
    let conflicts: string[] = [];
    if (mt.code === 0) canRebase = true;
    else if (mt.code === 1) {
      canRebase = false;
      // First line is the (conflicted) tree id; the rest are file names.
      conflicts = mt.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    }

    const web = toWebUrl(url);
    return {
      branch,
      ticket,
      sha,
      baseBranch,
      baseSha,
      ahead: info.ahead,
      behind: info.behind,
      unmerged: info.unmerged,
      canRebase,
      conflicts,
      commits,
      files,
      specs,
      serverCodeChanged,
      supportFiles,
      totals: {
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
      },
      branchUrl: web ? `${web}/tree/${branch}` : null,
    };
  }

  function merge(opts: { branch: unknown; expectedSha?: unknown; moveToDone?: unknown }): Promise<MergeResult> {
    return withLock(async () => {
      const { branch } = opts;
      assertReviewable(branch);
      if (typeof opts.expectedSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(opts.expectedSha)) {
        throw new ReviewError(400, 'expectedSha is required so the merge only applies what was reviewed.');
      }
      if (specRun.busy()) throw new ReviewError(409, 'Specs are running. Wait for them to finish (or cancel them) before merging.');
      await assertReady();
      // The ticket must be in the Review column right now — checked before
      // anything is fetched, rebased or pushed — and approved in Jira.
      const reviewTicket = await requireReviewTicket(branch);
      if (reviewTicket.approval !== 'approved') {
        throw new ReviewError(
          409,
          reviewTicket.approval === 'declined'
            ? `${reviewTicket.key} was declined in review, so it can't be merged. Approve it first if that has changed.`
            : `${reviewTicket.key} hasn't been approved yet. Approve it (this ticks Approved in Jira) before merging.`,
        );
      }
      await fetchRemote();
      await requireBase();

      const sha = await revParse(`${remote}/${branch}`);
      if (!sha) throw new ReviewError(404, `Branch "${branch}" was not found on ${remote}.`);
      if (!sha.startsWith(opts.expectedSha.toLowerCase())) {
        throw new ReviewError(409, `"${branch}" changed since you opened it. Refresh and review the new commits before merging.`);
      }

      const cherry = await git(['cherry', baseRef, `${remote}/${branch}`]);
      if (!cherry.stdout.split('\n').some((l) => l.startsWith('+'))) {
        throw new ReviewError(409, `Nothing to merge: "${branch}" has no changes that ${baseBranch} doesn't already have.`);
      }

      const dir = await mkdtemp(TEMP_WORKTREE_PREFIX);
      try {
        await mustGit(['worktree', 'add', '--detach', '--quiet', dir, `${remote}/${branch}`], repoPath, 'Creating a temporary worktree');

        const rebase = await git(['rebase', baseRef], dir, 120_000);
        if (rebase.code !== 0) {
          const unmerged = await git(['diff', '--name-only', '--diff-filter=U'], dir);
          const files = unmerged.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
          await git(['rebase', '--abort'], dir);
          throw new ReviewError(
            409,
            files.length
              ? `Rebasing "${branch}" onto ${baseBranch} hit conflicts. Rebase it locally, resolve them, push, then try again.`
              : `Rebasing "${branch}" onto ${baseBranch} failed: ${firstLines(rebase.stderr || rebase.stdout)}`,
            files,
          );
        }

        const newHead = (await mustGit(['rev-parse', 'HEAD'], dir, 'git rev-parse')).trim();
        const merged = Number((await mustGit(['rev-list', '--count', `${baseRef}..HEAD`], dir, 'git rev-list')).trim());
        if (!merged) {
          throw new ReviewError(409, `Nothing to merge: rebasing "${branch}" onto ${baseBranch} left no new commits.`);
        }

        // Plain (non-force) push: only succeeds as a fast-forward, so if
        // someone else landed on the base branch since our fetch it's
        // rejected rather than overwritten.
        const push = await git(['push', remote, `${newHead}:refs/heads/${baseBranch}`], dir, 120_000);
        if (push.code !== 0) {
          const msg = `${push.stderr}${push.stdout}`;
          if (/non-fast-forward|fetch first|rejected/i.test(msg) && !/protected branch|GH006|hook declined/i.test(msg)) {
            throw new ReviewError(409, `${baseBranch} moved while merging. Nothing was pushed — click Rebase and merge again.`);
          }
          throw new ReviewError(502, `Pushing to ${baseBranch} failed: ${firstLines(msg)}`);
        }

        // The merge is done. Delete the ticket branch (AT-### only — the guard
        // enforces that) but only if origin still has the commit we reviewed.
        let branchDeleted = false;
        let ticketMoved: string | null = null;
        const warnings: string[] = [];
        const del = await git(['push', remote, `--force-with-lease=refs/heads/${branch}:${sha}`, '--delete', branch], dir, 120_000);
        if (del.code === 0) branchDeleted = true;
        else warnings.push(`Merged, but couldn't delete the branch ${branch}: ${firstLines(del.stderr || del.stdout, 2)}`);

        // Only after the push has succeeded. A Jira failure never undoes the
        // merge; it's reported so the ticket can be moved by hand.
        if (opts.moveToDone === true) {
          const key = branchPrefixRe.exec(branch)![0].toUpperCase();
          try {
            await jiraClient.moveReviewIssueToDone(key);
            ticketMoved = key;
          } catch (err) {
            warnings.push(`Merged, but ${err instanceof AcliError ? err.message : `could not move ${key} in Jira.`}`);
          }
        }

        // Refresh our remote-tracking refs so the next list is accurate.
        await git(['fetch', '--prune', '--quiet', remote], repoPath, 120_000);

        return { merged, baseBranch, newBaseSha: newHead, branchDeleted, ticketMoved, warning: warnings.join(' ') || null };
      } finally {
        await git(['worktree', 'remove', '--force', dir]);
        await rm(dir, { recursive: true, force: true });
        await git(['worktree', 'prune']);
      }
    });
  }

  /** Approve or decline the PR: ticks Approved/Declined on the AT ticket and records the review notes. */
  async function submitReview(opts: { branch?: unknown; expectedSha?: unknown; decision?: unknown; info?: unknown }): Promise<JiraIssue> {
    assertReviewable(opts.branch);
    const branch = opts.branch;
    if (typeof opts.expectedSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(opts.expectedSha)) {
      throw new ReviewError(400, 'expectedSha is required so the decision applies to the commits you reviewed.');
    }
    if (opts.decision !== 'approved' && opts.decision !== 'declined' && opts.decision !== 'none') {
      throw new ReviewError(400, 'decision must be "approved", "declined" or "none".');
    }
    if (opts.info !== undefined && typeof opts.info !== 'string') throw new ReviewError(400, 'Review information must be text.');
    const info = typeof opts.info === 'string' ? opts.info.trim() : undefined;
    if (info !== undefined && info.length > MAX_REVIEW_INFO_CHARS) {
      throw new ReviewError(400, `Review information is limited to ${MAX_REVIEW_INFO_CHARS} characters (it is ${info.length}).`);
    }
    if (opts.decision === 'declined' && !info) throw new ReviewError(400, 'Say why you are declining: add some review information.');

    await assertReady();
    const sha = await revParse(`${remote}/${branch}`);
    if (!sha) throw new ReviewError(404, `Branch "${branch}" was not found on ${remote}. Refresh and try again.`);
    if (!sha.startsWith(opts.expectedSha.toLowerCase())) {
      throw new ReviewError(409, `"${branch}" changed since you opened it. Reload the pull request and review the new commits before deciding.`);
    }
    const ticket = await requireReviewTicket(branch);
    try {
      return await jiraClient.submitReview(ticket.key, opts.decision, info);
    } catch (err) {
      if (err instanceof AcliError && err.kind !== 'blocked') throw new ReviewError(err.kind === 'failed' ? 502 : 503, err.message);
      throw err;
    }
  }

  const specRun = createSpecRunService({
    repoPath,
    serverRoot: config.serverRepoPath ?? repoPath,
    testServerPort: config.testServerPort,
    assertReviewable,
    assertReady,
    requireReviewTicket,
    fetchRemote,
    resolveBranch: (branch) => revParse(`${remote}/${branch}`),
    changedFiles: async (branch) => {
      const diff = await mustGit(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', `${baseRef}...${remote}/${branch}`], repoPath, 'git diff');
      return parseDiff(diff).map((f) => ({ path: f.path, status: f.status }));
    },
    addWorktree: async (branch, dir) => {
      await mustGit(['worktree', 'add', '--detach', '--quiet', dir, `${remote}/${branch}`], repoPath, 'Creating a temporary checkout of the PR');
    },
    removeWorktree: async (dir) => {
      await git(['worktree', 'remove', '--force', dir]);
      await git(['worktree', 'prune']);
    },
    ...deps.specRun,
  });

  return {
    status,
    list,
    detail,
    merge,
    ghStatus,
    submitReview,
    testServer: specRun.testServer,
    startSpecRun: specRun.start,
    getSpecRun: specRun.get,
    cancelSpecRun: specRun.cancel,
    shutdown: specRun.shutdown,
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
