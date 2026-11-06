import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitGuardError, TEMP_WORKTREE_PREFIX, createGitGuard, isTempWorktree } from './gitGuard';

const assertAllowed = createGitGuard({ remote: 'origin', baseBranch: 'playwright-main', projectKey: 'AT' });
const REPO = '/Users/qa/Dev/securicy-app';
const TMP = `${TEMP_WORKTREE_PREFIX}AbC123`;
const SHA = 'a'.repeat(40);
const BASE = 'origin/playwright-main';
const AT = 'origin/AT-727-add-test';

const allowed = (args: string[], cwd = REPO) => expect(() => assertAllowedAcrossCwd(args, cwd)).not.toThrow();
const blocked = (args: string[], cwd = REPO) => expect(() => assertAllowedAcrossCwd(args, cwd)).toThrow(GitGuardError);
const assertAllowedAcrossCwd = (args: string[], cwd: string) => assertAllowed(args, cwd);

describe('git guard rail: what IS allowed', () => {
  it('read-only inspection of the base branch and AT branches', () => {
    allowed(['rev-parse', '--is-inside-work-tree']);
    allowed(['rev-parse', 'HEAD'], TMP);
    allowed(['rev-parse', '--verify', '--quiet', `${AT}^{commit}`]);
    allowed(['rev-parse', '--verify', '--quiet', `${BASE}^{commit}`]);
    allowed(['remote', 'get-url', 'origin']);
    allowed(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/']);
    allowed(['rev-list', '--left-right', '--count', `${BASE}...${AT}`]);
    allowed(['rev-list', '--count', `${BASE}..HEAD`], TMP);
    allowed(['cherry', BASE, AT]);
    allowed(['log', '--reverse', '--max-count=200', '--format=%H', `${BASE}..${AT}`]);
    allowed(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', `${BASE}...${AT}`]);
    allowed(['diff', '--name-only', '--diff-filter=U'], TMP);
    allowed(['merge-tree', '--write-tree', '--name-only', '--no-messages', BASE, AT]);
  });

  it('fetch (remote-tracking refs only)', () => {
    allowed(['fetch', '--prune', '--quiet', 'origin']);
  });

  it('CHECKOUT of an AT branch into a temp worktree, and cleaning that up', () => {
    allowed(['worktree', 'add', '--detach', '--quiet', TMP, AT]);
    allowed(['worktree', 'remove', '--force', TMP]);
    allowed(['worktree', 'prune']);
  });

  it('REBASE onto the base branch inside the temp worktree (and abort)', () => {
    allowed(['rebase', BASE], TMP);
    allowed(['rebase', '--abort'], TMP);
  });

  it('MERGE: a plain fast-forward push of a sha to the base branch from the temp worktree', () => {
    allowed(['push', 'origin', `${SHA}:refs/heads/playwright-main`], TMP);
  });

  it('DELETE of the merged AT-### branch, only with a lease on the exact reviewed commit, from the temp worktree', () => {
    allowed(['push', 'origin', `--force-with-lease=refs/heads/AT-727-add-test:${SHA}`, '--delete', 'AT-727-add-test'], TMP);
    allowed(['push', 'origin', `--force-with-lease=refs/heads/AT-1:${SHA}`, '--delete', 'AT-1'], TMP);
    allowed(['push', 'origin', `--force-with-lease=refs/heads/AT-5/sub:${SHA}`, '--delete', 'AT-5/sub'], TMP);
  });

  it('the diff --stat summary used by the list', () => {
    allowed(['diff', '--shortstat', `${BASE}...${AT}`]);
  });
});

describe('git guard rail: branch deletion is AT-### only', () => {
  const lease = (branch: string, sha = SHA) => `--force-with-lease=refs/heads/${branch}:${sha}`;
  const del = (branch: string, target = branch, sha = SHA) => ['push', 'origin', lease(branch, sha), '--delete', target];

  it.each([
    'master',
    'main',
    'playwright-main',
    'release-next',
    'develop',
    'feature/unrelated',
    'APP-12310-encrypt',
    'MT-5',
    'at-1-lowercase',
    'AT-12abc',
    'AT-',
    'ATX-1-x',
    'AT-x',
    'AT-1_x',
    'playwright-release-next-critical-aug18',
  ])('blocks deleting %s, even with a perfectly formed lease', (branch) => {
    blocked(del(branch), TMP);
    blocked(del(branch), REPO);
  });

  it('blocks every malformed or widened delete', () => {
    blocked(del('AT-1-x', 'master'), TMP); // lease says AT, target says master
    blocked(del('master', 'AT-1-x'), TMP); // lease says master, target says AT
    blocked(del('AT-1-x', 'AT-2-y'), TMP); // lease/target mismatch
    blocked(['push', 'origin', '--delete', 'AT-1-x'], TMP); // no lease
    blocked(['push', 'origin', '--force', '--delete', 'AT-1-x'], TMP);
    blocked(['push', 'origin', '--delete', lease('AT-1-x'), 'AT-1-x'], TMP); // wrong order
    blocked(['push', 'origin', lease('AT-1-x'), '--delete', 'AT-1-x', 'AT-2-y'], TMP); // two branches
    blocked(['push', 'origin', lease('AT-1-x'), '--delete', 'AT-*'], TMP); // wildcard
    blocked(['push', 'origin', lease('AT-1-x'), '--delete', 'refs/tags/AT-1-x'], TMP); // a tag
    blocked(['push', 'origin', lease('AT-1-x'), '--delete', 'AT-1-x', '--tags'], TMP);
    blocked(['push', 'origin', 'refs/heads/AT-1-x', '--delete', 'AT-1-x'], TMP);
    blocked(['push', 'origin', ':refs/heads/AT-1-x'], TMP); // empty-source refspec delete
    blocked(['push', 'origin', `+${SHA}:refs/heads/AT-1-x`], TMP);
    blocked(['push', 'origin', '--force-with-lease', '--delete', 'AT-1-x'], TMP);
    blocked(['push', '--delete', 'origin', 'AT-1-x'], TMP);
  });

  it('requires a full 40-character commit in the lease', () => {
    blocked(del('AT-1-x', 'AT-1-x', 'abcdef1'), TMP);
    blocked(del('AT-1-x', 'AT-1-x', ''), TMP);
    blocked(del('AT-1-x', 'AT-1-x', 'g'.repeat(40)), TMP);
    blocked(del('AT-1-x', 'AT-1-x', 'A'.repeat(40)), TMP); // uppercase hex is not what rev-parse prints
    blocked(['push', 'origin', '--force-with-lease=refs/heads/AT-1-x', '--delete', 'AT-1-x'], TMP);
  });

  it('only deletes from the temp worktree and only on the configured remote', () => {
    blocked(del('AT-1-x'), REPO);
    blocked(del('AT-1-x'), '/Users/qa/Dev');
    blocked(['push', 'upstream', lease('AT-1-x'), '--delete', 'AT-1-x'], TMP);
  });

  it('can never delete the configured base branch, whatever it is called', () => {
    const odd = createGitGuard({ remote: 'origin', baseBranch: 'AT-1-base', projectKey: 'AT' });
    expect(() => odd(['push', 'origin', `--force-with-lease=refs/heads/AT-1-base:${SHA}`, '--delete', 'AT-1-base'], TMP)).toThrow(GitGuardError);
  });
});

describe('git guard rail: only AT tickets', () => {
  it.each(['origin/AT-1', 'origin/AT-12-x', 'origin/AT-727-add-test', 'origin/AT-5/sub-branch'])('allows the exact AT-### shape %s', (ref) => {
    allowed(['cherry', BASE, ref]);
    allowed(['worktree', 'add', '--detach', '--quiet', TMP, ref]);
  });

  const others = ['origin/feature/unrelated', 'origin/APP-12310-encrypt', 'origin/MT-5', 'origin/playwright-release-next-critical-aug18', 'origin/at-1-lowercase', 'origin/ATX-1-x', 'origin/AT-x', 'origin/AT-12abc', 'origin/AT-12.5', 'origin/AT-', 'origin/AT-1_x', 'origin/master', 'origin/release-next', 'master', 'AT-1-no-remote-prefix', 'upstream/AT-1-x'];

  it.each(others)('blocks %s everywhere a branch can appear', (ref) => {
    blocked(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    blocked(['cherry', BASE, ref]);
    blocked(['rev-list', '--left-right', '--count', `${BASE}...${ref}`]);
    blocked(['log', '--reverse', '--max-count=200', '--format=%H', `${BASE}..${ref}`]);
    blocked(['diff', '-M', '--no-color', '--no-ext-diff', `${BASE}...${ref}`]);
    blocked(['merge-tree', '--write-tree', '--name-only', '--no-messages', BASE, ref]);
    blocked(['worktree', 'add', '--detach', '--quiet', TMP, ref]);
  });

  it('blocks option-injection and range tricks in a branch name', () => {
    for (const ref of ['origin/AT-1--upload-pack=x', 'origin/AT-1 ; rm -rf', 'origin/AT-1..master', 'origin/AT-1$(x)', '--output=/tmp/x']) {
      blocked(['cherry', BASE, ref]);
      blocked(['worktree', 'add', '--detach', '--quiet', TMP, ref]);
    }
    blocked(['log', '--reverse', '--max-count=200', '--format=%H', `${BASE}..${AT}..origin/master`]);
    blocked(['rev-list', '--count', `${BASE}...${AT}`]); // wrong separator for --count form
    blocked(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', `${BASE}..${AT}`]);
  });
});

describe('git guard rail: diff cannot be turned into something else', () => {
  const range = `${BASE}...${AT}`;

  it('requires --no-ext-diff and --no-textconv so no configured program ever runs on branch content', () => {
    blocked(['diff', '-M', '--no-color', '--no-ext-diff', range]); // missing --no-textconv
    blocked(['diff', '-M', '--no-color', '--no-textconv', range]); // missing --no-ext-diff
    blocked(['diff', '-M', '--no-color', '--ext-diff', '--no-textconv', range]);
    blocked(['diff', '-M', '--no-color', '--textconv', '--no-ext-diff', range]);
  });

  it('cannot write to a file or run a tool', () => {
    blocked(['diff', '--output=/tmp/pwned', '-M', '--no-color', '--no-ext-diff', '--no-textconv', range]);
    blocked(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', '--output=/tmp/pwned', range]);
    blocked(['diff', '--no-index', '/etc/passwd', '/dev/null']);
    blocked(['difftool', range]);
    blocked(['diff', '--shortstat', `${BASE}...${AT}`, '--output=/tmp/x']);
    blocked(['diff', '--shortstat', '--output=/tmp/x', `${BASE}...${AT}`]);
  });

  it('cannot diff anything but the base branch against an AT branch', () => {
    blocked(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', 'origin/master...origin/release-next']);
    blocked(['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', `${BASE}...origin/APP-1-x`]);
  });
});

describe('git guard rail: everything else is blocked', () => {
  it.each([
    ['force push', ['push', '--force', 'origin', `${SHA}:refs/heads/playwright-main`]],
    ['force-with-lease push', ['push', '--force-with-lease', 'origin', `${SHA}:refs/heads/playwright-main`]],
    ['+refspec push', ['push', 'origin', `+${SHA}:refs/heads/playwright-main`]],
    ['branch deletion', ['push', 'origin', '--delete', 'AT-727-add-test']],
    ['deletion via empty refspec', ['push', 'origin', ':refs/heads/AT-727-add-test']],
    ['push to master', ['push', 'origin', `${SHA}:refs/heads/master`]],
    ['push to release-next', ['push', 'origin', `${SHA}:refs/heads/release-next`]],
    ['push to another ref name', ['push', 'origin', `${SHA}:refs/heads/AT-1-x`]],
    ['push of a branch name, not a sha', ['push', 'origin', 'AT-1-x:refs/heads/playwright-main']],
    ['push to another remote', ['push', 'upstream', `${SHA}:refs/heads/playwright-main`]],
    ['push of tags', ['push', 'origin', '--tags']],
    ['push with a smuggled second refspec', ['push', 'origin', `${SHA}:refs/heads/playwright-main:refs/heads/master`]],
    ['push --mirror', ['push', '--mirror', 'origin']],
    ['reset', ['reset', '--hard', BASE]],
    ['commit', ['commit', '-am', 'x']],
    ['add', ['add', '-A']],
    ['clean', ['clean', '-fdx']],
    ['stash', ['stash']],
    ['config', ['config', 'user.name', 'x']],
    ['remote add', ['remote', 'add', 'evil', 'https://evil.example/x.git']],
    ['remote set-url', ['remote', 'set-url', 'origin', 'https://evil.example/x.git']],
    ['remote remove', ['remote', 'remove', 'origin']],
    ['fetch --all', ['fetch', '--all']],
    ['fetch from another remote', ['fetch', 'upstream']],
    ['fetch with a refspec', ['fetch', 'origin', '+refs/heads/*:refs/heads/*']],
    ['pull', ['pull', 'origin', 'playwright-main']],
    ['merge', ['merge', AT]],
    ['cherry-pick', ['cherry-pick', SHA]],
    ['branch -D', ['branch', '-D', 'AT-1-x']],
    ['tag', ['tag', '-d', 'v1']],
    ['checkout in the main repo', ['checkout', 'AT-1-x']],
    ['checkout -b', ['checkout', '-b', 'new']],
    ['switch', ['switch', 'master']],
    ['update-ref', ['update-ref', '-d', 'refs/heads/playwright-main']],
    ['gc', ['gc', '--prune=now']],
    ['filter-branch', ['filter-branch', '--all']],
    ['an alias / -c injection', ['-c', 'core.sshCommand=evil', 'fetch', 'origin']],
    ['rebase onto master', ['rebase', 'origin/master']],
    ['interactive rebase', ['rebase', '-i', BASE]],
    ['rebase --exec', ['rebase', '--exec', 'rm -rf /', BASE]],
    ['rebase --continue', ['rebase', '--continue']],
    ['worktree add without --detach', ['worktree', 'add', TMP, AT]],
    ['worktree add outside temp', ['worktree', 'add', '--detach', '--quiet', '/Users/qa/Desktop/x', AT]],
    ['worktree remove outside temp', ['worktree', 'remove', '--force', REPO]],
    ['worktree remove via traversal', ['worktree', 'remove', '--force', `${TMP}/../../important`]],
    ['for-each-ref over all refs', ['for-each-ref', '--format=%(refname)', 'refs/heads/']],
    ['empty command', []],
    ['non-string args', ['log', 5 as unknown as string]],
  ])('blocks %s', (_name, args) => {
    blocked(args as string[], TMP);
    blocked(args as string[], REPO);
  });

  it('only rebases and pushes from inside a temp worktree, never the real checkout', () => {
    blocked(['rebase', BASE], REPO);
    blocked(['rebase', '--abort'], REPO);
    blocked(['push', 'origin', `${SHA}:refs/heads/playwright-main`], REPO);
    blocked(['push', 'origin', `${SHA}:refs/heads/playwright-main`], '/Users/qa/Dev');
    blocked(['rebase', BASE], `${TMP}/../../..`);
  });

  it('has a base-branch-specific push rule', () => {
    const other = createGitGuard({ remote: 'origin', baseBranch: 'qa-main', projectKey: 'AT' });
    expect(() => other(['push', 'origin', `${SHA}:refs/heads/qa-main`], TMP)).not.toThrow();
    expect(() => other(['push', 'origin', `${SHA}:refs/heads/playwright-main`], TMP)).toThrow(GitGuardError);
  });
});

describe('isTempWorktree', () => {
  it('accepts only our own temp directories', () => {
    expect(isTempWorktree(TMP)).toBe(true);
    for (const p of [REPO, '/tmp/x', `${TMP}/../x`, `${TEMP_WORKTREE_PREFIX}a b`, `${TEMP_WORKTREE_PREFIX};x`, '']) {
      expect(isTempWorktree(p)).toBe(false);
    }
  });
});

describe('no other way to run commands (shells, other binaries, unguarded gh)', () => {
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ f, src: readFileSync(join(__dirname, f), 'utf8') }));

  it('imports child_process in exactly four places, each behind its own guard: git, acli, gh and the spec runner', () => {
    const spawners = files.filter(({ src }) => /from 'node:child_process'/.test(src)).map(({ f }) => f);
    expect(spawners.sort()).toEqual(['acli.ts', 'ghStatus.ts', 'reviewGit.ts', 'specRunner.ts']);
    for (const { f, src } of files) {
      if (f === 'acli.ts') expect(src).toMatch(/execFile\('acli'/);
      if (f === 'ghStatus.ts') expect(src).toMatch(/execFile\(\s*'gh'/);
      if (f === 'reviewGit.ts') expect(src).toMatch(/execFile\(\s*'git'/);
      if (f === 'specRunner.ts') expect(src).toMatch(/\)\('yarn', args, \{/);
    }
  });

  it('the spec runner starts only `yarn`, only after its guard, with no shell', () => {
    const src = files.find(({ f }) => f === 'specRunner.ts')!.src;
    expect(src).toMatch(/assertAllowedSpecCommand\('yarn', args, opts\.cwd\);[^]*\)\('yarn', args, \{/);
    expect(src).not.toMatch(/shell\s*:\s*true/);
    expect(src.match(/\('(?:[a-z]+)', args, \{/g)).toEqual(["('yarn', args, {"]);
    // nothing else spawns it: specRun.ts only goes through startSpecProcess
    const run = files.find(({ f }) => f === 'specRun.ts')!.src;
    expect(run).not.toMatch(/child_process/);
    expect(run).toMatch(/startSpecProcess\(/);
  });

  it('never launches a shell or any binary other than git, acli, gh and (guarded) yarn', () => {
    for (const { src } of files) {
      expect(src).not.toMatch(/execFile\(\s*['"`](?!git['"`]|acli['"`]|gh['"`])/);
      expect(src).not.toMatch(/(?<![.\w])(exec|execSync|spawn|spawnSync)\s*\(/);
      expect(src).not.toMatch(/shell\s*:\s*true/);
    }
  });

  it('gh is only ever run from ghStatus.ts, and only through its guard', () => {
    for (const { f, src } of files) {
      if (f !== 'ghStatus.ts') expect(src, f).not.toMatch(/['"`]gh['"`]\s*,/);
    }
    const src = files.find(({ f }) => f === 'ghStatus.ts')!.src;
    expect(src).toMatch(/assertAllowedGhCommand\(args\);\s*\n\s*return rawRun\(args\)/);
  });

  it('acli is only run through its guard', () => {
    const src = files.find(({ f }) => f === 'acli.ts')!.src;
    expect(src).toMatch(/assertAllowedAcliCommand\(args, settings\);\s*\n\s*return rawRun\(args\)/);
  });

  it('reviewGit.ts only reaches runGit through the guarded wrapper', () => {
    const src = files.find(({ f }) => f === 'reviewGit.ts')!.src;
    const calls = src.match(/\brunGit\(/g) ?? [];
    // one definition + one call inside the guarded `git` wrapper
    expect(calls).toHaveLength(2);
    expect(src).toMatch(/assertAllowedGitCommand\(args, cwd\);\s*\n\s*return runGit\(args, cwd, timeout\)/);
  });
});
