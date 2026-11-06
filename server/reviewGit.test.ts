import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ReviewError,
  branchMatchesKey,
  createReviewService,
  expandHome,
  explainFetchFailure,
  parseShortStat,
  shellQuote,
  TOTAL_PATCH_LIMIT,
  findOnPath,
  isSafeBranchName,
  parseDiff,
  toWebUrl,
} from './reviewGit';
import { AcliError } from './acli';
import type { JiraClient } from './acli';

// These tests drive the real `git` binary against throw-away repositories
// (a bare "origin" plus a developer clone), so the rebase / fast-forward /
// worktree behaviour is the real thing rather than a mock of it.

const BASE = 'playwright-main';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(cwd: string, file: string, content: string, message: string) {
  mkdirSync(join(cwd, file, '..'), { recursive: true });
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

interface Fixture {
  root: string;
  origin: string;
  seed: string;
  app: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'review-test-'));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const app = join(root, 'app');

  git(root, 'init', '-q', '--bare', '-b', BASE, origin);
  git(root, 'clone', '-q', origin, seed);
  for (const dir of [seed]) {
    git(dir, 'config', 'user.name', 'Seed User');
    git(dir, 'config', 'user.email', 'seed@example.com');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'checkout', '-q', '-b', BASE);
  }
  commitFile(seed, 'a.txt', 'one\ntwo\nthree\n', 'Initial commit');
  git(seed, 'push', '-q', 'origin', BASE);

  // AT-1: a clean new spec file
  git(seed, 'checkout', '-q', '-b', 'AT-1-add-spec', BASE);
  commitFile(seed, 'spec/new.spec.ts', "test('x', () => {})\n", 'AT-1 Add new spec');
  git(seed, 'push', '-q', 'origin', 'AT-1-add-spec');

  // AT-2: edits line two of a.txt (will conflict once the base edits it too)
  git(seed, 'checkout', '-q', '-b', 'AT-2-conflicting', BASE);
  commitFile(seed, 'a.txt', 'one\nBRANCH\nthree\n', 'AT-2 Change a.txt');
  git(seed, 'push', '-q', 'origin', 'AT-2-conflicting');

  // The base moves on after both branches were cut.
  git(seed, 'checkout', '-q', BASE);
  commitFile(seed, 'a.txt', 'one\nBASE\nthree\n', 'AT-9 Base edits a.txt');
  git(seed, 'push', '-q', 'origin', BASE);

  // A non-ticket branch must never be listed or mergeable.
  git(seed, 'checkout', '-q', '-b', 'feature/unrelated', BASE);
  commitFile(seed, 'other.txt', 'x\n', 'Unrelated');
  git(seed, 'push', '-q', 'origin', 'feature/unrelated');

  // The developer's own checkout, with uncommitted work that must survive.
  git(root, 'clone', '-q', origin, app);
  git(app, 'config', 'user.name', 'QA User');
  git(app, 'config', 'user.email', 'qa@example.com');
  git(app, 'config', 'commit.gpgsign', 'false');
  git(app, 'checkout', '-q', BASE);
  writeFileSync(join(app, 'my-uncommitted-notes.txt'), 'do not touch\n');

  return { root, origin, seed, app };
}

const IN_REVIEW: Record<string, { summary: string; assignee: string | null }> = {
  'AT-1': { summary: 'Add new spec', assignee: 'Brian' },
  'AT-2': { summary: 'Conflicting change', assignee: 'Matthew' },
  'AT-3': { summary: 'Another spec', assignee: null },
};

const issue = (key: string, summary: string, assignee: string | null, approval: 'approved' | 'declined' | null = 'approved') => ({ key, summary, status: 'Review', assignee, reviewers: assignee ? ['Matthew'] : [], approval, reviewInfo: approval === 'declined' ? 'Needs changes' : '', url: `https://jira/browse/${key}` });

/** A fake acli-backed Jira client: AT-1, AT-2 and AT-3 are "in the Review column". */
function fakeJira(overrides: Partial<Record<keyof JiraClient, unknown>> = {}): JiraClient {
  return {
    listReviewIssues: vi.fn().mockResolvedValue([issue('AT-1', 'Add new spec', 'Brian'), issue('AT-77', 'No branch yet', null)]),
    findReviewIssue: vi.fn(async (key: string) => (IN_REVIEW[key] ? issue(key, IN_REVIEW[key].summary, IN_REVIEW[key].assignee) : null)),
    moveReviewIssueToDone: vi.fn().mockResolvedValue(undefined),
    submitReview: vi.fn(async (key: string, decision: string, info?: string) => ({ ...issue(key, 'x', 'Brian', decision === 'none' ? null : (decision as 'approved' | 'declined')), reviewInfo: info ?? '' })),
    ...overrides,
  } as unknown as JiraClient;
}

let fx: Fixture;

beforeEach(() => {
  fx = makeFixture();
});

afterEach(() => {
  rmSync(fx.root, { recursive: true, force: true });
});

/** Pretend every CLI is installed, so tests don't depend on this machine's PATH. */
const installed = { findExecutable: () => true };

const config = () => ({ repoPath: fx.app, baseBranch: BASE, remote: 'origin', projectKey: 'AT' });

