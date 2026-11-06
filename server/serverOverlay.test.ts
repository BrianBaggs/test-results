import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_OVERLAY_FILES,
  OVERLAY_ALLOW,
  OverlayError,
  applyOverlay,
  isProcessAlive,
  isSafeRelPath,
  planOverlay,
  recoverStaleOverlays,
  restoreOverlay,
} from './serverOverlay';

// Real files in throw-away folders: "workspace" is the PR checkout, "server" is
// the Rails test server's checkout that must come back exactly as it was.

let root: string;
let workspace: string;
let server: string;

const put = (base: string, rel: string, content: string | Buffer) => {
  mkdirSync(join(base, rel, '..'), { recursive: true });
  writeFileSync(join(base, rel), content);
};
const read = (base: string, rel: string) => readFileSync(join(base, rel), 'utf8');
const FIX = 'spec/fixtures/default/users.yml';
const CASS = 'spec/playwright/playwright/fixtures/vcr_cassettes/mcp/list.yml';
/** Every file under a folder with its content, for exact before/after comparison. */
const snapshot = (base: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[full.slice(base.length + 1)] = readFileSync(full, 'utf8');
    }
  };
  walk(base);
  return out;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'overlay-test-'));
  workspace = join(root, 'workspace');
  server = join(root, 'server');
  mkdirSync(workspace);
  mkdirSync(server);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isSafeRelPath', () => {
  it('accepts clean relative paths', () => {
    expect(isSafeRelPath('spec/fixtures/a.yml')).toBe(true);
  });

  it.each(['', '/etc/passwd', '../x', 'a/../b', 'a//b', './a', 'a/./b', 'a\\b', 'a\0b', 'x'.repeat(301), 'a/', 5, null, undefined])('rejects %j', (value) => {
    expect(isSafeRelPath(value)).toBe(false);
  });
});

describe('planOverlay', () => {
  it('copies only fixture and cassette DATA files', () => {
    const plan = planOverlay([
      { path: FIX, status: 'modified' },
      { path: CASS, status: 'added' },
      { path: 'spec/fixtures/default/data.json', status: 'added' },
      { path: 'spec/fixtures/files/logo.png', status: 'added' },
      { path: 'spec/fixtures/default/seed.rb', status: 'added' },
      { path: 'spec/fixtures/default/x.yml.erb', status: 'added' },
      { path: 'spec/playwright/playwright/e2e/tasks/a.spec.ts', status: 'added' },
    ]);
    expect(plan.copy).toEqual([FIX, CASS, 'spec/fixtures/default/data.json']);
  });

  it('never deletes anything in the server checkout and ignores unsafe paths', () => {
    const plan = planOverlay([
      { path: FIX, status: 'deleted' },
      { path: 'spec/fixtures/../../etc/passwd.yml', status: 'added' },
      { path: '/abs/spec/fixtures/a.yml', status: 'added' },
    ]);
    expect(plan.copy).toEqual([]);
  });

  it('reports changed Ruby/server files instead of copying them', () => {
    const plan = planOverlay([
      { path: 'spec/playwright/playwright/app_commands/eval.rb', status: 'modified' },
      { path: 'spec/playwright/playwright/e2e_helper.rb', status: 'modified' },
      { path: 'app/models/user.rb', status: 'modified' },
      { path: 'Gemfile.lock', status: 'modified' },
      { path: 'config/routes.rb', status: 'modified' },
    ]);
    expect(plan.copy).toEqual([]);
    expect(plan.serverCodeChanged).toHaveLength(5);
  });

  it('allowlists exactly two folders', () => {
    expect(OVERLAY_ALLOW).toHaveLength(2);
  });
});

