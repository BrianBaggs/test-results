import { execFile } from 'node:child_process';

/**
 * The ONLY place this app talks to Jira, via the already-authenticated
 * Atlassian CLI (`acli`).
 *
 * GUARD RAIL — the QA team's rule: nothing outside the AT project is ever
 * touched, and the only things this code may do are:
 *
 *   1. READ which AT work items are in the review column
 *        acli jira workitem search  (project = "AT" AND status = "Review")
 *   2. MOVE one AT work item that is currently in the review column to done
 *        acli jira workitem transition --key AT-### --status Done --yes
 *      (the caller only does this after the branch was rebased and merged)
 *
 * It is enforced at the lowest layer: every argv handed to `acli` passes
 * `assertAllowedAcliCommand`, which accepts exactly those two shapes and
 * nothing else — no other subcommand, no other project, no multiple keys, no
 * free-form JQL, no other target status. Anything else throws before a
 * process is spawned. Do not loosen this; see server/acli.test.ts.
 */

/** The one Jira project this app may read or change. */
export const ALLOWED_PROJECT = 'AT';
/** The only statuses a ticket may be moved to. */
export const ALLOWED_DONE_STATUSES = ['Done', 'Completed'] as const;

export interface AcliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type AcliRunner = (args: string[]) => Promise<AcliResult>;

export const defaultAcliRunner: AcliRunner = (args) =>
  new Promise((resolve) => {
    execFile('acli', args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ code: 0, stdout, stderr });
        return;
      }
      const numeric = typeof (err as NodeJS.ErrnoException).code === 'number';
      resolve({
        code: numeric ? Number((err as NodeJS.ErrnoException).code) : 1,
        stdout,
        // ENOENT / timeout carry a string code; keep the reason visible.
        stderr: numeric ? stderr : `${stderr}${(err as NodeJS.ErrnoException).code ?? ''} ${err.message}`,
      });
    });
  });

export interface JiraSettings {
  /** Status (board column) name that means "ready for review". */
  reviewStatus: string;
  /** Status the ticket is moved to after its branch is merged: Done or Completed. */
  doneStatus: string;
  /** Site URL, only used to build "open in Jira" links. */
  baseUrl?: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  url: string | null;
}

export type AcliErrorKind = 'not-installed' | 'not-authenticated' | 'blocked' | 'failed';

export class AcliError extends Error {
  kind: AcliErrorKind;
  constructor(message: string, kind: AcliErrorKind = 'failed') {
    super(message);
    this.name = 'AcliError';
    this.kind = kind;
  }
}

const STATUS_NAME_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/;
const TICKET_KEY_RE = new RegExp(`^${ALLOWED_PROJECT}-\\d{1,7}$`);
/** Standard fields only — acli rejects custom fields, and nothing else is needed. */
export const SEARCH_FIELDS = 'key,summary,status,assignee';

const isDoneStatus = (s: string) => ALLOWED_DONE_STATUSES.some((d) => d.toLowerCase() === s.toLowerCase());

export function listReviewJql(reviewStatus: string): string {
  return `project = "${ALLOWED_PROJECT}" AND status = "${reviewStatus}" ORDER BY updated DESC`;
}

export function oneReviewTicketJql(key: string, reviewStatus: string): string {
  return `key = "${key}" AND status = "${reviewStatus}"`;
}

const blocked = (why: string) => new AcliError(`Blocked by the AT-only guard rail: ${why}`, 'blocked');

/**
 * Throws unless `args` is exactly one of the two permitted acli invocations.
 * Everything is compared against rebuilt strings, never pattern-searched, so
 * nothing can ride along inside an argument.
 */
export function assertAllowedAcliCommand(args: string[], settings: Pick<JiraSettings, 'reviewStatus' | 'doneStatus'>): void {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw blocked('invalid arguments.');
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

  if (args[0] === 'jira' && args[1] === 'workitem' && args[2] === 'search') {
    // acli jira workitem search --jql <JQL> --fields <F> --limit 100 --json
    const jql = args[4];
    const okShape = args.length === 10 && eq([args[3], args[5], args[6], args[7], args[8], args[9]], ['--jql', '--fields', SEARCH_FIELDS, '--limit', '100', '--json']);
    if (!okShape) throw blocked('unexpected search arguments.');
    if (jql === listReviewJql(settings.reviewStatus)) return;
    const m = /^key = "([^"]+)" AND status = "[^"]+"$/.exec(jql);
    if (m && TICKET_KEY_RE.test(m[1]) && jql === oneReviewTicketJql(m[1], settings.reviewStatus)) return;
    throw blocked(`only AT tickets in "${settings.reviewStatus}" may be read.`);
  }

  if (args[0] === 'jira' && args[1] === 'workitem' && args[2] === 'transition') {
    // acli jira workitem transition --key AT-### --status Done --yes
    const key = args[4];
    const okShape = args.length === 8 && eq([args[3], args[5], args[7]], ['--key', '--status', '--yes']);
    if (!okShape) throw blocked('unexpected transition arguments.');
    if (!TICKET_KEY_RE.test(key)) throw blocked(`${key} is not a single ${ALLOWED_PROJECT} ticket.`);
    if (args[6] !== settings.doneStatus || !isDoneStatus(args[6])) {
      throw blocked(`tickets may only be moved to ${ALLOWED_DONE_STATUSES.join(' or ')}.`);
    }
    return;
  }

  throw blocked(`"acli ${args.slice(0, 3).join(' ')}" is not allowed.`);
}