describe('credentials never leave the server', () => {
  const embedded = (token: string) => ['https:', '//qa-user:', token, '@127.0.0.1:1/org/repo.git'].join('');
  const TOKEN = ['gh', 'p_', 'abcdefghijklmnopqrstuvwx'].join('');

  it('strips a token embedded in the remote URL from the status the browser receives', async () => {
    git(fx.app, 'remote', 'set-url', 'origin', embedded(TOKEN));
    const s = await createReviewService(config(), { ...installed, jira: fakeJira() }).status();
    expect(s.remoteUrl).toBe('https://127.0.0.1:1/org/repo.git');
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(s.repoWebUrl).toBe('https://127.0.0.1:1/org/repo');
    expect(s.repoWebUrl).not.toContain('qa-user');
  });

  it('never puts a token from git\'s own error text into an API error', async () => {
    git(fx.app, 'remote', 'set-url', 'origin', embedded(TOKEN));
    const err = await createReviewService(config(), { ...installed, jira: fakeJira() }).list().catch((e) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain('qa-user:');
  });

  it('toWebUrl and the clone hint are safe for URLs that carry credentials', () => {
    expect(toWebUrl(embedded(TOKEN))).toBe('https://127.0.0.1:1/org/repo');
    expect(toWebUrl(embedded(TOKEN)) ?? '').not.toContain(TOKEN);
  });
});

describe('security hardening', () => {
  it('shell-quotes paths in copyable commands so they cannot be split or expanded', () => {
    expect(shellQuote('/Users/qa/Dev/securicy-app')).toBe('/Users/qa/Dev/securicy-app');
    expect(shellQuote('~/Dev/app')).toBe('~/Dev/app');
    expect(shellQuote('/Users/qa/My Projects/app')).toBe("'/Users/qa/My Projects/app'");
    expect(shellQuote('/x; rm -rf ~')).toBe("'/x; rm -rf ~'");
    expect(shellQuote('/x$(reboot)')).toBe("'/x$(reboot)'");
    expect(shellQuote('/x`id`')).toBe("'/x`id`'");
    expect(shellQuote("/it's")).toBe("'/it'\\''s'");
    expect(shellQuote('')).toBe("''");
  });

  it('quotes the repo path in the clone command shown to the user', async () => {
    const odd = join(fx.root, 'my projects; touch pwned');
    const s = await createReviewService({ ...config(), repoPath: odd }, { ...installed, jira: fakeJira() }).status();
    const cmd = s.requirements.find((r) => r.id === 'repo')!.command!;
    expect(cmd).toContain(`'${odd}'`);
    expect(cmd.startsWith('git clone git@github.com:carbidesecure/securicy-app.git ')).toBe(true);
  });

  it('keeps one review response bounded however big the branch is', () => {
    const file = (n: number) => `diff --git a/f${n}.txt b/f${n}.txt\n--- a/f${n}.txt\n+++ b/f${n}.txt\n@@ -0,0 +1 @@\n+${'x'.repeat(400)}\n`;
    const raw = Array.from({ length: 10 }, (_, i) => file(i)).join('');
    const files = parseDiff(raw, 10_000, 1_000); // room for two ~420-byte patches
    expect(files).toHaveLength(10);
    expect(files.filter((f) => f.patch).length).toBe(2);
    const dropped = files.filter((f) => !f.patch);
    expect(dropped).toHaveLength(8);
    expect(dropped.every((f) => f.truncated && f.additions === 1)).toBe(true); // counts survive, content is cut
    expect(TOTAL_PATCH_LIMIT).toBe(5_000_000);
  });

  it('does not mark an empty (binary) file as truncated just because the cap was reached', () => {
    const big = `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+${'x'.repeat(500)}\n`;
    const bin = 'diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n';
    const files = parseDiff(big + bin, 10_000, 100);
    expect(files[0]).toMatchObject({ patch: '', truncated: true });
    expect(files[1]).toMatchObject({ binary: true, truncated: false });
  });
});

describe('pure helpers', () => {
  it('parses git diff --shortstat output', () => {
    expect(parseShortStat(' 3 files changed, 12 insertions(+), 1 deletion(-)\n')).toEqual({ files: 3, additions: 12, deletions: 1 });
    expect(parseShortStat(' 1 file changed, 1 insertion(+)')).toEqual({ files: 1, additions: 1, deletions: 0 });
    expect(parseShortStat(' 2 files changed, 5 deletions(-)')).toEqual({ files: 2, additions: 0, deletions: 5 });
    expect(parseShortStat('')).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it('expands ~ to the home directory', () => {
    expect(expandHome('~/x')).toMatch(/\/x$/);
    expect(expandHome('~')).not.toBe('~');
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });

  it('turns git remotes into web URLs', () => {
    expect(toWebUrl('git@github.com:carbidesecure/securicy-app.git')).toBe('https://github.com/carbidesecure/securicy-app');
    expect(toWebUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r');
    expect(toWebUrl('ssh://git@github.com/o/r.git')).toBe('https://github.com/o/r');
    expect(toWebUrl('/local/path')).toBeNull();
    expect(toWebUrl(null)).toBeNull();
  });

  it('only accepts plain, safe branch names', () => {
    expect(isSafeBranchName('AT-727-add-test')).toBe(true);
    expect(isSafeBranchName('feature/x_y.z')).toBe(true);
    for (const bad of ['', '-rf', '--upload-pack=x', 'a..b', 'a b', 'a;b', 'a$(x)', 'x/', 'x.lock', 'a\nb', 5, null, undefined]) {
      expect(isSafeBranchName(bad)).toBe(false);
    }
  });

  it('matches a ticket key to branch names without prefix collisions', () => {
    expect(branchMatchesKey('AT-72-foo', 'AT-72')).toBe(true);
    expect(branchMatchesKey('at-72-foo', 'AT-72')).toBe(false); // exact case only
    expect(branchMatchesKey('AT-727-foo', 'AT-72')).toBe(false);
    expect(branchMatchesKey('AT-72', 'AT-72')).toBe(true);
    expect(branchMatchesKey('AT-72/foo', 'AT-72')).toBe(true);
  });
});

describe('parseDiff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '-old',
    '+new',
    '+added',
    'diff --git a/new file.ts b/new file.ts',
    'new file mode 100644',
    'index 000..333',
    '--- /dev/null',
    '+++ b/new file.ts',
    '@@ -0,0 +1 @@',
    '+hello',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    'index 444..000',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/old name.ts b/renamed.ts',
    'similarity index 90%',
    'rename from old name.ts',
    'rename to renamed.ts',
    'index 555..666 100644',
    '--- a/old name.ts',
    '+++ b/renamed.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/img.png b/img.png',
    'index 777..888 100644',
    'Binary files a/img.png and b/img.png differ',
    '',
  ].join('\n');

  it('splits per file with status, paths and counts', () => {
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual([
      ['src/a.ts', 'modified', 2, 1, false],
      ['new file.ts', 'added', 1, 0, false],
      ['gone.ts', 'deleted', 0, 1, false],
      ['renamed.ts', 'renamed', 1, 1, false],
      ['img.png', 'modified', 0, 0, true],
    ]);
    expect(files[3].oldPath).toBe('old name.ts');
    expect(files[0].patch.startsWith('@@ -1,2 +1,3 @@')).toBe(true);
    expect(files[4].patch).toBe('');
  });

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('\n')).toEqual([]);
  });

  it('truncates very large patches but keeps the real counts', () => {
    const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n');
    const [f] = parseDiff(`diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -0,0 +1,50 @@\n${body}\n`, 100);
    expect(f.truncated).toBe(true);
    expect(f.additions).toBe(50);
    expect(f.patch.length).toBeLessThanOrEqual(100);
  });

  it('recovers the path from the header for binary and mode-only changes', () => {
    const [f] = parseDiff('diff --git a/with space/x.bin b/with space/x.bin\nold mode 100644\nnew mode 100755\n');
    expect(f.path).toBe('with space/x.bin');
  });
});

