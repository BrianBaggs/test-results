import { describe, it, expect, vi } from 'vitest';
import { GhGuardError, assertAllowedGhCommand, createGhChecker } from './ghStatus';
import type { GhRunner } from './ghStatus';

const installed = () => true;

describe('gh guard rail: assertAllowedGhCommand', () => {
  it('allows exactly "gh auth status"', () => {
    expect(() => assertAllowedGhCommand(['auth', 'status'])).not.toThrow();
  });

  it.each([
    ['auth login', ['auth', 'login']],
    ['auth logout', ['auth', 'logout']],
    ['auth refresh', ['auth', 'refresh']],
    ['auth token (prints the secret)', ['auth', 'token']],
    ['auth status --show-token', ['auth', 'status', '--show-token']],
    ['auth status --hostname other', ['auth', 'status', '--hostname', 'evil.example']],
    ['pr merge', ['pr', 'merge', '123', '--rebase']],
    ['pr create', ['pr', 'create']],
    ['pr list', ['pr', 'list']],
    ['issue create', ['issue', 'create']],
    ['repo delete', ['repo', 'delete', 'carbidesecure/securicy-app', '--yes']],
    ['repo view', ['repo', 'view']],
    ['api (arbitrary REST calls)', ['api', '-X', 'DELETE', '/repos/carbidesecure/securicy-app']],
    ['secret set', ['secret', 'set', 'X']],
    ['workflow run', ['workflow', 'run', 'ci.yml']],
    ['extension install', ['extension', 'install', 'evil/gh-x']],
    ['alias set', ['alias', 'set', 'x', '!rm -rf /']],
    ['config set', ['config', 'set', 'editor', 'evil']],
    ['--version', ['--version']],
    ['status then something else', ['status', 'auth']],
    ['no arguments', []],
  ])('blocks %s', (_name, args) => {
    expect(() => assertAllowedGhCommand(args)).toThrow(GhGuardError);
    expect(() => assertAllowedGhCommand(args)).toThrow(/gh guard rail/);
  });

  it('rejects non-array input', () => {
    expect(() => assertAllowedGhCommand('auth status' as unknown as string[])).toThrow(GhGuardError);
  });
});

describe('createGhChecker', () => {
  const ok = (stdout: string): GhRunner => vi.fn().mockResolvedValue({ code: 0, stdout, stderr: '' });

  it('reports ready and the signed-in account', async () => {
    const run = ok('github.com\n  ✓ Logged in to github.com account BrianBaggs (keyring)\n  - Active account: true\n');
    const status = await createGhChecker({ findExecutable: installed, run }).check();

    expect(status).toMatchObject({ state: 'ready', account: 'BrianBaggs', host: 'github.com', detail: 'Signed in to github.com as BrianBaggs.' });
    expect(run).toHaveBeenCalledExactlyOnceWith(['auth', 'status']);
  });

  it('counts as signed in even if another configured host has a bad token', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'ghe.example.com\n  X Failed to log in to ghe.example.com account x (keyring)\ngithub.com\n  ✓ Logged in to github.com account BrianBaggs (keyring)',
    });
    expect(await createGhChecker({ findExecutable: installed, run }).check()).toMatchObject({ state: 'ready', account: 'BrianBaggs' });
  });

  it('tells the user to install gh and spawns nothing when it is missing', async () => {
    const run = vi.fn<GhRunner>();
    const status = await createGhChecker({ findExecutable: () => false, run }).check();

    expect(status).toMatchObject({ state: 'not-installed', command: 'brew install gh', url: 'https://cli.github.com' });
    expect(run).not.toHaveBeenCalled();
  });

  it('tells the user to sign in when gh is installed but logged out', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' });
    expect(await createGhChecker({ findExecutable: installed, run }).check()).toMatchObject({ state: 'not-authenticated', command: 'gh auth login' });
  });

  it('treats an invalid token as not signed in', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'github.com\n  X Failed to log in to github.com account x\n  - The token in keyring is invalid.' });
    expect(await createGhChecker({ findExecutable: installed, run }).check()).toMatchObject({ state: 'not-authenticated' });
  });

  it('detects a missing binary reported by the runner', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'ENOENT spawn gh ENOENT' });
    expect(await createGhChecker({ findExecutable: installed, run }).check()).toMatchObject({ state: 'not-installed' });
  });

  it('reports other failures as an error without throwing', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'something odd happened\nmore' });
    expect(await createGhChecker({ findExecutable: installed, run }).check()).toMatchObject({ state: 'error', detail: 'Could not check gh: something odd happened' });
    const empty: GhRunner = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: '' });
    expect((await createGhChecker({ findExecutable: installed, run: empty }).check()).detail).toContain('unknown error');
  });
});

describe('gh output never leaks a token', () => {
  const tokenLine = `  - Token: ${['gh', 'o_'].join('')}${'x'.repeat(20)}`;
  it('a ready status only reports the account and host, not the token line gh prints', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({ code: 0, stdout: `github.com\n  ✓ Logged in to github.com account BrianBaggs (keyring)\n${tokenLine}\n`, stderr: '' });
    const status = await createGhChecker({ findExecutable: installed, run }).check();
    expect(JSON.stringify(status)).not.toContain('xxxx');
    expect(status.detail).toBe('Signed in to github.com as BrianBaggs.');
  });

  it('an unexpected failure is redacted before it is shown', async () => {
    const run: GhRunner = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: `token=${'y'.repeat(24)} was rejected` });
    const status = await createGhChecker({ findExecutable: installed, run }).check();
    expect(status.state).toBe('error');
    expect(status.detail).not.toContain('yyyy');
    expect(status.detail).toContain('[redacted]');
  });
});
