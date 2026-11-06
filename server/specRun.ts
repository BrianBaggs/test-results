import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_WORKTREE_PREFIX } from './gitGuard.ts';
import { redactSecrets } from './redact.ts';
import { ReviewError } from './reviewError.ts';
import { OverlayError, applyOverlay, planOverlay, restoreOverlay } from './serverOverlay.ts';
import { copyGeneratedFiles } from './generatedFiles.ts';
import type { ChangedFile, OverlayManifest } from './serverOverlay.ts';
import {
  DEFAULT_TEST_SERVER_PORT,
  MAX_OUTPUT_CHARS,
  MAX_SPECS_PER_RUN,
  RESULTS_FILE_NAME,
  SpecGuardError,
  isRunnableSpecPath,
  parsePlaywrightJson,
  probeTestServer,
  startSpecProcess,
} from './specRunner.ts';
import type { SpawnFn, SpecFileResult, SpecProcess } from './specRunner.ts';

/**
 * Run the Playwright specs a PR touches, against the local test server.
 *
 * NEVER starts the test server — that is the QA team's to run (`yarn test:server`).
 * If it isn't listening, nothing is started and the user is told how to start it.
 *
 * A run is: a throw-away checkout of the PR commit (node_modules linked in) →
 * the PR's fixture/cassette data files copied into the server's checkout (see
 * serverOverlay.ts) → the guarded Playwright command → parse results → ALWAYS
 * clean up (stop the process group, restore the server checkout, remove the
 * checkout), whatever happened.
 */

export type JobStatus = 'preparing' | 'syncing' | 'running' | 'cleaning' | 'passed' | 'failed' | 'cancelled' | 'error';
const ACTIVE: JobStatus[] = ['preparing', 'syncing', 'running', 'cleaning'];
const isActive = (s: JobStatus) => ACTIVE.includes(s);

export interface SpecJobView {
  id: string;
  branch: string;
  sha: string;
  status: JobStatus;
  specs: string[];
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  /** Output from `since` on (so the page can poll cheaply). */
  output: string;
  nextOffset: number;
  truncated: boolean;
  results: SpecFileResult[] | null;
  error: string | null;
  warnings: string[];
  /** Changed files that run inside the test server and were NOT copied. */
  serverCodeChanged: string[];
  exitCode: number | null;
}

export interface TestServerStatus {
  up: boolean;
  host: string;
  port: number;
  /** How to start it, shown whenever it's down. */
  startCommand: string;
  activeJob: { id: string; branch: string; status: JobStatus } | null;
}

const START_TEST_SERVER_COMMAND = 'yarn test:server';

interface Job {
  id: string;
  branch: string;
  sha: string;
  specs: string[];
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  output: string;
  truncated: boolean;
  results: SpecFileResult[] | null;
  error: string | null;
  warnings: string[];
  serverCodeChanged: string[];
  exitCode: number | null;
  cancelled: boolean;
  proc: SpecProcess | null;
  dir: string | null;
  overlay: OverlayManifest | null;
}

export interface SpecRunContext {
  repoPath: string;
  /** The Rails test server's checkout (where its fixtures and cassettes are read from). */
  serverRoot: string;
  testServerPort?: number;
  assertReviewable: (branch: unknown) => asserts branch is string;
  assertReady: () => Promise<void>;
  requireReviewTicket: (branch: string) => Promise<unknown>;
  fetchRemote: () => Promise<void>;
  resolveBranch: (branch: string) => Promise<string | null>;
  changedFiles: (branch: string) => Promise<ChangedFile[]>;
  addWorktree: (branch: string, dir: string) => Promise<void>;
  removeWorktree: (dir: string) => Promise<void>;
  // injectable for tests
  probe?: (port: number) => Promise<boolean>;
  spawnImpl?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  keepJobs?: number;
}

const errText = (err: unknown) => redactSecrets(err instanceof Error ? err.message : String(err));