describe('createReviewService', () => {
  describe('setup requirements (tells the user what to install)', () => {
    const reqOf = (s: { requirements: Array<{ id: string; ok: boolean }> }, id: string) => s.requirements.find((r) => r.id === id);

    it('asks for the repo to be cloned when the path does not exist', async () => {
      const missing = createReviewService({ ...config(), repoPath: join(fx.root, 'nope') }, { ...installed, jira: fakeJira() });
      const s = await missing.status();

      expect(s.ok).toBe(false);
      expect(reqOf(s, 'repo')).toMatchObject({
        ok: false,
        fix: expect.stringContaining('REVIEW_REPO_PATH'),
        command: expect.stringContaining('git clone git@github.com:carbidesecure/securicy-app.git'),
      });
      expect(s.problems[0]).toMatch(/No git repository was found at/);
      await expect(missing.list()).rejects.toMatchObject({ status: 503 });
    });

    it('treats a plain folder as "not cloned"', async () => {
      const plain = join(fx.root, 'plain');
      mkdirSync(plain);
      const s = await createReviewService({ ...config(), repoPath: plain }, { ...installed, jira: fakeJira() }).status();
      expect(reqOf(s, 'repo')).toMatchObject({ ok: false });
    });

    it('reports a repo without the remote', async () => {
      git(fx.app, 'remote', 'remove', 'origin');
      const s = await createReviewService(config(), { ...installed, jira: fakeJira() }).status();
      expect(s.ok).toBe(false);
      expect(reqOf(s, 'remote')).toMatchObject({ ok: false, fix: expect.stringContaining('git remote add origin') });
    });

    it('tells the user to install Git, with the command and a link', async () => {
      const s = await createReviewService(config(), { jira: fakeJira(), findExecutable: (bin) => bin !== 'git' }).status();

      expect(s.ok).toBe(false);
      expect(reqOf(s, 'git')).toMatchObject({ ok: false, command: 'brew install git', url: 'https://git-scm.com/downloads' });
      // the remote can't be checked without git, so it isn't reported as a second problem
      expect(reqOf(s, 'remote')).toBeUndefined();
      await expect(createReviewService(config(), { jira: fakeJira(), findExecutable: () => false }).list()).rejects.toMatchObject({ status: 503 });
    });

    it('tells the user to install the Atlassian CLI when Jira is used', async () => {
      const s = await createReviewService(config(), { jira: fakeJira(), findExecutable: (bin) => bin !== 'acli' }).status();

      expect(s.ok).toBe(false);
      expect(reqOf(s, 'git')).toMatchObject({ ok: true });
      expect(reqOf(s, 'acli')).toMatchObject({
        ok: false,
        command: 'brew tap atlassian/homebrew-acli && brew install acli',
        url: expect.stringContaining('developer.atlassian.com'),
        fix: expect.stringContaining('acli auth login'),
      });
      expect(s.problems).toHaveLength(1);
    });

    it('never asks for gh, which this feature does not use', async () => {
      const s = await createReviewService(config(), { ...installed, jira: fakeJira() }).status();
      expect(s.requirements.map((r) => r.id).sort()).toEqual(['acli', 'git', 'remote', 'repo']);
    });
  });

  describe('findOnPath', () => {
    it('finds an executable file on PATH and ignores directories and missing ones', () => {
      const bin = join(fx.root, 'bin');
      mkdirSync(join(bin, 'adir'), { recursive: true });
      writeFileSync(join(bin, 'mytool'), '#!/bin/sh\n', { mode: 0o755 });

      expect(findOnPath('mytool', `/nonexistent::${bin}`)).toBe(true);
      expect(findOnPath('adir', bin)).toBe(false);
      expect(findOnPath('nothing', bin)).toBe(false);
      expect(findOnPath('mytool', '')).toBe(false);
    });

    it('finds the real git on this machine', () => {
      expect(findOnPath('git')).toBe(true);
    });
  });

  describe('explainFetchFailure', () => {
    it.each([
      ['git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', /sign in to GitHub over SSH/],
      ['Host key verification failed.', /sign in to GitHub over SSH/],
      ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", /gh auth login/],
      ['remote: Invalid username or password.\nfatal: Authentication failed', /gh auth login/],
      ["fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com", /internet\/VPN/],
      ['ssh: connect to host github.com port 22: Operation timed out', /internet\/VPN/],
      ['fatal: something unexpected\nsecond line', /git fetch origin failed: fatal: something unexpected/],
    ])('explains %j', (stderr, expected) => {
      expect(explainFetchFailure(stderr, '/repo', 'origin')).toMatch(expected);
    });

    it('is used when fetching really fails', async () => {
      git(fx.app, 'remote', 'set-url', 'origin', join(fx.root, 'does-not-exist.git'));
      await expect(createReviewService(config(), { ...installed, jira: fakeJira() }).list()).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining('git fetch origin failed'),
      });
    });
  });

  it('reports status for a healthy repo', async () => {
    const s = await createReviewService(config(), { ...installed, jira: fakeJira() }).status();
    expect(s).toMatchObject({ ok: true, baseBranch: BASE, problems: [] });
    expect(s.requirements.every((r) => r.ok)).toBe(true);
    expect(s.remoteUrl).toContain('origin.git');
  });

  it.each(['master', 'main', 'release-next', 'Master'])('refuses %s as the merge target', (base) => {
    expect(() => createReviewService({ ...config(), baseBranch: base }, { ...installed, jira: fakeJira() })).toThrow(/can never be the review merge target/);
  });

  it('fails clearly when the base branch does not exist', async () => {
    const svc = createReviewService({ ...config(), baseBranch: 'does-not-exist' }, { ...installed, jira: fakeJira() });
    await expect(svc.list()).rejects.toThrow(/Base branch .* was not found/);
  });

  describe('list (only the AT Review column ever shows up)', () => {
    it('lists the review column and matches branches by key, with a diff --stat summary', async () => {
      const list = await createReviewService(config(), { ...installed, jira: fakeJira() }).list();
      expect(list.jira).toEqual({ error: null, errorKind: null });
      expect(list.tickets.map((t) => t.key)).toEqual(['AT-1', 'AT-77']);
      expect(list.tickets[0]).toMatchObject({ status: 'Review', summary: 'Add new spec' });
      expect(list.tickets[0].branches).toHaveLength(1);
      expect(list.tickets[0].branches[0]).toMatchObject({ name: 'AT-1-add-spec', ahead: 1, behind: 1, unmerged: 1, files: 1, additions: 1, deletions: 0 });
      expect(list.tickets[1].branches).toEqual([]);
    });

    it('does NOT list AT branches whose ticket is not in the Review column', async () => {
      // AT-2 has a branch on origin but Jira only has AT-1 in Review
      const list = await createReviewService(config(), { ...installed, jira: fakeJira() }).list();
      expect(list.tickets.flatMap((t) => t.branches.map((b) => b.name))).toEqual(['AT-1-add-spec']);
    });

    it('shows nothing (no branch fallback) and says why when Jira cannot be read', async () => {
      const jira = fakeJira({ listReviewIssues: vi.fn().mockRejectedValue(new AcliError('acli is not logged in', 'not-authenticated')) });
      const list = await createReviewService(config(), { ...installed, jira }).list();
      expect(list.jira).toEqual({ error: 'acli is not logged in', errorKind: 'not-authenticated' });
      expect(list.tickets).toEqual([]);
    });

    it('reports an unexpected Jira failure as a generic failure', async () => {
      const jira = fakeJira({ listReviewIssues: vi.fn().mockRejectedValue(new Error('boom')) });
      const list = await createReviewService(config(), { ...installed, jira }).list();
      expect(list.jira).toEqual({ error: 'boom', errorKind: 'failed' });
    });

    it('groups several branches of one ticket together', async () => {
      git(fx.seed, 'checkout', '-q', '-b', 'AT-1-second-try', BASE);
      commitFile(fx.seed, 'second.txt', 'y\n', 'AT-1 Second try');
      git(fx.seed, 'push', '-q', 'origin', 'AT-1-second-try');
      const list = await createReviewService(config(), { ...installed, jira: fakeJira() }).list();
      expect(list.tickets.find((t) => t.key === 'AT-1')!.branches).toHaveLength(2);
    });
  });

  describe('review decisions and the approval gate', () => {
  const svc = (jira = fakeJira()) => createReviewService(config(), { ...installed, jira });

  it('includes approval and review information on the show page data', async () => {
    const jira = fakeJira({ findReviewIssue: vi.fn().mockResolvedValue(issue('AT-1', 'Add new spec', 'Brian', 'declined')) });
    const d = await svc(jira).detail('AT-1-add-spec');
    expect(d.ticket).toMatchObject({ approval: 'declined', reviewInfo: 'Needs changes' });
  });

  it.each([
    [null, /hasn't been approved yet/],
    ['declined', /was declined in review/],
  ] as const)('refuses to merge a ticket whose approval is %s, before touching git', async (approval, message) => {
    const jira = fakeJira({ findReviewIssue: vi.fn().mockResolvedValue(issue('AT-1', 'x', 'Brian', approval)) });
    const baseBefore = git(fx.origin, 'rev-parse', BASE);
    await expect(svc(jira).merge({ branch: 'AT-1-add-spec', expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(message) });
    expect(git(fx.origin, 'rev-parse', BASE)).toBe(baseBefore);
    expect(git(fx.origin, 'branch', '--list', 'AT-1-add-spec')).toContain('AT-1-add-spec');
  });

  it('records an approval for the reviewed commit', async () => {
    const jira = fakeJira();
    const s = svc(jira);
    await s.list();
    const sha = (await s.detail('AT-1-add-spec')).sha;
    const result = await s.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'approved', info: '  Looks good  ' });
    expect(jira.submitReview).toHaveBeenCalledExactlyOnceWith('AT-1', 'approved', 'Looks good');
    expect(result.approval).toBe('approved');
  });

  it('declining needs a reason', async () => {
    const jira = fakeJira();
    const s = svc(jira);
    await s.list();
    const sha = (await s.detail('AT-1-add-spec')).sha;
    for (const info of [undefined, '', '   ']) {
      await expect(s.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'declined', info })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Say why') });
    }
    expect(jira.submitReview).not.toHaveBeenCalled();
    await expect(s.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'declined', info: 'Missing cleanup' })).resolves.toBeTruthy();
  });

  it('validates the request before touching Jira', async () => {
    const jira = fakeJira();
    const s = svc(jira);
    await s.list();
    const sha = (await s.detail('AT-1-add-spec')).sha;
    const call = (over: Record<string, unknown>) => s.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'approved', ...over });
    await expect(call({ decision: 'maybe' })).rejects.toMatchObject({ status: 400 });
    await expect(call({ decision: undefined })).rejects.toMatchObject({ status: 400 });
    await expect(call({ expectedSha: undefined })).rejects.toMatchObject({ status: 400 });
    await expect(call({ expectedSha: 'not-a-sha' })).rejects.toMatchObject({ status: 400 });
    await expect(call({ info: 42 })).rejects.toMatchObject({ status: 400 });
    await expect(call({ info: 'x'.repeat(5001) })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('5000') });
    await expect(call({ branch: 'feature/x' })).rejects.toMatchObject({ status: 400 });
    await expect(call({ branch: 'AT-404-missing' })).rejects.toMatchObject({ status: 404 });
    await expect(call({ expectedSha: '1234567' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('changed since you opened it') });
    expect(jira.submitReview).not.toHaveBeenCalled();
  });

  it('refuses a ticket that left the Review column', async () => {
    // in Review when the page was opened, gone by the time the decision is submitted
    const jira = fakeJira({ findReviewIssue: vi.fn().mockResolvedValueOnce(issue('AT-1', 'x', 'Brian')).mockResolvedValue(null) });
    const s = svc(jira);
    await s.list();
    const sha = (await s.detail('AT-1-add-spec')).sha;
    await expect(s.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'approved' })).rejects.toMatchObject({ status: 404 });
    expect(jira.submitReview).not.toHaveBeenCalled();
  });

  it.each([
    [new AcliError('not signed in', 'not-authenticated'), 503],
    [new AcliError("Your acli can't set these Jira fields", 'failed'), 502],
  ])('maps a Jira write failure to a clear status', async (err, status) => {
    const jira = fakeJira({ submitReview: vi.fn().mockRejectedValue(err) });
    const s = svc(jira);
    await s.list();
    const sha = (await s.detail('AT-1-add-spec')).sha;
    await expect(s.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'approved' })).rejects.toMatchObject({ status, message: err.message });
  });

  it('lets a guard-rail refusal pass through and rethrows unexpected errors', async () => {
    const s1 = svc(fakeJira({ submitReview: vi.fn().mockRejectedValue(new AcliError('Blocked by the AT-only guard rail: x', 'blocked')) }));
    await s1.list();
    const sha = (await s1.detail('AT-1-add-spec')).sha;
    await expect(s1.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'approved' })).rejects.toBeInstanceOf(AcliError);
    const s2 = svc(fakeJira({ submitReview: vi.fn().mockRejectedValue(new TypeError('weird')) }));
    await expect(s2.submitReview({ branch: 'AT-1-add-spec', expectedSha: sha, decision: 'approved' })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('the Review column gates detail and merge', () => {
    it('includes the Jira ticket on the show page data', async () => {
      const d = await createReviewService(config(), { ...installed, jira: fakeJira() }).detail('AT-1-add-spec');
      expect(d.ticket).toMatchObject({ key: 'AT-1', summary: 'Add new spec', status: 'Review', assignee: 'Brian', reviewers: ['Matthew'] });
    });

    it('refuses to show a branch whose ticket is not in Review', async () => {
      const jira = fakeJira({ findReviewIssue: vi.fn().mockResolvedValue(null) });
      await expect(createReviewService(config(), { ...installed, jira }).detail('AT-1-add-spec')).rejects.toMatchObject({
        status: 404,
        message: expect.stringContaining("isn't in the Review column"),
      });
    });

    it('refuses to merge a branch whose ticket is not in Review, and pushes nothing', async () => {
      const jira = fakeJira({ findReviewIssue: vi.fn().mockResolvedValue(null) });
      const baseBefore = git(fx.origin, 'rev-parse', BASE);
      const svc = createReviewService(config(), { ...installed, jira });
      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 404 });
      expect(git(fx.origin, 'rev-parse', BASE)).toBe(baseBefore);
      expect(git(fx.origin, 'branch', '--list', 'AT-1-add-spec')).toContain('AT-1-add-spec');
    });

    it.each([
      ['not signed in', new AcliError('acli isn\'t logged in', 'not-authenticated'), 503],
      ['not installed', new AcliError('acli not found', 'not-installed'), 503],
      ['another failure', new AcliError('search failed', 'failed'), 502],
    ])('turns a Jira problem (%s) into a clear refusal', async (_n, err, status) => {
      const jira = fakeJira({ findReviewIssue: vi.fn().mockRejectedValue(err) });
      const svc = createReviewService(config(), { ...installed, jira });
      await expect(svc.detail('AT-1-add-spec')).rejects.toMatchObject({ status, message: err.message });
      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: 'abcdef1' })).rejects.toMatchObject({ status });
    });

    it('lets a guard-rail refusal from acli pass through untouched', async () => {
      const jira = fakeJira({ findReviewIssue: vi.fn().mockRejectedValue(new AcliError('Blocked by the AT-only guard rail: x', 'blocked')) });
      await expect(createReviewService(config(), { ...installed, jira }).detail('AT-1-add-spec')).rejects.toBeInstanceOf(AcliError);
    });

    it('rethrows unexpected errors from the Jira client', async () => {
      const jira = fakeJira({ findReviewIssue: vi.fn().mockRejectedValue(new TypeError('weird')) });
      await expect(createReviewService(config(), { ...installed, jira }).detail('AT-1-add-spec')).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe('detail', () => {
    it('returns commits, a per-file diff and clean mergeability', async () => {
      const d = await createReviewService(config(), { ...installed, jira: fakeJira() }).detail('AT-1-add-spec');
      expect(d.commits).toHaveLength(1);
      expect(d.commits[0]).toMatchObject({ author: 'Seed User', subject: 'AT-1 Add new spec' });
      expect(d.files).toHaveLength(1);
      expect(d.files[0]).toMatchObject({ path: 'spec/new.spec.ts', status: 'added', additions: 1, deletions: 0 });
      expect(d.totals).toEqual({ additions: 1, deletions: 0 });
      expect(d.canRebase).toBe(true);
      expect(d.conflicts).toEqual([]);
      expect(d.behind).toBe(1);
      expect(d.unmerged).toBe(1);
      expect(d.branchUrl).toBeNull(); // local-path remote has no web URL
    });

    it('predicts conflicts and names the files', async () => {
      const d = await createReviewService(config(), { ...installed, jira: fakeJira() }).detail('AT-2-conflicting');
      expect(d.canRebase).toBe(false);
      expect(d.conflicts).toEqual(['a.txt']);
    });

    it('rejects bad, non-ticket and unknown branches', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      for (const lookalike of ['AT-1abc', 'at-1-lowercase', 'ATX-1-x', 'AT-', 'AT-x-y', 'APP-1-x']) {
        await expect(svc.detail(lookalike)).rejects.toMatchObject({ status: 400 });
      }
      await expect(svc.detail('--evil')).rejects.toMatchObject({ status: 400 });
      await expect(svc.detail(undefined)).rejects.toMatchObject({ status: 400 });
      await expect(svc.detail('feature/unrelated')).rejects.toMatchObject({ status: 400 });
      await expect(svc.detail('AT-404-missing')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('merge (rebase and merge)', () => {
    async function sha(ref: string, cwd = fx.origin) {
      return git(cwd, 'rev-parse', ref);
    }

    it('rebases onto the base, fast-forwards it, and leaves the developer checkout alone', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const detail = await svc.detail('AT-1-add-spec');
      const baseBefore = await sha(BASE);

      const result = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: detail.sha });

      expect(result).toMatchObject({ merged: 1, baseBranch: BASE, ticketMoved: null, branchDeleted: true, warning: null });
      const baseAfter = await sha(BASE);
      expect(result.newBaseSha).toBe(baseAfter);
      expect(baseAfter).not.toBe(baseBefore);

      // Linear history: the new commit sits directly on the old base tip…
      expect(git(fx.origin, 'rev-parse', `${BASE}~1`)).toBe(baseBefore);
      expect(git(fx.origin, 'log', '--merges', '--format=%h', BASE)).toBe('');
      // …it is a rebased copy (new SHA), same message and content.
      expect(baseAfter).not.toBe(detail.sha);
      expect(git(fx.origin, 'log', '-1', '--format=%s', BASE)).toBe('AT-1 Add new spec');
      expect(git(fx.origin, 'show', `${BASE}:spec/new.spec.ts`)).toContain("test('x'");
      // The reviewed AT branch is deleted from origin once merged…
      expect(result.branchDeleted).toBe(true);
      expect(git(fx.origin, 'branch', '--list', 'AT-1-add-spec')).toBe('');
      // …and nothing else is: base and the other branches are intact.
      expect(git(fx.origin, 'branch', '--list').split('\n').map((l) => l.trim().replace('* ', '')).sort()).toEqual(['AT-2-conflicting', 'feature/unrelated', 'playwright-main']);

      // Developer's checkout: same branch, uncommitted file intact, no leftover worktree.
      expect(git(fx.app, 'branch', '--show-current')).toBe(BASE);
      expect(readFileSync(join(fx.app, 'my-uncommitted-notes.txt'), 'utf8')).toBe('do not touch\n');
      expect(git(fx.app, 'worktree', 'list').split('\n')).toHaveLength(1);
      expect(readdirSync(tmpdir()).filter((n) => n.startsWith('review-merge-') && n.length > 0).length).toBe(0);

      // The page's next listing has nothing to review for it: in real life Jira
      // has moved the ticket out of Review, and its branch is gone either way.
      const list = await svc.list();
      expect(list.tickets.find((t) => t.key === 'AT-1')!.branches).toEqual([]);
    });

    it('moves the ticket to done after pushing and deletes the merged AT branch', async () => {
      const jira = fakeJira();
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');

      const result = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });

      expect(result).toMatchObject({ ticketMoved: 'AT-1', warning: null });
      expect(jira.moveReviewIssueToDone).toHaveBeenCalledExactlyOnceWith('AT-1');
      expect(result.branchDeleted).toBe(true);
      expect(git(fx.origin, 'branch', '--list', 'AT-1-add-spec')).toBe('');
    });

    it('does not touch Jira unless asked, and never when the merge fails', async () => {
      const jira = fakeJira();
      const svc = createReviewService(config(), { ...installed, jira });
      const d1 = await svc.detail('AT-1-add-spec');
      await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d1.sha });
      expect(jira.moveReviewIssueToDone).not.toHaveBeenCalled();

      const d2 = await svc.detail('AT-2-conflicting');
      await expect(svc.merge({ branch: 'AT-2-conflicting', expectedSha: d2.sha, moveToDone: true })).rejects.toBeInstanceOf(ReviewError);
      expect(jira.moveReviewIssueToDone).not.toHaveBeenCalled();
    });

    it('keeps the merge but warns when Jira cannot be updated', async () => {
      const jira = fakeJira({ moveReviewIssueToDone: vi.fn().mockRejectedValue(new AcliError('AT-1 is not in "Review" any more')) });
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');
      const baseBefore = await sha(BASE);

      const result = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });

      expect(result.ticketMoved).toBeNull();
      expect(result.warning).toMatch(/Merged, but AT-1 is not in "Review" any more/);
      expect(await sha(BASE)).not.toBe(baseBefore);
    });

    it('warns (without failing) for a non-AcliError Jira failure', async () => {
      const jira = fakeJira({ moveReviewIssueToDone: vi.fn().mockRejectedValue(new Error('boom')) });
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');
      const result = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });
      expect(result.warning).toMatch(/could not move AT-1 in Jira/);
    });

    it('aborts on conflicts, names the files, and changes nothing', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const d = await svc.detail('AT-2-conflicting');
      const baseBefore = await sha(BASE);

      const err = await svc.merge({ branch: 'AT-2-conflicting', expectedSha: d.sha }).catch((e) => e);

      expect(err).toBeInstanceOf(ReviewError);
      expect(err.status).toBe(409);
      expect(err.message).toMatch(/hit conflicts/);
      expect(err.details).toEqual(['a.txt']);
      expect(await sha(BASE)).toBe(baseBefore);
      expect(git(fx.app, 'worktree', 'list').split('\n')).toHaveLength(1);
      expect(git(fx.app, 'status', '--porcelain')).toBe('?? my-uncommitted-notes.txt');
    });

    it('refuses to merge commits that were not the ones reviewed', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const d = await svc.detail('AT-1-add-spec');
      // someone pushes another commit after the reviewer opened it
      git(fx.seed, 'checkout', '-q', 'AT-1-add-spec');
      commitFile(fx.seed, 'sneaky.txt', 'late change\n', 'AT-1 Late push');
      git(fx.seed, 'push', '-q', 'origin', 'AT-1-add-spec');
      const baseBefore = await sha(BASE);

      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('changed since you opened it'),
      });
      expect(await sha(BASE)).toBe(baseBefore);
    });

    it('cannot merge the same branch twice: the first merge deletes it', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const d = await svc.detail('AT-1-add-spec');
      await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha });
      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha })).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a branch whose changes the base already has', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const d = await svc.detail('AT-1-add-spec');
      await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha });
      git(fx.seed, 'push', '-q', 'origin', 'AT-1-add-spec'); // someone re-pushes the old branch
      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('Nothing to merge'),
      });
    });

    it('validates its input before doing anything', async () => {
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const baseBefore = await sha(BASE);
      await expect(svc.merge({ branch: 'feature/unrelated', expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 400 });
      await expect(svc.merge({ branch: BASE, expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 400 });
      await expect(svc.merge({ branch: '-x', expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 400 });
      await expect(svc.merge({ branch: 'AT-1-add-spec' })).rejects.toMatchObject({ status: 400 });
      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: 'not-a-sha!' })).rejects.toMatchObject({ status: 400 });
      await expect(svc.merge({ branch: 'AT-404-missing', expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 404 });
      expect(await sha(BASE)).toBe(baseBefore);
    });

    it('reports a rejected push (base moved) without losing the temp worktree cleanup', async () => {
      // A server-side hook that rejects pushes simulates the base branch
      // moving, or branch protection, between our fetch and our push.
      const hook = join(fx.origin, 'hooks', 'pre-receive');
      writeFileSync(hook, '#!/bin/sh\necho "remote: GH006: Protected branch update failed" >&2\nexit 1\n', { mode: 0o755 });
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      const d = await svc.detail('AT-1-add-spec');
      const baseBefore = await sha(BASE);

      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha })).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining('Pushing to playwright-main failed'),
      });
      expect(await sha(BASE)).toBe(baseBefore);
      expect(git(fx.app, 'worktree', 'list').split('\n')).toHaveLength(1);
    });

    it('serialises concurrent merges so they do not race on the base branch', async () => {
      git(fx.seed, 'checkout', '-q', '-b', 'AT-3-another', BASE);
      commitFile(fx.seed, 'three.spec.ts', 'z\n', 'AT-3 Another spec');
      git(fx.seed, 'push', '-q', 'origin', 'AT-3-another');
      const svc = createReviewService(config(), { ...installed, jira: fakeJira() });
      await svc.list(); // fetches AT-3 into the clone, as the page's refresh does
      const [a, b] = await Promise.all([svc.detail('AT-1-add-spec'), svc.detail('AT-3-another')]);

      await Promise.all([
        svc.merge({ branch: 'AT-1-add-spec', expectedSha: a.sha }),
        svc.merge({ branch: 'AT-3-another', expectedSha: b.sha }),
      ]);

      const subjects = git(fx.origin, 'log', '--format=%s', '-3', BASE).split('\n');
      expect(subjects).toEqual(expect.arrayContaining(['AT-1 Add new spec', 'AT-3 Another spec']));
      expect(git(fx.origin, 'log', '--merges', '--format=%h', BASE)).toBe('');
    });
  });
});