describe('applyOverlay + restoreOverlay', () => {
  it('copies a new file in, then removes it again (and the folders it created)', () => {
    put(workspace, CASS, 'cassette: new');
    const before = snapshot(server);

    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [CASS] });

    expect(read(server, CASS)).toBe('cassette: new');
    const result = restoreOverlay(manifest);

    expect(result).toEqual({ restored: 1, warnings: [] });
    expect(existsSync(join(server, CASS))).toBe(false);
    expect(existsSync(join(server, 'spec'))).toBe(false); // folders we created are gone too
    expect(snapshot(server)).toEqual(before);
    expect(existsSync(manifest.journalDir)).toBe(false);
  });

  it('overwrites an existing file, then restores the original bytes exactly', () => {
    put(server, FIX, 'original: server version\n');
    put(workspace, FIX, 'changed: pr version\n');
    const before = snapshot(server);

    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    expect(read(server, FIX)).toBe('changed: pr version\n');
    restoreOverlay(manifest);

    expect(snapshot(server)).toEqual(before);
  });

  it('preserves the user\'s own uncommitted edits to the original (restores whatever bytes were there)', () => {
    put(server, FIX, 'user edit not committed anywhere\n');
    put(workspace, FIX, 'pr version\n');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    restoreOverlay(manifest);
    expect(read(server, FIX)).toBe('user edit not committed anywhere\n');
  });

  it('skips files that are already identical (nothing to restore)', () => {
    put(server, FIX, 'same\n');
    put(workspace, FIX, 'same\n');
    const { manifest, skipped } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    expect(skipped).toEqual([FIX]);
    expect(manifest.entries).toEqual([]);
    restoreOverlay(manifest);
    expect(read(server, FIX)).toBe('same\n');
  });

  it('restores binary-safe: any bytes survive the round trip', () => {
    const original = Buffer.from([0, 1, 2, 250, 255, 10, 13]);
    put(server, 'spec/fixtures/default/blob.json', original);
    put(workspace, 'spec/fixtures/default/blob.json', Buffer.from('{}'));
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: ['spec/fixtures/default/blob.json'] });
    restoreOverlay(manifest);
    expect(readFileSync(join(server, 'spec/fixtures/default/blob.json')).equals(original)).toBe(true);
  });

  it('handles many files, mixed new and changed, and restores them all', () => {
    const files = Array.from({ length: 20 }, (_, i) => `spec/fixtures/default/f${i}.yml`);
    files.forEach((f, i) => {
      put(workspace, f, `pr ${i}`);
      if (i % 2 === 0) put(server, f, `server ${i}`);
    });
    const before = snapshot(server);
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files });
    expect(manifest.entries).toHaveLength(20);
    expect(restoreOverlay(manifest).restored).toBe(20);
    expect(snapshot(server)).toEqual(before);
  });

  it('keeps the journal private (0700) and the manifest readable only by the owner', () => {
    put(workspace, FIX, 'x');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    expect(statSync(manifest.journalDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(manifest.journalDir, 'manifest.json')).mode & 0o777).toBe(0o600);
    restoreOverlay(manifest);
  });

  it('does not clobber a file the user edited while the specs were running', () => {
    put(server, FIX, 'original\n');
    put(workspace, FIX, 'pr\n');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    writeFileSync(join(server, FIX), 'edited during the run\n');

    const result = restoreOverlay(manifest);

    expect(read(server, FIX)).toBe('edited during the run\n');
    expect(result.restored).toBe(0);
    expect(result.warnings[0]).toMatch(/changed while the specs were running/);
  });

  it('brings back a file that was deleted during the run', () => {
    put(server, FIX, 'original\n');
    put(workspace, FIX, 'pr\n');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    rmSync(join(server, FIX));
    restoreOverlay(manifest);
    expect(read(server, FIX)).toBe('original\n');
  });

  it('leaves a directory it did not create alone, even when empty of our files', () => {
    mkdirSync(join(server, 'spec/fixtures/default'), { recursive: true });
    put(workspace, FIX, 'x');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    restoreOverlay(manifest);
    expect(existsSync(join(server, 'spec/fixtures/default'))).toBe(true);
  });

  it('is safe to call restore twice', () => {
    put(server, FIX, 'original\n');
    put(workspace, FIX, 'pr\n');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });
    restoreOverlay(manifest);
    expect(() => restoreOverlay(manifest)).not.toThrow();
    expect(read(server, FIX)).toBe('original\n');
  });
});

