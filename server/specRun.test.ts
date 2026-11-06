import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewService } from './reviewGit';
import { TEMP_WORKTREE_PREFIX } from './gitGuard';
import { OVERLAY_JOURNAL_PREFIX } from './serverOverlay';
import type { JiraClient } from './acli';

// A real run, end to end, with real git repositories and real folders — only
// Playwright itself is replaced by a fake `bundle` that records what it sees
// while it "runs" (the linked node_modules, the server's fixtures, its env).

const BASE = 'playwright-main';
const E2E = 'spec/playwright/playwright/e2e';
const SPEC_A = `${E2E}/tasks/a.spec.ts`;
const SPEC_B = `${E2E}/tasks/b.spec.ts`;
const FIXTURE = 'spec/fixtures/default/users.yml';
const CASSETTE = 'spec/playwright/playwright/fixtures/vcr_cassettes/c.yml';
const APP_COMMAND = 'spec/playwright/playwright/app_commands/x.rb';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (base: string, rel: string, content: string) => {
  mkdirSync(join(base, rel, '..'), { recursive: true });
  writeFileSync(join(base, rel), content);
};
const commit = (cwd: string, msg: string) => {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', msg);
};
const tree = (base: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else out[f.slice(base.length + 1)] = readFileSync(f, 'utf8');
    }
  };
  walk(base);
  return out;
};

const FAKE_YARN = `#!/bin/sh
echo "args: $@" >> "$FAKE_LOG"
echo "pwd: $PWD" >> "$FAKE_LOG"
if [ -L node_modules ] && [ -e node_modules/marker.txt ]; then echo "node_modules: linked" >> "$FAKE_LOG"; else echo "node_modules: MISSING" >> "$FAKE_LOG"; fi
echo "server-fixture: $(cat "$FAKE_SERVER_FIXTURE" 2>/dev/null)" >> "$FAKE_LOG"
echo "server-cassette: $(cat "$FAKE_SERVER_CASSETTE" 2>/dev/null)" >> "$FAKE_LOG"
echo "leak: \${GH_TOKEN:-none}|\${SLACK_WEBHOOK_URL:-none}" >> "$FAKE_LOG"
case "$FAKE_MODE" in
  hang) echo "started"; sleep 60 & wait ;;
  crash) echo "boom on stderr" 1>&2; exit 2 ;;
esac
echo "Running specs"
OUT="$PLAYWRIGHT_JSON_OUTPUT_NAME"
printf '{"suites":[' > "$OUT"
first=1
for a in "$@"; do
  case "$a" in
    *.spec.ts)
      rel="\${a#spec/playwright/playwright/}"
      [ $first = 1 ] || printf ',' >> "$OUT"
      first=0
      if [ "$FAKE_MODE" = fail ]; then
        st=failed
        errs=',"errors":[{"message":"Error: expect(locator).toContainText","stack":"Error: expect(locator).toContainText\\\\n    at '"$rel"':5:3","snippet":"> 5 | await expect(x)"}]'
      else
        st=passed
        errs=''
      fi
      printf '{"file":"%s","specs":[{"title":"works","file":"%s","line":5,"tests":[{"status":"x","results":[{"status":"%s","duration":10%s}]}]}]}' "$rel" "$rel" "$st" "$errs" >> "$OUT"
      ;;
  esac
done
printf ']}' >> "$OUT"
[ "$FAKE_MODE" = fail ] && exit 1
exit 0
`;

interface Fx {
  root: string;
  origin: string;
  seed: string;
  app: string;
  server: string;
  bin: string;
  log: string;
}
let fx: Fx;

