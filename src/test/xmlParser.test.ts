import { describe, it, expect, vi } from 'vitest';
import { parseJUnitXML } from '../utils/xmlParser';

describe('parseJUnitXML', () => {
  describe('single testsuite', () => {
    it('should parse basic testsuite with passed tests', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="2" failures="0" errors="0" time="1.5">
  <testcase name="test1" classname="TestClass1" time="0.5"/>
  <testcase name="test2" classname="TestClass2" time="1.0"/>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.summary).toEqual({
        total: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        flaky: 0,
        time: 1.5
      });

      expect(result.suites).toHaveLength(1);
      expect(result.suites[0]).toMatchObject({
        name: 'Test Suite',
        tests: 2,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 1.5
      });

      expect(result.suites[0].testcases).toHaveLength(2);
      expect(result.suites[0].testcases[0]).toMatchObject({
        name: 'test1',
        classname: 'TestClass1',
        time: 0.5,
        status: 'passed',
        errorMessage: null,
        failureDetails: null
      });
    });

    it('should parse testsuite with failed tests', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="2" failures="1" errors="0" time="1.5">
  <testcase name="test1" classname="TestClass1" time="0.5">
    <failure message="Assertion failed" type="AssertionError">Stack trace here</failure>
  </testcase>
  <testcase name="test2" classname="TestClass2" time="1.0"/>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.summary).toEqual({
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        flaky: 0,
        time: 1.5
      });

      expect(result.suites[0].testcases[0]).toMatchObject({
        name: 'test1',
        status: 'failed',
        errorMessage: 'Assertion failed',
        failureDetails: {
          message: 'Assertion failed',
          type: 'AssertionError',
          stackTrace: 'Stack trace here'
        }
      });
    });

    it('should parse testsuite with error tests', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="1" time="1.0">
  <testcase name="test1" classname="TestClass1" time="1.0">
    <error message="Runtime error" type="RuntimeError">Error details</error>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.summary.failed).toBe(1);
      expect(result.suites[0].testcases[0]).toMatchObject({
        name: 'test1',
        status: 'failed',
        errorMessage: 'Runtime error',
        failureDetails: {
          message: 'Runtime error',
          type: 'RuntimeError',
          stackTrace: 'Error details'
        }
      });
    });

    it('should parse testsuite with skipped tests', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="2" failures="0" errors="0" skipped="1" time="1.0">
  <testcase name="test1" classname="TestClass1" time="0.5">
    <skipped/>
  </testcase>
  <testcase name="test2" classname="TestClass2" time="0.5"/>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.summary).toEqual({
        total: 2,
        passed: 1,
        failed: 0,
        skipped: 1,
        flaky: 0,
        time: 1.0
      });

      expect(result.suites[0].testcases[0].status).toBe('skipped');
      expect(result.suites[0].testcases[1].status).toBe('passed');
      expect(result.suites[0].skipped).toBe(1);
    });

    it('detects a skipped testcase whether <skipped> is empty, self-closing, or carries a message', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="S" tests="3" failures="0" errors="0" skipped="3" time="0">
  <testcase name="a" classname="C" time="0"><skipped></skipped></testcase>
  <testcase name="b" classname="C" time="0"><skipped/></testcase>
  <testcase name="c" classname="C" time="0"><skipped message="not today"/></testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases.map((t) => t.status)).toEqual(['skipped', 'skipped', 'skipped']);
    });

    it('does not treat a skipped testcase as a flaky candidate even if it has attachment output', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="S" tests="3" failures="0" errors="0" skipped="1" time="0">
  <testcase name="a" classname="C" time="0"><system-out>[[ATTACHMENT|x.webm]]</system-out><skipped/></testcase>
  <testcase name="b" classname="C" time="0"/>
  <testcase name="c" classname="C" time="0"/>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].status).toBe('skipped');
      expect(result.summary.flaky).toBe(0);
    });

    it('should handle string failure messages', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="1" errors="0" time="1.0">
  <testcase name="test1" classname="TestClass1" time="1.0">
    <failure>Simple failure message</failure>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases[0]).toMatchObject({
        status: 'failed',
        errorMessage: 'Simple failure message',
        failureDetails: null
      });
    });

    it('should handle string error messages', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="1" time="1.0">
  <testcase name="test1" classname="TestClass1" time="1.0">
    <error>Simple error message</error>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases[0]).toMatchObject({
        status: 'failed',
        errorMessage: 'Simple error message',
        failureDetails: null
      });
    });
  });

  describe('multiple testsuites', () => {
    it('should parse testsuites with multiple suites', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Suite 1" tests="2" failures="1" errors="0" time="1.0">
    <testcase name="test1" classname="Class1" time="0.5">
      <failure message="Failed">Error</failure>
    </testcase>
    <testcase name="test2" classname="Class2" time="0.5"/>
  </testsuite>
  <testsuite name="Suite 2" tests="1" failures="0" errors="0" time="0.5">
    <testcase name="test3" classname="Class3" time="0.5"/>
  </testsuite>
</testsuites>`;

      const result = parseJUnitXML(xml);
      
      expect(result.summary).toEqual({
        total: 3,
        passed: 2,
        failed: 1,
        skipped: 0,
        flaky: 0,
        time: 1.5
      });

      expect(result.suites).toHaveLength(2);
      expect(result.suites[0].name).toBe('Suite 1');
      expect(result.suites[1].name).toBe('Suite 2');
    });
  });

  describe('edge cases and defaults', () => {
    it('should handle missing attributes with defaults', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite>
  <testcase/>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0]).toMatchObject({
        name: 'Unknown Suite',
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0
      });

      // When testsuite has no attributes, testcases array will be empty
      expect(result.suites[0].testcases).toHaveLength(0);
    });

    it('should handle testsuite with valid testcase', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test" tests="1" failures="0" errors="0" time="1.0">
  <testcase name="test1" classname="TestClass1" time="1.0"/>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases).toHaveLength(1);
      expect(result.suites[0].testcases[0]).toMatchObject({
        name: 'test1',
        classname: 'TestClass1',
        time: 1.0,
        status: 'passed'
      });
    });

    it('should handle testsuite without testcases', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Empty Suite" tests="0" failures="0" errors="0" time="0"/>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases).toHaveLength(0);
    });

    it('should handle single testcase (not array)', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Single Test" tests="1" failures="0" errors="0" time="1.0">
  <testcase name="test1" classname="Class1" time="1.0"/>
</testsuite>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases).toHaveLength(1);
      expect(result.suites[0].testcases[0].name).toBe('test1');
    });

    it('should add timestamp if not provided', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test" tests="0" failures="0" errors="0" time="0"/>`;

      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].timestamp).toBeDefined();
      expect(new Date(result.suites[0].timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid XML', () => {
      const invalidXml = 'not xml';
      
      expect(() => parseJUnitXML(invalidXml)).toThrow();
    });

    it('should throw error for XML without testsuite or testsuites', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <data>not junit</data>
</root>`;

      expect(() => parseJUnitXML(xml)).toThrow('Invalid JUnit XML format');
    });

    it('should return an empty report for a <testsuites/> with no testsuite children', () => {
      const xml = '<?xml version="1.0" encoding="UTF-8"?><testsuites tests="0"/>';

      const result = parseJUnitXML(xml);

      expect(result.summary).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, time: 0 });
      expect(result.suites).toEqual([]);
    });

    it('should log console error on parse failure', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* mock implementation */ });
      
      expect(() => parseJUnitXML('invalid xml')).toThrow();
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle test cases with skipped attribute', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="0" skipped="1" time="0.123">
  <testcase name="SkippedTest" classname="TestClass" time="0.0" skipped="true"/>
</testsuite>`;
      
      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases[0].status).toBe('skipped');
      expect(result.summary.skipped).toBe(1);
    });

    it('should handle test cases with string-type failure', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="1" errors="0" time="0.123">
  <testcase name="FailedTest" classname="TestClass" time="0.1">
    <failure>Simple failure message</failure>
  </testcase>
</testsuite>`;
      
      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases[0].status).toBe('failed');
      expect(result.suites[0].testcases[0].errorMessage).toBe('Simple failure message');
    });

    it('should handle test cases with string-type error', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="1" time="0.123">
  <testcase name="ErrorTest" classname="TestClass" time="0.1">
    <error>Simple error message</error>
  </testcase>
</testsuite>`;
      
      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases[0].status).toBe('failed');
      expect(result.suites[0].testcases[0].errorMessage).toBe('Simple error message');
    });

    it('should handle test cases with object-type error with full details', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="1" time="0.123">
  <testcase name="ErrorTest" classname="TestClass" time="0.1">
    <error message="Detailed error" type="RuntimeError">Stack trace here</error>
  </testcase>
</testsuite>`;
      
      const result = parseJUnitXML(xml);
      
      expect(result.suites[0].testcases[0].status).toBe('failed');
      expect(result.suites[0].testcases[0].errorMessage).toBe('Detailed error');
      expect(result.suites[0].testcases[0].failureDetails?.type).toBe('RuntimeError');
      expect(result.suites[0].testcases[0].failureDetails?.stackTrace).toBe('Stack trace here');
    });

    it('should handle testcases without name attribute', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="0" time="0.123">
  <testcase classname="TestClass" time="0.1"/>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].name).toBe('Unnamed Test');
    });
  });

  describe('missing optional sub-fields', () => {
    it('should default failure message and use fallback empty string for missing failure message', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="1" errors="0" time="0.123">
  <testcase name="test1" classname="TestClass" time="0.1">
    <failure type="AssertionError">Some details</failure>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].errorMessage).toBe('Test failed');
      expect(result.suites[0].testcases[0].failureDetails).toEqual({
        message: '',
        type: 'AssertionError',
        stackTrace: 'Some details'
      });
    });

    it('should default failure type and stack trace when only a message is present', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="1" errors="0" time="0.123">
  <testcase name="test1" classname="TestClass" time="0.1">
    <failure message="Boom"/>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].failureDetails).toEqual({
        message: 'Boom',
        type: '',
        stackTrace: ''
      });
    });

    it('should default error message and use fallback empty string for missing error message', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="1" time="0.123">
  <testcase name="test1" classname="TestClass" time="0.1">
    <error type="RuntimeError">Some details</error>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].errorMessage).toBe('Test error');
      expect(result.suites[0].testcases[0].failureDetails).toEqual({
        message: '',
        type: 'RuntimeError',
        stackTrace: 'Some details'
      });
    });

    it('should default error type and stack trace when only a message is present', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="1" time="0.123">
  <testcase name="test1" classname="TestClass" time="0.1">
    <error message="Boom"/>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].failureDetails).toEqual({
        message: 'Boom',
        type: '',
        stackTrace: ''
      });
    });

    it('should default classname and time when a testcase omits them entirely', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test Suite" tests="1" failures="0" errors="0" time="0">
  <testcase name="test1"/>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0]).toMatchObject({
        name: 'test1',
        classname: '',
        time: 0
      });
    });
  });

  describe('flaky test detection', () => {
    it('should mark a passing testcase as flaky when its system-out contains a Playwright attachment marker', () => {
      // Three clean passes alongside the one flaky candidate keeps the candidate ratio
      // (1/4 = 25%) comfortably under the plausibility guard, isolating this test to
      // just the marker-detection behavior rather than the guard's own threshold.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="4" failures="0" errors="0" time="13">
  <testcase name="import big file" classname="e2e/import.spec.ts" time="9.5">
    <system-out><![CDATA[
[[ATTACHMENT|../test-results/e2e-import-chromium/video.webm]]

[[ATTACHMENT|../test-results/e2e-import-chromium/trace.zip]]
]]></system-out>
  </testcase>
  <testcase name="clean1" classname="e2e/other.spec.ts" time="1"/>
  <testcase name="clean2" classname="e2e/other.spec.ts" time="1"/>
  <testcase name="clean3" classname="e2e/other.spec.ts" time="1.5"/>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].status).toBe('flaky');
      expect(result.suites[0].testcases[0].errorMessage).toBeNull();
      expect(result.suites[0].testcases[0].failureDetails).toEqual({
        type: 'Flaky',
        message: 'This test failed on an initial attempt but passed on retry.',
        stackTrace: ''
      });
      expect(result.summary).toEqual({
        total: 4, passed: 3, failed: 0, skipped: 0, flaky: 1, time: 13
      });
      expect(result.flakyDetectionSkippedReason).toBeUndefined();
    });

    it('should not flag a passing testcase whose system-out is unrelated console output', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="1" failures="0" errors="0" time="1">
  <testcase name="logs something" classname="C" time="1">
    <system-out><![CDATA[hello from console.log, nothing attached here]]></system-out>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].status).toBe('passed');
      expect(result.summary.flaky).toBe(0);
      expect(result.summary.passed).toBe(1);
    });

    it('should not flag a failed testcase even if its system-out also contains an attachment marker', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="1" failures="1" errors="0" time="1">
  <testcase name="really fails" classname="C" time="1">
    <system-out><![CDATA[[[ATTACHMENT|../test-results/x/video.webm]]]]></system-out>
    <failure message="boom" type="Error">Stack trace</failure>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].status).toBe('failed');
      expect(result.summary.flaky).toBe(0);
      expect(result.summary.failed).toBe(1);
    });

    it('should not flag a skipped testcase even if its system-out contains an attachment marker', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="1" failures="0" errors="0" skipped="1" time="0">
  <testcase name="skipped anyway" classname="C" time="0" skipped="true">
    <system-out><![CDATA[[[ATTACHMENT|../test-results/x/video.webm]]]]></system-out>
  </testcase>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].status).toBe('skipped');
      expect(result.summary.flaky).toBe(0);
      expect(result.summary.skipped).toBe(1);
    });

    it('should skip flaky-marking entirely when more than half of the passing tests show attachment evidence', () => {
      // 3 of 4 "passed" testcases have the marker — implausible as genuine flakiness,
      // more likely a config that captures video/trace for every test.
      const candidate = (name: string) => `
  <testcase name="${name}" classname="C" time="1">
    <system-out><![CDATA[[[ATTACHMENT|../test-results/${name}/video.webm]]]]></system-out>
  </testcase>`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="4" failures="0" errors="0" time="4">
  ${candidate('a')}
  ${candidate('b')}
  ${candidate('c')}
  <testcase name="d" classname="C" time="1"/>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases.every((t) => t.status === 'passed')).toBe(true);
      expect(result.summary).toEqual({
        total: 4, passed: 4, failed: 0, skipped: 0, flaky: 0, time: 4
      });
      expect(result.flakyDetectionSkippedReason).toMatch(/3 of 4 passing tests had debug attachments/);
    });

    it('should still detect flaky tests when the candidate ratio is exactly at the guard threshold', () => {
      // 1 of 2 = 50%, not *greater than* the 50% max ratio, so detection still applies.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="2" failures="0" errors="0" time="2">
  <testcase name="flaky-one" classname="C" time="1">
    <system-out><![CDATA[[[ATTACHMENT|../test-results/x/video.webm]]]]></system-out>
  </testcase>
  <testcase name="clean-one" classname="C" time="1"/>
</testsuite>`;

      const result = parseJUnitXML(xml);

      expect(result.suites[0].testcases[0].status).toBe('flaky');
      expect(result.suites[0].testcases[1].status).toBe('passed');
      expect(result.summary.flaky).toBe(1);
      expect(result.flakyDetectionSkippedReason).toBeUndefined();
    });

    it('should not divide by zero when candidates exist but the suite declares zero total tests', () => {
      // Malformed/inconsistent XML: the suite's own `tests` attribute (which the summary
      // math is derived from) undercounts relative to its actual <testcase> children.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Suite" tests="0" failures="0" errors="0" time="1">
  <testcase name="flaky-one" classname="C" time="1">
    <system-out><![CDATA[[[ATTACHMENT|../test-results/x/video.webm]]]]></system-out>
  </testcase>
</testsuite>`;

      expect(() => parseJUnitXML(xml)).not.toThrow();
      const result = parseJUnitXML(xml);
      // totalPassed (derived from the declared "tests" count) is 0, so the ratio is
      // forced to 1 (100%) rather than dividing by zero — the guard correctly fires.
      expect(result.flakyDetectionSkippedReason).toBeDefined();
      expect(result.suites[0].testcases[0].status).toBe('passed');
    });

    it('should match Playwright\'s own ground truth on a real trimmed run (5 failed, 3 flaky, rest passed)', () => {
      // A representative trim of a real results.xml this feature was built against —
      // shaped exactly like Playwright's actual output (retry1-suffixed attachments and
      // an <error>/<failure> element with a "Retry #1" section for genuine failures;
      // a single, un-suffixed attachment set and no failure/error element for flaky
      // tests; nothing at all for clean passes) — verified against Playwright's own
      // console summary for that run, which reported exactly 5 failed / 3 flaky.
      const cleanPass = (n: number) => `<testcase name="clean${n}" classname="e2e/clean.spec.ts" time="1.0"/>`;
      const flakyCase = (n: number) => `
<testcase name="flaky${n}" classname="e2e/flaky.spec.ts" time="30.0">
<system-out><![CDATA[
[[ATTACHMENT|../test-results/flaky${n}-chromium/video.webm]]
[[ATTACHMENT|../test-results/flaky${n}-chromium/trace.zip]]
]]></system-out>
</testcase>`;
      const failedCase = (n: number) => `
<testcase name="failed${n}" classname="e2e/failed.spec.ts" time="30.0">
<system-out><![CDATA[
[[ATTACHMENT|../test-results/failed${n}-chromium/video.webm]]
[[ATTACHMENT|../test-results/failed${n}-chromium-retry1/video.webm]]
]]></system-out>
<error message="Timed out" type="Error"><![CDATA[
Timed out waiting for element
Retry #1 ───────────────────────
Timed out waiting for element
]]></error>
</testcase>`;

      const passedCases = Array.from({ length: 50 }, (_, i) => cleanPass(i)).join('\n');
      const flakyCases = Array.from({ length: 3 }, (_, i) => flakyCase(i)).join('\n');
      const failedCases = Array.from({ length: 5 }, (_, i) => failedCase(i)).join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="58" failures="0" skipped="0" errors="5" time="500">
<testsuite name="Trimmed" tests="58" failures="0" errors="5" skipped="0" time="500">
${passedCases}
${flakyCases}
${failedCases}
</testsuite>
</testsuites>`;

      const result = parseJUnitXML(xml);

      expect(result.summary).toEqual({
        total: 58, passed: 50, failed: 5, skipped: 0, flaky: 3, time: 500
      });
      const statuses = result.suites[0].testcases.map((t) => t.status);
      expect(statuses.filter((s) => s === 'passed')).toHaveLength(50);
      expect(statuses.filter((s) => s === 'flaky')).toHaveLength(3);
      expect(statuses.filter((s) => s === 'failed')).toHaveLength(5);
    });
  });
});