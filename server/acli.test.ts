import { describe, it, expect, vi } from 'vitest';
import {
  AcliError,
  SEARCH_FIELDS,
  assertAllowedAcliCommand,
  createJiraClient,
  listReviewJql,
  oneReviewTicketJql,
  parseIssues,
} from './acli';
import type { AcliResult, AcliRunner } from './acli';

const settings = { reviewStatus: 'Review', doneStatus: 'Done' };
const ok = (stdout = '[]'): AcliResult => ({ code: 0, stdout, stderr: '' });

const search = (jql: string, fields = SEARCH_FIELDS) => ['jira', 'workitem', 'search', '--jql', jql, '--fields', fields, '--limit', '100', '--json'];
const transition = (key: string, status = 'Done') => ['jira', 'workitem', 'transition', '--key', key, '--status', status, '--yes'];

describe('AT-only guard rail: assertAllowedAcliCommand', () => {
  it('allows exactly the two permitted operations', () => {
    expect(() => assertAllowedAcliCommand(search(listReviewJql('Review')), settings)).not.toThrow();
    expect(() => assertAllowedAcliCommand(search(oneReviewTicketJql('AT-727', 'Review')), settings)).not.toThrow();
    expect(() => assertAllowedAcliCommand(transition('AT-727'), settings)).not.toThrow();
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
      { key: 'AT-727', summary: 'Summary AT-727', status: 'Review', assignee: 'Brian', url: 'https://x.atlassian.net/browse/AT-727' },
      { key: 'AT-726', summary: 'Summary AT-726', status: 'Review', assignee: 'Brian', url: 'https://x.atlassian.net/browse/AT-726' },
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

describe('parseIssues', () => {
  it('accepts an { issues: [] } wrapper, string statuses and missing fields', () => {
    const out = parseIssues(JSON.stringify({ issues: [{ key: 'AT-5', status: 'Review' }] }), { reviewStatus: 'Review' });
    expect(out).toEqual([{ key: 'AT-5', summary: '', status: 'Review', assignee: null, url: null }]);
    expect(parseIssues('{}', { reviewStatus: 'Review' })).toEqual([]);
  });
});