function makeFixture(): Fx {
  const root = mkdtempSync(join(tmpdir(), 'specrun-test-'));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const app = join(root, 'app');
  const server = join(root, 'server');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(server);

  git(root, 'init', '-q', '--bare', '-b', BASE, origin);
  git(root, 'clone', '-q', origin, seed);
  for (const [k, v] of [['user.name', 'Seed'], ['user.email', 'seed@example.com'], ['commit.gpgsign', 'false']]) git(seed, 'config', k, v);
  git(seed, 'checkout', '-q', '-b', BASE);
  put(seed, FIXTURE, 'users: base version\n');
  put(seed, 'README.md', 'base');
  commit(seed, 'Initial');
  git(seed, 'push', '-q', 'origin', BASE);

  // the PR: two specs, a changed fixture, a new cassette, and one server-side Ruby file
  git(seed, 'checkout', '-q', '-b', 'AT-5-add-specs', BASE);
  put(seed, SPEC_A, "test('a', () => {})\n");
  put(seed, SPEC_B, "test('b', () => {})\n");
  put(seed, FIXTURE, 'users: PR version\n');
  put(seed, CASSETTE, 'cassette: from PR\n');
  put(seed, APP_COMMAND, '# ruby that runs inside the server\n');
  commit(seed, 'AT-5 Add specs');
  git(seed, 'push', '-q', 'origin', 'AT-5-add-specs');

  git(root, 'clone', '-q', origin, app);
  for (const [k, v] of [['user.name', 'QA'], ['user.email', 'qa@example.com'], ['commit.gpgsign', 'false']]) git(app, 'config', k, v);
  put(app, 'node_modules/marker.txt', 'real node_modules');

  // the Rails test server's own checkout (what it reads fixtures from)
  put(server, FIXTURE, 'users: SERVER version (with an uncommitted edit)\n');
  put(server, 'spec/other.yml', 'untouched');

  writeFileSync(join(bin, 'yarn'), FAKE_YARN);
  chmodSync(join(bin, 'yarn'), 0o755);
  return { root, origin, seed, app, server, bin, log: join(root, 'fake.log') };
}

const jira = (inReview = true): JiraClient =>
  ({
    listReviewIssues: vi.fn().mockResolvedValue([]),
    findReviewIssue: vi.fn(async (key: string) => (inReview && key === 'AT-5' ? { key, summary: 'Specs', status: 'Review', assignee: null, reviewers: [], url: null } : null)),
    moveReviewIssueToDone: vi.fn(),
  }) as unknown as JiraClient;

function makeService(over: { up?: boolean; mode?: string; inReview?: boolean; path?: string; killGraceMs?: number; keepJobs?: number } = {}) {
  return createReviewService(
    { repoPath: fx.app, baseBranch: BASE, remote: 'origin', projectKey: 'AT', serverRepoPath: fx.server },
    {
      jira: jira(over.inReview ?? true),
      findExecutable: () => true,
      specRun: {
        probe: async () => over.up ?? true,
        killGraceMs: over.killGraceMs ?? 3000,
        keepJobs: over.keepJobs,
        env: {
          ...process.env,
          PATH: over.path ?? `${fx.bin}:${process.env.PATH}`,
          FAKE_LOG: fx.log,
          FAKE_MODE: over.mode ?? 'pass',
          FAKE_SERVER_FIXTURE: join(fx.server, FIXTURE),
          FAKE_SERVER_CASSETTE: join(fx.server, CASSETTE),
          GH_TOKEN: 'must-not-leak',
          SLACK_WEBHOOK_URL: 'must-not-leak-either',
        },
      },
    },
  );
}

