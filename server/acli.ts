import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets } from './redact.ts';

/**
 * The ONLY place this app talks to Jira, via the already-authenticated
 * Atlassian CLI (`acli`).
 *
 * GUARD RAIL — the QA team's rule: nothing outside the AT project is ever
 * touched, and the only things this code may do are:
 *
 *   1. READ which AT work items are in the review column
 *        acli jira workitem search  (project = "AT" AND status = "Review")
 *   2. READ one AT work item (its summary, status, assignee and Reviewer)
 *        acli jira workitem view AT-### --fields key,summary,status,assignee,customfield_10550 --json
 *   3. RECORD A REVIEW DECISION on one AT work item that is in the review column:
 *      set its Approval checkboxes (Approved / Declined) and its Review Information text
 *        acli jira workitem edit --from-json <private temp file> --yes
 *      (the guard reads that file and accepts only exactly those two fields, for one AT key)
 *   4. MOVE one AT work item that is currently in the review column to done
 *        acli jira workitem transition --key AT-### --status Done --yes
 *      (the caller only does this after the branch was rebased and merged)
 *
 * It is enforced at the lowest layer: every argv handed to `acli` passes
 * `assertAllowedAcliCommand`, which accepts exactly those four shapes and
 * nothing else — no other subcommand, no other project, no multiple keys, no
 * free-form JQL, no other target status. Anything else throws before a
 * process is spawned. Do not loosen this; see server/acli.test.ts.
 */

/** The one Jira project this app may read or change. */
export const ALLOWED_PROJECT = 'AT';
/** The only statuses a ticket may be moved to. */
const ALLOWED_DONE_STATUSES = ['Done', 'Completed'] as const;

export interface AcliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type AcliRunner = (args: string[]) => Promise<AcliResult>;

const defaultAcliRunner: AcliRunner = (args) =>
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
  /** The Reviewer field (empty when unset, or when read via search, which can't return it). */
  reviewers: string[];
  /** The Approval checkboxes: null when neither is ticked. (Both ticked counts as declined.) */
  approval: 'approved' | 'declined' | null;
  /** The Review Information text. */
  reviewInfo: string;
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
/** The AT board's custom "Reviewer" user field. `search --fields` can't return custom fields, `view` can. */
export const REVIEWER_FIELD = 'customfield_10550';
/** The AT board's "Approval" checkboxes (Approved / Declined) and "Review Information" text area. */
export const APPROVAL_FIELD = 'customfield_10650';
export const REVIEW_INFO_FIELD = 'customfield_10652';
export const APPROVAL_OPTION_IDS = { approved: '10478', declined: '10479' } as const;
export const MAX_REVIEW_INFO_CHARS = 5000;
export const REVIEW_EDIT_DIR_PREFIX = join(tmpdir(), 'review-jira-');
export const VIEW_FIELDS = `key,summary,status,assignee,${REVIEWER_FIELD},${APPROVAL_FIELD},${REVIEW_INFO_FIELD}`;

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
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** Plain text -> Atlassian Document Format (what Jira's text-area fields take): one paragraph per line. */
export function toAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

/** The ADF back to plain text (paragraphs joined with newlines). */
export function fromAdf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!isPlainObject(node)) return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  const kids = Array.isArray(node.content) ? node.content.map(fromAdf) : [];
  return node.type === 'doc' ? kids.join('\n') : kids.join('');
}

export type ReviewDecision = 'approved' | 'declined' | 'none';

/** The one edit payload this app may send: one AT ticket, only the Approval and Review Information fields. */
export function buildReviewPayload(key: string, decision: ReviewDecision, info?: string): Record<string, unknown> {
  return {
    issues: [key],
    [APPROVAL_FIELD]: decision === 'none' ? [] : [{ id: APPROVAL_OPTION_IDS[decision] }],
    ...(info !== undefined ? { [REVIEW_INFO_FIELD]: toAdf(info) } : {}),
  };
}

/**
 * Reads the edit file and refuses anything but exactly what buildReviewPayload
 * makes: a single AT key, only the two permitted fields, only the two known
 * option ids, and plain paragraph text of a bounded size.
 */
function assertReviewEditFile(file: string): void {
  const rest = typeof file === 'string' && file.startsWith(REVIEW_EDIT_DIR_PREFIX) ? file.slice(REVIEW_EDIT_DIR_PREFIX.length) : '';
  if (!/^[A-Za-z0-9]+\/edit\.json$/.test(rest) || file.includes('..')) throw blocked('the edit file must be the app\'s own temporary file.');
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw blocked('the edit file could not be read.');
  }
  assertReviewEditPayload(data);
}

