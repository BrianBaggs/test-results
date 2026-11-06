import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GUARD RAIL for every `git` command the Review tab runs.
 *
 * The QA team's rule: the only things this app may DO with git are
 *
 *   - CHECK OUT   an AT-### branch (into a throw-away temp worktree),
 *   - REBASE      it onto the base branch (in that temp worktree), and
 *   - MERGE       i.e. fast-forward the base branch to the rebased result
 *                 (a plain, non-force push of `<sha>:refs/heads/<base>`),
 *
 * and only for tickets whose branch starts with `AT-`. After a successful merge
 * it may also DELETE that same AT-### branch — only that branch, only if the
 * remote still points at the exact commit that was reviewed (a lease), and
 * never the base branch or any non-AT branch. Alongside those it may
 * run the read-only commands needed to *look at* branches (rev-parse, for-each-ref,
 * rev-list, merge-base --is-ancestor, cherry, log, diff, merge-tree, remote get-url) and `fetch`, which
 * only refreshes remote-tracking refs. Nothing else — no force push, no branch
 * deletion, no reset/commit/stash/config, no other branches or remotes — is
 * reachable: every argv must match one of the shapes below exactly, or it
 * throws before a process is spawned. `gh` is never run at all.
 *
 * Do not loosen this; see server/gitGuard.test.ts.
 */

/** Base branches that may never be a merge target, even if configured. */
export const FORBIDDEN_BASE_BRANCHES = ['master', 'main', 'release-next', 'develop', 'development', 'production', 'staging'];

/** Prefix of every temp worktree this app creates (mkdtemp appends random chars). */
export const TEMP_WORKTREE_PREFIX = join(tmpdir(), 'review-merge-');

export interface GitGuardContext {
  remote: string;
  baseBranch: string;
  /** Ticket/branch prefix that may be acted on, e.g. `AT`. */
  projectKey: string;
}

export class GitGuardError extends Error {
  constructor(message: string) {
    super(`Blocked by the git guard rail: ${message}`);
    this.name = 'GitGuardError';
  }
}

const SAFE_REF_CHARS = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA40 = /^[0-9a-f]{40}$/;

