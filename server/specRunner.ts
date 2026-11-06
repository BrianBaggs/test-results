import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import net from 'node:net';
import { isTempWorktree } from './gitGuard.ts';
import { redactSecrets } from './redact.ts';

/**
 * Runs Playwright specs from a PR against the local test server.
 *
 * GUARD RAIL: the ONLY process this module can start is the QA team's own
 * documented command, built from fixed strings plus validated spec paths:
 *
 *   yarn playwright test -c spec/playwright/playwright.config.js
 *        <spec/playwright/playwright/e2e/…/x.spec.ts …>  (space-separated)
 *        --retries=0 --workers=1 --reporter=list,json --output=<temp worktree>/.spec-run-output
 *
 * (the last four flags only keep results structured and artifacts in the temp folder)
 *
 * `assertAllowedSpecCommand` accepts exactly that shape, only inside a temp
 * worktree, and only for `*.spec.ts` files under the e2e folder. It is never
 * given a shell. The child gets a scrubbed environment (no tokens or keys), so
 * the code in a branch under review can't read them from its environment.
 * Do not loosen this; see server/specRunner.test.ts.
 */

const SPEC_FILE_RE = /^spec\/playwright\/playwright\/e2e\/[A-Za-z0-9_][A-Za-z0-9_./-]*\.spec\.ts$/;
export const PLAYWRIGHT_CONFIG = 'spec/playwright/playwright.config.js';
export const OUTPUT_DIR_NAME = '.spec-run-output';
export const RESULTS_FILE_NAME = '.spec-run-results.json';
export const MAX_SPECS_PER_RUN = 200;
export const DEFAULT_TEST_SERVER_PORT = 5017;
export const MAX_OUTPUT_CHARS = 2_000_000;

export class SpecGuardError extends Error {
  constructor(message: string) {
    super(`Blocked by the spec-runner guard rail: ${message}`);
    this.name = 'SpecGuardError';
  }
}

export function isRunnableSpecPath(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 300 && SPEC_FILE_RE.test(p) && !p.includes('..') && !p.includes('//');
}

export function buildSpecArgs(files: string[], cwd: string): string[] {
  return [
    'playwright',
    'test',
    '-c',
    PLAYWRIGHT_CONFIG,
    ...files,
    '--retries=0',
    '--workers=1',
    '--reporter=list,json',
    `--output=${cwd}/${OUTPUT_DIR_NAME}`,
  ];
}

export function assertAllowedSpecCommand(bin: string, args: string[], cwd: string): void {
  const deny = (why: string): never => {
    throw new SpecGuardError(why);
  };
  if (bin !== 'yarn') deny(`"${String(bin)}" is not allowed.`);
  if (typeof cwd !== 'string' || !isTempWorktree(cwd)) deny('specs only run inside the temporary PR checkout.');
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) deny('invalid arguments.');
  const head = ['playwright', 'test', '-c', PLAYWRIGHT_CONFIG];
  const tail = ['--retries=0', '--workers=1', '--reporter=list,json', `--output=${cwd}/${OUTPUT_DIR_NAME}`];
  if (args.length < head.length + 1 + tail.length) deny('unexpected arguments.');
  if (!head.every((h, i) => args[i] === h)) deny('unexpected arguments.');
  if (!tail.every((t, i) => args[args.length - tail.length + i] === t)) deny('unexpected arguments.');
  const files = args.slice(head.length, args.length - tail.length);
  if (files.length === 0 || files.length > MAX_SPECS_PER_RUN) deny(`between 1 and ${MAX_SPECS_PER_RUN} spec files per run.`);
  for (const f of files) if (!isRunnableSpecPath(f)) deny(`"${f}" is not a runnable spec file.`);
  if (new Set(files).size !== files.length) deny('duplicate spec files.');
}

const SENSITIVE_ENV = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|CREDENTIAL|PRIVATE_?KEY|AUTH|SESSION)|^(?:AWS_|GH_|GITHUB_|SLACK|JIRA|ATLASSIAN|OPENAI|ANTHROPIC|SSH_AUTH_SOCK|SSH_AGENT)/i;

/** A copy of the environment without anything that looks like a credential. */
export function scrubEnv(env: NodeJS.ProcessEnv, cwd: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !SENSITIVE_ENV.test(k)) out[k] = v;
  out.FORCE_COLOR = '0';
  out.NO_COLOR = '1';
  out.PLAYWRIGHT_JSON_OUTPUT_NAME = `${cwd}/${RESULTS_FILE_NAME}`;
  return out;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
export const stripAnsi = (text: string): string => text.replace(ANSI, '');

/** Output as shown to the user: no colour codes, no credentials. */
export const cleanOutput = (text: string): string => redactSecrets(stripAnsi(text));

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

type SpecStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';

interface SpecError {
  message: string;
  stack: string;
  /** The code frame Playwright printed around the failing line, if any. */
  snippet: string;
}

interface SpecTestResult {
  title: string;
  line: number | null;
  status: SpecStatus;
  durationMs: number;
  error: SpecError | null;
}

export interface SpecFileResult {
  file: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  tests: SpecTestResult[];
}

interface PwError {
  message?: string;
  stack?: string;
  snippet?: string;
}
interface PwResult {
  status?: string;
  duration?: number;
  error?: PwError;
  errors?: PwError[];
}
interface PwTest {
  status?: string;
  results?: PwResult[];
}
interface PwSpec {
  title?: string;
  file?: string;
  line?: number;
  tests?: PwTest[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

const KNOWN: SpecStatus[] = ['passed', 'failed', 'skipped', 'timedOut', 'interrupted'];

/** Turn Playwright's JSON report into one entry per spec file. */
export function parsePlaywrightJson(raw: string, requested: string[]): SpecFileResult[] {
  let data: { suites?: PwSuite[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const byFile = new Map<string, SpecFileResult>();
  const resolveFile = (f: string | undefined): string | null => {
    if (!f) return null;
    const norm = f.replace(/\\/g, '/');
    return requested.find((r) => r === norm || r.endsWith(`/${norm}`) || norm.endsWith(`/${r}`)) ?? null;
  };

  const visit = (suite: PwSuite, trail: string[], inheritedFile: string | undefined) => {
    const file = suite.file ?? inheritedFile;
    const nextTrail = suite.title && suite.title !== file ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      const path = resolveFile(spec.file ?? file);
      if (!path) continue;
      const entry = byFile.get(path) ?? { file: path, status: 'passed' as const, durationMs: 0, tests: [] };
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        const status: SpecStatus = KNOWN.includes(last?.status as SpecStatus) ? (last!.status as SpecStatus) : t.status === 'skipped' ? 'skipped' : 'failed';
        const e = last?.errors?.[0] ?? last?.error;
        const duration = (t.results ?? []).reduce((n, r) => n + (r.duration ?? 0), 0);
        entry.tests.push({
          title: [...nextTrail, spec.title ?? '(untitled)'].join(' › '),
          line: typeof spec.line === 'number' ? spec.line : null,
          status,
          durationMs: duration,
          error: e ? { message: cleanOutput(e.message ?? ''), stack: cleanOutput(e.stack ?? e.message ?? ''), snippet: cleanOutput(e.snippet ?? '') } : null,
        });
        entry.durationMs += duration;
      }
      byFile.set(path, entry);
    }
    for (const child of suite.suites ?? []) visit(child, nextTrail, file);
  };
  for (const s of data.suites ?? []) visit(s, [], undefined);

  return [...byFile.values()].map((f) => ({
    ...f,
    status: f.tests.some((t) => t.status === 'failed' || t.status === 'timedOut' || t.status === 'interrupted')
      ? ('failed' as const)
      : f.tests.length > 0 && f.tests.every((t) => t.status === 'skipped')
        ? ('skipped' as const)
        : ('passed' as const),
  }));
}

// ---------------------------------------------------------------------------
// test server + process
// ---------------------------------------------------------------------------

/** Is anything listening on the test server's port? A plain TCP connect: no process, no request. */
export function probeTestServer(port: number = DEFAULT_TEST_SERVER_PORT, timeoutMs = 800, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export interface SpecProcess {
  pid: number | undefined;
  kill: (signal: NodeJS.Signals) => void;
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; error: string | null }>;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export function startSpecProcess(opts: {
  cwd: string;
  files: string[];
  env?: NodeJS.ProcessEnv;
  onOutput: (text: string) => void;
  spawnImpl?: SpawnFn;
}): SpecProcess {
  const args = buildSpecArgs(opts.files, opts.cwd);
  assertAllowedSpecCommand('yarn', args, opts.cwd); // throws before anything is started

  const child = (opts.spawnImpl ?? (spawn as SpawnFn))('yarn', args, {
    cwd: opts.cwd,
    env: scrubEnv(opts.env ?? process.env, opts.cwd),
    // its own process group, so a cancel stops Playwright and the browsers it started
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const feed = (chunk: Buffer | string) => opts.onOutput(cleanOutput(chunk.toString()));
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);

  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error: string | null }>((resolve) => {
    child.once('error', (err: NodeJS.ErrnoException) =>
      resolve({
        code: null,
        signal: null,
        error:
          err.code === 'ENOENT'
            ? '`yarn` was not found. Install it (`brew install yarn`), then try again.'
            : redactSecrets(err.message),
      }),
    );
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });

  return {
    pid: child.pid,
    done,
    kill(signal) {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
    },
  };
}
