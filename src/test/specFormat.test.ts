import { describe, it, expect } from 'vitest';
import { PHASES, classifyLine, formatDuration, groupSupportFiles, isFinished, jobTitle, splitSpecPath, summarize } from '../utils/specFormat';
import { SPEC_A, failedSpecResult, specResult } from './reviewFixtures';

describe('formatDuration', () => {
  it.each([
    [0, '0ms'],
    [450, '450ms'],
    [999, '999ms'],
    [1000, '1.0s'],
    [4200, '4.2s'],
    [59_949, '59.9s'],
    [60_000, '1m 0s'],
    [125_400, '2m 5s'],
    [3_600_000, '60m 0s'],
  ])('formats %i ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('shows a dash for nonsense', () => {
    for (const v of [-1, NaN, Infinity]) expect(formatDuration(v)).toBe('—');
  });
});

describe('splitSpecPath', () => {
  it('drops the shared prefix and separates the folder from the file name', () => {
    expect(splitSpecPath(SPEC_A)).toEqual({ dir: 'tasks/show/admin/', name: 'recurring_comments_completed.spec.ts' });
    expect(splitSpecPath('spec/playwright/playwright/e2e/a.spec.ts')).toEqual({ dir: '', name: 'a.spec.ts' });
    expect(splitSpecPath('other/place/b.spec.ts')).toEqual({ dir: 'other/place/', name: 'b.spec.ts' });
    expect(splitSpecPath('plain.spec.ts')).toEqual({ dir: '', name: 'plain.spec.ts' });
  });
});

describe('summarize', () => {
  it('counts files and tests, treating timeouts and interruptions as failures', () => {
    const results = [
      specResult('a'),
      failedSpecResult('b'),
      specResult('c', { status: 'skipped', tests: [{ title: 't', line: 1, status: 'skipped', durationMs: 0, error: null }] }),
      specResult('d', { status: 'failed', tests: [{ title: 't', line: 1, status: 'timedOut', durationMs: 1, error: null }, { title: 'u', line: 2, status: 'interrupted', durationMs: 1, error: null }] }),
    ];
    expect(summarize(results)).toEqual({ files: 4, filesPassed: 2, filesFailed: 2, tests: 6, passed: 2, failed: 3, skipped: 1 });
  });

  it('is all zeros without results', () => {
    expect(summarize(null)).toEqual({ files: 0, filesPassed: 0, filesFailed: 0, tests: 0, passed: 0, failed: 0, skipped: 0 });
    expect(summarize([])).toEqual(summarize(null));
  });
});

describe('job status helpers', () => {
  it('knows which statuses are final', () => {
    for (const s of ['passed', 'failed', 'cancelled', 'error'] as const) expect(isFinished(s)).toBe(true);
    for (const s of ['preparing', 'syncing', 'running', 'cleaning'] as const) expect(isFinished(s)).toBe(false);
  });

  it('has the four phases, in order, each with a description', () => {
    expect(PHASES.map((p) => p.id)).toEqual(['preparing', 'syncing', 'running', 'cleaning']);
    expect(PHASES.every((p) => p.label && p.detail)).toBe(true);
  });

  it('titles the modal for every state', () => {
    expect(jobTitle(null, true)).toBe('Starting…');
    expect(jobTitle(null, false)).toBe('Specs');
    expect(jobTitle({ status: 'passed' }, false)).toBe('Specs passed');
    expect(jobTitle({ status: 'failed' }, false)).toBe('Specs failed');
    expect(jobTitle({ status: 'cancelled' }, false)).toBe('Run cancelled');
    expect(jobTitle({ status: 'error' }, false)).toBe('Run could not finish');
    expect(jobTitle({ status: 'running' }, false)).toBe('Running specs');
  });
});

describe('classifyLine (colouring Playwright\'s list reporter)', () => {
  it.each([
    ['  ✓  1 [chromium] › a.spec.ts:5:3 › works (1.2s)', 'pass'],
    ['  ✔  1 ok', 'pass'],
    ['  ok 1 something', 'pass'],
    ['  ✘  2 [chromium] › a.spec.ts:9:3 › breaks (3.1s)', 'fail'],
    ['  x  2 failed thing', 'fail'],
    ['  1) [chromium] › a.spec.ts:9:3 › breaks', 'fail'],
    ['  2 failed', 'fail'],
    ['  -  3 [chromium] › skipped one', 'skip'],
    ['  1 skipped', 'skip'],
    ['Running 3 tests using 1 worker', 'plain'],
    ['', 'plain'],
    ['    at a.spec.ts:57:9', 'plain'],
  ] as const)('%j is %s', (line, kind) => {
    expect(classifyLine(line)).toBe(kind);
  });
});

describe('groupSupportFiles (what a support-only PR changes)', () => {
  const P = 'spec/playwright/playwright';

  it('groups files by kind, in a stable order, with human labels', () => {
    const groups = groupSupportFiles([
      'spec/fixtures/users.yml',
      `${P}/pages/login_page.ts`,
      `${P}/support/helpers.ts`,
      `${P}/fixtures/vcr_cassettes/tasks/show.yml`,
      `${P}/authentication/admin.json`,
      `${P}/playwright.config.js`,
    ]);
    expect(groups.map((g) => [g.kind, g.label])).toEqual([
      ['helpers', 'Helpers and support code'],
      ['pages', 'Page objects'],
      ['fixtures', 'Fixtures'],
      ['cassettes', 'VCR cassettes'],
      ['authentication', 'Login state'],
      ['other', 'Other files'],
    ]);
  });

  it('puts every file in exactly one group (cassettes win over the fixtures folder they live in)', () => {
    const files = [`${P}/fixtures/vcr_cassettes/a.yml`, `${P}/fixtures/b.yml`, `${P}/support/c.ts`, `${P}/pages/d.ts`];
    const groups = groupSupportFiles(files);
    expect(groups.flatMap((g) => g.files).sort()).toEqual([...files].sort());
    expect(groups.find((g) => g.kind === 'cassettes')?.files).toEqual([`${P}/fixtures/vcr_cassettes/a.yml`]);
    expect(groups.find((g) => g.kind === 'fixtures')?.files).toEqual([`${P}/fixtures/b.yml`]);
  });

  it('recognises components, utils, app commands and e2e helpers', () => {
    const groups = groupSupportFiles([`${P}/components/menu.ts`, `${P}/utils/dates.ts`, 'spec/e2e/app_commands/seed.rb', `${P}/e2e_helper.rb`]);
    expect(groups.map((g) => g.kind)).toEqual(['helpers', 'pages']);
    expect(groups[0].files).toHaveLength(3);
  });

  it('sorts files within a group and omits empty groups', () => {
    const groups = groupSupportFiles([`${P}/support/z.ts`, `${P}/support/a.ts`]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toEqual([`${P}/support/a.ts`, `${P}/support/z.ts`]);
  });

  it('is empty for no files', () => {
    expect(groupSupportFiles([])).toEqual([]);
  });
});