export function isTempWorktree(path: string): boolean {
  return path.startsWith(TEMP_WORKTREE_PREFIX) && !path.includes('..') && !/[\s;&|$`<>\\]/.test(path.slice(TEMP_WORKTREE_PREFIX.length));
}

export function createGitGuard(ctx: GitGuardContext) {
  const keyEsc = ctx.projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `AT-123`, `AT-123-anything` or `AT-123/anything` — never `AT-123abc` or `at-123`.
  const ticketBranch = new RegExp(`^${keyEsc}-\\d+(?:[-/].*)?$`);
  const baseRef = `${ctx.remote}/${ctx.baseBranch}`;

  /** `origin/AT-123-whatever` — the only branches that may be touched. */
  const isTicketRef = (ref: string): boolean => {
    if (!ref.startsWith(`${ctx.remote}/`)) return false;
    const branch = ref.slice(ctx.remote.length + 1);
    return SAFE_REF_CHARS.test(branch) && !branch.includes('..') && ticketBranch.test(branch);
  };
  const isRef = (ref: string): boolean => ref === baseRef || isTicketRef(ref) || SHA40.test(ref) || ref === 'HEAD';

  const stripCommit = (r: string) => (r.endsWith('^{commit}') ? r.slice(0, -'^{commit}'.length) : r);
  const isRange = (spec: string, sep: '..' | '...'): boolean => {
    const parts = spec.split(sep);
    return parts.length === 2 && parts[0] !== '' && !parts[1].startsWith('.') && isRef(parts[0]) && isRef(parts[1]);
  };

  const deny = (why: string): never => {
    throw new GitGuardError(why);
  };

  return function assertAllowedGitCommand(args: string[], cwd: string): void {
    if (!Array.isArray(args) || args.length === 0 || args.some((a) => typeof a !== 'string')) deny('invalid arguments.');
    const [cmd, ...rest] = args;
    const is = (...expected: string[]) => rest.length === expected.length && expected.every((e, i) => rest[i] === e);
    const ok = (cond: boolean, why: string) => (cond ? undefined : deny(why));

    switch (cmd) {
      // ------------------------------------------------------------ read-only
      case 'rev-parse':
        if (is('--is-inside-work-tree') || is('HEAD')) return;
        if (rest.length === 3 && rest[0] === '--verify' && rest[1] === '--quiet' && isRef(stripCommit(rest[2]))) return;
        return deny('rev-parse is only allowed on the base branch or an AT branch.');

      case 'remote':
        return ok(is('get-url', ctx.remote), `only "git remote get-url ${ctx.remote}" is allowed.`);

      case 'fetch':
        // Refreshes remote-tracking refs only; never touches local branches.
        return ok(is('--prune', '--quiet', ctx.remote), `only "git fetch --prune --quiet ${ctx.remote}" is allowed.`);

      case 'for-each-ref':
        return ok(rest.length === 2 && rest[0].startsWith('--format=') && rest[1] === `refs/remotes/${ctx.remote}/`, 'for-each-ref is only allowed over the remote-tracking branches.');

      case 'rev-list':
        if (rest.length === 3 && rest[0] === '--left-right' && rest[1] === '--count' && isRange(rest[2], '...')) return;
        if (rest.length === 2 && rest[0] === '--count' && isRange(rest[1], '..')) return;
        if (rest.length === 3 && rest[0] === '--merges' && rest[1] === '--count' && isRange(rest[2], '..')) return; // "is this history a straight line?"
        return deny('rev-list is only allowed between the base branch and an AT branch (or HEAD).');

      case 'merge-base':
        // Read-only ancestry check (is the base tip underneath the rebased commits?). It creates nothing.
        return ok(is('--is-ancestor', baseRef, 'HEAD'), `only "git merge-base --is-ancestor ${baseRef} HEAD" is allowed.`);

      case 'cherry':
        return ok(rest.length === 2 && rest.every(isRef), 'cherry is only allowed between the base branch and an AT branch.');

      case 'log':
        return ok(
          rest.length === 4 && rest[0] === '--reverse' && rest[1] === '--max-count=200' && rest[2].startsWith('--format=') && isRange(rest[3], '..'),
          'log is only allowed over base..AT-branch.',
        );

      case 'diff':
        if (rest.length === 5 && rest[0] === '-M' && rest[1] === '--no-color' && rest[2] === '--no-ext-diff' && rest[3] === '--no-textconv' && isRange(rest[4], '...')) return;
        if (rest.length === 2 && rest[0] === '--shortstat' && isRange(rest[1], '...')) return; // `git diff --stat` summary for the list
        if (is('--name-only', '--diff-filter=U')) return; // conflicted files during a rebase
        return deny('diff is only allowed between the base branch and an AT branch.');

      case 'merge-tree':
        // Dry-run conflict check; writes objects only, never refs or files.
        return ok(
          rest.length === 5 && rest[0] === '--write-tree' && rest[1] === '--name-only' && rest[2] === '--no-messages' && rest[3] === baseRef && isTicketRef(rest[4]),
          'merge-tree is only allowed for the base branch vs an AT branch.',
        );

      // ------------------------------------------------- CHECKOUT (temp only)
      case 'worktree':
        if (rest.length === 5 && rest[0] === 'add' && rest[1] === '--detach' && rest[2] === '--quiet' && isTempWorktree(rest[3]) && isTicketRef(rest[4])) return;
        if (rest.length === 3 && rest[0] === 'remove' && rest[1] === '--force' && isTempWorktree(rest[2])) return; // cleanup of our own temp dir
        if (is('prune')) return;
        return deny('worktree is only allowed to check out an AT branch into a temp directory, and to clean that directory up.');

      // ------------------------------------------------------------- REBASE
      case 'rebase':
        ok(isTempWorktree(cwd), 'rebase only runs inside the temporary worktree.');
        if (is(baseRef) || is('--abort')) return;
        return deny(`rebase is only allowed onto ${baseRef}.`);

      // -------------------------------------------- MERGE (fast-forward push)
      case 'push': {
        ok(isTempWorktree(cwd), 'push only runs from the temporary worktree.');
        // Exactly: git push <remote> <40-hex>:refs/heads/<base>. No --force,
        // no +refspec, no --delete, no other branch, no other remote.
        if (rest.length === 2 && rest[0] === ctx.remote) {
          const [sha, dest] = rest[1].split(':');
          if (SHA40.test(sha ?? '') && dest === `refs/heads/${ctx.baseBranch}` && rest[1].split(':').length === 2) return;
        }
        // Exactly: git push <remote> --force-with-lease=refs/heads/<AT-branch>:<40-hex> --delete <AT-branch>
        // The lease makes the delete a no-op unless the remote branch is still
        // at the reviewed commit; the branch must be an AT-### ticket branch.
        if (rest.length === 4 && rest[0] === ctx.remote && rest[2] === '--delete') {
          const m = /^--force-with-lease=refs\/heads\/(.+):([0-9a-f]{40})$/.exec(rest[1]);
          const branch = rest[3];
          if (m && m[1] === branch && branch !== ctx.baseBranch && isTicketRef(`${ctx.remote}/${branch}`)) return;
        }
        return deny(`push is only allowed as a plain fast-forward of ${ctx.baseBranch}, or deleting the reviewed ${ctx.projectKey}-### branch.`);
      }

      default:
        return deny(`"git ${cmd}" is not allowed.`);
    }
  };
}

