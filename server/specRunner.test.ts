import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEMP_WORKTREE_PREFIX } from './gitGuard';
import {
  MAX_SPECS_PER_RUN,
  OUTPUT_DIR_NAME,
  PLAYWRIGHT_CONFIG,
  RESULTS_FILE_NAME,
  SpecGuardError,
  assertAllowedSpecCommand,
  buildSpecArgs,
  cleanOutput,
  isRunnableSpecPath,
  parsePlaywrightJson,
  probeTestServer,
  scrubEnv,
  startSpecProcess,
  stripAnsi,
} from './specRunner';

const E2E = 'spec/playwright/playwright/e2e';
const SPEC_A = `${E2E}/tasks/show/admin/recurring_comments_completed.spec.ts`;
const SPEC_B = `${E2E}/tasks/show/owner/recurring_comments_completed.spec.ts`;

let dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(TEMP_WORKTREE_PREFIX);
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('spec runner guard rail: assertAllowedSpecCommand', () => {
  const cwd = () => tempDir();

  it('allows exactly the documented command, for one or many specs', () => {
    const dir = cwd();
    expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs([SPEC_A], dir), dir)).not.toThrow();
    expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs([SPEC_A, SPEC_B], dir), dir)).not.toThrow();
  });

  it('builds the QA team\'s command line', () => {
    expect(buildSpecArgs([SPEC_A], '/x')).toEqual([
      'playwright', 'test', '-c', 'spec/playwright/playwright.config.js', SPEC_A,
      '--retries=0', '--workers=1', '--reporter=list,json', `--output=/x/${OUTPUT_DIR_NAME}`,
    ]);
    expect(PLAYWRIGHT_CONFIG).toBe('spec/playwright/playwright.config.js');
  });

  it.each([
    ['another binary', 'sh', ['-c', 'rm -rf /']],
    ['bundle exec yarn', 'bundle', ['exec', 'yarn', 'playwright', 'test']],
    ['node', 'node', ['-e', 'process.exit()']],
    ['bash', 'bash', ['-c', 'id']],
    ['npx', 'npx', ['playwright', 'test']],
  ])('blocks %s', (_n, bin, args) => {
    expect(() => assertAllowedSpecCommand(bin, args, cwd())).toThrow(SpecGuardError);
  });

  it.each([
    ['rails', ['rails', 'runner', 'User.destroy_all']],
    ['a different playwright subcommand', ['playwright', 'install']],
    ['yarn run something else', ['run', 'build']],
    ['yarn add (installs packages)', ['add', 'evil-package']],
    ['yarn test:server (the user starts that themselves)', ['test:server']],
    ['no spec files', ['playwright', 'test', '-c', PLAYWRIGHT_CONFIG, '--retries=0', '--workers=1', '--reporter=list,json']],
    ['empty', []],
  ])('blocks %s', (_n, args) => {
    expect(() => assertAllowedSpecCommand('yarn', args, cwd())).toThrow(SpecGuardError);
  });

  it('blocks tampering with the fixed flags or config', () => {
    const dir = cwd();
    const base = buildSpecArgs([SPEC_A], dir);
    const swap = (i: number, v: string) => base.map((a, n) => (n === i ? v : a));
    for (let i = 0; i < base.length; i++) if (base[i] !== SPEC_A) expect(() => assertAllowedSpecCommand('yarn', swap(i, '--evil'), dir)).toThrow(SpecGuardError);
    expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs([SPEC_A], dir).map((a) => (a === PLAYWRIGHT_CONFIG ? '/etc/evil.config.js' : a)), dir)).toThrow(SpecGuardError);
    expect(() => assertAllowedSpecCommand('yarn', [...base, '--update-snapshots'], dir)).toThrow(SpecGuardError);
    expect(() => assertAllowedSpecCommand('yarn', [...base.slice(0, 4), '--ui', ...base.slice(4)], dir)).toThrow(SpecGuardError);
  });

  it.each([
    ['a spec outside the e2e folder', 'spec/models/user_spec.rb'],
    ['a non-spec file', `${E2E}/tasks/helper.ts`],
    ['a Ruby spec', `${E2E}/tasks/a.spec.rb`],
    ['a path traversal', `${E2E}/../../../etc/passwd.spec.ts`],
    ['an absolute path', `/etc/${E2E}/a.spec.ts`],
    ['an option disguised as a file', '--config=evil.spec.ts'],
    ['a different test dir', 'spec/playwright/other/a.spec.ts'],
    ['a path with spaces', `${E2E}/a b.spec.ts`],
    ['a path with a semicolon', `${E2E}/a;id.spec.ts`],
    ['a path with a newline', `${E2E}/a\n.spec.ts`],
    ['a leading dot segment', `${E2E}/./a.spec.ts`],
    ['a double slash', `${E2E}//a.spec.ts`],
  ])('blocks %s', (_n, file) => {
    const dir = cwd();
    expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs([file], dir), dir)).toThrow(SpecGuardError);
    expect(isRunnableSpecPath(file)).toBe(false);
  });

  it('blocks duplicates and too many specs', () => {
    const dir = cwd();
    expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs([SPEC_A, SPEC_A], dir), dir)).toThrow(/duplicate/);
    const many = Array.from({ length: MAX_SPECS_PER_RUN + 1 }, (_, i) => `${E2E}/x/s${i}.spec.ts`);
    expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs(many, dir), dir)).toThrow(/between 1 and 200/);
  });

  it('only runs inside a temp PR checkout, never the real repo', () => {
    for (const bad of ['/Users/qa/Dev/securicy-app', '/tmp/other', `${TEMP_WORKTREE_PREFIX}x/../../etc`, '', '/']) {
      expect(() => assertAllowedSpecCommand('yarn', buildSpecArgs([SPEC_A], bad), bad)).toThrow(/temporary PR checkout/);
    }
  });

  it('blocks an --output pointing anywhere but the temp checkout', () => {
    const dir = cwd();
    const args = buildSpecArgs([SPEC_A], dir);
    args[args.length - 1] = '--output=/Users/qa/Desktop/out';
    expect(() => assertAllowedSpecCommand('yarn', args, dir)).toThrow(SpecGuardError);
  });

  it('rejects non-string arguments', () => {
    const dir = cwd();
    expect(() => assertAllowedSpecCommand('yarn', ['exec', 5 as unknown as string], dir)).toThrow(/invalid arguments/);
    expect(() => assertAllowedSpecCommand(undefined as unknown as string, [], dir)).toThrow(SpecGuardError);
  });
});

