import { describe, it, expect, vi } from 'vitest';
import {
  AcliError,
  SEARCH_FIELDS,
  VIEW_FIELDS,
  REVIEWER_FIELD,
  APPROVAL_FIELD,
  REVIEW_INFO_FIELD,
  APPROVAL_OPTION_IDS,
  MAX_REVIEW_INFO_CHARS,
  REVIEW_EDIT_DIR_PREFIX,
  assertReviewEditPayload,
  buildReviewPayload,
  fromAdf,
  parseApproval,
  toAdf,
  assertAllowedAcliCommand,
  createJiraClient,
  listReviewJql,
  oneReviewTicketJql,
  parseIssues,
} from './acli';
import type { AcliResult, AcliRunner } from './acli';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const settings = { reviewStatus: 'Review', doneStatus: 'Done' };
const ok = (stdout = '[]'): AcliResult => ({ code: 0, stdout, stderr: '' });

const search = (jql: string, fields = SEARCH_FIELDS) => ['jira', 'workitem', 'search', '--jql', jql, '--fields', fields, '--limit', '100', '--json'];
const view = (key: string, fields = VIEW_FIELDS) => ['jira', 'workitem', 'view', key, '--fields', fields, '--json'];
const transition = (key: string, status = 'Done') => ['jira', 'workitem', 'transition', '--key', key, '--status', status, '--yes'];

describe('AT-only guard rail: assertAllowedAcliCommand', () => {
  it('allows exactly the two permitted operations', () => {
    expect(() => assertAllowedAcliCommand(search(listReviewJql('Review')), settings)).not.toThrow();
    expect(() => assertAllowedAcliCommand(search(oneReviewTicketJql('AT-727', 'Review')), settings)).not.toThrow();
    expect(() => assertAllowedAcliCommand(transition('AT-727'), settings)).not.toThrow();
    expect(() => assertAllowedAcliCommand(view('AT-728'), settings)).not.toThrow();
    expect(() => assertAllowedAcliCommand(transition('AT-1', 'Completed'), { ...settings, doneStatus: 'Completed' })).not.toThrow();
  });

  it.each([
    ['another Jira project', search('project = "APP" AND status = "Review" ORDER BY updated DESC')],
    ['the manual-testing project', search('project = "MT" AND status = "Review" ORDER BY updated DESC')],
    ['all projects', search('status = "Review"')],
    ['a different column', search('project = "AT" AND status = "Done" ORDER BY updated DESC')],
    ['free-form JQL appended', search('project = "AT" AND status = "Review" OR project = "APP" ORDER BY updated DESC')],
    ['JQL that widens via a second clause', search('project = "AT" AND status = "Review" ORDER BY updated DESC; project = APP')],
    ['a key from another project', search('key = "APP-1" AND status = "Review"')],
    ['several keys in a read', search('key = "AT-1,APP-2" AND status = "Review"')],
    ['an OR on the key', search('key = "AT-1" OR key = "APP-2" AND status = "Review"')],
    ['a filter id', ['jira', 'workitem', 'search', '--filter', '10001', '--fields', SEARCH_FIELDS, '--limit', '100', '--json']],
    ['extra fields', search(listReviewJql('Review'), 'key,summary,customfield_10550')],
    ['a bigger limit', ['jira', 'workitem', 'search', '--jql', listReviewJql('Review'), '--fields', SEARCH_FIELDS, '--limit', '5000', '--json']],
    ['a trailing extra flag', [...search(listReviewJql('Review')), '--web']],
  ])('blocks a search with %s', (_name, args) => {
    expect(() => assertAllowedAcliCommand(args, settings)).toThrow(/AT-only guard rail/);
  });

  it.each([
    ['another project ticket', transition('APP-123')],
    ['an MT ticket', transition('MT-5')],
    ['several keys', transition('AT-1,AT-2')],
    ['AT key plus another', transition('AT-1,APP-2')],
    ['a key with whitespace', transition('AT-1 ')],
    ['a lowercase key', transition('at-1')],
    ['a JQL instead of a key', ['jira', 'workitem', 'transition', '--jql', 'project = AT', '--status', 'Done', '--yes']],
    ['a filter instead of a key', ['jira', 'workitem', 'transition', '--filter', '10001', '--status', 'Done', '--yes']],
    ['moving it back to In Progress', transition('AT-1', 'In Progress')],
    ['moving it to a column other than done', transition('AT-1', 'Review')],
    ['a status that merely contains Done', transition('AT-1', 'Done; rm -rf')],
    ['ignoring errors', [...transition('AT-1'), '--ignore-errors']],
    ['a missing --yes', ['jira', 'workitem', 'transition', '--key', 'AT-1', '--status', 'Done']],
  ])('blocks a transition with %s', (_name, args) => {
    expect(() => assertAllowedAcliCommand(args, settings)).toThrow(/AT-only guard rail/);
  });

  it.each([
    ['delete a work item', ['jira', 'workitem', 'delete', '--key', 'AT-1', '--yes']],
    ['edit a work item', ['jira', 'workitem', 'edit', '--key', 'AT-1', '--summary', 'x']],
    ['create a work item', ['jira', 'workitem', 'create', '--project', 'AT', '--summary', 'x', '--type', 'Task']],
    ['comment', ['jira', 'workitem', 'comment', 'create', '--key', 'AT-1', '--body', 'x']],
    ['assign', ['jira', 'workitem', 'assign', '--key', 'AT-1', '--assignee', 'x']],
    ['view a work item', ['jira', 'workitem', 'view', 'AT-1']],
    ['list projects', ['jira', 'project', 'list']],
    ['log out', ['auth', 'logout']],
    ['log in', ['auth', 'login']],
    ['confluence', ['confluence', 'space', 'list']],
    ['no arguments', []],
  ])('blocks any other acli command: %s', (_name, args) => {
    expect(() => assertAllowedAcliCommand(args, settings)).toThrow(AcliError);
  });

  it('rejects non-string arguments', () => {
    expect(() => assertAllowedAcliCommand(['jira', 5 as unknown as string], settings)).toThrow(/invalid arguments/);
  });
});

