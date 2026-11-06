import { execFile } from 'node:child_process';

/**
 * The ONLY place this app runs the GitHub CLI (`gh`), and it can do exactly
 * ONE thing: `gh auth status` — a read-only check of whether `gh` is signed
 * in, shown as a status light on the Review page.
 *
 * GUARD RAIL: `assertAllowedGhCommand` accepts that single argv and nothing
 * else. No pr/issue/repo/api/auth login|logout|refresh, no other subcommand or
 * flag — anything else throws before a process is spawned. The review itself
 * (fetch, rebase, merge) is done with plain `git`, never `gh`.
 * Do not loosen this; see server/ghStatus.test.ts.
 */

export type GhState = 'ready' | 'not-installed' | 'not-authenticated' | 'error';

export interface GhStatus {
  state: GhState;
  /** e.g. the signed-in account name. */
  account: string | null;
  host: string | null;
  detail: string;
  /** How to fix it when it isn't ready. */
  command?: string;
  url?: string;
}

export class GhGuardError extends Error {
  constructor(message: string) {
    super(`Blocked by the gh guard rail: ${message}`);
    this.name = 'GhGuardError';
  }
}

/** The one permitted invocation. */
export const ALLOWED_GH_ARGS = ['auth', 'status'] as const;

export function assertAllowedGhCommand(args: string[]): void {
  const ok = Array.isArray(args) && args.length === ALLOWED_GH_ARGS.length && ALLOWED_GH_ARGS.every((a, i) => args[i] === a);
  if (!ok) throw new GhGuardError(`only "gh ${ALLOWED_GH_ARGS.join(' ')}" is allowed, never "gh ${Array.isArray(args) ? args.join(' ') : '?'}".`);
}

export interface GhRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[]) => Promise<GhRunResult>;

export const defaultGhRunner: GhRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      // Never prompt, never colour; a hung check must not hang the page.
      { timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' } },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const numeric = typeof (err as NodeJS.ErrnoException).code === 'number';
        resolve({
          code: numeric ? Number((err as NodeJS.ErrnoException).code) : 1,
          stdout,
          stderr: numeric ? stderr : `${stderr}${(err as NodeJS.ErrnoException).code ?? ''} ${err.message}`,
        });
      },
    );
  });

const INSTALL = { command: 'brew install gh', url: 'https://cli.github.com' };
const LOGIN = { command: 'gh auth login' };

export function createGhChecker(deps: { findExecutable: (bin: string) => boolean; run?: GhRunner }) {
  const rawRun = deps.run ?? defaultGhRunner;
  // Every command, whoever builds it, goes through the guard first.
  const run: GhRunner = async (args) => {
    assertAllowedGhCommand(args);
    return rawRun(args);
  };

  return {
    async check(): Promise<GhStatus> {
      if (!deps.findExecutable('gh')) {
        return {
          state: 'not-installed',
          account: null,
          host: null,
          detail: "The GitHub CLI (gh) isn't installed.",
          ...INSTALL,
        };
      }
      const r = await run([...ALLOWED_GH_ARGS]);
      const text = `${r.stdout}\n${r.stderr}`;
      const logged = /Logged in to (\S+) account (\S+)/.exec(text);
      // gh exits non-zero if ANY configured host has a bad token, so a success
      // line plus a failure line still counts as signed in to the working one.
      if (logged) {
        return { state: 'ready', account: logged[2], host: logged[1], detail: `Signed in to ${logged[1]} as ${logged[2]}.` };
      }
      if (/not logged in|gh auth login|no (?:github )?hosts|token .* invalid|failed to log in/i.test(text)) {
        return { state: 'not-authenticated', account: null, host: null, detail: "The GitHub CLI isn't signed in.", ...LOGIN };
      }
      if (/ENOENT/.test(r.stderr)) {
        return { state: 'not-installed', account: null, host: null, detail: "The GitHub CLI (gh) isn't installed.", ...INSTALL };
      }
      const first = text.trim().split('\n').find(Boolean) ?? 'unknown error';
      return { state: 'error', account: null, host: null, detail: `Could not check gh: ${first}` };
    },
  };
}

export type GhChecker = ReturnType<typeof createGhChecker>;
