import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAllowedAcliCommand, createJiraClient } from './acli';
import { assertAllowedGhCommand } from './ghStatus';
import { TEMP_WORKTREE_PREFIX, createGitGuard } from './gitGuard';
import { createReviewService } from './reviewGit';

// -----------------------------------------------------------------------------
// MOCKED PROCESSES. `node:child_process` is replaced wholesale, so nothing real
// ever runs: no git, no acli, no gh. Every call the app *would* make is recorded
// and then audited against the guard rails — independently of the guards that
// ran inside the app — across realistic flows and hostile scenarios.
// -----------------------------------------------------------------------------

interface Spawn {
  bin: string;
  args: string[];
  cwd?: string;
}
interface FakeResult {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

const h = vi.hoisted(() => ({
  spawned: [] as Array<{ bin: string; args: string[]; cwd?: string }>,
  override: null as null | ((bin: string, args: string[]) => { code?: number | string; stdout?: string; stderr?: string } | undefined),
  respond: null as unknown as (bin: string, args: string[]) => { code?: number | string; stdout?: string; stderr?: string },
}));

vi.mock('node:child_process', () => ({
  execFile: (
    bin: string,
    args: string[],
    opts: { cwd?: string },
    cb: (err: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void,
  ) => {
    h.spawned.push({ bin, args: [...args], cwd: opts?.cwd });
    const r = h.override?.(bin, args) ?? h.respond(bin, args);
    const stdout = r.stdout ?? '';
    const stderr = r.stderr ?? '';
    if (r.code && r.code !== 0) cb(Object.assign(new Error(`${bin} failed`), { code: r.code }), stdout, stderr);
    else cb(null, stdout, stderr);
  },
}));

const BRANCH_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const NEW_HEAD = 'd'.repeat(40);
const SEP = '\x1f';
const REC = '\x1e';

const BRANCH_LINES = [
  ['AT-727-add-test', BRANCH_SHA, 'Brian Baggs', '2026-11-05T10:00:00-04:00', 'AT-727 Add tests'],
  ['AT-726-mcp-tools', 'e'.repeat(40), 'Matthew Carabin', '2026-11-04T10:00:00-04:00', 'AT-726 MCP tools'],
  // Branches that must never be listed or touched:
  ['feature/unrelated', 'f'.repeat(40), 'Dev', '2026-11-05T10:00:00-04:00', 'Unrelated'],
  ['APP-12310-encrypt', '1'.repeat(40), 'Dev', '2026-11-05T10:00:00-04:00', 'APP-12310 Encrypt'],
  ['playwright-main', BASE_SHA, 'QA', '2026-11-05T10:00:00-04:00', 'AT-725 Update'],
  ['master', '2'.repeat(40), 'Dev', '2026-11-05T10:00:00-04:00', 'Master commit'],
  ['release-next', '3'.repeat(40), 'Dev', '2026-11-05T10:00:00-04:00', 'Release'],
  ['at-9-lowercase', '4'.repeat(40), 'Dev', '2026-11-05T10:00:00-04:00', 'lowercase'],
  ['AT-12abc-lookalike', '5'.repeat(40), 'Dev', '2026-11-05T10:00:00-04:00', 'lookalike'],
  ['HEAD', BASE_SHA, '', '', ''],
]
  .map((f) => f.join(SEP))
  .join('\n');

const DIFF = ['diff --git a/spec/x.spec.ts b/spec/x.spec.ts', 'new file mode 100644', '--- /dev/null', '+++ b/spec/x.spec.ts', '@@ -0,0 +1 @@', '+hello', ''].join('\n');

const jiraReview = (extra: unknown[] = []) =>
  JSON.stringify([
    { key: 'AT-727', fields: { summary: 'Add tests for comments', status: { name: 'Review' }, assignee: { displayName: 'Brian Baggs' } } },
    { key: 'AT-726', fields: { summary: 'MCP tools', status: { name: 'Review' }, assignee: { displayName: 'Brian Baggs' } } },
    ...extra,
  ]);

h.respond = function respond(bin, args): FakeResult {
  if (bin === 'acli') return { stdout: jiraReview() };
  if (bin === 'gh') return { stdout: 'github.com\n  ✓ Logged in to github.com account BrianBaggs (keyring)\n' };
  if (bin !== 'git') return { code: 127, stderr: `unexpected binary: ${bin}` };

  const a = args[0] === '-c' ? args.slice(2) : args;
  const [cmd, ...r] = a;
  switch (cmd) {
    case 'remote':
      return { stdout: 'git@github.com:carbidesecure/securicy-app.git\n' };
    case 'fetch':
    case 'worktree':
    case 'rebase':
    case 'push':
      return {};
    case 'for-each-ref':
      return { stdout: BRANCH_LINES };
    case 'rev-parse':
      if (r[0] === 'HEAD') return { stdout: `${NEW_HEAD}\n` };
      return { stdout: `${r[2]?.startsWith('origin/playwright-main') ? BASE_SHA : BRANCH_SHA}\n` };
    case 'rev-list':
      return { stdout: r[0] === '--left-right' ? '1\t1\n' : '1\n' };
    case 'cherry':
      return { stdout: `+ ${'c'.repeat(40)}\n` };
    case 'log':
      return { stdout: `${'9'.repeat(40)}${SEP}Brian Baggs${SEP}2026-11-05T10:00:00-04:00${SEP}AT-727 Add tests${SEP}Body text${REC}` };
    case 'diff':
      return { stdout: r[0] === '--shortstat' ? ' 1 file changed, 1 insertion(+)\n' : DIFF };
    case 'merge-tree':
      return { stdout: `${'t'.repeat(40)}\n` };
  }
  return { code: 1, stderr: `unexpected git command in test: ${a.join(' ')}` };
};

const roots: string[] = [];
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-mock-repo-'));
  mkdirSync(join(root, '.git'));
  roots.push(root);
  return root;
}

const repoPath = makeRepo();
const baseConfig = { repoPath, baseBranch: 'playwright-main', remote: 'origin', projectKey: 'AT' };

function makeService(overrides: Partial<Parameters<typeof createReviewService>[1]> = {}) {
  return createReviewService(baseConfig, {
    jira: createJiraClient('AT', { reviewStatus: 'Review', doneStatus: 'Done' }),
    findExecutable: () => true,
    ...overrides,
  });
}

// ---- audit helpers -----------------------------------------------------------

const spawned = (): Spawn[] => h.spawned;
const gitCalls = () => spawned().filter((s) => s.bin === 'git').map((s) => ({ ...s, args: s.args[0] === '-c' ? s.args.slice(2) : s.args }));
const acliCalls = () => spawned().filter((s) => s.bin === 'acli');
const ghCalls = () => spawned().filter((s) => s.bin === 'gh');
const idx = (pred: (s: Spawn) => boolean) => spawned().findIndex(pred);
const isGit = (...prefix: string[]) => (s: Spawn) => s.bin === 'git' && prefix.every((p, i) => (s.args[0] === '-c' ? s.args.slice(2) : s.args)[i] === p);

const independentGitGuard = createGitGuard({ remote: 'origin', baseBranch: 'playwright-main', projectKey: 'AT' });

/** Re-validate everything that was (mock-)spawned, with guards the app didn't run. */
function auditEverything() {
  for (const s of spawned()) {
    expect(['git', 'acli', 'gh'], `unexpected binary ${s.bin}`).toContain(s.bin);
  }
  for (const c of gitCalls()) {
    expect(() => independentGitGuard(c.args, c.cwd ?? repoPath), `git ${c.args.join(' ')}`).not.toThrow();
  }
  for (const c of acliCalls()) {
    expect(() => assertAllowedAcliCommand(c.args, { reviewStatus: 'Review', doneStatus: 'Done' }), `acli ${c.args.join(' ')}`).not.toThrow();
  }
  for (const c of ghCalls()) {
    expect(() => assertAllowedGhCommand(c.args), `gh ${c.args.join(' ')}`).not.toThrow();
  }

  // `worktree remove --force <temp dir>` (cleanup) and the lease-protected delete
  // of an AT-### branch are the only places a force-ish flag may appear, and the
  // independent guard above has already proven they have exactly those shapes.
  const isCleanup = (c: { args: string[] }) => c.args[0] === 'worktree' && c.args[1] === 'remove';
  const isAtBranchDelete = (c: { args: string[] }) => c.args[0] === 'push' && c.args[3] === '--delete' && /^--force-with-lease=refs\/heads\/AT-\d+/.test(c.args[2]);
  const flat = gitCalls().filter((c) => !isCleanup(c) && !isAtBranchDelete(c)).flatMap((c) => c.args);
  for (const banned of ['--force', '-f', '--force-with-lease', '--delete', '-d', '-D', '--hard', '--mirror', '--all', '--tags', '--prune=now']) {
    // `--prune` (plain) is how fetch drops stale remote-tracking refs and is fine.
    expect(flat, `forbidden git flag ${banned}`).not.toContain(banned);
  }
  expect(flat.filter((a) => a.startsWith('+')), 'no +refspec').toEqual([]);
  expect(flat.join(' ')).not.toMatch(/\b(master|release-next|feature\/|APP-|at-9|AT-12abc)\b/);
  expect(
    gitCalls().map((c) => c.args[0]),
    'only these git subcommands are ever used',
  ).toSatisfy((cmds: string[]) =>
    cmds.every((c) => ['rev-parse', 'remote', 'fetch', 'for-each-ref', 'rev-list', 'cherry', 'log', 'diff', 'merge-tree', 'worktree', 'rebase', 'push'].includes(c)),
  );
}

beforeEach(() => {
  h.spawned.length = 0;
  h.override = null;
});

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------

describe('guard rails, audited through mocked processes', () => {
  describe('a complete review: list → open → rebase and merge → move ticket', () => {
    it('only ever launches allowed git/acli/gh commands', async () => {
      const svc = makeService();

      await svc.status();
      await svc.ghStatus();
      const list = await svc.list();
      const detail = await svc.detail('AT-727-add-test');
      const result = await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, moveToDone: true });

      // the flow really did what it should
      expect(list.tickets.map((t) => t.key)).toEqual(['AT-727', 'AT-726']);
      expect(result).toMatchObject({ merged: 1, baseBranch: 'playwright-main', ticketMoved: 'AT-727', branchDeleted: true });

      auditEverything();
    });

    it('checks out, rebases and pushes ONLY inside a temp worktree, never the real checkout', async () => {
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');
      await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha });

      const add = gitCalls().find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')!;
      const dir = add.args[4];
      expect(add.args).toEqual(['worktree', 'add', '--detach', '--quiet', dir, 'origin/AT-727-add-test']);
      expect(dir.startsWith(TEMP_WORKTREE_PREFIX)).toBe(true);
      expect(dir).not.toBe(repoPath);

      for (const c of gitCalls().filter((c) => c.args[0] === 'rebase' || c.args[0] === 'push')) {
        expect(c.cwd, `${c.args[0]} must run in the temp worktree`).toBe(dir);
      }
      expect(gitCalls().filter((c) => c.args[0] === 'rebase').map((c) => c.args)).toEqual([['rebase', 'origin/playwright-main']]);
      expect(gitCalls().filter((c) => c.args[0] === 'push').map((c) => c.args)).toEqual([
        ['push', 'origin', `${NEW_HEAD}:refs/heads/playwright-main`],
        ['push', 'origin', `--force-with-lease=refs/heads/AT-727-add-test:${BRANCH_SHA}`, '--delete', 'AT-727-add-test'],
      ]);

      // the temp worktree is always cleaned up
      expect(gitCalls().some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove' && c.args[3] === dir)).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });

    it('moves the Jira ticket only AFTER the push, and only that AT ticket', async () => {
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');
      await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, moveToDone: true });

      const push = idx(isGit('push'));
      const transition = idx((s) => s.bin === 'acli' && s.args[2] === 'transition');
      expect(push).toBeGreaterThan(-1);
      expect(transition).toBeGreaterThan(push);
      expect(idx(isGit('rebase'))).toBeLessThan(push);

      const transitions = acliCalls().filter((c) => c.args[2] === 'transition');
      expect(transitions).toHaveLength(1);
      expect(transitions[0].args).toEqual(['jira', 'workitem', 'transition', '--key', 'AT-727', '--status', 'Done', '--yes']);

      // it re-checked the ticket is still in Review right before moving it
      const recheck = acliCalls().filter((c) => c.args[2] === 'search').map((c) => c.args[4]);
      expect(recheck).toContain('key = "AT-727" AND status = "Review"');
    });

    it('reads Jira only for the AT project and the Review column', async () => {
      await makeService().list();
      const queries = acliCalls().map((c) => c.args[4]);
      expect(queries).toEqual(['project = "AT" AND status = "Review" ORDER BY updated DESC']);
    });

    it('asks gh for nothing except "auth status"', async () => {
      await makeService().ghStatus();
      expect(ghCalls().map((c) => c.args)).toEqual([['auth', 'status']]);
    });
  });

  describe('branch deletion (AT-### only)', () => {
    const deletes = () => gitCalls().filter((c) => c.args[0] === 'push' && c.args.includes('--delete'));

    it('deletes exactly the merged AT branch, once, only after the push, with a lease on the reviewed commit', async () => {
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');
      const result = await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha });

      expect(result.branchDeleted).toBe(true);
      expect(deletes()).toHaveLength(1);
      expect(deletes()[0].args).toEqual(['push', 'origin', `--force-with-lease=refs/heads/AT-727-add-test:${BRANCH_SHA}`, '--delete', 'AT-727-add-test']);
      expect(deletes()[0].cwd?.startsWith(TEMP_WORKTREE_PREFIX)).toBe(true);

      const pushToBase = idx((s) => isGit('push', 'origin', `${NEW_HEAD}:refs/heads/playwright-main`)(s));
      const deletion = idx((s) => s.bin === 'git' && s.args.includes('--delete'));
      expect(pushToBase).toBeGreaterThan(-1);
      expect(deletion).toBeGreaterThan(pushToBase);
      auditEverything();
    });

    it('never deletes anything but AT-### branches: base and other branches are never named in a delete', async () => {
      const svc = makeService();
      for (const key of ['AT-727-add-test', 'AT-726-mcp-tools']) {
        const d = await svc.detail(key);
        await svc.merge({ branch: key, expectedSha: d.sha });
      }
      const targets = deletes().map((c) => c.args[4]);
      expect(targets).toEqual(['AT-727-add-test', 'AT-726-mcp-tools']);
      for (const t of targets) expect(t).toMatch(/^AT-\d+-/);
      expect(spawned().some((s) => s.args.join(' ').match(/--delete.*(playwright-main|master|release-next|feature|APP-)/))).toBe(false);
    });

    it.each(['master', 'playwright-main', 'release-next', 'feature/unrelated', 'APP-12310-encrypt', 'at-9-lowercase', 'AT-12abc-lookalike'])(
      'cannot be made to delete %s',
      async (branch) => {
        const svc = makeService();
        await expect(svc.merge({ branch, expectedSha: BRANCH_SHA, moveToDone: true })).rejects.toMatchObject({ status: 400 });
        expect(spawned()).toEqual([]);
      },
    );

    it('is not attempted when the rebase fails or the push is rejected', async () => {
      h.override = (bin, args) => {
        const a = args[0] === '-c' ? args.slice(2) : args;
        return bin === 'git' && a[0] === 'rebase' && a[1] !== '--abort' ? { code: 1, stderr: 'CONFLICT' } : undefined;
      };
      const svc = makeService();
      const d = await svc.detail('AT-727-add-test');
      await expect(svc.merge({ branch: 'AT-727-add-test', expectedSha: d.sha })).rejects.toBeTruthy();
      expect(deletes()).toEqual([]);

      h.spawned.length = 0;
      h.override = (bin, args) => {
        const a = args[0] === '-c' ? args.slice(2) : args;
        return bin === 'git' && a[0] === 'push' ? { code: 1, stderr: 'remote: GH006: Protected branch update failed' } : undefined;
      };
      await expect(svc.merge({ branch: 'AT-727-add-test', expectedSha: d.sha })).rejects.toBeTruthy();
      expect(deletes()).toEqual([]);
    });

    it('a failed delete is only a warning: the merge stands and the ticket is still moved', async () => {
      h.override = (bin, args) => (bin === 'git' && args.includes('--delete') ? { code: 1, stderr: 'error: failed to push some refs (stale info)' } : undefined);
      const svc = makeService();
      const d = await svc.detail('AT-727-add-test');

      const result = await svc.merge({ branch: 'AT-727-add-test', expectedSha: d.sha, moveToDone: true });

      expect(result).toMatchObject({ merged: 1, branchDeleted: false, ticketMoved: 'AT-727' });
      expect(result.warning).toMatch(/couldn't delete the branch AT-727-add-test/);
    });
  });

  describe('only AT-### tickets can be acted on', () => {
    it('never lists non-AT, lowercase or look-alike branches', async () => {
      const list = await makeService().list();
      expect(list.tickets.flatMap((t) => t.branches.map((b) => b.name)).sort()).toEqual(['AT-726-mcp-tools', 'AT-727-add-test']);
    });

    it('lists only tickets that Jira says are in Review, never branches on their own', async () => {
      h.override = (bin, args) =>
        bin === 'acli' && args[2] === 'search' ? { stdout: JSON.stringify([{ key: 'AT-727', fields: { summary: 'Only this one', status: { name: 'Review' } } }]) } : undefined;
      const list = await makeService().list();
      expect(list.tickets.map((t) => t.key)).toEqual(['AT-727']);
      expect(list.tickets.flatMap((t) => t.branches.map((b) => b.name))).toEqual(['AT-727-add-test']); // AT-726's branch exists but isn't shown
    });

    it('refuses to show or merge a branch whose ticket is not in Review: no checkout, rebase, push or delete', async () => {
      h.override = (bin, args) => (bin === 'acli' && args[2] === 'search' ? { stdout: '[]' } : undefined);
      const svc = makeService();
      await expect(svc.detail('AT-727-add-test')).rejects.toMatchObject({ status: 404 });
      await expect(svc.merge({ branch: 'AT-727-add-test', expectedSha: BRANCH_SHA, moveToDone: true })).rejects.toMatchObject({ status: 404 });
      expect(gitCalls().filter((c) => ['worktree', 'rebase', 'push'].includes(c.args[0]))).toEqual([]);
      expect(acliCalls().filter((c) => c.args[2] === 'transition')).toEqual([]);
    });

    it.each(['master', 'main', 'playwright-main', 'release-next', 'feature/unrelated', 'APP-12310-encrypt', 'at-9-lowercase', 'AT-12abc-lookalike', 'ATX-1-x', '--force', '-D', 'AT-1..master', 'AT-1 ; rm -rf /', 'AT-1\nmaster', '$(reboot)', ''])(
      'launches NO process at all for the branch %j',
      async (branch) => {
        const svc = makeService();
        await expect(svc.detail(branch)).rejects.toMatchObject({ status: 400 });
        await expect(svc.merge({ branch, expectedSha: 'abcdef1', moveToDone: true })).rejects.toMatchObject({ status: 400 });
        expect(spawned()).toEqual([]);
      },
    );

    it('rejects non-string branch values without launching anything', async () => {
      const svc = makeService();
      for (const branch of [undefined, null, 42, {}, ['AT-1-x'], true]) {
        await expect(svc.merge({ branch, expectedSha: 'abcdef1' })).rejects.toMatchObject({ status: 400 });
        await expect(svc.detail(branch)).rejects.toMatchObject({ status: 400 });
      }
      expect(spawned()).toEqual([]);
    });

    it('cannot choose its own base, remote or flags: the request only carries branch, sha and a Jira flag', async () => {
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');
      await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, baseBranch: 'master', remote: 'evil', force: true, deleteBranch: true } as never);
      auditEverything();
      expect(gitCalls().filter((c) => c.args[0] === 'push')).toHaveLength(2); // the merge push + deleting the AT branch
    });

    it('refuses a forged expectedSha before any worktree, rebase or push', async () => {
      await expect(makeService().merge({ branch: 'AT-727-add-test', expectedSha: '1234567' })).rejects.toMatchObject({ status: 409 });
      expect(gitCalls().filter((c) => ['worktree', 'rebase', 'push'].includes(c.args[0]))).toEqual([]);
      expect(acliCalls().filter((c) => c.args[2] === 'transition')).toEqual([]);
    });

    it('requires the reviewed commit to be named at all', async () => {
      await expect(makeService().merge({ branch: 'AT-727-add-test' })).rejects.toMatchObject({ status: 400 });
      expect(spawned()).toEqual([]);
    });
  });

  describe('nothing is launched when tools are missing', () => {
    it('launches no process at all when git, acli and gh are not installed', async () => {
      const svc = makeService({ findExecutable: () => false });

      const status = await svc.status();
      expect(status.ok).toBe(false);
      expect(status.requirements.filter((r) => !r.ok).map((r) => r.id)).toEqual(expect.arrayContaining(['git', 'acli']));
      await expect(svc.list()).rejects.toMatchObject({ status: 503 });
      await expect(svc.detail('AT-727-add-test')).rejects.toMatchObject({ status: 503 });
      await expect(svc.merge({ branch: 'AT-727-add-test', expectedSha: BRANCH_SHA })).rejects.toMatchObject({ status: 503 });
      expect((await svc.ghStatus()).state).toBe('not-installed');

      expect(spawned()).toEqual([]);
    });
  });

  describe('failures never lead to a Jira change or a stray push', () => {
    it('a rebase conflict: aborts, pushes nothing, moves no ticket, cleans up', async () => {
      h.override = (bin, args) => {
        const a = args[0] === '-c' ? args.slice(2) : args;
        if (bin === 'git' && a[0] === 'rebase' && a[1] !== '--abort') return { code: 1, stderr: 'CONFLICT (content): Merge conflict in a.txt' };
        if (bin === 'git' && a[0] === 'diff' && a[1] === '--name-only') return { stdout: 'a.txt\n' };
        return undefined;
      };
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');

      await expect(svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, moveToDone: true })).rejects.toMatchObject({ status: 409, details: ['a.txt'] });

      expect(gitCalls().some((c) => c.args[0] === 'rebase' && c.args[1] === '--abort')).toBe(true);
      expect(gitCalls().filter((c) => c.args[0] === 'push')).toEqual([]);
      expect(acliCalls().filter((c) => c.args[2] === 'transition')).toEqual([]);
      expect(gitCalls().some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true);
      auditEverything();
    });

    it('a rejected push (e.g. protected branch): moves no ticket and cleans up', async () => {
      h.override = (bin, args) => {
        const a = args[0] === '-c' ? args.slice(2) : args;
        if (bin === 'git' && a[0] === 'push') return { code: 1, stderr: 'remote: GH006: Protected branch update failed for refs/heads/playwright-main.' };
        return undefined;
      };
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');

      await expect(svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, moveToDone: true })).rejects.toMatchObject({ status: 502 });

      expect(acliCalls().filter((c) => c.args[2] === 'transition')).toEqual([]);
      expect(gitCalls().filter((c) => c.args[0] === 'push')).toHaveLength(1); // one attempt, no retry with force
      expect(gitCalls().some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true);
      auditEverything();
    });

    it('does not move the ticket unless asked, even after a successful merge', async () => {
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');
      await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, moveToDone: false });
      expect(acliCalls().filter((c) => c.args[2] === 'transition')).toEqual([]);
    });

    it('leaves a ticket that leaves Review mid-merge alone (merge still succeeds, with a warning)', async () => {
      let keyChecks = 0;
      h.override = (bin, args) => (bin === 'acli' && args[2] === 'search' && args[4].startsWith('key = ') && ++keyChecks > 2 ? { stdout: '[]' } : undefined);
      const svc = makeService();
      const detail = await svc.detail('AT-727-add-test');

      const result = await svc.merge({ branch: 'AT-727-add-test', expectedSha: detail.sha, moveToDone: true });

      expect(result.ticketMoved).toBeNull();
      expect(result.warning).toMatch(/not in "Review" any more/);
      expect(acliCalls().filter((c) => c.args[2] === 'transition')).toEqual([]);
    });
  });

  describe('Jira data cannot widen what is touched', () => {
    it('ignores tickets from other projects or with hostile keys returned by acli', async () => {
      h.override = (bin, args) =>
        bin === 'acli' && args[2] === 'search'
          ? { stdout: jiraReview([{ key: 'APP-1', fields: { summary: 'x' } }, { key: 'AT-9; rm -rf /', fields: { summary: 'y' } }, { key: 'MT-5', fields: { summary: 'z' } }]) }
          : undefined;
      const list = await makeService().list();
      expect(list.tickets.map((t) => t.key)).toEqual(['AT-727', 'AT-726']);
    });

    it('derives the ticket to move from the merged branch, never from Jira data', async () => {
      const svc = makeService();
      const detail = await svc.detail('AT-726-mcp-tools');
      await svc.merge({ branch: 'AT-726-mcp-tools', expectedSha: detail.sha, moveToDone: true });
      expect(acliCalls().filter((c) => c.args[2] === 'transition').map((c) => c.args[4])).toEqual(['AT-726']);
    });
  });

  describe('when acli or gh misbehave', () => {
    it('acli not signed in: shows nothing, never attempts a transition', async () => {
      h.override = (bin) => (bin === 'acli' ? { code: 1, stderr: "✗ Error: unauthorized: use 'acli auth login' to authenticate" } : undefined);
      const svc = makeService();

      const list = await svc.list();

      expect(list.jira).toMatchObject({ errorKind: 'not-authenticated' });
      expect(list.tickets).toEqual([]); // no branch fallback: nothing is shown without the Review column
      expect(gitCalls().some((c) => c.args[0] === 'cherry')).toBe(false);
      expect(acliCalls().every((c) => c.args[2] === 'search')).toBe(true);
      auditEverything();
    });

    it('acli missing at runtime: reported as not installed', async () => {
      h.override = (bin) => (bin === 'acli' ? { code: 'ENOENT' } : undefined);
      const list = await makeService().list();
      expect(list.jira.errorKind).toBe('not-installed');
    });

    it('gh signed out or missing at runtime never affects the review itself', async () => {
      h.override = (bin) => (bin === 'gh' ? { code: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' } : undefined);
      const svc = makeService();
      expect((await svc.ghStatus()).state).toBe('not-authenticated');
      await expect(svc.list()).resolves.toBeTruthy();

      h.override = (bin) => (bin === 'gh' ? { code: 'ENOENT' } : undefined);
      expect((await svc.ghStatus()).state).toBe('not-installed');
      expect(ghCalls().every((c) => c.args.join(' ') === 'auth status')).toBe(true);
    });

    it('git unable to authenticate to GitHub: explains it and launches nothing further', async () => {
      h.override = (bin, args) => {
        const a = args[0] === '-c' ? args.slice(2) : args;
        return bin === 'git' && a[0] === 'fetch' ? { code: 128, stderr: 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.' } : undefined;
      };
      await expect(makeService().list()).rejects.toMatchObject({ status: 502, message: expect.stringContaining("couldn't sign in to GitHub over SSH") });
      expect(acliCalls()).toEqual([]);
      expect(gitCalls().map((c) => c.args[0])).toEqual(['remote', 'fetch']);
    });
  });

  describe('the audit itself catches violations (so the audit can be trusted)', () => {
    it.each([
      ['a force push', ['push', '--force', 'origin', `${NEW_HEAD}:refs/heads/playwright-main`]],
      ['a branch deletion without a lease', ['push', 'origin', '--delete', 'AT-727-add-test']],
      ['deleting master, lease and all', ['push', 'origin', `--force-with-lease=refs/heads/master:${BRANCH_SHA}`, '--delete', 'master']],
      ['deleting playwright-main', ['push', 'origin', `--force-with-lease=refs/heads/playwright-main:${BASE_SHA}`, '--delete', 'playwright-main']],
      ['a push to master', ['push', 'origin', `${NEW_HEAD}:refs/heads/master`]],
      ['a hard reset', ['reset', '--hard', 'origin/playwright-main']],
      ['a commit', ['commit', '-am', 'x']],
      ['a checkout in the real repo', ['checkout', 'AT-727-add-test']],
    ])('flags %s', (_name, args) => {
      h.spawned.push({ bin: 'git', args, cwd: TEMP_WORKTREE_PREFIX + 'x' });
      expect(() => auditEverything()).toThrow();
    });

    it.each([
      ['another binary', { bin: 'curl', args: ['https://evil.example'] }],
      ['gh pr merge', { bin: 'gh', args: ['pr', 'merge', '1', '--rebase'] }],
      ['acli deleting a ticket', { bin: 'acli', args: ['jira', 'workitem', 'delete', '--key', 'AT-1', '--yes'] }],
      ['acli touching another project', { bin: 'acli', args: ['jira', 'workitem', 'transition', '--key', 'APP-1', '--status', 'Done', '--yes'] }],
    ])('flags %s', (_name, spawn) => {
      h.spawned.push(spawn);
      expect(() => auditEverything()).toThrow();
    });
  });
});