describe('AT-only guard rail: reading one ticket (view)', () => {
  it('uses the AT board\'s real field ids', () => {
    expect(REVIEWER_FIELD).toBe('customfield_10550');
    expect(APPROVAL_FIELD).toBe('customfield_10650');
    expect(REVIEW_INFO_FIELD).toBe('customfield_10652');
    expect(APPROVAL_OPTION_IDS).toEqual({ approved: '10478', declined: '10479' });
    expect(VIEW_FIELDS).toBe('key,summary,status,assignee,customfield_10550,customfield_10650,customfield_10652');
  });

  it.each([
    ['another project ticket', view('APP-1')],
    ['an MT ticket', view('MT-5')],
    ['several keys', view('AT-1,AT-2')],
    ['AT key plus another', view('AT-1 APP-2')],
    ['a lowercase key', view('at-1')],
    ['a key with trailing text', view('AT-1; rm -rf /')],
    ['all fields', view('AT-1', '*all')],
    ['other fields', view('AT-1', 'key,description,comment')],
    ['an extra custom field', view('AT-1', `${VIEW_FIELDS},customfield_10000`)],
    ['no --json', ['jira', 'workitem', 'view', 'AT-1', '--fields', VIEW_FIELDS]],
    ['--web', ['jira', 'workitem', 'view', 'AT-1', '--web']],
    ['a trailing flag', [...view('AT-1'), '--web']],
    ['no key', ['jira', 'workitem', 'view', '--fields', VIEW_FIELDS, '--json']],
  ])('blocks a view with %s', (_name, args) => {
    expect(() => assertAllowedAcliCommand(args, settings)).toThrow(/AT-only guard rail/);
  });
});

