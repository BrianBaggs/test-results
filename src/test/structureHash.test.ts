import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeResultsHash, computeStructureHash } from '../utils/structureHash';
import { parseJUnitXML } from '../utils/xmlParser';
import { splitJUnitXml } from '../utils/splitJUnitXml';
import { combineExportBundles } from '../utils/combineResults';
import type { ExportBundle, TestCase, TestData } from '../types';

function makeTestData(testcases: TestCase[], suiteName = 'S'): TestData {
  return {
    summary: { total: testcases.length, passed: 0, failed: 0, skipped: 0, flaky: 0, time: 1 },
    suites: [
      {
        name: suiteName,
        tests: testcases.length,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 1,
        timestamp: '2024-01-01T00:00:00Z',
        testcases,
      },
    ],
  };
}

const failed: TestCase = {
  name: 'f1',
  classname: 'C',
  status: 'failed',
  time: 1.5,
  errorMessage: 'boom',
  failureDetails: { message: 'boom', type: 'AssertionError', stackTrace: 'at a.spec.ts:1' },
};
const passed: TestCase = { name: 'p1', classname: 'C', status: 'passed', time: 0.5, errorMessage: null, failureDetails: null };

describe('computeResultsHash', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a SHA-256 hex digest', async () => {
    expect(await computeResultsHash(makeTestData([failed, passed]))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same for the same results regardless of test order', async () => {
    expect(await computeResultsHash(makeTestData([failed, passed]))).toBe(
      await computeResultsHash(makeTestData([passed, failed])),
    );
  });

  it('ignores suite-level aggregates and timestamps, which differ between parses of the same file', async () => {
    const original = makeTestData([failed, passed]);
    const reparsed = makeTestData([failed, passed]);
    reparsed.suites[0] = { ...reparsed.suites[0], tests: 99, failures: 7, errors: 3, skipped: 5, time: 123, timestamp: new Date().toISOString() };
    reparsed.summary = { total: 99, passed: 1, failed: 2, skipped: 3, flaky: 4, time: 5 };

    expect(await computeResultsHash(reparsed)).toBe(await computeResultsHash(original));
  });

  it.each([
    ['a different outcome', { ...failed, status: 'passed' as const }],
    ['a different duration', { ...failed, time: 1.6 }],
    ['a different error message', { ...failed, errorMessage: 'a different boom' }],
    ['a different stack trace', { ...failed, failureDetails: { ...failed.failureDetails!, stackTrace: 'at a.spec.ts:2' } }],
    ['a different class', { ...failed, classname: 'Other' }],
    ['a different test name', { ...failed, name: 'f2' }],
  ])('differs when a test has %s — i.e. it is a different run, even of the same suite', async (_label, changed) => {
    expect(await computeResultsHash(makeTestData([changed, passed]))).not.toBe(
      await computeResultsHash(makeTestData([failed, passed])),
    );
  });

  it('differs when a test is added or removed', async () => {
    expect(await computeResultsHash(makeTestData([failed, passed]))).not.toBe(await computeResultsHash(makeTestData([failed])));
  });

  it('does not collide when suite/test name boundaries are ambiguous under naive concatenation', async () => {
    const suiteABtestC = makeTestData([{ ...passed, classname: undefined, name: 'C' }], 'A-B');
    const suiteAtestBC = makeTestData([{ ...passed, classname: undefined, name: 'B-C' }], 'A');

    expect(await computeResultsHash(suiteABtestC)).not.toBe(await computeResultsHash(suiteAtestBC));
  });

  it('is not the same as the structure hash, which cannot tell two runs of one suite apart', async () => {
    const run1 = makeTestData([failed, passed]);
    const run2 = makeTestData([{ ...failed, status: 'passed' }, passed]);

    expect(await computeStructureHash(run1)).toBe(await computeStructureHash(run2));
    expect(await computeResultsHash(run1)).not.toBe(await computeResultsHash(run2));
  });

  it('returns undefined when SubtleCrypto is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });

    expect(await computeResultsHash(makeTestData([failed]))).toBeUndefined();
  });

  it('computeStructureHash returns undefined when SubtleCrypto is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });

    expect(await computeStructureHash(makeTestData([failed]))).toBeUndefined();
  });

  describe('for a combined result', () => {
    const ORIGINAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="login.spec.ts" tests="5" failures="1" errors="1" skipped="1" time="5.0" timestamp="2026-10-01T10:00:00">
    <testcase name="logs in" classname="login.spec.ts" time="1.25"/>
    <testcase name="rejects bad password" classname="login.spec.ts" time="0.5">
      <failure message="expected 401" type="AssertionError">at login.spec.ts:12</failure>
    </testcase>
    <testcase name="locks account" classname="login.spec.ts" time="2.5">
      <error message="timeout" type="TimeoutError">at login.spec.ts:30</error>
    </testcase>
    <testcase name="remember me" classname="login.spec.ts" time="0.75">
      <skipped message="not ready"/>
    </testcase>
    <testcase name="shows greeting" classname="login.spec.ts" time="0.125"/>
  </testsuite>
  <testsuite name="cart.spec.ts" tests="5" failures="1" errors="0" skipped="0" time="4.0" timestamp="2026-10-01T10:00:05">
    <testcase name="adds item" classname="cart.spec.ts" time="0.5"/>
    <testcase name="removes item" classname="cart.spec.ts" time="0.5"/>
    <testcase name="applies coupon" classname="cart.spec.ts" time="1.0">
      <failure message="expected 10% off" type="AssertionError">at cart.spec.ts:44</failure>
    </testcase>
    <testcase name="checks out" classname="cart.spec.ts" time="1.5">
      <system-out>[[ATTACHMENT|trace.zip]]</system-out>
    </testcase>
    <testcase name="empties cart" classname="cart.spec.ts" time="0.5"/>
  </testsuite>
</testsuites>`;

    it('matches the XML it was split from, so reloading that XML after a Combine keeps the merged progress', async () => {
      const original = parseJUnitXML(ORIGINAL_XML);
      const split = splitJUnitXml(ORIGINAL_XML);
      // Guard against the fixture quietly degenerating into a split where one half holds everything.
      expect(split.countA).toBeGreaterThan(0);
      expect(split.countB).toBeGreaterThan(0);
      // …and against it no longer exercising a failure, an error, and a flaky test.
      expect(original.summary).toMatchObject({ failed: 3, skipped: 1, flaky: 1 });

      const toBundle = (xml: string): ExportBundle => ({ version: 1, testData: parseJUnitXML(xml), progress: {} });
      const { testData: combined, warnings } = combineExportBundles(toBundle(split.fileAXml), toBundle(split.fileBXml));

      expect(warnings).toEqual([]);
      expect(await computeResultsHash(combined)).toBe(await computeResultsHash(original));
    });

    it('does not match a later run of that XML in which one test changed', async () => {
      const original = parseJUnitXML(ORIGINAL_XML);
      const laterRun = parseJUnitXML(ORIGINAL_XML.replace('time="0.125"', 'time="0.130"'));

      expect(await computeResultsHash(laterRun)).not.toBe(await computeResultsHash(original));
    });
  });
});