describe('applyOverlay refusals (nothing is left changed)', () => {
  const expectUntouched = (before: Record<string, string>) => {
    expect(snapshot(server)).toEqual(before);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('review-overlay-') && existsSync(join(tmpdir(), n, 'manifest.json')) && readFileSync(join(tmpdir(), n, 'manifest.json'), 'utf8').includes(root))).toEqual([]);
  };

  it.each(['spec/other/a.yml', 'app/models/user.rb', 'spec/fixtures/default/a.rb', '../escape.yml', '/abs.yml', 'spec/fixtures/../../x.yml'])('refuses to copy %s', (rel) => {
    put(workspace, 'spec/fixtures/default/ok.yml', 'ok');
    const before = snapshot(server);
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: ['spec/fixtures/default/ok.yml', rel] })).toThrow(OverlayError);
    expectUntouched(before); // the first, valid file was rolled back too
  });

  it('refuses a symlink in the PR checkout (never follows it)', () => {
    put(root, 'secret.yml', 'top secret');
    mkdirSync(join(workspace, 'spec/fixtures/default'), { recursive: true });
    symlinkSync(join(root, 'secret.yml'), join(workspace, FIX));
    const before = snapshot(server);
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] })).toThrow(/not a regular file/);
    expectUntouched(before);
  });

  it('refuses to write through a symlinked folder in the server checkout', () => {
    mkdirSync(join(root, 'elsewhere'));
    mkdirSync(join(server, 'spec'), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(server, 'spec/fixtures'));
    put(workspace, FIX, 'x');
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] })).toThrow(/symlink/);
    expect(existsSync(join(root, 'elsewhere/default/users.yml'))).toBe(false);
  });

  it('refuses to replace a symlink or a directory that already exists at the destination', () => {
    put(root, 'target.yml', 'real');
    mkdirSync(join(server, 'spec/fixtures/default'), { recursive: true });
    symlinkSync(join(root, 'target.yml'), join(server, FIX));
    put(workspace, FIX, 'pr');
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] })).toThrow(/not a regular file/);
    expect(read(root, 'target.yml')).toBe('real');
  });

  it('refuses a missing source and oversized files', () => {
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] })).toThrow(/missing from the PR checkout/);
    put(workspace, FIX, Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] })).toThrow(/larger than/);
  });

  it('refuses when the total is too large, or there are too many files', () => {
    for (let i = 0; i < 11; i++) put(workspace, `spec/fixtures/default/big${i}.yml`, Buffer.alloc(5 * 1024 * 1024));
    const many = Array.from({ length: 11 }, (_, i) => `spec/fixtures/default/big${i}.yml`);
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: many })).toThrow(/exceed 50 MB/);
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: Array.from({ length: MAX_OVERLAY_FILES + 1 }, (_, i) => `spec/fixtures/default/n${i}.yml`) })).toThrow(/limit is 500/);
  });

  it('explains a server checkout that does not exist', () => {
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: join(root, 'nope'), files: [FIX] })).toThrow(/REVIEW_SERVER_REPO_PATH/);
  });

  it('works with a read-only-looking tree for identical files (no writes needed)', () => {
    put(server, FIX, 'same');
    put(workspace, FIX, 'same');
    chmodSync(join(server, FIX), 0o444);
    expect(() => applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] })).not.toThrow();
  });
});

/** A pid that definitely belonged to a process that has since exited. */
const deadPid = () => spawnSync('true').pid as number;
const crashOwnedBy = (journalDir: string, pid: number) => {
  const file = join(journalDir, 'manifest.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), pid }));
};

describe('isProcessAlive', () => {
  it('knows live and dead processes', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(deadPid())).toBe(false);
    for (const v of [0, -1, 1.5, NaN, '123', null, undefined]) expect(isProcessAlive(v)).toBe(false);
  });
});

describe('recoverStaleOverlays (the dev server died mid-run)', () => {
  it('never touches the journal of a process that is still running (another dev server mid-run)', () => {
    put(server, FIX, 'original\n');
    put(workspace, FIX, 'pr\n');
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX] });

    recoverStaleOverlays(); // run by "another dev server" while this overlay's owner (us) is alive

    expect(read(server, FIX)).toBe('pr\n');
    expect(existsSync(manifest.journalDir)).toBe(true);
    restoreOverlay(manifest);
  });

  it('restores the server checkout from a leftover journal', () => {
    put(server, FIX, 'original\n');
    put(workspace, FIX, 'pr\n');
    put(workspace, CASS, 'new cassette');
    const before = snapshot(server);
    const { manifest } = applyOverlay({ workspaceDir: workspace, serverRoot: server, files: [FIX, CASS] });
    expect(read(server, FIX)).toBe('pr\n'); // ...and now the owning process "crashes": no restore is called
    crashOwnedBy(manifest.journalDir, deadPid());

    const recovered = recoverStaleOverlays();

    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(snapshot(server)).toEqual(before);
    expect(existsSync(manifest.journalDir)).toBe(false);
  });

  it('ignores folders that are not valid journals', () => {
    const junk = mkdtempSync(join(tmpdir(), 'review-overlay-'));
    writeFileSync(join(junk, 'manifest.json'), '{not json');
    const other = mkdtempSync(join(tmpdir(), 'review-overlay-'));
    writeFileSync(join(other, 'manifest.json'), JSON.stringify({ pid: deadPid(), journalDir: '/somewhere/else', entries: [] }));
    expect(() => recoverStaleOverlays()).not.toThrow();
    expect(existsSync(junk)).toBe(true);
    rmSync(junk, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });
});