describe('createJiraClient', () => {
  const review = (key: string, status = 'Review') => ({ key, fields: { summary: `Summary ${key}`, status: { name: status }, assignee: { displayName: 'Brian' } } });

  it('refuses to be built for any project other than AT, or any other target status', () => {
    expect(() => createJiraClient('APP', settings)).toThrow(/restricted to the AT project/);
    expect(() => createJiraClient('MT', settings)).toThrow(/restricted to the AT project/);
    expect(() => createJiraClient('AT', { ...settings, doneStatus: 'In Progress' })).toThrow(/Done or Completed/);
    expect(() => createJiraClient('AT', { ...settings, reviewStatus: 'Review"; DROP' })).toThrow(/JIRA_REVIEW_STATUS/);
  });

  it('lists the review column with the one fixed AT query', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify([review('AT-727'), review('AT-726')])));
    const issues = await createJiraClient('AT', { ...settings, baseUrl: 'https://x.atlassian.net/' }, run).listReviewIssues();

    expect(run).toHaveBeenCalledExactlyOnceWith(search('project = "AT" AND status = "Review" ORDER BY updated DESC'));
    expect(issues).toEqual([
      { key: 'AT-727', summary: 'Summary AT-727', status: 'Review', assignee: 'Brian', reviewers: [], approval: null, reviewInfo: '', url: 'https://x.atlassian.net/browse/AT-727' },
      { key: 'AT-726', summary: 'Summary AT-726', status: 'Review', assignee: 'Brian', reviewers: [], approval: null, reviewInfo: '', url: 'https://x.atlassian.net/browse/AT-726' },
    ]);
  });

  it('drops anything that is not an AT ticket even if acli returned it', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify([review('APP-1'), review('AT-9'), review('MT-3'), { nokey: true }])));
    const issues = await createJiraClient('AT', settings, run).listReviewIssues();
    expect(issues.map((i) => i.key)).toEqual(['AT-9']);
  });

  it('moves a ticket to done only after confirming it is still in review', async () => {
    const run = vi
      .fn<AcliRunner>()
      .mockResolvedValueOnce(ok(JSON.stringify([review('AT-727')])))
      .mockResolvedValueOnce(ok(''));
    await createJiraClient('AT', settings, run).moveReviewIssueToDone('AT-727');

    expect(run.mock.calls.map((c) => c[0])).toEqual([search('key = "AT-727" AND status = "Review"'), transition('AT-727')]);
  });

  it('leaves a ticket alone when it is no longer in review', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValueOnce(ok('[]'));
    await expect(createJiraClient('AT', settings, run).moveReviewIssueToDone('AT-727')).rejects.toThrow(/not in "Review" any more/);
    expect(run).toHaveBeenCalledTimes(1); // never reached the transition
  });

  it('refuses to move non-AT tickets and never spawns anything', async () => {
    const run = vi.fn<AcliRunner>();
    const jira = createJiraClient('AT', settings, run);
    for (const key of ['APP-1', 'MT-1', 'AT-1,AT-2', 'AT-1; x', '']) {
      await expect(jira.moveReviewIssueToDone(key)).rejects.toThrow(/not a AT ticket key/);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('turns acli failures into actionable messages', async () => {
    const fail = (stderr: string, stdout = ''): AcliRunner => vi.fn().mockResolvedValue({ code: 1, stdout, stderr });
    await expect(createJiraClient('AT', settings, fail('✗ Error: unauthorized: use \'acli auth login\'')).listReviewIssues()).rejects.toThrow(/acli auth login/);
    await expect(createJiraClient('AT', settings, fail('ENOENT spawn acli ENOENT')).listReviewIssues()).rejects.toThrow(/was not found/);
    await expect(createJiraClient('AT', settings, fail('boom happened')).listReviewIssues()).rejects.toThrow(/Reading the review column from Jira failed: boom happened/);
    await expect(createJiraClient('AT', settings, fail('')).listReviewIssues()).rejects.toThrow(/failed\.$/);

    const move = vi
      .fn<AcliRunner>()
      .mockResolvedValueOnce(ok(JSON.stringify([review('AT-1')])))
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'transition not available' });
    await expect(createJiraClient('AT', settings, move).moveReviewIssueToDone('AT-1')).rejects.toThrow(/Moving AT-1 to Done failed: transition not available/);
  });

  it('rejects output that is not JSON', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValue(ok('not json'));
    await expect(createJiraClient('AT', settings, run).listReviewIssues()).rejects.toThrow(/expected JSON/);
  });
});

