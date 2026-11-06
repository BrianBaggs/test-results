import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATED_FILES, GENERATE_ROUTES_COMMAND, GeneratedFilesError, copyGeneratedFiles } from './generatedFiles';

let root: string;
let workspace: string;
let checkout: string;
let other: string;

const put = (base: string, rel: string, content: string) => {
  mkdirSync(join(base, rel, '..'), { recursive: true });
  writeFileSync(join(base, rel), content);
};
const ROUTES = 'app/javascript/routes.js';
const TYPES = 'app/javascript/routes.d.ts';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'generated-files-test-'));
  workspace = join(root, 'workspace');
  checkout = join(root, 'checkout');
  other = join(root, 'other');
  for (const d of [workspace, checkout, other]) mkdirSync(d);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the allowlist', () => {
  it('is exactly the generated routes module and its types, nothing else', () => {
    expect(GENERATED_FILES.map((f) => f.path)).toEqual([ROUTES, TYPES]);
    expect(GENERATED_FILES.filter((f) => f.required).map((f) => f.path)).toEqual([ROUTES]);
  });

  it('never contains anything that looks like a secret or Rails config', () => {
    for (const { path } of GENERATED_FILES) expect(path).not.toMatch(/master\.key|credentials|database|\.env|secret|config\//i);
  });
});

describe('copyGeneratedFiles', () => {
  it('copies both files into the workspace and reports them', () => {
    put(checkout, ROUTES, 'routes');
    put(checkout, TYPES, 'types');
    expect(copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] })).toEqual([ROUTES, TYPES]);
    expect(readFileSync(join(workspace, ROUTES), 'utf8')).toBe('routes');
    expect(readFileSync(join(workspace, TYPES), 'utf8')).toBe('types');
  });

  it('copies nothing else from the checkout, even when it holds secrets', () => {
    put(checkout, ROUTES, 'routes');
    put(checkout, 'config/master.key', 'private');
    put(checkout, 'config/database.yml', 'private');
    put(checkout, '.env', 'private');
    copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] });
    for (const rel of ['config/master.key', 'config/database.yml', '.env', 'config']) expect(existsSync(join(workspace, rel))).toBe(false);
  });

  it('takes each file from the first root that has it', () => {
    put(checkout, ROUTES, 'first');
    put(other, ROUTES, 'second');
    put(other, TYPES, 'types from the second');
    copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout, other] });
    expect(readFileSync(join(workspace, ROUTES), 'utf8')).toBe('first');
    expect(readFileSync(join(workspace, TYPES), 'utf8')).toBe('types from the second');
  });

  it('the same folder listed twice is just one folder', () => {
    put(checkout, ROUTES, 'routes');
    expect(copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout, checkout] })).toEqual([ROUTES]);
  });

  it('leaves a file the PR already carries alone (never overwrites)', () => {
    put(checkout, ROUTES, 'from the checkout');
    put(workspace, ROUTES, 'from the PR');
    expect(copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] })).toEqual([]);
    expect(readFileSync(join(workspace, ROUTES), 'utf8')).toBe('from the PR');
  });

  it('routes.d.ts is optional', () => {
    put(checkout, ROUTES, 'routes');
    expect(copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] })).toEqual([ROUTES]);
    expect(existsSync(join(workspace, TYPES))).toBe(false);
  });

  it('a missing routes.js is an error that names the file, the folder and the command that creates it', () => {
    let error: unknown;
    try {
      copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout, other] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GeneratedFilesError);
    const message = (error as Error).message;
    expect(message).toContain(ROUTES);
    expect(message).toContain(checkout);
    expect(message).toContain(GENERATE_ROUTES_COMMAND);
    expect(GENERATE_ROUTES_COMMAND).toBe('bundle exec rails js:routes');
    expect(existsSync(join(workspace, ROUTES))).toBe(false);
  });

  it('refuses a symlink and does not fall through to a different, later folder silently when it was the only match', () => {
    writeFileSync(join(root, 'target.js'), 'elsewhere');
    mkdirSync(join(checkout, 'app/javascript'), { recursive: true });
    symlinkSync(join(root, 'target.js'), join(checkout, ROUTES));
    expect(() => copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] })).toThrow(/symlink/);
    expect(existsSync(join(workspace, ROUTES))).toBe(false);
  });

  it('skips a symlinked copy in the first folder when a later folder has a real file', () => {
    writeFileSync(join(root, 'target.js'), 'elsewhere');
    mkdirSync(join(checkout, 'app/javascript'), { recursive: true });
    symlinkSync(join(root, 'target.js'), join(checkout, ROUTES));
    put(other, ROUTES, 'the real one');
    copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout, other] });
    expect(readFileSync(join(workspace, ROUTES), 'utf8')).toBe('the real one');
  });

  it('refuses something that is not a regular file', () => {
    mkdirSync(join(checkout, ROUTES), { recursive: true });
    expect(() => copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] })).toThrow(/not a regular file/);
  });

  it('refuses an unexpectedly huge file', () => {
    put(checkout, ROUTES, 'x'.repeat(9 * 1024 * 1024));
    expect(() => copyGeneratedFiles({ workspaceDir: workspace, roots: [checkout] })).toThrow(/unexpectedly large/);
  });
});