describe('isRunnableSpecPath', () => {
  it('accepts normal spec paths', () => {
    expect(isRunnableSpecPath(SPEC_A)).toBe(true);
    expect(isRunnableSpecPath(`${E2E}/avo/frameworks/create.spec.ts`)).toBe(true);
  });
  it('rejects non-strings and over-long paths', () => {
    for (const v of [undefined, null, 5, {}, `${E2E}/${'a'.repeat(300)}.spec.ts`]) expect(isRunnableSpecPath(v)).toBe(false);
  });
});

describe('scrubEnv', () => {
  it('removes anything that looks like a credential, keeps what a toolchain needs', () => {
    const env = scrubEnv(
      {
        PATH: '/usr/bin', HOME: '/Users/qa', LANG: 'en_US.UTF-8', RBENV_VERSION: '4.0.9', PLAYWRIGHT_BROWSERS_PATH: '/pw',
        GH_TOKEN: 'x', GITHUB_TOKEN: 'x', SLACK_WEBHOOK_URL: 'x', JIRA_API_TOKEN: 'x', ATLASSIAN_API_TOKEN: 'x',
        AWS_SECRET_ACCESS_KEY: 'x', AWS_ACCESS_KEY_ID: 'x', OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', NPM_TOKEN: 'x',
        DB_PASSWORD: 'x', MY_SECRET: 'x', SSH_AUTH_SOCK: '/tmp/agent', SESSION_COOKIE: 'x', STRIPE_API_KEY: 'x', GITLAB_AUTH: 'x',
      },
      '/tmp/w',
    );
    expect(Object.keys(env).sort()).toEqual(['FORCE_COLOR', 'HOME', 'LANG', 'NO_COLOR', 'PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'RBENV_VERSION']);
  });

  it('sets colourless output and the JSON results path inside the checkout', () => {
    const env = scrubEnv({ PATH: '/bin', FORCE_COLOR: '1' }, '/tmp/w');
    expect(env).toMatchObject({ FORCE_COLOR: '0', NO_COLOR: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: `/tmp/w/${RESULTS_FILE_NAME}` });
  });

  it('drops undefined values', () => {
    expect('X' in scrubEnv({ X: undefined, PATH: '/bin' }, '/tmp/w')).toBe(false);
  });
});

describe('output cleaning', () => {
  it('strips colour and cursor codes', () => {
    expect(stripAnsi('\u001b[31mfail\u001b[0m \u001b[1;32mok\u001b[39m')).toBe('fail ok');
    expect(stripAnsi('\u001b[2K\u001b[1Gline')).toBe('line');
  });
  it('also removes credentials', () => {
    expect(cleanOutput('\u001b[31mtoken=abcd1234efgh\u001b[0m')).toBe('token=[redacted]');
  });
});

describe('parsePlaywrightJson', () => {
  const report = (suites: unknown[]) => JSON.stringify({ suites });
  const spec = (title: string, results: unknown[], line = 10) => ({ title, file: 'e2e/tasks/a.spec.ts', line, tests: [{ status: 'x', results }] });

  it('turns a report into per-file results with pass/fail per test and durations', () => {
    const raw = report([
      {
        title: 'e2e/tasks/show/admin/recurring_comments_completed.spec.ts',
        file: 'e2e/tasks/show/admin/recurring_comments_completed.spec.ts',
        suites: [
          {
            title: 'Recurring task comments',
            file: 'e2e/tasks/show/admin/recurring_comments_completed.spec.ts',
            specs: [
              { title: 'Comment stays shared', file: 'e2e/tasks/show/admin/recurring_comments_completed.spec.ts', line: 41, tests: [{ status: 'expected', results: [{ status: 'passed', duration: 1200 }] }] },
              {
                title: 'Evidence is copied',
                file: 'e2e/tasks/show/admin/recurring_comments_completed.spec.ts',
                line: 55,
                tests: [{ status: 'unexpected', results: [{ status: 'failed', duration: 800, errors: [{ message: '\u001b[31mError: expect(locator).toContainText\u001b[0m', stack: 'Error: boom\n    at a.spec.ts:57:9', snippet: '> 57 | await expect(x)' }] }] }],
              },
            ],
          },
        ],
      },
    ]);

    const [file] = parsePlaywrightJson(raw, [SPEC_A]);

    expect(file).toMatchObject({ file: SPEC_A, status: 'failed', durationMs: 2000 });
    expect(file.tests.map((t) => [t.title, t.status, t.line, t.durationMs])).toEqual([
      ['Recurring task comments › Comment stays shared', 'passed', 41, 1200],
      ['Recurring task comments › Evidence is copied', 'failed', 55, 800],
    ]);
    expect(file.tests[0].error).toBeNull();
    expect(file.tests[1].error).toEqual({ message: 'Error: expect(locator).toContainText', stack: 'Error: boom\n    at a.spec.ts:57:9', snippet: '> 57 | await expect(x)' });
  });

  it('marks a file passed only when everything passed, skipped when everything was skipped', () => {
    const passed = parsePlaywrightJson(report([{ file: 'e2e/tasks/a.spec.ts', specs: [spec('t', [{ status: 'passed', duration: 5 }])] }]), [`${E2E}/tasks/a.spec.ts`]);
    expect(passed[0].status).toBe('passed');
    const skipped = parsePlaywrightJson(report([{ file: 'e2e/tasks/a.spec.ts', specs: [spec('t', [{ status: 'skipped', duration: 0 }])] }]), [`${E2E}/tasks/a.spec.ts`]);
    expect(skipped[0].status).toBe('skipped');
    const mixed = parsePlaywrightJson(report([{ file: 'e2e/tasks/a.spec.ts', specs: [spec('a', [{ status: 'passed' }]), spec('b', [{ status: 'skipped' }])] }]), [`${E2E}/tasks/a.spec.ts`]);
    expect(mixed[0].status).toBe('passed');
  });

  it.each(['timedOut', 'interrupted', 'failed'])('treats %s as a failure', (status) => {
    const out = parsePlaywrightJson(report([{ file: 'e2e/tasks/a.spec.ts', specs: [spec('t', [{ status, duration: 1 }])] }]), [`${E2E}/tasks/a.spec.ts`]);
    expect(out[0].status).toBe('failed');
    expect(out[0].tests[0].status).toBe(status);
  });

  it('uses the last attempt, and the error list when there is no single error', () => {
    const out = parsePlaywrightJson(
      report([{ file: 'e2e/tasks/a.spec.ts', specs: [spec('t', [{ status: 'failed', duration: 3, error: { message: 'first' } }, { status: 'passed', duration: 4 }])] }]),
      [`${E2E}/tasks/a.spec.ts`],
    );
    expect(out[0].tests[0]).toMatchObject({ status: 'passed', durationMs: 7, error: null });
    const withError = parsePlaywrightJson(report([{ file: 'e2e/tasks/a.spec.ts', specs: [spec('t', [{ status: 'failed', error: { message: 'only error field' } }])] }]), [`${E2E}/tasks/a.spec.ts`]);
    expect(withError[0].tests[0].error?.message).toBe('only error field');
  });

  it('ignores specs from files that were not requested, and survives garbage', () => {
    expect(parsePlaywrightJson(report([{ file: 'e2e/other.spec.ts', specs: [spec('t', [{ status: 'passed' }])] }]), [SPEC_A])).toEqual([]);
    expect(parsePlaywrightJson('not json', [SPEC_A])).toEqual([]);
    expect(parsePlaywrightJson('{}', [SPEC_A])).toEqual([]);
    expect(parsePlaywrightJson(report([{ specs: [{ title: 'x', tests: [{}] }] }]), [SPEC_A])).toEqual([]);
  });

  it('handles an unknown status and an untitled spec', () => {
    const out = parsePlaywrightJson(report([{ file: 'e2e/tasks/a.spec.ts', specs: [{ file: 'e2e/tasks/a.spec.ts', tests: [{ status: 'skipped', results: [{ status: 'weird' }] }, { status: 'unexpected', results: [] }] }] }]), [`${E2E}/tasks/a.spec.ts`]);
    expect(out[0].tests.map((t) => [t.title, t.status])).toEqual([['(untitled)', 'skipped'], ['(untitled)', 'failed']]);
  });
});

describe('probeTestServer', () => {
  it('is up when something listens, down when nothing does', async () => {
    const server = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as net.AddressInfo).port;
    expect(await probeTestServer(port)).toBe(true);
    await new Promise((r) => server.close(r));
    expect(await probeTestServer(port)).toBe(false);
  });

  it('gives up quickly when the connection hangs', async () => {
    const started = Date.now();
    expect(await probeTestServer(81, 150, '10.255.255.1')).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('startSpecProcess (a fake `yarn` stands in for the real one)', () => {
  let bin: string;
  const fakeYarn = (body: string) => {
    bin = mkdtempSync(join(tmpdir(), 'fake-bundle-'));
    dirs.push(bin);
    writeFileSync(join(bin, 'yarn'), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, 'yarn'), 0o755);
  };
  const env = () => ({ ...process.env, PATH: `${bin}:${process.env.PATH}` });
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams cleaned output, writes results where the guard says, and reports the exit code', async () => {
    fakeYarn(`printf '\\033[32m  ok 1 first test\\033[0m\\n'\necho "args: $@" > "$PWD/args.txt"\necho '{"suites":[]}' > "$PLAYWRIGHT_JSON_OUTPUT_NAME"\nexit 0`);
    const dir = tempDir();
    const chunks: string[] = [];

    const proc = startSpecProcess({ cwd: dir, files: [SPEC_A], env: env(), onOutput: (t) => chunks.push(t) });
    const result = await proc.done;

    expect(result).toEqual({ code: 0, signal: null, error: null });
    expect(chunks.join('')).toBe('  ok 1 first test\n');
    expect(readFileSync(join(dir, 'args.txt'), 'utf8')).toContain(`playwright test -c ${PLAYWRIGHT_CONFIG} ${SPEC_A} --retries=0 --workers=1 --reporter=list,json --output=${dir}/${OUTPUT_DIR_NAME}`);
    expect(existsSync(join(dir, RESULTS_FILE_NAME))).toBe(true);
  });

  it('does not hand credentials to the specs', async () => {
    fakeYarn(`echo "GH=$GH_TOKEN SLACK=$SLACK_WEBHOOK_URL JIRA=$JIRA_API_TOKEN SOCK=$SSH_AUTH_SOCK HOME_OK=$HOME" > "$PWD/env.txt"`);
    const dir = tempDir();
    await startSpecProcess({ cwd: dir, files: [SPEC_A], env: { ...env(), GH_TOKEN: 'leak1', SLACK_WEBHOOK_URL: 'leak2', JIRA_API_TOKEN: 'leak3', SSH_AUTH_SOCK: '/leak4' }, onOutput: () => {} }).done;
    const seen = readFileSync(join(dir, 'env.txt'), 'utf8');
    expect(seen).toContain('GH= SLACK= JIRA= SOCK=');
    expect(seen).not.toMatch(/leak/);
    expect(seen).toMatch(/HOME_OK=\//);
  });

  it('reports a failing exit code and stderr output', async () => {
    fakeYarn(`echo "boom on stderr" 1>&2\nexit 1`);
    const chunks: string[] = [];
    const result = await startSpecProcess({ cwd: tempDir(), files: [SPEC_A], env: env(), onOutput: (t) => chunks.push(t) }).done;
    expect(result.code).toBe(1);
    expect(chunks.join('')).toContain('boom on stderr');
  });

  it('explains a missing yarn instead of crashing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'no-bin-'));
    dirs.push(empty);
    const result = await startSpecProcess({ cwd: tempDir(), files: [SPEC_A], env: { PATH: empty }, onOutput: () => {} }).done;
    expect(result.error).toMatch(/`yarn` was not found/);
    expect(result.code).toBeNull();
  });

  it('can stop the whole process group', async () => {
    fakeYarn(`sleep 30 &\nwait`);
    const proc = startSpecProcess({ cwd: tempDir(), files: [SPEC_A], env: env(), onOutput: () => {} });
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    proc.kill('SIGTERM');
    const result = await proc.done;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.signal === 'SIGTERM' || result.code !== 0).toBe(true);
  });

  it('refuses to start anything the guard rail does not allow', () => {
    for (const files of [['spec/models/x_spec.rb'], [], ['--config=x.spec.ts']]) {
      expect(() => startSpecProcess({ cwd: tempDir(), files, onOutput: () => {} })).toThrow(SpecGuardError);
    }
    expect(() => startSpecProcess({ cwd: '/Users/qa/Dev/securicy-app', files: [SPEC_A], onOutput: () => {} })).toThrow(/temporary PR checkout/);
  });

  it('uses the injected spawn with no shell, a scrubbed env and its own process group', () => {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const fakeChild = Object.assign(new EventEmitter(), { pid: 4242, stdout: null, stderr: null, kill: vi.fn() });
    const dir = tempDir();
    const proc = startSpecProcess({
      cwd: dir,
      files: [SPEC_A],
      env: { PATH: '/bin', GH_TOKEN: 'secret' },
      onOutput: () => {},
      spawnImpl: ((command: string, args: string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return fakeChild;
      }) as never,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('yarn');
    expect(calls[0].options.shell).toBeUndefined();
    expect(calls[0].options.detached).toBe(true);
    expect(calls[0].options.cwd).toBe(dir);
    expect((calls[0].options.env as Record<string, string>).GH_TOKEN).toBeUndefined();
    expect(proc.pid).toBe(4242);
    fakeChild.emit('close', 0, null);
  });
});