describe('findReviewIssue (read one ticket with its Reviewer)', () => {
  const issue = (over: Record<string, unknown> = {}) => ({
    key: 'AT-728',
    fields: { summary: 'Add coverage', status: { name: 'Review' }, assignee: { displayName: 'Brian Baggs' }, customfield_10550: { displayName: 'Matthew Carabin' }, ...over },
  });

  it('reads the ticket with one call and returns the single Reviewer', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify(issue())));
    const found = await createJiraClient('AT', { ...settings, baseUrl: 'https://x.atlassian.net' }, run).findReviewIssue('AT-728');

    expect(run).toHaveBeenCalledExactlyOnceWith(view('AT-728'));
    expect(found).toEqual({ key: 'AT-728', summary: 'Add coverage', status: 'Review', assignee: 'Brian Baggs', reviewers: ['Matthew Carabin'], approval: null, reviewInfo: '', url: 'https://x.atlassian.net/browse/AT-728' });
  });

  it('also understands the older multi-user form, an unset reviewer, and an unassigned ticket', async () => {
    const multi = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify(issue({ customfield_10550: [{ displayName: 'A' }, { displayName: 'B' }] }))));
    expect((await createJiraClient('AT', settings, multi).findReviewIssue('AT-728'))?.reviewers).toEqual(['A', 'B']);
    const none = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify(issue({ customfield_10550: null, assignee: null }))));
    const found = await createJiraClient('AT', settings, none).findReviewIssue('AT-728');
    expect(found).toMatchObject({ reviewers: [], assignee: null });
    const missing = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify({ key: 'AT-728', fields: { summary: 'x', status: { name: 'Review' } } })));
    expect((await createJiraClient('AT', settings, missing).findReviewIssue('AT-728'))?.reviewers).toEqual([]);
  });

  it('returns null for a ticket that is not in the review column', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify(issue({ status: { name: 'In Progress' } }))));
    expect(await createJiraClient('AT', settings, run).findReviewIssue('AT-728')).toBeNull();
  });

  it('matches the review column name case-insensitively', async () => {
    const run = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify(issue({ status: { name: 'review' } }))));
    expect(await createJiraClient('AT', settings, run).findReviewIssue('AT-728')).not.toBeNull();
  });

  it('returns null when Jira says the ticket does not exist, but surfaces real failures', async () => {
    const gone = vi.fn<AcliRunner>().mockResolvedValue({ code: 1, stdout: '', stderr: 'Issue does not exist or you do not have permission to see it.' });
    expect(await createJiraClient('AT', settings, gone).findReviewIssue('AT-999')).toBeNull();
    const auth = vi.fn<AcliRunner>().mockResolvedValue({ code: 1, stdout: '', stderr: "unauthorized: use 'acli auth login'" });
    await expect(createJiraClient('AT', settings, auth).findReviewIssue('AT-728')).rejects.toMatchObject({ kind: 'not-authenticated' });
    const boom = vi.fn<AcliRunner>().mockResolvedValue({ code: 1, stdout: '', stderr: 'boom' });
    await expect(createJiraClient('AT', settings, boom).findReviewIssue('AT-728')).rejects.toThrow(/Reading AT-728 from Jira failed/);
  });

  it('rejects output that is not JSON, and an issue with the wrong key', async () => {
    await expect(createJiraClient('AT', settings, vi.fn<AcliRunner>().mockResolvedValue(ok('nope'))).findReviewIssue('AT-728')).rejects.toThrow(/expected JSON/);
    const other = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify(issue({}) && { key: 'AT-1', fields: { status: { name: 'Review' } } })));
    expect(await createJiraClient('AT', settings, other).findReviewIssue('AT-728')).toBeNull();
    const array = vi.fn<AcliRunner>().mockResolvedValue(ok(JSON.stringify([issue()])));
    expect(await createJiraClient('AT', settings, array).findReviewIssue('AT-728')).not.toBeNull();
  });

  it('never spawns anything for a key outside the AT project', async () => {
    const run = vi.fn<AcliRunner>();
    for (const key of ['APP-1', 'MT-2', 'AT-1,AT-2', '']) {
      await expect(createJiraClient('AT', settings, run).findReviewIssue(key)).rejects.toThrow(/not a AT ticket key/);
    }
    expect(run).not.toHaveBeenCalled();
  });
});