// The reviewer's whole workflow in one place: rebase the branch onto the latest
// playwright-main, wait for that to finish, then move playwright-main up to it. That
// is a fast-forward, exactly what `git merge AT-123` does after a manual rebase, and a
// merge commit must NEVER appear, whatever happens before or during the merge.
describe('rebase first, then merge: always a straight line, never a merge commit', () => {
  const anyJira = () => fakeJira({ findReviewIssue: vi.fn(async (key: string) => issue(key, 'Another ticket', 'Brian')) });
  const parentsOf = (ref: string) =>
    git(fx.origin, 'rev-list', '--parents', ref)
      .split('\n')
      .map((l) => l.split(' ').slice(1));
  const expectStraightLine = (ref = BASE) => {
    expect(git(fx.origin, 'log', '--merges', '--format=%h', ref)).toBe('');
    for (const parents of parentsOf(ref)) expect(parents.length).toBeLessThanOrEqual(1);
  };
  const cutBranch = (name: string, file: string, content: string, message: string, from = BASE) => {
    git(fx.seed, 'checkout', '-q', '-b', name, from);
    commitFile(fx.seed, file, content, message);
    git(fx.seed, 'push', '-q', 'origin', name);
  };

  it('two tickets in a row: the second is rebased onto the first (and waits for that) before it merges', async () => {
    cutBranch('AT-3-another', 'three.spec.ts', 'z\n', 'AT-3 Another spec');
    const svc = createReviewService(config(), { ...installed, jira: anyJira() });
    await svc.list();
    const [a, b] = await Promise.all([svc.detail('AT-1-add-spec'), svc.detail('AT-3-another')]);
    expect(b.behind).toBe(0); // as the reviewer saw it, before AT-1 landed

    const first = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: a.sha });

    // Going to the next ticket: it is now one commit behind, with the same reviewed commit.
    const bNow = await svc.detail('AT-3-another');
    expect(bNow.sha).toBe(b.sha);
    expect(bNow.behind).toBe(1);
    expect(bNow.canRebase).toBe(true);

    const second = await svc.merge({ branch: 'AT-3-another', expectedSha: b.sha });

    // Rebased first (a new commit, not the one that was reviewed), then fast-forwarded: AT-3 sits directly on AT-1.
    expect(second.newBaseSha).not.toBe(b.sha);
    expect(git(fx.origin, 'rev-parse', BASE)).toBe(second.newBaseSha);
    expect(git(fx.origin, 'rev-parse', `${BASE}~1`)).toBe(first.newBaseSha);
    expect(git(fx.origin, 'log', '--format=%s', '-3', BASE).split('\n')).toEqual(['AT-3 Another spec', 'AT-1 Add new spec', 'AT-9 Base edits a.txt']);
    expect(git(fx.origin, 'show', `${BASE}:three.spec.ts`)).toBe('z');
    expect(git(fx.origin, 'show', `${BASE}:spec/new.spec.ts`)).toContain("test('x'"); // both tickets' files, nothing lost
    expectStraightLine();
    expect(git(fx.origin, 'branch', '--list').split('\n').map((l) => l.trim().replace('* ', '')).sort()).toEqual(['AT-2-conflicting', 'feature/unrelated', 'playwright-main']);
  });

  it('three in a row, starting from stale views, still ends as one straight line in the order merged', async () => {
    cutBranch('AT-3-three', 'three.spec.ts', '3\n', 'AT-3 Third');
    cutBranch('AT-4-four', 'four.spec.ts', '4\n', 'AT-4 Fourth');
    const svc = createReviewService(config(), { ...installed, jira: anyJira() });
    await svc.list();
    const views = await Promise.all(['AT-1-add-spec', 'AT-3-three', 'AT-4-four'].map((b) => svc.detail(b)));
    for (const v of views) await svc.merge({ branch: v.branch, expectedSha: v.sha });
    expect(git(fx.origin, 'log', '--format=%s', '-4', BASE).split('\n')).toEqual(['AT-4 Fourth', 'AT-3 Third', 'AT-1 Add new spec', 'AT-9 Base edits a.txt']);
    expectStraightLine();
  });

  it('the QA workflow: two tickets cut from the same playwright-main with several commits each. The first lands as-is, the second is rebased on top and keeps every commit, in order, with its author', async () => {
    git(fx.seed, 'checkout', '-q', '-b', 'AT-3-multi', BASE);
    commitFile(fx.seed, 'multi/three-a.spec.ts', 'a\n', 'AT-3 First');
    commitFile(fx.seed, 'multi/three-b.spec.ts', 'b\n', 'AT-3 Second');
    commitFile(fx.seed, 'multi/three-c.spec.ts', 'c\n', 'AT-3 Third');
    git(fx.seed, 'push', '-q', 'origin', 'AT-3-multi');
    git(fx.seed, 'checkout', '-q', '-b', 'AT-4-multi', BASE);
    commitFile(fx.seed, 'multi/four-a.spec.ts', 'a\n', 'AT-4 First');
    commitFile(fx.seed, 'multi/four-b.spec.ts', 'b\n', 'AT-4 Second');
    git(fx.seed, 'push', '-q', 'origin', 'AT-4-multi');

    const svc = createReviewService(config(), { ...installed, jira: anyJira() });
    await svc.list();
    const [three, four] = await Promise.all([svc.detail('AT-3-multi'), svc.detail('AT-4-multi')]);
    expect([three.unmerged, four.unmerged]).toEqual([3, 2]);
    expect([three.behind, four.behind]).toEqual([0, 0]);

    // 1) the first ticket sits directly on playwright-main already, so it needs no rewriting: its own commits just move the branch up
    const first = await svc.merge({ branch: 'AT-3-multi', expectedSha: three.sha });
    expect(first.merged).toBe(3);
    expect(first.newBaseSha).toBe(three.sha);

    // 2) the second is now 3 commits behind: rebased onto the first, and only then moved up
    expect((await svc.detail('AT-4-multi')).behind).toBe(3);
    const second = await svc.merge({ branch: 'AT-4-multi', expectedSha: four.sha });
    expect(second.merged).toBe(2);
    expect(second.newBaseSha).not.toBe(four.sha);

    expect(git(fx.origin, 'log', '--format=%s', '-6', BASE).split('\n')).toEqual([
      'AT-4 Second',
      'AT-4 First',
      'AT-3 Third',
      'AT-3 Second',
      'AT-3 First',
      'AT-9 Base edits a.txt',
    ]);
    // authorship survives the rebase (the reviewer only becomes the committer)
    expect(git(fx.origin, 'log', '--format=%an', '-5', BASE).split('\n')).toEqual(Array(5).fill('Seed User'));
    expect(git(fx.origin, 'log', '--format=%cn', '-2', BASE).split('\n')).toEqual(['QA User', 'QA User']);
    for (const f of ['three-a', 'three-b', 'three-c', 'four-a', 'four-b']) expect(git(fx.origin, 'cat-file', '-e', `${BASE}:multi/${f}.spec.ts`)).toBe('');
    expectStraightLine();
  });

  it('a second ticket that now conflicts with the first stops at the rebase: nothing is merged, nothing is deleted', async () => {
    // AT-5 adds the same file AT-1 adds, with different content
    cutBranch('AT-5-clash', 'spec/new.spec.ts', "test('different', () => {})\n", 'AT-5 Same file, different spec');
    const svc = createReviewService(config(), { ...installed, jira: anyJira() });
    await svc.list();
    const [a, c] = await Promise.all([svc.detail('AT-1-add-spec'), svc.detail('AT-5-clash')]);
    expect(c.canRebase).toBe(true); // fine on its own
    await svc.merge({ branch: 'AT-1-add-spec', expectedSha: a.sha });
    const baseAfterFirst = git(fx.origin, 'rev-parse', BASE);

    expect((await svc.detail('AT-5-clash')).canRebase).toBe(false); // the page says so before anyone clicks
    const err = await svc.merge({ branch: 'AT-5-clash', expectedSha: c.sha }).catch((e) => e);

    expect(err).toMatchObject({ status: 409, details: ['spec/new.spec.ts'] });
    expect(err.message).toMatch(/hit conflicts/);
    expect(git(fx.origin, 'rev-parse', BASE)).toBe(baseAfterFirst);
    expect(git(fx.origin, 'branch', '--list', 'AT-5-clash').trim()).toBe('AT-5-clash'); // still there to fix
    expect(git(fx.app, 'worktree', 'list').split('\n')).toHaveLength(1);
    expectStraightLine();
  });

  it('a branch that already contains a merge commit (someone merged playwright-main into it) lands flattened, with no merge commit', async () => {
    git(fx.seed, 'checkout', '-q', '-b', 'AT-6-has-merge', BASE);
    commitFile(fx.seed, 'six-a.spec.ts', 'a\n', 'AT-6 First commit');
    git(fx.seed, 'checkout', '-q', BASE);
    commitFile(fx.seed, 'base-moves-on.txt', 'y\n', 'AT-10 Base moves on');
    git(fx.seed, 'push', '-q', 'origin', BASE);
    git(fx.seed, 'checkout', '-q', 'AT-6-has-merge');
    git(fx.seed, 'merge', '--no-ff', '-q', '-m', 'Merge playwright-main into AT-6', BASE);
    commitFile(fx.seed, 'six-b.spec.ts', 'b\n', 'AT-6 Second commit');
    git(fx.seed, 'push', '-q', 'origin', 'AT-6-has-merge');
    expect(git(fx.seed, 'log', '--merges', '--format=%s', 'AT-6-has-merge')).toBe('Merge playwright-main into AT-6'); // the branch really has one

    const svc = createReviewService(config(), { ...installed, jira: anyJira() });
    await svc.list(); // fetches AT-6 into the clone, as the page's refresh does
    const d = await svc.detail('AT-6-has-merge');
    const result = await svc.merge({ branch: 'AT-6-has-merge', expectedSha: d.sha });

    expect(result.merged).toBe(2);
    expect(git(fx.origin, 'log', '--format=%s', '-3', BASE).split('\n')).toEqual(['AT-6 Second commit', 'AT-6 First commit', 'AT-10 Base moves on']);
    expect(git(fx.origin, 'log', '--format=%s', BASE)).not.toContain('Merge playwright-main');
    expectStraightLine();
  });

  describe('pressing the button twice (or from two tabs) can never merge, push or move anything twice', () => {
    it('a second request for the same branch while the first is running is refused at once, and only one merge happens', async () => {
      const jira = anyJira();
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');
      const baseBefore = git(fx.origin, 'rev-parse', BASE);

      const first = svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });
      const second = svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });
      const third = svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });

      await expect(second).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already being merged') });
      await expect(third).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already being merged') });
      const result = await first;

      expect(result).toMatchObject({ merged: 1, branchDeleted: true, ticketMoved: 'AT-1' });
      expect(git(fx.origin, 'rev-list', '--count', `${baseBefore}..${BASE}`)).toBe('1'); // exactly one commit landed
      expect(jira.moveReviewIssueToDone).toHaveBeenCalledTimes(1);
      expectStraightLine();
    });

    it('the same click after the merge has finished is refused too (branch is gone), and still nothing happens twice', async () => {
      const jira = anyJira();
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');
      await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true });
      const baseAfter = git(fx.origin, 'rev-parse', BASE);

      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true })).rejects.toMatchObject({ status: 404 });

      expect(git(fx.origin, 'rev-parse', BASE)).toBe(baseAfter);
      expect(jira.moveReviewIssueToDone).toHaveBeenCalledTimes(1);
    });

    it('the guard is released after a failure, so the reviewer can try again', async () => {
      const svc = createReviewService(config(), { ...installed, jira: anyJira() });
      const d = await svc.detail('AT-2-conflicting');
      await expect(svc.merge({ branch: 'AT-2-conflicting', expectedSha: d.sha })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('hit conflicts') });
      // not "already being merged": the failed attempt is over
      await expect(svc.merge({ branch: 'AT-2-conflicting', expectedSha: d.sha })).rejects.toMatchObject({ message: expect.stringContaining('hit conflicts') });
    });

    it('different tickets are not blocked by each other: they queue and both land, in order', async () => {
      cutBranch('AT-3-another', 'three.spec.ts', 'z\n', 'AT-3 Another spec');
      const svc = createReviewService(config(), { ...installed, jira: anyJira() });
      await svc.list();
      const [a, b] = await Promise.all([svc.detail('AT-1-add-spec'), svc.detail('AT-3-another')]);

      const results = await Promise.all([svc.merge({ branch: 'AT-1-add-spec', expectedSha: a.sha }), svc.merge({ branch: 'AT-3-another', expectedSha: b.sha })]);

      expect(results.map((r) => r.merged)).toEqual([1, 1]);
      expect(git(fx.origin, 'log', '--format=%s', '-3', BASE).split('\n')).toEqual(['AT-3 Another spec', 'AT-1 Add new spec', 'AT-9 Base edits a.txt']);
      expectStraightLine();
    });

    it('a malformed request does not leave the guard stuck for anything else', async () => {
      const svc = createReviewService(config(), { ...installed, jira: anyJira() });
      await expect(svc.merge({ branch: 'AT-1-add-spec' })).rejects.toMatchObject({ status: 400 }); // no expectedSha
      const d = await svc.detail('AT-1-add-spec');
      await expect(svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha })).resolves.toMatchObject({ merged: 1 });
    });
  });

  describe('when something goes wrong between the rebase and the push', () => {
    let shimDir: string;
    const savedPath = process.env.PATH;

    // A `git` in front of the real one that behaves normally, but right after the rebase succeeds it does
    // something to the repository, to make a rare situation happen on purpose.
    function useShim(mode: 'merge-commit' | 'teammate-lands-first') {
      shimDir = mkdtempSync(join(tmpdir(), 'git-shim-'));
      const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
      const shim = join(shimDir, 'git');
      writeFileSync(
        shim,
        `#!/bin/sh
"$REAL_GIT" "$@"
rc=$?
case " $* " in
  *" rebase origin/playwright-main "*)
    if [ "$rc" = 0 ]; then
      case "$SHIM_MODE" in
        merge-commit)
          T=$("$REAL_GIT" rev-parse 'HEAD^{tree}')
          S=$("$REAL_GIT" commit-tree "$T" -m side)
          M=$("$REAL_GIT" commit-tree "$T" -p HEAD -p "$S" -m "a merge commit that must never be pushed")
          "$REAL_GIT" checkout -q --detach "$M"
          ;;
        teammate-lands-first)
          "$REAL_GIT" -C "$TEAMMATE" fetch -q origin
          "$REAL_GIT" -C "$TEAMMATE" checkout -q -B teammate origin/playwright-main
          echo "from a teammate" > "$TEAMMATE/teammate.txt"
          "$REAL_GIT" -C "$TEAMMATE" add -A
          "$REAL_GIT" -C "$TEAMMATE" commit -q -m "Teammate lands first"
          "$REAL_GIT" -C "$TEAMMATE" push -q origin HEAD:playwright-main
          ;;
      esac
    fi
    ;;
esac
exit $rc
`,
      );
      chmodSync(shim, 0o755);
      process.env.PATH = `${shimDir}:${savedPath}`;
      process.env.REAL_GIT = real;
      process.env.SHIM_MODE = mode;
      process.env.TEAMMATE = fx.seed;
    }
    afterEach(() => {
      process.env.PATH = savedPath;
      delete process.env.REAL_GIT;
      delete process.env.SHIM_MODE;
      delete process.env.TEAMMATE;
      if (shimDir) rmSync(shimDir, { recursive: true, force: true });
    });

    it('refuses to push a result that contains a merge commit, and nothing changes anywhere', async () => {
      const jira = anyJira();
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');
      const baseBefore = git(fx.origin, 'rev-parse', BASE);
      useShim('merge-commit');

      const err = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true }).catch((e) => e);

      expect(err).toMatchObject({ status: 409 });
      expect(err.message).toMatch(/not a straight line of commits \(it contains 1 merge commit\)/);
      expect(err.message).toMatch(/Merge commits are never created here, and nothing was pushed/);
      expect(git(fx.origin, 'rev-parse', BASE)).toBe(baseBefore);
      expect(git(fx.origin, 'branch', '--list', 'AT-1-add-spec').trim()).toBe('AT-1-add-spec'); // branch kept
      expect(jira.moveReviewIssueToDone).not.toHaveBeenCalled();
      expect(git(fx.app, 'worktree', 'list').split('\n')).toHaveLength(1);
      expectStraightLine();
    });

    it('when a teammate lands on playwright-main after our rebase, our push is rejected as non-fast-forward and nothing is lost or merged', async () => {
      const jira = anyJira();
      const svc = createReviewService(config(), { ...installed, jira });
      const d = await svc.detail('AT-1-add-spec');
      useShim('teammate-lands-first');

      const err = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha, moveToDone: true }).catch((e) => e);

      expect(err).toMatchObject({ status: 409 });
      expect(err.message).toMatch(/moved while merging\. Nothing was pushed/);
      // the teammate's commit is the base tip, ours was not forced over it, and no merge commit papered over the gap
      expect(git(fx.origin, 'log', '-1', '--format=%s', BASE)).toBe('Teammate lands first');
      expect(git(fx.origin, 'log', '--format=%s', BASE)).not.toContain('AT-1 Add new spec');
      expect(git(fx.origin, 'branch', '--list', 'AT-1-add-spec').trim()).toBe('AT-1-add-spec');
      expect(jira.moveReviewIssueToDone).not.toHaveBeenCalled();
      expectStraightLine();

      // Clicking again (now without the shim) rebases onto the teammate's commit and lands cleanly on top of it.
      process.env.PATH = savedPath;
      const again = await svc.merge({ branch: 'AT-1-add-spec', expectedSha: d.sha });
      expect(again.merged).toBe(1);
      expect(git(fx.origin, 'log', '--format=%s', '-3', BASE).split('\n')).toEqual(['AT-1 Add new spec', 'Teammate lands first', 'AT-9 Base edits a.txt']);
      expectStraightLine();
    });
  });
});