type Svc = ReturnType<typeof makeService>;
async function branchSha(svc: Svc) {
  await svc.list();
  return (await svc.detail('AT-5-add-specs')).sha;
}
async function waitFor(svc: Svc, id: string, until: (status: string) => boolean = (s) => !['preparing', 'syncing', 'running', 'cleaning'].includes(s)) {
  for (let i = 0; i < 400; i++) {
    const job = svc.getSpecRun(id);
    if (until(job.status)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job never reached the expected state: ${svc.getSpecRun(id).status}`);
}
const leftovers = () => ({
  worktrees: git(fx.app, 'worktree', 'list').split('\n').length,
  tempCheckouts: readdirSync(tmpdir()).filter((n) => join(tmpdir(), n).startsWith(TEMP_WORKTREE_PREFIX) && existsSync(join(tmpdir(), n, 'node_modules'))).length,
  journals: readdirSync(tmpdir()).filter((n) => join(tmpdir(), n).startsWith(OVERLAY_JOURNAL_PREFIX) && existsSync(join(tmpdir(), n, 'manifest.json')) && readFileSync(join(tmpdir(), n, 'manifest.json'), 'utf8').includes(fx.root)).length,
});

beforeEach(() => {
  fx = makeFixture();
});
afterEach(() => {
  rmSync(fx.root, { recursive: true, force: true });
});

describe('what the PR page needs to know', () => {
  it('lists the specs the PR adds or changes, and the server-side Ruby it does not copy', async () => {
    const svc = makeService();
    await svc.list();
    const d = await svc.detail('AT-5-add-specs');
    expect(d.specs.sort()).toEqual([SPEC_A, SPEC_B]);
    expect(d.serverCodeChanged).toEqual([APP_COMMAND]);
    // everything else the PR changes under spec/ (fixtures, cassettes, support code) is reported, but not runnable
    expect(d.supportFiles.sort()).toEqual([APP_COMMAND, CASSETTE, FIXTURE].sort());
  });

  describe('a PR that only changes Playwright support files (no specs)', () => {
    async function supportOnlyPr(svc: Svc, files: Record<string, string>, remove: string[] = []) {
      git(fx.seed, 'checkout', '-q', '-b', 'AT-8-support-only', BASE);
      for (const [rel, content] of Object.entries(files)) put(fx.seed, rel, content);
      for (const rel of remove) git(fx.seed, 'rm', '-q', rel);
      commit(fx.seed, 'AT-8 Update support files');
      git(fx.seed, 'push', '-q', 'origin', 'AT-8-support-only');
      await svc.list();
      return svc.detail('AT-8-support-only');
    }
    const svcFor8 = () => {
      const j = jira();
      (j.findReviewIssue as ReturnType<typeof vi.fn>).mockResolvedValue({ key: 'AT-8', summary: 'Support', status: 'Review', assignee: null, reviewers: [], approval: null, reviewInfo: '', url: null });
      return createReviewService(
        { repoPath: fx.app, baseBranch: BASE, remote: 'origin', projectKey: 'AT', serverRepoPath: fx.server },
        { jira: j, findExecutable: () => true, specRun: { probe: async () => true } },
      );
    };

    it('reports the support files and no runnable specs', async () => {
      const svc = svcFor8();
      const d = await supportOnlyPr(svc, {
        'spec/playwright/playwright/support/helpers.ts': 'export const x = 1\n',
        'spec/playwright/playwright/pages/login_page.ts': 'export class LoginPage {}\n',
        [FIXTURE]: 'users: changed\n',
        [CASSETTE]: 'cassette: new\n',
      });
      expect(d.specs).toEqual([]);
      expect(d.supportFiles.sort()).toEqual(
        ['spec/playwright/playwright/support/helpers.ts', 'spec/playwright/playwright/pages/login_page.ts', FIXTURE, CASSETTE].sort(),
      );
    });

    it('refuses to start a run (nothing to run) and spawns nothing', async () => {
      const svc = svcFor8();
      const d = await supportOnlyPr(svc, { 'spec/playwright/playwright/support/helpers.ts': 'export const x = 1\n' });
      await expect(svc.startSpecRun({ branch: 'AT-8-support-only', expectedSha: d.sha, specs: 'all' })).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("doesn't add or change any runnable"),
      });
      expect(existsSync(fx.log)).toBe(false);
    });

    it('does not list deleted files, and ignores files outside spec/', async () => {
      const svc = svcFor8();
      const d = await supportOnlyPr(svc, { 'notes/readme.md': 'x', 'spec/playwright/playwright/support/new.ts': 'x' }, [FIXTURE]);
      expect(d.supportFiles).toEqual(['spec/playwright/playwright/support/new.ts']);
    });

    it('a PR that changes a spec AND support files lists both, separately', async () => {
      const svc = svcFor8();
      const d = await supportOnlyPr(svc, { [SPEC_A]: "test('x', () => {})\n", 'spec/playwright/playwright/support/h.ts': 'x' });
      expect(d.specs).toEqual([SPEC_A]);
      expect(d.supportFiles).toEqual(['spec/playwright/playwright/support/h.ts']);
    });
  });

  it('reports the test server as up or down, and never tries to start it', async () => {
    expect(await makeService({ up: true }).testServer()).toEqual({ up: true, host: '127.0.0.1', port: 5017, startCommand: 'yarn test:server', activeJob: null });
    expect(await makeService({ up: false }).testServer()).toMatchObject({ up: false, startCommand: 'yarn test:server' });
  });
});

describe('a full run', () => {
  it('runs all of the PR\'s specs, links node_modules, copies fixtures for the run, then restores and cleans up everything', async () => {
    const svc = makeService();
    const serverBefore = tree(fx.server);
    const sha = await branchSha(svc);

    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: 'all' });
    const job = await waitFor(svc, id);

    // the outcome
    expect(job.status).toBe('passed');
    expect(job.specs.sort()).toEqual([SPEC_A, SPEC_B]);
    expect(job.results?.map((r) => [r.file, r.status]).sort()).toEqual([[SPEC_A, 'passed'], [SPEC_B, 'passed']]);
    expect(job.output).toContain('Running specs');
    expect(job.exitCode).toBe(0);
    expect(job.error).toBeNull();
    expect(job.serverCodeChanged).toEqual([APP_COMMAND]);
    expect(job.warnings.join(' ')).toMatch(/Copied 2 fixture\/cassette files/);

    // what the specs saw WHILE they ran
    const seen = readFileSync(fx.log, 'utf8');
    expect(seen).toContain('node_modules: linked');
    expect(seen).toContain('server-fixture: users: PR version');
    expect(seen).toContain('server-cassette: cassette: from PR');
    expect(seen).toContain('leak: none|none'); // no credentials in the environment
    expect(seen).toMatch(/args: playwright test -c spec\/playwright\/playwright\.config\.js .*--retries=0 --workers=1 --reporter=list,json --output=/);
    expect(seen).toContain(SPEC_A);
    expect(seen).toContain(SPEC_B);
    const runDir = /pwd: (.+)/.exec(seen)![1];
    expect(runDir).toContain('review-merge-'); // (macOS reports the real /private/var path)
    expect(runDir).not.toContain(fx.app);

    // ...and everything is back exactly as it was
    expect(tree(fx.server)).toEqual(serverBefore);
    expect(existsSync(runDir)).toBe(false);
    expect(existsSync(join(fx.app, 'node_modules/marker.txt'))).toBe(true); // the linked target survived the cleanup
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
    expect(git(fx.app, 'status', '--porcelain')).toBe('?? node_modules/'); // only our own fake node_modules; nothing else in the clone changed
  });

  it('runs just one spec when asked', async () => {
    const svc = makeService();
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: [SPEC_B] });
    const job = await waitFor(svc, id);
    expect(job.status).toBe('passed');
    expect(job.specs).toEqual([SPEC_B]);
    const args = readFileSync(fx.log, 'utf8').split('\n').find((l) => l.startsWith('args:'))!;
    expect(args).toContain(SPEC_B);
    expect(args).not.toContain(SPEC_A);
    expect(job.results?.map((r) => r.file)).toEqual([SPEC_B]);
  });

  it('streams output while running and supports polling from an offset', async () => {
    const svc = makeService({ mode: 'hang' });
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: [SPEC_A] });
    const running = await waitFor(svc, id, (s) => s === 'running');
    await vi.waitFor(() => expect(svc.getSpecRun(id).output).toContain('started'));
    const first = svc.getSpecRun(id, 0);
    expect(first.output).toContain('started');
    expect(svc.getSpecRun(id, first.nextOffset).output).toBe('');
    expect(running.status).toBe('running');
    await svc.cancelSpecRun(id);
    await waitFor(svc, id);
  });

  it('reports failures with the error message, stack and code frame', async () => {
    const svc = makeService({ mode: 'fail' });
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    const job = await waitFor(svc, id);

    expect(job.status).toBe('failed');
    expect(job.exitCode).toBe(1);
    const failed = job.results!.find((r) => r.file === SPEC_A)!;
    expect(failed.status).toBe('failed');
    expect(failed.tests[0]).toMatchObject({ title: 'works', status: 'failed', line: 5 });
    expect(failed.tests[0].error?.message).toBe('Error: expect(locator).toContainText');
    expect(failed.tests[0].error?.stack).toContain('a.spec.ts:5:3');
    expect(failed.tests[0].error?.snippet).toContain('> 5 | await expect(x)');
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  });

  it('a crash with no report is a failure with the output kept, and still cleans up', async () => {
    const svc = makeService({ mode: 'crash' });
    const serverBefore = tree(fx.server);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    const job = await waitFor(svc, id);
    expect(job.status).toBe('failed');
    expect(job.exitCode).toBe(2);
    expect(job.results).toBeNull();
    expect(job.output).toContain('boom on stderr');
    expect(tree(fx.server)).toEqual(serverBefore);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  });

  it('explains a missing `yarn` and cleans up', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'nobin-'));
    const svc = makeService({ path: empty });
    const serverBefore = tree(fx.server);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    const job = await waitFor(svc, id);
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/`yarn` was not found/);
    expect(tree(fx.server)).toEqual(serverBefore);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
    rmSync(empty, { recursive: true, force: true });
  });

  it('can be cancelled mid-run: the process stops, the server checkout is restored, the checkout is removed', async () => {
    const svc = makeService({ mode: 'hang' });
    const serverBefore = tree(fx.server);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    await waitFor(svc, id, (s) => s === 'running');
    expect(readFileSync(join(fx.server, FIXTURE), 'utf8')).toBe('users: PR version\n'); // copied for the run

    const started = Date.now();
    const afterCancel = await svc.cancelSpecRun(id);
    expect(afterCancel.status).not.toBe('passed');
    const job = await waitFor(svc, id);

    expect(job.status).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(8000);
    expect(tree(fx.server)).toEqual(serverBefore);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  });

  it('cancelling a finished run is harmless', async () => {
    const svc = makeService();
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: [SPEC_A] });
    const done = await waitFor(svc, id);
    expect((await svc.cancelSpecRun(id)).status).toBe(done.status);
  });
});

describe('refusals (nothing is created, nothing is spawned)', () => {
  const nothingHappened = () => {
    expect(existsSync(fx.log)).toBe(false);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  };

  it('tells the user to run `yarn test:server` when the test server is down — and does not start it', async () => {
    const svc = makeService({ up: false });
    const sha = await branchSha(svc);
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: 'all' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('`yarn test:server`'),
    });
    nothingHappened();
  });

  it('refuses when the ticket is not in the Review column', async () => {
    const svc = makeService({ inReview: false });
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: 'abcdef1', specs: 'all' })).rejects.toMatchObject({ status: 404 });
    nothingHappened();
  });

  it.each(['master', 'playwright-main', 'feature/x', 'APP-1-x', 'at-5-x', 'AT-5x', '--evil', '', undefined, 5])('refuses the branch %j before doing anything', async (branch) => {
    await expect(makeService().startSpecRun({ branch, expectedSha: 'abcdef1', specs: 'all' })).rejects.toMatchObject({ status: 400 });
    nothingHappened();
  });

  it.each([
    [[]],
    ['everything'],
    [[`${E2E}/../../etc/passwd.spec.ts`]],
    [['spec/models/user_spec.rb']],
    [['--ui']],
    [[SPEC_A, SPEC_A]],
    [null],
    [{ 0: SPEC_A }],
    [[5]],
  ])('refuses the specs value %j', async (specs) => {
    await expect(makeService().startSpecRun({ branch: 'AT-5-add-specs', expectedSha: 'abcdef1', specs })).rejects.toMatchObject({ status: 400 });
    nothingHappened();
  });

  it('refuses specs this PR did not add or change, naming them', async () => {
    const svc = makeService();
    const sha = await branchSha(svc);
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: [`${E2E}/other/not_in_pr.spec.ts`] })).rejects.toMatchObject({
      status: 400,
      details: [`${E2E}/other/not_in_pr.spec.ts`],
    });
    nothingHappened();
  });

  it('requires the reviewed commit, and refuses if the branch moved', async () => {
    const svc = makeService();
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', specs: 'all' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: 'not-a-sha!', specs: 'all' })).rejects.toMatchObject({ status: 400 });
    await svc.list();
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: '1234567', specs: 'all' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('changed since you opened it') });
    nothingHappened();
  });

  it('refuses a PR that has no runnable specs', async () => {
    git(fx.seed, 'checkout', '-q', '-b', 'AT-6-no-specs', BASE);
    put(fx.seed, 'notes.md', 'x');
    commit(fx.seed, 'AT-6 docs');
    git(fx.seed, 'push', '-q', 'origin', 'AT-6-no-specs');
    const j = jira();
    (j.findReviewIssue as ReturnType<typeof vi.fn>).mockResolvedValue({ key: 'AT-6', summary: 'x', status: 'Review', assignee: null, reviewers: [], url: null });
    const svc = createReviewService({ repoPath: fx.app, baseBranch: BASE, remote: 'origin', projectKey: 'AT', serverRepoPath: fx.server }, { jira: j, findExecutable: () => true, specRun: { probe: async () => true } });
    await svc.list();
    const sha = (await svc.detail('AT-6-no-specs')).sha;
    await expect(svc.startSpecRun({ branch: 'AT-6-no-specs', expectedSha: sha, specs: 'all' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("doesn't add or change any runnable") });
  });

  it('allows only one run at a time, and a merge waits for it', async () => {
    const svc = makeService({ mode: 'hang' });
    const sha = await branchSha(svc);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: 'all' });
    await expect(svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: [SPEC_A] })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already in progress') });
    await expect(svc.merge({ branch: 'AT-5-add-specs', expectedSha: sha })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Specs are running') });
    expect((await svc.testServer()).activeJob).toMatchObject({ id, branch: 'AT-5-add-specs' });
    await svc.cancelSpecRun(id);
    await waitFor(svc, id);
    expect((await svc.testServer()).activeJob).toBeNull();
  });

  it('two simultaneous clicks start only one run', async () => {
    const svc = makeService({ mode: 'hang' });
    const sha = await branchSha(svc);
    const results = await Promise.allSettled([
      svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: 'all' }),
      svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: 'all' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ok = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>;
    await svc.cancelSpecRun(ok.value.id);
    await waitFor(svc, ok.value.id);
  });

  it('answers 404 for an unknown run', async () => {
    const svc = makeService();
    expect(() => svc.getSpecRun('nope')).toThrow(/not found/);
    expect(() => svc.getSpecRun(undefined)).toThrow(/not found/);
    await expect(svc.cancelSpecRun('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('errors during preparation still clean up', () => {
  it('node_modules missing: explains and cleans up', async () => {
    rmSync(join(fx.app, 'node_modules'), { recursive: true });
    const svc = makeService();
    const sha = await branchSha(svc);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: 'all' });
    const job = await waitFor(svc, id);
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/node_modules was not found.*yarn install/);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  });

  it('refuses a symlinked node_modules', async () => {
    rmSync(join(fx.app, 'node_modules'), { recursive: true });
    mkdirSync(join(fx.root, 'elsewhere'));
    symlinkSync(join(fx.root, 'elsewhere'), join(fx.app, 'node_modules'));
    const svc = makeService();
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    expect((await waitFor(svc, id)).error).toMatch(/symlink/);
  });

  it('a server checkout that cannot be found: explains, restores nothing it did not change, cleans up', async () => {
    rmSync(fx.server, { recursive: true });
    const svc = makeService();
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    const job = await waitFor(svc, id);
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/REVIEW_SERVER_REPO_PATH/);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  });

  it('a PR fixture that is a symlink is refused, and the server checkout is left untouched', async () => {
    git(fx.seed, 'checkout', '-q', 'AT-5-add-specs');
    put(fx.seed, 'target.txt', 'secret');
    mkdirSync(join(fx.seed, 'spec/fixtures/default'), { recursive: true });
    symlinkSync(join(fx.seed, 'target.txt'), join(fx.seed, 'spec/fixtures/default/evil.yml'));
    commit(fx.seed, 'AT-5 symlink fixture');
    git(fx.seed, 'push', '-q', 'origin', 'AT-5-add-specs');
    const svc = makeService();
    const serverBefore = tree(fx.server);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    const job = await waitFor(svc, id);
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/not a regular file/);
    expect(tree(fx.server)).toEqual(serverBefore);
    expect(leftovers()).toEqual({ worktrees: 1, tempCheckouts: 0, journals: 0 });
  });

  it('keeps only the most recent finished runs', async () => {
    const svc = makeService({ keepJobs: 2 });
    const sha = await branchSha(svc);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: sha, specs: [SPEC_A] });
      await waitFor(svc, id);
      ids.push(id);
    }
    expect(() => svc.getSpecRun(ids[0])).toThrow(/not found/);
    expect(svc.getSpecRun(ids[2]).status).toBe('passed');
  });
});

describe('shutdown (the dev server is exiting)', () => {
  it('restores the server checkout and removes the temp checkout even though the run never finished', async () => {
    const svc = makeService({ mode: 'hang' });
    const serverBefore = tree(fx.server);
    const { id } = await svc.startSpecRun({ branch: 'AT-5-add-specs', expectedSha: await branchSha(svc), specs: 'all' });
    await waitFor(svc, id, (s) => s === 'running');
    expect(readFileSync(join(fx.server, FIXTURE), 'utf8')).toBe('users: PR version\n');

    svc.shutdown();

    expect(tree(fx.server)).toEqual(serverBefore);
    expect(leftovers().tempCheckouts).toBe(0);
    await waitFor(svc, id).catch(() => undefined);
  });

  it('does nothing when no run is active', () => {
    expect(() => makeService().shutdown()).not.toThrow();
  });
});