describe('acli errors never leak a credential', () => {
  it('redacts tokens and credentialed URLs from the failure message', async () => {
    const leak = ['ATA', 'TT3xFfGF0abcdefghijklmnop12345'].join('');
    const run = vi.fn<AcliRunner>().mockResolvedValue({ code: 1, stdout: '', stderr: `request to ${['https:', '//u:', 'pw123', '@x.atlassian.net'].join('')} failed with token=${leak}` });
    const err = await createJiraClient('AT', settings, run).listReviewIssues().catch((e) => e);
    expect(err).toBeInstanceOf(AcliError);
    expect(err.message).not.toContain(leak);
    expect(err.message).not.toContain('pw123');
    expect(err.message).toContain('[redacted]');
  });
});

describe('parseIssues', () => {
  it('accepts an { issues: [] } wrapper, string statuses and missing fields', () => {
    const out = parseIssues(JSON.stringify({ issues: [{ key: 'AT-5', status: 'Review' }] }), { reviewStatus: 'Review' });
    expect(out).toEqual([{ key: 'AT-5', summary: '', status: 'Review', assignee: null, reviewers: [], approval: null, reviewInfo: '', url: null }]);
    expect(parseIssues('{}', { reviewStatus: 'Review' })).toEqual([]);
  });
});

