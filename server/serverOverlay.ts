import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

/**
 * Specs rely on fixtures and VCR cassettes that the Rails TEST SERVER reads from
 * ITS OWN checkout (`spec/fixtures`, `spec/playwright/playwright/fixtures/…`),
 * not from the spec files. To run a PR's specs faithfully, the PR's added or
 * changed fixture/cassette DATA files are copied into the server's checkout for
 * the duration of the run and then restored byte-for-byte.
 *
 * Safety model:
 *  - only plain data files (.yml/.yaml/.json) under two allowlisted folders —
 *    never Ruby, never anything else (changed Ruby support files are reported,
 *    not copied);
 *  - sources must be regular files (no symlinks), size-capped; destinations must
 *    stay inside the server checkout (no `..`, no symlink escapes) and must be
 *    regular files if they already exist;
 *  - every original is backed up (0700 temp dir) before it is replaced, and a
 *    manifest is written after every step so a crash can be recovered;
 *  - restore only touches a file if it still holds exactly what we wrote, so
 *    edits you make during a run are never clobbered.
 */

export const OVERLAY_ALLOW: RegExp[] = [
  /^spec\/fixtures\/.+\.(?:ya?ml|json)$/,
  /^spec\/playwright\/playwright\/fixtures\/.+\.(?:ya?ml|json)$/,
];

/** Changed files that run INSIDE the server — reported to the user, never copied. */
const SERVER_CODE_PATHS: RegExp[] = [
  /^spec\/playwright\/playwright\/app_commands\//,
  /^spec\/playwright\/playwright\/e2e_helper\.rb$/,
  /^(?:app|lib|config|db)\//,
  /^Gemfile(?:\.lock)?$/,
];

const MAX_OVERLAY_FILE_BYTES = 5 * 1024 * 1024;
const MAX_OVERLAY_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_OVERLAY_FILES = 500;
export const OVERLAY_JOURNAL_PREFIX = join(tmpdir(), 'review-overlay-');

export interface ChangedFile {
  path: string;
  status: 'added' | 'deleted' | 'renamed' | 'modified';
}

export interface OverlayPlan {
  /** Data files to copy into the server checkout. */
  copy: string[];
  /** Changed files that execute inside the server and are NOT copied. */
  serverCodeChanged: string[];
}

interface OverlayEntry {
  rel: string;
  existed: boolean;
  /** Path of the backup of the original bytes (when `existed`). */
  backup: string | null;
  /** sha256 of what we wrote, to detect later edits by the user. */
  writtenHash: string;
}

export interface OverlayManifest {
  /** The process that owns this overlay: only a dead owner's journal is ever recovered. */
  pid: number;
  serverRoot: string;
  journalDir: string;
  entries: OverlayEntry[];
  /** Directories we had to create (removed again if left empty). */
  createdDirs: string[];
}

export interface OverlayResult {
  manifest: OverlayManifest;
  skipped: string[];
}

export interface RestoreResult {
  restored: number;
  /** Files left alone because they changed while the run was in progress. */
  warnings: string[];
}

export class OverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayError';
  }
}