function explain(r: AcliResult, what: string): AcliError {
  const text = `${r.stderr}\n${r.stdout}`;
  if (/ENOENT/.test(r.stderr)) {
    return new AcliError('The Atlassian CLI (acli) was not found. Install it and make sure `acli` is on your PATH.', 'not-installed');
  }
  if (/unauthori[sz]ed|not logged in|auth login|401/i.test(text)) {
    return new AcliError("acli isn't logged in to Jira. Run `acli auth login` in a terminal, then refresh.", 'not-authenticated');
  }
  const detail = text.trim().split('\n').filter(Boolean).slice(0, 3).join(' ');
  return new AcliError(`${what} failed${detail ? `: ${detail}` : '.'}`);
}

function asName(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as { displayName?: unknown; name?: unknown };
    if (typeof o.displayName === 'string') return o.displayName;
    if (typeof o.name === 'string') return o.name;
  }
  return null;
}

/**
 * acli's --json is an array of work items with values under `fields`.
 * Anything that isn't an AT-### key is dropped (defence in depth).
 */
export function parseIssues(stdout: string, settings: Pick<JiraSettings, 'reviewStatus' | 'baseUrl'>): JiraIssue[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new AcliError('Could not read the output of `acli jira workitem search` (expected JSON).');
  }
  const rows = Array.isArray(data) ? data : Array.isArray((data as { issues?: unknown })?.issues) ? (data as { issues: unknown[] }).issues : [];

  const base = settings.baseUrl?.replace(/\/+$/, '') ?? null;
  const out: JiraIssue[] = [];
  for (const row of rows) {
    const r = row as { key?: unknown; fields?: Record<string, unknown> } & Record<string, unknown>;
    if (typeof r?.key !== 'string' || !TICKET_KEY_RE.test(r.key)) continue;
    const f: Record<string, unknown> = { ...r, ...(r.fields ?? {}) };
    out.push({
      key: r.key,
      summary: typeof f.summary === 'string' ? f.summary : '',
      status: asName(f.status) ?? settings.reviewStatus,
      assignee: asName(f.assignee),
      url: base ? `${base}/browse/${r.key}` : null,
    });
  }
  return out;
}

export function createJiraClient(projectKey: string, settings: JiraSettings, rawRun: AcliRunner = defaultAcliRunner) {
  if (projectKey !== ALLOWED_PROJECT) {
    throw new Error(`Jira access is restricted to the ${ALLOWED_PROJECT} project; "${projectKey}" is not allowed.`);
  }
  if (!STATUS_NAME_RE.test(settings.reviewStatus)) {
    throw new Error('JIRA_REVIEW_STATUS may only contain letters, numbers, spaces, "_" and "-".');
  }
  if (!isDoneStatus(settings.doneStatus)) {
    throw new Error(`JIRA_DONE_STATUS must be ${ALLOWED_DONE_STATUSES.join(' or ')}.`);
  }

  // Every command, whoever builds it, goes through the guard first.
  const run: AcliRunner = async (args) => {
    assertAllowedAcliCommand(args, settings);
    return rawRun(args);
  };

  async function search(jql: string): Promise<JiraIssue[]> {
    const r = await run(['jira', 'workitem', 'search', '--jql', jql, '--fields', SEARCH_FIELDS, '--limit', '100', '--json']);
    if (r.code !== 0) throw explain(r, 'Reading the review column from Jira');
    return parseIssues(r.stdout, settings);
  }

  /** Read-only: the one AT ticket with this key, if (and only if) it is in the review column. */
  async function findInReview(key: string): Promise<JiraIssue | null> {
    if (!TICKET_KEY_RE.test(key)) throw new AcliError(`"${key}" is not a ${ALLOWED_PROJECT} ticket key.`);
    const found = await search(oneReviewTicketJql(key, settings.reviewStatus));
    return found.find((i) => i.key === key) ?? null;
  }

  return {
    findReviewIssue: findInReview,

    /** Operation 1 (read-only): AT tickets currently in the review column. */
    listReviewIssues(): Promise<JiraIssue[]> {
      return search(listReviewJql(settings.reviewStatus));
    },

    /**
     * Operation 2: move one AT ticket from the review column to done. Re-checks
     * right now that the ticket is still in the review column, so it can never
     * move a ticket that's anywhere else on the board.
     */
    async moveReviewIssueToDone(key: string): Promise<void> {
      const current = await findInReview(key);
      if (!current) {
        throw new AcliError(`${key} is not in "${settings.reviewStatus}" any more, so it was left where it is.`);
      }
      const r = await run(['jira', 'workitem', 'transition', '--key', key, '--status', settings.doneStatus, '--yes']);
      if (r.code !== 0) throw explain(r, `Moving ${key} to ${settings.doneStatus}`);
    },
  };
}

export type JiraClient = ReturnType<typeof createJiraClient>;