describe('AT-only guard rail: recording a review decision (edit)', () => {
  const edit = (file: string, extra: string[] = []) => ['jira', 'workitem', 'edit', '--from-json', file, '--yes', ...extra];
  const writeEdit = (payload: unknown): string => {
    const dir = mkdtempSync(REVIEW_EDIT_DIR_PREFIX);
    const file = join(dir, 'edit.json');
    writeFileSync(file, JSON.stringify(payload));
    return file;
  };
  const adf = (text: string) => toAdf(text);

  it('allows exactly the payloads buildReviewPayload makes', () => {
    for (const payload of [
      buildReviewPayload('AT-726', 'approved'),
      buildReviewPayload('AT-726', 'declined', 'Missing a cleanup step\nand a tag'),
      buildReviewPayload('AT-726', 'none'),
      buildReviewPayload('AT-726', 'approved', 'LGTM'),
    ]) {
      expect(() => assertAllowedAcliCommand(edit(writeEdit(payload)), settings)).not.toThrow();
    }
  });

  it('builds the payload with the real field ids and option ids', () => {
    expect(buildReviewPayload('AT-1', 'approved')).toEqual({ issues: ['AT-1'], customfield_10650: [{ id: '10478' }] });
    expect(buildReviewPayload('AT-1', 'declined', 'why')).toEqual({ issues: ['AT-1'], customfield_10650: [{ id: '10479' }], customfield_10652: toAdf('why') });
    expect(buildReviewPayload('AT-1', 'none')).toEqual({ issues: ['AT-1'], customfield_10650: [] });
  });

  it.each([
    ['another project ticket', { issues: ['APP-1'], customfield_10650: [{ id: '10478' }] }],
    ['several tickets', { issues: ['AT-1', 'AT-2'], customfield_10650: [{ id: '10478' }] }],
    ['no tickets', { issues: [], customfield_10650: [{ id: '10478' }] }],
    ['a key with trailing text', { issues: ['AT-1; rm'], customfield_10650: [{ id: '10478' }] }],
    ['a JQL instead of keys', { jql: 'project = AT', customfield_10650: [{ id: '10478' }] }],
    ['the summary', { issues: ['AT-1'], customfield_10650: [{ id: '10478' }], summary: 'hacked' }],
    ['the assignee', { issues: ['AT-1'], assignee: 'someone', customfield_10650: [{ id: '10478' }] }],
    ['the description', { issues: ['AT-1'], description: adf('x'), customfield_10650: [{ id: '10478' }] }],
    ['another custom field', { issues: ['AT-1'], customfield_10550: [{ accountId: 'x' }] }],
    ['the type', { issues: ['AT-1'], type: 'Bug', customfield_10650: [{ id: '10478' }] }],
    ['labels', { issues: ['AT-1'], labelsToAdd: ['x'], customfield_10650: [{ id: '10478' }] }],
    ['nothing to edit', { issues: ['AT-1'] }],
    ['an unknown approval option', { issues: ['AT-1'], customfield_10650: [{ id: '99999' }] }],
    ['both approval options', { issues: ['AT-1'], customfield_10650: [{ id: '10478' }, { id: '10479' }] }],
    ['approval as a string', { issues: ['AT-1'], customfield_10650: 'Approved' }],
    ['approval option with extra keys', { issues: ['AT-1'], customfield_10650: [{ id: '10478', value: 'x' }] }],
    ['review info as a plain string', { issues: ['AT-1'], customfield_10652: 'text' }],
    ['review info with a non-paragraph node', { issues: ['AT-1'], customfield_10652: { type: 'doc', version: 1, content: [{ type: 'codeBlock', content: [] }] } }],
    ['review info with a link mark/attrs', { issues: ['AT-1'], customfield_10652: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:1' } }] }] }] } }],
    ['review info with an extra node key', { issues: ['AT-1'], customfield_10652: { type: 'doc', version: 1, content: [{ type: 'paragraph', attrs: { a: 1 }, content: [] }], extra: 1 } }],
    ['review info that is empty', { issues: ['AT-1'], customfield_10652: { type: 'doc', version: 1, content: [] } }],
    ['review info that is too long', { issues: ['AT-1'], customfield_10652: adf('x'.repeat(MAX_REVIEW_INFO_CHARS + 1)) }],
    ['a non-object file', ['AT-1']],
    ['null', null],
  ])('blocks an edit payload with %s', (_name, payload) => {
    expect(() => assertReviewEditPayload(payload)).toThrow(/AT-only guard rail/);
    expect(() => assertAllowedAcliCommand(edit(writeEdit(payload)), settings)).toThrow(/AT-only guard rail/);
  });

  it('blocks an edit file that is not the app\'s own private temp file', () => {
    mkdirSync(join(tmpdir(), 'elsewhere-guard'), { recursive: true });
    const elsewhere = join(tmpdir(), 'elsewhere-guard', 'edit.json');
    writeFileSync(elsewhere, JSON.stringify(buildReviewPayload('AT-1', 'approved')));
    for (const file of [elsewhere, '/etc/passwd', `${REVIEW_EDIT_DIR_PREFIX}abc/../../../etc/passwd`, `${REVIEW_EDIT_DIR_PREFIX}abc/other.json`, `${REVIEW_EDIT_DIR_PREFIX}abc/sub/edit.json`, `${REVIEW_EDIT_DIR_PREFIX}/edit.json`, '', 'edit.json']) {
      expect(() => assertAllowedAcliCommand(edit(file), settings), file).toThrow(/AT-only guard rail/);
    }
  });

  it('blocks a missing or unreadable edit file', () => {
    expect(() => assertAllowedAcliCommand(edit(`${REVIEW_EDIT_DIR_PREFIX}doesnotexist/edit.json`), settings)).toThrow(/could not be read/);
    const dir = mkdtempSync(REVIEW_EDIT_DIR_PREFIX);
    writeFileSync(join(dir, 'edit.json'), '{not json');
    expect(() => assertAllowedAcliCommand(edit(join(dir, 'edit.json')), settings)).toThrow(/could not be read/);
  });

  it.each([
    ['inline fields instead of a file', ['jira', 'workitem', 'edit', '--key', 'AT-1', '--summary', 'x']],
    ['a JQL', ['jira', 'workitem', 'edit', '--jql', 'project = AT', '--from-json', 'x', '--yes']],
    ['a missing --yes', ['jira', 'workitem', 'edit', '--from-json', 'x']],
    ['--ignore-errors', ['jira', 'workitem', 'edit', '--from-json', 'x', '--yes', '--ignore-errors']],
    ['an extra flag', [...edit('x'), '--assignee', 'someone']],
    ['--generate-json', ['jira', 'workitem', 'edit', '--generate-json']],
  ])('blocks edit with %s', (_n, args) => {
    expect(() => assertAllowedAcliCommand(args, settings)).toThrow(/AT-only guard rail/);
  });
});

describe('Approval / Review Information parsing', () => {
  it('reads the Approval checkboxes (Declined wins, so it can never unlock a merge)', () => {
    expect(parseApproval([{ value: 'Approved', id: '10478' }])).toBe('approved');
    expect(parseApproval([{ value: 'Declined', id: '10479' }])).toBe('declined');
    expect(parseApproval([{ value: 'Approved', id: '10478' }, { value: 'Declined', id: '10479' }])).toBe('declined');
    expect(parseApproval([{ id: '10478' }])).toBe('approved');
    expect(parseApproval({ value: 'Approved' })).toBe('approved');
    expect(parseApproval(['Approved'])).toBe('approved');
    for (const none of [null, undefined, [], [{ value: 'Something else' }], 'x', 5]) expect(parseApproval(none)).toBeNull();
  });

  it('converts text to ADF paragraphs and back', () => {
    expect(toAdf('one\n\nthree')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
      ],
    });
    expect(fromAdf(toAdf('one\n\nthree'))).toBe('one\n\nthree');
    expect(fromAdf('plain string')).toBe('plain string');
    expect(fromAdf(null)).toBe('');
    expect(fromAdf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] })).toBe('ab');
  });

  it('parses approval and review information from a ticket', () => {
    const out = parseIssues(
      JSON.stringify([{ key: 'AT-726', fields: { summary: 's', status: { name: 'Review' }, customfield_10650: [{ value: 'Declined', id: '10479' }], customfield_10652: toAdf('Needs a cleanup step\nand a tag') } }]),
      { reviewStatus: 'Review' },
    );
    expect(out[0]).toMatchObject({ approval: 'declined', reviewInfo: 'Needs a cleanup step\nand a tag' });
  });
});

