import { XMLParser } from 'fast-xml-parser';
import type { TestData, TestSuite, TestCase } from '../types';

interface RawFailureOrError {
  message?: string;
  type?: string;
  '#text'?: string;
}

interface RawTestCase {
  name?: string;
  classname?: string;
  time?: string;
  failure?: string | RawFailureOrError;
  error?: string | RawFailureOrError;
  skipped?: string;
  // fast-xml-parser coerces purely numeric/boolean tag text into a JS number/boolean
  // (not a string), and returns an array instead of a single value when a testcase has
  // more than one <system-out> element — both verified against the installed parser.
  'system-out'?: string | number | boolean | (string | number | boolean)[];
}

interface RawTestSuite {
  name?: string;
  tests?: string;
  failures?: string;
  errors?: string;
  skipped?: string;
  time?: string;
  timestamp?: string;
  testcase?: RawTestCase | RawTestCase[];
}

interface RawTestSuites {
  testsuite?: RawTestSuite | RawTestSuite[];
}

interface RawJUnitXML {
  testsuites?: RawTestSuites;
  testsuite?: RawTestSuite;
}

// Playwright's JUnit reporter writes this marker into <system-out> whenever it
// attaches a video/trace/error-context file to a test *attempt* — which, under the
// standard retain-on-failure/on-first-retry config, only happens when that attempt
// failed. A testcase with no <failure>/<error> (so the *final* attempt passed) but
// with this marker in its system-out therefore failed at least once before passing
// on retry: flaky. There is no dedicated "flaky" or retry-count field anywhere in
// JUnit XML or Playwright's reporter output, so this structural side-effect is the
// only reliable signal available — verified against two real result files where
// every flaky/failed/clean-pass test matched this pattern with no exceptions.
// Exported so splitJUnitXml.ts can apply the identical rule when deciding what
// needs to be split rather than duplicated across both halves.
export const ATTACHMENT_MARKER = '[[ATTACHMENT|';

// If detecting flaky tests this way would flag more than half of the tests that
// would otherwise be "passed", that's no longer plausible as genuine flakiness
// (real suites have flaky tests as a small minority) — it much more likely means
// this project's Playwright config captures video/trace/screenshots for every
// test, not just failing attempts, which would make every passing test look
// flaky. In that case, skip flaky-marking entirely rather than mislabel the file.
export const FLAKY_GUARD_MAX_RATIO = 0.5;

// Normalizes <system-out> into a single searchable string regardless of the shape
// fast-xml-parser handed back (see the RawTestCase field comment above) — a plain
// .includes() call on the raw value crashes on a number/boolean and silently misses
// the marker when it's an array. Takes `unknown` (rather than RawTestCase's own
// narrower field type) so splitJUnitXml.ts's differently-typed raw nodes — parsed
// with the same parser options, so structurally identical at runtime — can reuse
// this directly with no cast.
export const systemOutText = (value: unknown): string => {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join('\n');
  return String(value);
};

// A testcase is a flaky *candidate* when its final attempt didn't fail but an
// earlier one did (see ATTACHMENT_MARKER above). Exported so splitJUnitXml.ts can
// identify the same candidates — before its own guard decides whether to trust
// them — without re-deriving the detection rule a second time.
export const isFlakyCandidateTestcase = (tc: { failure?: unknown; error?: unknown; 'system-out'?: unknown }): boolean =>
  tc.failure === undefined && tc.error === undefined && systemOutText(tc['system-out']).includes(ATTACHMENT_MARKER);

export const parseJUnitXML = (xmlContent: string): TestData => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  });
  try {
    const result: RawJUnitXML = parser.parse(xmlContent);
    // Process testsuites (multiple suites case)
    if (result.testsuites) {
      return processTestSuites(result.testsuites.testsuite || []);
    }
    // Process single testsuite
    if (result.testsuite) {
      return processTestSuites([result.testsuite]);
    }
    throw new Error('Invalid JUnit XML format');
  } catch (error) {
    console.error('Error parsing XML:', error);
    throw error;
  }
};

