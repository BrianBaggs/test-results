import { constants, copyFileSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A temporary checkout of a PR only contains what git tracks. The Playwright specs
 * also import a few files that are generated (and gitignored) in a normal
 * securicy-app checkout: `app/javascript/routes.js` (made by js-routes) is imported
 * by `spec/playwright/playwright/support/playwright_routes.ts`, so without it every
 * spec fails with "Cannot find module .../app/javascript/routes".
 *
 * Those files are copied from the user's own checkout. This is an exact allowlist,
 * never "everything that is ignored": the same checkout holds Rails secrets
 * (config/master.key, credentials, database.yml) which must never be copied anywhere.
 */
export const GENERATED_FILES: ReadonlyArray<{ path: string; required: boolean }> = [
  { path: 'app/javascript/routes.js', required: true },
  // types only: Playwright strips them, but keep the copy consistent for editors and tsc
  { path: 'app/javascript/routes.d.ts', required: false },
];

/** `routes.js` is about 1 MB; anything wildly bigger is not what we expect to be copying. */
const MAX_BYTES = 8 * 1024 * 1024;

export const GENERATE_ROUTES_COMMAND = 'bundle exec rails js:routes';

export class GeneratedFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeneratedFilesError';
  }
}

/**
 * Copies the generated files into the temporary checkout, looking in `roots` in order
 * (the test server's checkout first, then the reviewed repo). Returns what was copied.
 * A file the PR itself tracks is left alone, a symlink is never followed, and a
 * required file that cannot be found is an error that says how to create it.
 */
export function copyGeneratedFiles(opts: { workspaceDir: string; roots: string[] }): string[] {
  const roots = [...new Set(opts.roots)];
  const copied: string[] = [];

  for (const { path, required } of GENERATED_FILES) {
    const dest = join(opts.workspaceDir, path);
    if (existsSync(dest)) continue; // the PR carries its own copy

    let source: string | null = null;
    const refused: string[] = [];
    for (const root of roots) {
      const candidate = join(root, path);
      let stat;
      try {
        stat = lstatSync(candidate);
      } catch {
        continue; // not in this checkout
      }
      if (stat.isSymbolicLink()) refused.push(`${candidate} is a symlink; refusing to copy it.`);
      else if (!stat.isFile()) refused.push(`${candidate} is not a regular file.`);
      else if (stat.size > MAX_BYTES) refused.push(`${candidate} is unexpectedly large (${Math.round(stat.size / 1024 / 1024)} MB); refusing to copy it.`);
      else {
        source = candidate;
        break;
      }
    }

    if (!source) {
      if (!required) continue;
      if (refused.length > 0) throw new GeneratedFilesError(refused.join(' '));
      throw new GeneratedFilesError(
        `${path} was not found in your securicy-app checkout (${roots[0]}). The specs import it, and it is generated rather than committed. ` +
          `Run \`${GENERATE_ROUTES_COMMAND}\` there, then run the specs again.`,
      );
    }

    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest, constants.COPYFILE_EXCL); // never overwrites
    copied.push(path);
  }
  return copied;
}