export function createSpecRunService(ctx: SpecRunContext) {
  const port = ctx.testServerPort ?? DEFAULT_TEST_SERVER_PORT;
  const probe = ctx.probe ?? ((p: number) => probeTestServer(p));
  const killGraceMs = ctx.killGraceMs ?? 5000;
  const keepJobs = ctx.keepJobs ?? 10;
  const jobs = new Map<string, Job>();
  /** Set from the moment a start is accepted until its job exists, so two clicks can't both start. */
  let starting = false;

  const active = (): Job | undefined => [...jobs.values()].find((j) => isActive(j.status));

  const append = (job: Job, text: string) => {
    if (job.truncated) return;
    if (job.output.length + text.length > MAX_OUTPUT_CHARS) {
      job.output += text.slice(0, Math.max(0, MAX_OUTPUT_CHARS - job.output.length)) + '\n[output truncated]\n';
      job.truncated = true;
    } else job.output += text;
  };

  const view = (job: Job, since = 0): SpecJobView => ({
    id: job.id,
    branch: job.branch,
    sha: job.sha,
    status: job.status,
    specs: job.specs,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    output: job.output.slice(Math.max(0, since)),
    nextOffset: job.output.length,
    truncated: job.truncated,
    results: job.results,
    error: job.error,
    warnings: job.warnings,
    serverCodeChanged: job.serverCodeChanged,
    exitCode: job.exitCode,
  });

  const evictOld = () => {
    const finished = [...jobs.values()].filter((j) => !isActive(j.status)).sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    while (finished.length > keepJobs) jobs.delete(finished.shift()!.id);
  };

  async function stopProcess(job: Job) {
    const proc = job.proc;
    if (!proc) return;
    let exited = false;
    void proc.done.then(() => (exited = true));
    proc.kill('SIGTERM');
    const deadline = Date.now() + killGraceMs;
    while (!exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    if (!exited) {
      proc.kill('SIGKILL');
      await Promise.race([proc.done, new Promise((r) => setTimeout(r, 1000))]);
    }
  }

  /** Idempotent: safe to call more than once, and never throws. */
  async function cleanup(job: Job) {
    job.status = 'cleaning';
    try {
      await stopProcess(job);
    } catch (err) {
      job.warnings.push(`Could not stop the spec process: ${errText(err)}`);
    }
    if (job.overlay) {
      try {
        const r = restoreOverlay(job.overlay);
        job.warnings.push(...r.warnings);
      } catch (err) {
        job.warnings.push(`Could not restore the test server checkout: ${errText(err)}`);
      }
      job.overlay = null;
    }
    if (job.dir) {
      const dir = job.dir;
      try {
        await ctx.removeWorktree(dir);
      } catch (err) {
        job.warnings.push(`Could not remove the temporary worktree: ${errText(err)}`);
      }
      try {
        rmSync(dir, { recursive: true, force: true }); // a symlinked node_modules is unlinked, never followed
      } catch (err) {
        job.warnings.push(`Could not remove ${dir}: ${errText(err)}`);
      }
      job.dir = null;
    }
  }

  async function run(job: Job, changed: ChangedFile[]) {
    try {
      // ---- 1. a throw-away checkout of the reviewed commit
      job.status = 'preparing';
      const dir = mkdtempSync(TEMP_WORKTREE_PREFIX);
      job.dir = dir;
      await ctx.addWorktree(job.branch, dir);

      const modules = join(ctx.repoPath, 'node_modules');
      if (!existsSync(modules)) throw new Error(`node_modules was not found in ${ctx.repoPath}. Run \`yarn install\` there first.`);
      if (lstatSync(modules).isSymbolicLink()) throw new Error('node_modules in the securicy-app checkout is a symlink; refusing to link it.');
      symlinkSync(modules, join(dir, 'node_modules'), 'dir');
      // generated, gitignored files the specs import (routes.js); done before anything is copied into the server
      copyGeneratedFiles({ workspaceDir: dir, roots: [ctx.serverRoot, ctx.repoPath] });
      if (job.cancelled) return;

      // ---- 2. the PR's fixtures/cassettes into the server's checkout
      job.status = 'syncing';
      const plan = planOverlay(changed);
      job.serverCodeChanged = plan.serverCodeChanged;
      if (plan.copy.length > 0) {
        const { manifest, skipped } = applyOverlay({ workspaceDir: dir, serverRoot: ctx.serverRoot, files: plan.copy });
        job.overlay = manifest;
        const copied = manifest.entries.length;
        if (copied > 0) job.warnings.push(`Copied ${copied} fixture/cassette file${copied === 1 ? '' : 's'} from this PR into your test server checkout for the run. They are restored when it finishes.`);
        if (skipped.length > 0 && copied === 0) job.warnings.push('The PR\'s fixtures and cassettes already match your test server checkout.');
      }
      if (job.cancelled) return;

      // ---- 3. run the specs
      job.status = 'running';
      const proc = startSpecProcess({ cwd: dir, files: job.specs, env: ctx.env, onOutput: (t) => append(job, t), spawnImpl: ctx.spawnImpl });
      job.proc = proc;
      const done = await proc.done;
      job.proc = null;
      job.exitCode = done.code;
      if (done.error) throw new Error(done.error);

      const resultsFile = join(dir, RESULTS_FILE_NAME);
      if (existsSync(resultsFile)) {
        try {
          job.results = parsePlaywrightJson(readFileSync(resultsFile, 'utf8'), job.specs);
        } catch (err) {
          job.warnings.push(`Could not read the results report: ${errText(err)}`);
        }
      }
    } catch (err) {
      job.error = errText(err);
    } finally {
      await cleanup(job);
      const failed = job.results?.some((r) => r.status === 'failed') ?? false;
      job.status = job.cancelled ? 'cancelled' : job.error ? 'error' : failed || (job.exitCode !== null && job.exitCode !== 0) ? 'failed' : 'passed';
      job.finishedAt = Date.now();
      evictOld();
    }
  }

  return {
    /** True while a run is starting or in progress (cheap, no probe). */
    busy: (): boolean => starting || !!active(),

    async testServer(): Promise<TestServerStatus> {
      const job = active();
      return {
        up: await probe(port),
        host: '127.0.0.1',
        port,
        startCommand: START_TEST_SERVER_COMMAND,
        activeJob: job ? { id: job.id, branch: job.branch, status: job.status } : null,
      };
    },

    async start(opts: { branch?: unknown; expectedSha?: unknown; specs?: unknown }): Promise<{ id: string }> {
      // cheap validation first: nothing below runs for a malformed request
      ctx.assertReviewable(opts.branch);
      const branch = opts.branch;
      if (typeof opts.expectedSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(opts.expectedSha)) {
        throw new ReviewError(400, 'expectedSha is required so the specs run against what was reviewed.');
      }
      const all = opts.specs === 'all';
      if (!all) {
        const list = opts.specs;
        if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SPECS_PER_RUN || !list.every(isRunnableSpecPath) || new Set(list).size !== list.length) {
          throw new ReviewError(400, 'Choose which spec files to run (or "all"): each must be a *.spec.ts under spec/playwright/playwright/e2e.');
        }
      }

      if (starting || active()) throw new ReviewError(409, 'A spec run is already in progress. Wait for it to finish (or cancel it) first.');
      starting = true;
      try {
        await ctx.assertReady();
        await ctx.requireReviewTicket(branch);

        // Never start the server ourselves: if it isn't there, say how to start it.
        if (!(await probe(port))) {
          throw new ReviewError(409, `The test server isn't running on 127.0.0.1:${port}. Start it with \`${START_TEST_SERVER_COMMAND}\` in securicy-app, then try again.`);
        }

        await ctx.fetchRemote();
        const sha = await ctx.resolveBranch(branch);
        if (!sha) throw new ReviewError(404, `Branch "${branch}" was not found on origin. Refresh and try again.`);
        if (!sha.startsWith(opts.expectedSha.toLowerCase())) {
          throw new ReviewError(409, `"${branch}" changed since you opened it. Reload the pull request, review the new commits, then run the specs.`);
        }

        const changed = await ctx.changedFiles(branch);
        const runnable = changed.filter((f) => f.status !== 'deleted' && isRunnableSpecPath(f.path)).map((f) => f.path);
        const chosen = all ? runnable : (opts.specs as string[]);
        if (chosen.length === 0) throw new ReviewError(400, 'This PR doesn\'t add or change any runnable Playwright specs.');
        const notInPr = chosen.filter((s) => !runnable.includes(s));
        if (notInPr.length > 0) throw new ReviewError(400, 'Only specs this PR adds or changes can be run.', notInPr);

        const job: Job = {
          id: randomUUID(),
          branch,
          sha,
          specs: chosen,
          status: 'preparing',
          startedAt: Date.now(),
          finishedAt: null,
          output: '',
          truncated: false,
          results: null,
          error: null,
          warnings: [],
          serverCodeChanged: [],
          exitCode: null,
          cancelled: false,
          proc: null,
          dir: null,
          overlay: null,
        };
        jobs.set(job.id, job);
        void run(job, changed); // runs in the background; the page polls get()
        return { id: job.id };
      } catch (err) {
        if (err instanceof SpecGuardError || err instanceof OverlayError) throw new ReviewError(err instanceof SpecGuardError ? 403 : 409, err.message);
        throw err;
      } finally {
        starting = false;
      }
    },

    get(id: unknown, since: unknown = 0): SpecJobView {
      const job = typeof id === 'string' ? jobs.get(id) : undefined;
      if (!job) throw new ReviewError(404, 'That spec run was not found (the dev server may have restarted).');
      const offset = typeof since === 'number' && Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
      return view(job, offset);
    },

    async cancel(id: unknown): Promise<SpecJobView> {
      const job = typeof id === 'string' ? jobs.get(id) : undefined;
      if (!job) throw new ReviewError(404, 'That spec run was not found (the dev server may have restarted).');
      if (!isActive(job.status)) return view(job);
      job.cancelled = true;
      void stopProcess(job); // run()'s finally finishes the cleanup
      return view(job);
    },

    /**
     * Synchronous last resort for process exit: stop the child, restore the
     * server checkout, delete the temp checkout. (If even this can't run, the
     * overlay journal is recovered on the next start.)
     */
    shutdown() {
      for (const job of jobs.values()) {
        if (!isActive(job.status)) continue;
        try {
          job.proc?.kill('SIGKILL');
        } catch {
          // already gone
        }
        try {
          if (job.overlay) restoreOverlay(job.overlay);
        } catch {
          // recovered on next start
        }
        try {
          if (job.dir) rmSync(job.dir, { recursive: true, force: true });
        } catch {
          // best effort
        }
      }
    },
  };
}

