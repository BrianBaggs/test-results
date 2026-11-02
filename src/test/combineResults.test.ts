import { describe, it, expect } from 'vitest';
import { combineExportBundles } from '../utils/combineResults';
import { testIdentityKey } from '../utils/testIdentity';
import type { ExportBundle, TestCase, TestSuite } from '../types';

function tc(overrides: Partial<TestCase> & Pick<TestCase, 'name' | 'status'>): TestCase {
  return { classname: 'C', time: 1, ...overrides };
}

function suite(overrides: Partial<TestSuite> & Pick<TestSuite, 'name' | 'testcases'>): TestSuite {
  return {
    tests: overrides.testcases.length,
    failures: overrides.testcases.filter((t) => t.status === 'failed').length,
    errors: 0,
    skipped: overrides.testcases.filter((t) => t.status === 'skipped').length,
    time: overrides.testcases.reduce((s, t) => s + t.time, 0),
    timestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function bundle(suites: TestSuite[], progress: ExportBundle['progress'] = {}): ExportBundle {
  const summary = suites.reduce(
    (acc, s) => {
      acc.total += s.tests;
      acc.failed += s.failures + s.errors;
      acc.skipped += s.skipped;
      acc.flaky += s.testcases.filter((t) => t.status === 'flaky').length;
      acc.time += s.time;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, time: 0 },
  );
  summary.passed = summary.total - summary.failed - summary.skipped - summary.flaky;
  return { version: 1, testData: { summary, suites }, progress };
}

describe('combineExportBundles', () => {
  it('unions complementary failures and dedupes shared passed/skipped tests', () => {
    const shared = tc({ name: 'passes', status: 'passed' });
    const a = bundle([
      suite({ name: 'Suite A', testcases: [shared, tc({ name: 'fail1', status: 'failed' })] }),
    ]);
    const b = bundle([
      suite({ name: 'Suite A', testcases: [shared, tc({ name: 'fail2', status: 'failed' })] }),
    ]);

    const { testData, warnings } = combineExportBundles(a, b);

    expect(warnings).toEqual([]);
    expect(testData.suites).toHaveLength(1);
    expect(testData.suites[0].testcases.map((t) => t.name).sort()).toEqual(['fail1', 'fail2', 'passes']);
    expect(testData.summary.total).toBe(3);
    expect(testData.summary.failed).toBe(2);
    expect(testData.summary.passed).toBe(1);
  });

  it('includes a suite that exists in only one bundle (dropped entirely from the other)', () => {
    const a = bundle([suite({ name: 'OnlyInA', testcases: [tc({ name: 'f', status: 'failed' })] })]);
    const b = bundle([suite({ name: 'OnlyInB', testcases: [tc({ name: 'g', status: 'failed' })] })]);

    const { testData } = combineExportBundles(a, b);

    const names = testData.suites.map((s) => s.name).sort();
    expect(names).toEqual(['OnlyInA', 'OnlyInB']);
    expect(testData.summary.total).toBe(2);
    expect(testData.summary.failed).toBe(2);
  });

  it('merges progress maps from both bundles without collisions', () => {
    const a = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'f1', status: 'failed' })] })],
      { 'S-f1': { id: 'S-f1', name: 'f1', suite: 'S', testStatus: 'failed', status: 'completed' } },
    );
    const b = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'f2', status: 'failed' })] })],
      { 'S-f2': { id: 'S-f2', name: 'f2', suite: 'S', testStatus: 'failed', status: 'in_progress' } },
    );

    const { progress } = combineExportBundles(a, b);

    expect(Object.keys(progress).sort()).toEqual(['S-f1', 'S-f2']);
    expect(progress['S-f1'].status).toBe('completed');
    expect(progress['S-f2'].status).toBe('in_progress');
  });

  it('keeps the more recently updated progress entry when the two files disagree', () => {
    const a = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'f1', status: 'failed' })] })],
      { 'S-f1': { id: 'S-f1', name: 'f1', suite: 'S', testStatus: 'failed', status: 'in_progress', updatedAt: '2024-01-02T00:00:00Z' } },
    );
    const b = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'f1', status: 'failed' })] })],
      { 'S-f1': { id: 'S-f1', name: 'f1', suite: 'S', testStatus: 'failed', status: 'completed', updatedAt: '2024-01-01T00:00:00Z' } },
    );

    const { progress, warnings } = combineExportBundles(a, b);

    expect(progress['S-f1'].status).toBe('in_progress');
    expect(warnings).toContainEqual(expect.stringMatching(/Progress for "f1" differs/));
  });

  it('prefers the second file\'s progress entry when neither side has a timestamp', () => {
    const a = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'f1', status: 'failed' })] })],
      { 'S-f1': { id: 'S-f1', name: 'f1', suite: 'S', testStatus: 'failed', status: 'in_progress' } },
    );
    const b = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'f1', status: 'failed' })] })],
      { 'S-f1': { id: 'S-f1', name: 'f1', suite: 'S', testStatus: 'failed', status: 'completed' } },
    );

    const { progress } = combineExportBundles(a, b);

    expect(progress['S-f1'].status).toBe('completed');
  });

  it('warns when both bundles contain identical test data', () => {
    const shared = bundle([suite({ name: 'S', testcases: [tc({ name: 'f', status: 'failed' })] })]);

    const { warnings } = combineExportBundles(shared, shared);

    expect(warnings).toContainEqual(expect.stringMatching(/identical/i));
  });

  it('warns and prefers the failed version when the same test has conflicting status between files', () => {
    const a = bundle([suite({ name: 'S', testcases: [tc({ name: 'flaky', status: 'passed' })] })]);
    const b = bundle([suite({ name: 'S', testcases: [tc({ name: 'flaky', status: 'failed' })] })]);

    const { testData, warnings } = combineExportBundles(a, b);

    expect(warnings).toContainEqual(expect.stringMatching(/different status/i));
    expect(testData.suites[0].testcases).toHaveLength(1);
    expect(testData.suites[0].testcases[0].status).toBe('failed');
  });

  it('falls back to an empty classname when deduplicating testcases by key', () => {
    const a = bundle([
      suite({ name: 'S', testcases: [tc({ name: 'x', status: 'passed', classname: undefined })] }),
    ]);
    const b = bundle([
      suite({ name: 'S', testcases: [tc({ name: 'x', status: 'passed', classname: undefined })] }),
    ]);

    const { testData } = combineExportBundles(a, b);

    expect(testData.suites[0].testcases).toHaveLength(1);
  });

  it('keeps the existing entry when the conflicting testcase from the other file is not the failed one', () => {
    const a = bundle([suite({ name: 'S', testcases: [tc({ name: 'flaky', status: 'failed' })] })]);
    const b = bundle([suite({ name: 'S', testcases: [tc({ name: 'flaky', status: 'passed' })] })]);

    const { testData, warnings } = combineExportBundles(a, b);

    expect(warnings).toContainEqual(expect.stringMatching(/different status/i));
    expect(testData.suites[0].testcases).toHaveLength(1);
    expect(testData.suites[0].testcases[0].status).toBe('failed');
  });

  it('falls back to a generated timestamp when neither side has one for a merged suite', () => {
    const a = bundle([
      suite({ name: 'NoTs', testcases: [tc({ name: 'a', status: 'passed' })], timestamp: undefined }),
    ]);
    const b = bundle([
      suite({ name: 'NoTs', testcases: [tc({ name: 'b', status: 'passed' })], timestamp: undefined }),
    ]);

    const { testData } = combineExportBundles(a, b);

    expect(Number.isNaN(new Date(testData.suites[0].timestamp).getTime())).toBe(false);
  });

  it('sums failures/errors from each side rather than re-deriving them from testcase status', () => {
    const a = bundle([
      { ...suite({ name: 'S', testcases: [tc({ name: 'e1', status: 'failed' })] }), failures: 0, errors: 1 },
    ]);
    const b = bundle([
      { ...suite({ name: 'S', testcases: [tc({ name: 'f1', status: 'failed' })] }), failures: 1, errors: 0 },
    ]);

    const { testData } = combineExportBundles(a, b);

    expect(testData.suites[0].failures).toBe(1);
    expect(testData.suites[0].errors).toBe(1);
    expect(testData.summary.failed).toBe(2);
  });

  it('keeps two failed tests distinct when they share a name but differ by classname', () => {
    // Regression test: the old testcaseKey ignored classname, so a suite
    // with two same-named failures from different classes would silently
    // dedupe down to one.
    const a = bundle([
      suite({ name: 'S', testcases: [tc({ name: 'test1', classname: 'ClassA', status: 'failed' })] }),
    ]);
    const b = bundle([
      suite({ name: 'S', testcases: [tc({ name: 'test1', classname: 'ClassB', status: 'failed' })] }),
    ]);

    const { testData } = combineExportBundles(a, b);

    expect(testData.suites[0].testcases).toHaveLength(2);
    expect(testData.summary.failed).toBe(2);
  });

  it('merges progress entries for two different tests that happen to share a name across classes', () => {
    // Regression test: progress ids that ignore classname collide here,
    // silently overwriting one teammate's notes/status with the other's.
    const idA = testIdentityKey('S', 'ClassA', 'test1');
    const idB = testIdentityKey('S', 'ClassB', 'test1');
    const a = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'test1', classname: 'ClassA', status: 'failed' })] })],
      { [idA]: { id: idA, name: 'test1', suite: 'S', testStatus: 'failed', status: 'completed', notes: 'Alice fixed this' } },
    );
    const b = bundle(
      [suite({ name: 'S', testcases: [tc({ name: 'test1', classname: 'ClassB', status: 'failed' })] })],
      { [idB]: { id: idB, name: 'test1', suite: 'S', testStatus: 'failed', status: 'in_progress', notes: 'Bob investigating' } },
    );

    const { progress } = combineExportBundles(a, b);

    expect(Object.keys(progress)).toHaveLength(2);
    expect(progress[idA].notes).toBe('Alice fixed this');
    expect(progress[idB].notes).toBe('Bob investigating');
  });

  it('does not drop testcases when a suite name is duplicated and both duplicates land in the same half', () => {
    // Regression test: the old suite lookup used .find(), which only reads
    // the first suite matching a name and silently drops any others.
    const a = bundle([
      suite({ name: 'Dup', testcases: [tc({ name: 'alpha', status: 'failed' })] }),
      suite({ name: 'Dup', testcases: [tc({ name: 'charlie', status: 'failed' })] }),
    ]);
    const b = bundle([
      suite({ name: 'Dup', testcases: [tc({ name: 'bravo', status: 'failed' })] }),
      suite({ name: 'Dup', testcases: [tc({ name: 'delta', status: 'failed' })] }),
    ]);

    const { testData } = combineExportBundles(a, b);

    const dupNames = testData.suites
      .filter((s) => s.name === 'Dup')
      .flatMap((s) => s.testcases.map((t) => t.name));
    expect(new Set(dupNames)).toEqual(new Set(['alpha', 'bravo', 'charlie', 'delta']));
    expect(testData.summary.failed).toBe(4);
  });

  it('sums flaky testcases into summary.flaky and excludes them from passed', () => {
    const a = bundle([
      suite({ name: 'S', testcases: [tc({ name: 'flaky1', status: 'flaky' }), tc({ name: 'clean', status: 'passed' })] }),
    ]);
    const b = bundle([
      suite({ name: 'S', testcases: [tc({ name: 'flaky1', status: 'flaky' }), tc({ name: 'clean', status: 'passed' })] }),
    ]);

    const { testData } = combineExportBundles(a, b);

    expect(testData.summary.flaky).toBe(1);
    expect(testData.summary.passed).toBe(1);
    expect(testData.summary.total).toBe(2);
  });

  it('prefers flaky over passed when the same test has conflicting status between files', () => {
    const a = bundle([suite({ name: 'S', testcases: [tc({ name: 'unstable', status: 'passed' })] })]);
    const b = bundle([suite({ name: 'S', testcases: [tc({ name: 'unstable', status: 'flaky' })] })]);

    const { testData, warnings } = combineExportBundles(a, b);

    expect(warnings).toContainEqual(expect.stringMatching(/kept the flaky one/));
    expect(testData.suites[0].testcases[0].status).toBe('flaky');
  });

  it('prefers failed over flaky when the same test has conflicting status between files', () => {
    const a = bundle([suite({ name: 'S', testcases: [tc({ name: 'unstable', status: 'flaky' })] })]);
    const b = bundle([suite({ name: 'S', testcases: [tc({ name: 'unstable', status: 'failed' })] })]);

    const { testData, warnings } = combineExportBundles(a, b);

    expect(warnings).toContainEqual(expect.stringMatching(/kept the failed one/));
    expect(testData.suites[0].testcases[0].status).toBe('failed');
  });

  it('prefers flaky over skipped when the same test has conflicting status between files', () => {
    const a = bundle([suite({ name: 'S', testcases: [tc({ name: 'unstable', status: 'skipped' })] })]);
    const b = bundle([suite({ name: 'S', testcases: [tc({ name: 'unstable', status: 'flaky' })] })]);

    const { testData, warnings } = combineExportBundles(a, b);

    expect(warnings).toContainEqual(expect.stringMatching(/kept the flaky one/));
    expect(testData.suites[0].testcases[0].status).toBe('flaky');
  });
});