export function isSafeRelPath(rel: unknown): rel is string {
  return (
    typeof rel === 'string' &&
    rel.length > 0 &&
    rel.length <= 300 &&
    !isAbsolute(rel) &&
    !rel.includes('\0') &&
    !rel.includes('\\') &&
    normalize(rel) === rel &&
    !rel.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

export function planOverlay(changed: ChangedFile[]): OverlayPlan {
  const copy: string[] = [];
  const serverCodeChanged: string[] = [];
  for (const f of changed) {
    if (f.status === 'deleted' || !isSafeRelPath(f.path)) continue; // never delete anything in the server checkout
    if (OVERLAY_ALLOW.some((re) => re.test(f.path))) copy.push(f.path);
    else if (SERVER_CODE_PATHS.some((re) => re.test(f.path))) serverCodeChanged.push(f.path);
  }
  return { copy, serverCodeChanged };
}

const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function isInside(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

function persist(m: OverlayManifest) {
  writeFileSync(join(m.journalDir, 'manifest.json'), JSON.stringify(m), { mode: 0o600 });
}

/** Copy the planned data files from the PR workspace into the server checkout. */
export function applyOverlay(opts: { workspaceDir: string; serverRoot: string; files: string[] }): OverlayResult {
  const { workspaceDir, serverRoot, files } = opts;
  if (files.length > MAX_OVERLAY_FILES) throw new OverlayError(`This PR changes ${files.length} fixture/cassette files; the limit is ${MAX_OVERLAY_FILES}.`);
  let realServerRoot: string;
  try {
    realServerRoot = realpathSync(serverRoot);
  } catch {
    throw new OverlayError(`The test server checkout was not found at ${serverRoot}. Set REVIEW_SERVER_REPO_PATH in your .env file.`);
  }

  const journalDir = mkdtempSync(OVERLAY_JOURNAL_PREFIX);
  chmodSync(journalDir, 0o700);
  const manifest: OverlayManifest = { pid: process.pid, serverRoot: realServerRoot, journalDir, entries: [], createdDirs: [] };
  persist(manifest);
  const skipped: string[] = [];
  let total = 0;

  try {
    for (const rel of files) {
      if (!isSafeRelPath(rel) || !OVERLAY_ALLOW.some((re) => re.test(rel))) throw new OverlayError(`Refusing to copy "${rel}": not an allowed fixture/cassette data file.`);

      const src = join(workspaceDir, rel);
      const sst = lstatSync(src, { throwIfNoEntry: false });
      if (!sst) throw new OverlayError(`"${rel}" is missing from the PR checkout.`);
      if (!sst.isFile()) throw new OverlayError(`Refusing to copy "${rel}": not a regular file (symlinks are never followed).`);
      if (sst.size > MAX_OVERLAY_FILE_BYTES) throw new OverlayError(`"${rel}" is larger than ${MAX_OVERLAY_FILE_BYTES / 1024 / 1024} MB.`);
      total += sst.size;
      if (total > MAX_OVERLAY_TOTAL_BYTES) throw new OverlayError(`The PR's fixture/cassette files exceed ${MAX_OVERLAY_TOTAL_BYTES / 1024 / 1024} MB in total.`);
      const bytes = readFileSync(src);

      const dst = join(realServerRoot, rel);
      if (!isInside(realServerRoot, dst)) throw new OverlayError(`Refusing to write outside the test server checkout: ${rel}`);

      // No symlink escapes: the deepest existing parent must really live inside the checkout.
      let probe = dirname(dst);
      while (!existsSync(probe) && probe !== realServerRoot) probe = dirname(probe);
      if (!isInside(realServerRoot, realpathSync(probe))) throw new OverlayError(`Refusing to write through a symlink: ${rel}`);

      const dstat = lstatSync(dst, { throwIfNoEntry: false });
      let backup: string | null = null;
      if (dstat) {
        if (!dstat.isFile()) throw new OverlayError(`"${rel}" exists in the test server checkout but is not a regular file.`);
        const original = readFileSync(dst);
        if (original.equals(bytes)) {
          skipped.push(rel); // already identical — nothing to do, nothing to restore
          continue;
        }
        backup = join(journalDir, `backup-${manifest.entries.length}`);
        writeFileSync(backup, original, { mode: 0o600 });
      } else {
        // remember which directories we create so they can be removed again
        const missing: string[] = [];
        for (let d = dirname(dst); !existsSync(d) && isInside(realServerRoot, d) && d !== realServerRoot; d = dirname(d)) missing.push(d);
        mkdirSync(dirname(dst), { recursive: true });
        manifest.createdDirs.push(...missing.reverse());
      }

      manifest.entries.push({ rel, existed: !!dstat, backup, writtenHash: sha(bytes) });
      persist(manifest); // before writing: a crash mid-write is still recoverable
      writeFileSync(dst, bytes);
    }
  } catch (err) {
    restoreOverlay(manifest); // never leave a half-applied overlay behind
    throw err;
  }
  return { manifest, skipped };
}

/** Put the server checkout back exactly as it was. Synchronous so it can run on process exit. */
export function restoreOverlay(manifest: OverlayManifest): RestoreResult {
  const warnings: string[] = [];
  let restored = 0;
  for (const entry of [...manifest.entries].reverse()) {
    const target = join(manifest.serverRoot, entry.rel);
    try {
      const current = lstatSync(target, { throwIfNoEntry: false });
      if (!current) {
        if (entry.existed && entry.backup && existsSync(entry.backup)) {
          writeFileSync(target, readFileSync(entry.backup)); // it was removed during the run; bring it back
          restored++;
        }
        continue;
      }
      if (!current.isFile() || sha(readFileSync(target)) !== entry.writtenHash) {
        warnings.push(`${entry.rel} changed while the specs were running, so it was left as it is.`);
        continue;
      }
      if (entry.existed && entry.backup) writeFileSync(target, readFileSync(entry.backup));
      else unlinkSync(target);
      restored++;
    } catch (err) {
      warnings.push(`Could not restore ${entry.rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const dir of [...manifest.createdDirs].reverse()) {
    try {
      if (isInside(manifest.serverRoot, dir) && readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // already gone or not empty — fine
    }
  }
  // Only discard the backups once every restore succeeded; otherwise keep them.
  if (warnings.length === 0 || warnings.every((w) => w.includes('changed while'))) rmSync(manifest.journalDir, { recursive: true, force: true });
  return { restored, warnings };
}

export function isProcessAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, but not ours to signal
  }
}

/**
 * If the dev server died mid-run, a journal is left in the temp folder. On
 * startup, finish the restore so the checkout is never left modified — but
 * only for journals whose owning process is gone, never another live server's.
 */
export function recoverStaleOverlays(tmp: string = tmpdir()): number {
  let recovered = 0;
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith('review-overlay-')) continue;
    const dir = join(tmp, name);
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as OverlayManifest;
      if (!manifest || manifest.journalDir !== dir || !Array.isArray(manifest.entries)) continue;
      // Another dev server may be mid-run right now; only a DEAD owner's journal is stale.
      if (isProcessAlive(manifest.pid)) continue;
      restoreOverlay(manifest);
      rmSync(dir, { recursive: true, force: true });
      recovered++;
    } catch {
      // not ours / unreadable — leave it alone
    }
  }
  return recovered;
}