describe('submitReview (record a decision, then read it back)', () => {
  type View = { approval?: 'approved' | 'declined' | null; info?: string; status?: string };
  const view = (key: string, v: View = {}) => ({
    key,
    fields: {
      summary: 'Add coverage',
      status: { name: v.status ?? 'Review' },
      customfield_10650: v.approval === 'approved' ? [{ value: 'Approved', id: '10478' }] : v.approval === 'declined' ? [{ value: 'Declined', id: '10479' }] : [],
      customfield_10652: v.info ? toAdf(v.info) : null,
    },
  });

  /** A fake acli: the first view is "before", the edit applies the payload it was given, later views are "after". */
  function fakeAcli(opts: { applyEdit?: boolean; editResult?: AcliResult; statusBefore?: string } = {}) {
    let state: View = { approval: null, info: '', status: opts.statusBefore ?? 'Review' };
    const edits: Array<{ args: string[]; payload: Record<string, unknown>; fileExistedDuringRun: boolean }> = [];
    const run = vi.fn<AcliRunner>(async (args) => {
      if (args[2] === 'view') return ok(JSON.stringify(view(args[3], state)));
      if (args[2] === 'edit') {
        const payload = JSON.parse(readFileSync(args[4], 'utf8'));
        edits.push({ args, payload, fileExistedDuringRun: existsSync(args[4]) });
        if (opts.editResult) return opts.editResult;
        if (opts.applyEdit !== false) {
          const a = payload.customfield_10650 as Array<{ id: string }> | undefined;
          if (a) state = { ...state, approval: a.length === 0 ? null : a[0].id === '10478' ? 'approved' : 'declined' };
          if (payload.customfield_10652) state = { ...state, info: fromAdf(payload.customfield_10652) };
        }
        return ok('');
      }
      return ok('[]');
    });
    return { run, edits };
  }

  it('approves: sends exactly the approval payload, then verifies it by reading the ticket back', async () => {
    const { run, edits } = fakeAcli();
    const issue = await createJiraClient('AT', settings, run).submitReview('AT-726', 'approved');

    expect(edits).toHaveLength(1);
    expect(edits[0].payload).toEqual({ issues: ['AT-726'], customfield_10650: [{ id: '10478' }] });
    expect(edits[0].args.slice(0, 4)).toEqual(['jira', 'workitem', 'edit', '--from-json']);
    expect(edits[0].args[5]).toBe('--yes');
    expect(issue.approval).toBe('approved');
    expect(run.mock.calls.map((c) => c[0][2])).toEqual(['view', 'edit', 'view']);
  });

  it('declines with review information (multi-line) and reads both back', async () => {
    const { run, edits } = fakeAcli();
    const issue = await createJiraClient('AT', settings, run).submitReview('AT-726', 'declined', '  Missing a cleanup step.\r\nAlso tag it @critical.  ');

    expect(edits[0].payload).toEqual({ issues: ['AT-726'], customfield_10650: [{ id: '10479' }], customfield_10652: toAdf('Missing a cleanup step.\nAlso tag it @critical.') });
    expect(issue).toMatchObject({ approval: 'declined', reviewInfo: 'Missing a cleanup step.\nAlso tag it @critical.' });
  });

  it('can clear the decision (and leaves the review text alone when none is given)', async () => {
    const { run, edits } = fakeAcli();
    const client = createJiraClient('AT', settings, run);
    await client.submitReview('AT-726', 'approved', 'LGTM');
    await client.submitReview('AT-726', 'none');
    expect(edits[1].payload).toEqual({ issues: ['AT-726'], customfield_10650: [] });
    expect('customfield_10652' in edits[1].payload).toBe(false);
  });

  it('removes its temporary file, even though it only exists while acli runs', async () => {
    const { run, edits } = fakeAcli();
    await createJiraClient('AT', settings, run).submitReview('AT-726', 'approved');
    expect(edits[0].fileExistedDuringRun).toBe(true);
    expect(existsSync(edits[0].args[4])).toBe(false);
    expect(existsSync(join(edits[0].args[4], '..'))).toBe(false);
  });

  it('removes its temporary file when acli fails', async () => {
    const { run, edits } = fakeAcli({ editResult: { code: 1, stdout: '', stderr: 'boom' } });
    await expect(createJiraClient('AT', settings, run).submitReview('AT-726', 'approved')).rejects.toThrow(/Saving the review on AT-726 failed: boom/);
    expect(existsSync(edits[0].args[4])).toBe(false);
  });

  it('refuses a ticket that is not in the review column, without editing anything', async () => {
    const { run } = fakeAcli({ statusBefore: 'In Progress' });
    await expect(createJiraClient('AT', settings, run).submitReview('AT-726', 'approved')).rejects.toThrow(/not in "Review" any more/);
    expect(run.mock.calls.some((c) => c[0][2] === 'edit')).toBe(false);
  });

  it('reports a change that did not stick instead of claiming success', async () => {
    const { run } = fakeAcli({ applyEdit: false });
    await expect(createJiraClient('AT', settings, run).submitReview('AT-726', 'approved')).rejects.toThrow(/Jira did not save the review on AT-726.*directly/);
  });

  it('explains when acli cannot set these fields, with the manual fallback', async () => {
    const { run } = fakeAcli({ editResult: { code: 1, stdout: '', stderr: 'json: unknown field "customfield_10650"' } });
    await expect(createJiraClient('AT', settings, run).submitReview('AT-726', 'approved')).rejects.toThrow(/can't set these Jira fields.*Set Approval and Review Information on AT-726 in Jira instead/);
  });

  it('refuses review text over the limit and keys outside AT, before spawning anything', async () => {
    const run = vi.fn<AcliRunner>();
    const client = createJiraClient('AT', settings, run);
    await expect(client.submitReview('APP-1', 'approved')).rejects.toThrow(/not a AT ticket key/);
    expect(run).not.toHaveBeenCalled();
    const { run: run2 } = fakeAcli();
    await expect(createJiraClient('AT', settings, run2).submitReview('AT-726', 'declined', 'x'.repeat(MAX_REVIEW_INFO_CHARS + 1))).rejects.toThrow(/limited to 5000/);
    expect(run2.mock.calls.some((c) => c[0][2] === 'edit')).toBe(false);
  });

  it('strips NUL characters and ignores empty review text', async () => {
    const { run, edits } = fakeAcli();
    await createJiraClient('AT', settings, run).submitReview('AT-726', 'approved', '   ');
    expect('customfield_10652' in edits[0].payload).toBe(false);
    await createJiraClient('AT', settings, run).submitReview('AT-726', 'declined', 'bad\0text');
    expect(fromAdf(edits[1].payload.customfield_10652)).toBe('badtext');
  });
});