/** The content rules, separate from the file so they can be tested (and audited) on their own. */
export function assertReviewEditPayload(data: unknown): void {
  if (!isPlainObject(data)) throw blocked('the edit file must be a JSON object.');
  const allowed = ['issues', APPROVAL_FIELD, REVIEW_INFO_FIELD];
  if (Object.keys(data).some((k) => !allowed.includes(k))) throw blocked('only the Approval and Review Information fields may be edited.');
  if (!Array.isArray(data.issues) || data.issues.length !== 1 || typeof data.issues[0] !== 'string' || !TICKET_KEY_RE.test(data.issues[0])) {
    throw blocked(`exactly one ${ALLOWED_PROJECT} ticket may be edited.`);
  }
  if (!(APPROVAL_FIELD in data) && !(REVIEW_INFO_FIELD in data)) throw blocked('nothing to edit.');
  if (APPROVAL_FIELD in data) {
    const a = data[APPROVAL_FIELD];
    const ids = Object.values(APPROVAL_OPTION_IDS) as string[];
    const ok = Array.isArray(a) && a.length <= 1 && a.every((o) => isPlainObject(o) && sameKeys(o, ['id']) && typeof o.id === 'string' && ids.includes(o.id));
    if (!ok) throw blocked('Approval may only be set to Approved, Declined or cleared.');
  }
  if (REVIEW_INFO_FIELD in data) {
    const doc = data[REVIEW_INFO_FIELD];
    let chars = 0;
    const ok =
      isPlainObject(doc) &&
      sameKeys(doc, ['type', 'version', 'content']) &&
      doc.type === 'doc' &&
      doc.version === 1 &&
      Array.isArray(doc.content) &&
      doc.content.length > 0 &&
      doc.content.every(
        (p) =>
          isPlainObject(p) &&
          p.type === 'paragraph' &&
          Array.isArray(p.content) &&
          p.content.every((t) => {
            const good = isPlainObject(t) && sameKeys(t, ['type', 'text']) && t.type === 'text' && typeof t.text === 'string';
            if (good) chars += (t as { text: string }).text.length;
            return good;
          }),
      );
    if (!ok) throw blocked('Review Information must be plain paragraphs of text.');
    if (chars > MAX_REVIEW_INFO_CHARS) throw blocked(`Review Information is limited to ${MAX_REVIEW_INFO_CHARS} characters.`);
  }
}

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

  if (args[0] === 'jira' && args[1] === 'workitem' && args[2] === 'view') {
    // acli jira workitem view AT-### --fields <VIEW_FIELDS> --json   (read-only, exactly one AT ticket)
    const okShape = args.length === 7 && eq([args[4], args[5], args[6]], ['--fields', VIEW_FIELDS, '--json']);
    if (!okShape) throw blocked('unexpected view arguments.');
    if (!TICKET_KEY_RE.test(args[3])) throw blocked(`${args[3]} is not a single ${ALLOWED_PROJECT} ticket.`);
    return;
  }

  if (args[0] === 'jira' && args[1] === 'workitem' && args[2] === 'edit') {
    // acli jira workitem edit --from-json <private temp file> --yes
    if (args.length !== 6 || args[3] !== '--from-json' || args[5] !== '--yes') throw blocked('unexpected edit arguments.');
    assertReviewEditFile(args[4]);
    return;
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
  const detail = redactSecrets(text.trim().split('\n').filter(Boolean).slice(0, 3).join(' '));
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

/** The Approval checkboxes. Both ticked is treated as declined, so it can never unlock a merge. */
export function parseApproval(v: unknown): 'approved' | 'declined' | null {
  const names = (Array.isArray(v) ? v : v ? [v] : []).map((o) => (typeof o === 'string' ? o : isPlainObject(o) ? String(o.value ?? o.name ?? o.id ?? '') : '').toLowerCase());
  const ids = (Array.isArray(v) ? v : v ? [v] : []).map((o) => (isPlainObject(o) ? String(o.id ?? '') : ''));
  const declined = names.includes('declined') || ids.includes(APPROVAL_OPTION_IDS.declined);
  const approved = names.includes('approved') || ids.includes(APPROVAL_OPTION_IDS.approved);
  return declined ? 'declined' : approved ? 'approved' : null;
}

/** The Reviewer field is a single user (older values may be a list); be liberal about both. */
function asNames(v: unknown): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).map(asName).filter((n): n is string => !!n);
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
      reviewers: asNames(f[REVIEWER_FIELD]),
      approval: parseApproval(f[APPROVAL_FIELD]),
      reviewInfo: fromAdf(f[REVIEW_INFO_FIELD]).trim(),
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

  /** Strict JQL check used right before a transition: exactly this AT ticket, in the review column. */
  async function searchOneInReview(key: string): Promise<JiraIssue | null> {
    if (!TICKET_KEY_RE.test(key)) throw new AcliError(`"${key}" is not a ${ALLOWED_PROJECT} ticket key.`);
    const found = await search(oneReviewTicketJql(key, settings.reviewStatus));
    return found.find((i) => i.key === key) ?? null;
  }

  /**
   * Read-only: one AT ticket, with its Reviewer — but only if it is in the
   * review column right now (else null). One call serves the show page and the
   * pre-merge check.
   */
  async function findInReview(key: string): Promise<JiraIssue | null> {
    if (!TICKET_KEY_RE.test(key)) throw new AcliError(`"${key}" is not a ${ALLOWED_PROJECT} ticket key.`);
    const r = await run(['jira', 'workitem', 'view', key, '--fields', VIEW_FIELDS, '--json']);
    if (r.code !== 0) {
      // a ticket that doesn't exist is "not in Review", not a failure
      if (/does not exist|not found|404|no issue/i.test(`${r.stderr}\n${r.stdout}`) && !/unauthori[sz]ed|auth login/i.test(`${r.stderr}${r.stdout}`)) return null;
      throw explain(r, `Reading ${key} from Jira`);
    }
    let data: unknown;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      throw new AcliError('Could not read the output of `acli jira workitem view` (expected JSON).');
    }
    const issue = parseIssues(JSON.stringify(Array.isArray(data) ? data : [data]), settings).find((i) => i.key === key);
    return issue && issue.status.toLowerCase() === settings.reviewStatus.toLowerCase() ? issue : null;
  }

  /**
   * Record a review decision on one AT ticket that is in the review column,
   * then READ IT BACK: acli's `edit` doesn't document custom-field support, so
   * a change that silently didn't happen is reported instead of assumed.
   */
  async function submitReview(key: string, decision: ReviewDecision, info?: string): Promise<JiraIssue> {
    const current = await findInReview(key);
    if (!current) throw new AcliError(`${key} is not in "${settings.reviewStatus}" any more, so its review was not changed.`);
    const text = info === undefined ? undefined : info.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();
    if (text !== undefined && text.length > MAX_REVIEW_INFO_CHARS) throw new AcliError(`Review information is limited to ${MAX_REVIEW_INFO_CHARS} characters.`);

    const dir = mkdtempSync(REVIEW_EDIT_DIR_PREFIX);
    try {
      chmodSync(dir, 0o700);
      const file = join(dir, 'edit.json');
      writeFileSync(file, JSON.stringify(buildReviewPayload(key, decision, text || undefined)), { mode: 0o600 });
      const r = await run(['jira', 'workitem', 'edit', '--from-json', file, '--yes']);
      if (r.code !== 0) {
        if (/unknown field|not allowed|cannot (?:set|be set)|not on the appropriate screen/i.test(`${r.stderr}${r.stdout}`)) {
          throw new AcliError(
            `Your acli can't set these Jira fields (${redactSecrets(`${r.stderr}${r.stdout}`.trim().split('\n')[0] ?? '')}). Set Approval and Review Information on ${key} in Jira instead.`,
          );
        }
        throw explain(r, `Saving the review on ${key}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const after = await findInReview(key);
    const want = decision === 'none' ? null : decision;
    if (!after || after.approval !== want || (text && after.reviewInfo !== text)) {
      throw new AcliError(`Jira did not save the review on ${key} (the fields are unchanged). Set Approval and Review Information on ${key} in Jira directly.`);
    }
    return after;
  }

  return {
    submitReview,
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
      const current = await searchOneInReview(key);
      if (!current) {
        throw new AcliError(`${key} is not in "${settings.reviewStatus}" any more, so it was left where it is.`);
      }
      const r = await run(['jira', 'workitem', 'transition', '--key', key, '--status', settings.doneStatus, '--yes']);
      if (r.code !== 0) throw explain(r, `Moving ${key} to ${settings.doneStatus}`);
    },
  };
}

export type JiraClient = ReturnType<typeof createJiraClient>;