const processTestSuites = (suites: RawTestSuite | RawTestSuite[]): TestData => {
  // Ensure suites is an array
  const suitesArray = Array.isArray(suites) ? suites : [suites];
  let totalTests = 0;
  let totalPassed: number;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalTime = 0;
  // Testcases that resolved to "passed" but show retry-artifact evidence — finalized
  // as flaky (or left as passed, see FLAKY_GUARD_MAX_RATIO) once every suite is processed.
  const flakyCandidates: TestCase[] = [];
  const processedSuites: TestSuite[] = suitesArray.map(suite => {
    // Extract basic suite info
    const suiteInfo: TestSuite = {
      name: suite.name || 'Unknown Suite',
      tests: parseInt(suite.tests || '0'),
      failures: parseInt(suite.failures || '0'),
      errors: parseInt(suite.errors || '0'),
      skipped: parseInt(suite.skipped || '0'),
      time: parseFloat(suite.time || '0'),
      timestamp: suite.timestamp || new Date().toISOString(),
      testcases: []
    };
    // Update totals
    totalTests += suiteInfo.tests;
    totalFailed += suiteInfo.failures + suiteInfo.errors;
    totalSkipped += suiteInfo.skipped;
    totalTime += suiteInfo.time;
    // Process testcases if available
    if (suite.testcase) {
      const testcases = Array.isArray(suite.testcase) ? suite.testcase : [suite.testcase];
      suiteInfo.testcases = testcases.map((testcase): TestCase => {
        let status: 'passed' | 'failed' | 'skipped' = 'passed';
        let errorMessage: string | null = null;
        let failureDetails: { message: string; type: string; stackTrace: string } | null = null;
        if (testcase.failure !== undefined) {
          status = 'failed';
          // Handle both string and object failure messages
          if (typeof testcase.failure === 'string') {
            errorMessage = testcase.failure;
          } else {
            errorMessage = testcase.failure.message || 'Test failed';
            // Capture the full failure message including stack trace
            failureDetails = {
              message: testcase.failure.message || '',
              type: testcase.failure.type || '',
              stackTrace: testcase.failure['#text'] || ''
            };
          }
        } else if (testcase.error !== undefined) {
          status = 'failed';
          if (typeof testcase.error === 'string') {
            errorMessage = testcase.error;
          } else {
            errorMessage = testcase.error.message || 'Test error';
            failureDetails = {
              message: testcase.error.message || '',
              type: testcase.error.type || '',
              stackTrace: testcase.error['#text'] || ''
            };
          }
        } else if (testcase.skipped) {
          status = 'skipped';
        }
        const testCase: TestCase = {
          name: testcase.name || 'Unnamed Test',
          classname: testcase.classname || '',
          time: Number(testcase.time ?? '0'),
          status,
          errorMessage,
          failureDetails
        };
        if (status === 'passed' && systemOutText(testcase['system-out']).includes(ATTACHMENT_MARKER)) {
          flakyCandidates.push(testCase);
        }
        return testCase;
      });
    }
    return suiteInfo;
  });
  // Calculate passed tests (still includes flaky candidates at this point)
  totalPassed = totalTests - totalFailed - totalSkipped;

  let totalFlaky = 0;
  let flakyDetectionSkippedReason: string | undefined;
  if (flakyCandidates.length > 0) {
    const candidateRatio = totalPassed > 0 ? flakyCandidates.length / totalPassed : 1;
    if (candidateRatio > FLAKY_GUARD_MAX_RATIO) {
      flakyDetectionSkippedReason =
        `Flaky-test detection was skipped: ${flakyCandidates.length} of ${totalPassed} passing tests had debug ` +
        `attachments, which usually means this project's Playwright config captures video/trace for every test, ` +
        `not just failures.`;
    } else {
      flakyCandidates.forEach(testCase => {
        testCase.status = 'flaky';
        testCase.failureDetails = {
          type: 'Flaky',
          message: 'This test failed on an initial attempt but passed on retry.',
          stackTrace: ''
        };
      });
      totalFlaky = flakyCandidates.length;
      totalPassed -= totalFlaky;
    }
  }

  return {
    summary: {
      total: totalTests,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      flaky: totalFlaky,
      time: totalTime
    },
    suites: processedSuites,
    ...(flakyDetectionSkippedReason ? { flakyDetectionSkippedReason } : {})
  };
};
