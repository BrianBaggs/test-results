import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitPage } from '../components/Split/SplitPage';
import * as downloadUtil from '../utils/download';
import * as splitUtil from '../utils/splitJUnitXml';
import * as exportBundleUtil from '../utils/exportBundle';
import type { ExportBundle } from '../types';

const VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Suite" tests="3" failures="2" errors="0" skipped="0" time="3">
    <testcase name="passes" classname="C" time="1" />
    <testcase name="fails1" classname="C" time="1"><failure message="m" type="E">x</failure></testcase>
    <testcase name="fails2" classname="C" time="1"><failure message="m" type="E">x</failure></testcase>
  </testsuite>
</testsuites>`;

function makeBundle(failName: string): ExportBundle {
  return {
    version: 1,
    testData: {
      summary: { total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0, time: 2 },
      suites: [
        {
          name: 'Suite',
          tests: 2,
          failures: 1,
          errors: 0,
          skipped: 0,
          time: 2,
          timestamp: '2024-01-01T00:00:00Z',
          testcases: [
            { name: 'passes', classname: 'C', time: 1, status: 'passed' },
            { name: failName, classname: 'C', time: 1, status: 'failed' },
          ],
        },
      ],
    },
    progress: { [`Suite-${failName}`]: { id: `Suite-${failName}`, name: failName, suite: 'Suite', testStatus: 'failed', status: 'pending' } },
  };
}

async function uploadFile(input: HTMLElement, file: File) {
  const user = userEvent.setup();
  await user.upload(input, file);
}

describe('SplitPage', () => {
  const onCombined = vi.fn();
  const setActiveTab = vi.fn();

  beforeEach(() => {
    onCombined.mockClear();
    setActiveTab.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Split section', () => {
    it('accepts a file dropped onto the source drop zone', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const dropZone = screen.getByLabelText('Upload XML file to split').closest('div') as HTMLElement;
      const file = new File([VALID_XML], 'dropped.xml', { type: 'text/xml' });

      fireEvent.dragOver(dropZone);
      expect(dropZone.className).toContain('bg-primary/5');

      fireEvent.dragLeave(dropZone);
      expect(dropZone.className).not.toContain('bg-primary/5');

      fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

      await waitFor(() => expect(screen.getByText('Using: dropped.xml')).toBeInTheDocument());
      expect(screen.getByText('Split').closest('button')).not.toBeDisabled();
    });

    it('opens the file picker when "Choose XML File" is clicked', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const input = screen.getByLabelText('Upload XML file to split') as HTMLInputElement;
      const clickSpy = vi.spyOn(input, 'click');

      await userEvent.click(screen.getByText('Choose XML File'));

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('splits an uploaded file and shows the resulting counts', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const file = new File([VALID_XML], 'results.xml', { type: 'text/xml' });
      await uploadFile(screen.getByLabelText('Upload XML file to split'), file);

      await waitFor(() => expect(screen.getByText('Choose XML File').closest('button')).toBeInTheDocument());
      await userEvent.click(screen.getByText('Split'));

      const result = await screen.findByTestId('split-result');
      expect(result).toHaveTextContent('2 failed, errored, or flaky tests split into 2 and 0');
      expect(screen.getByText(/Download File A/)).toBeInTheDocument();
      expect(screen.getByText(/Download File B/)).toBeInTheDocument();
    });

    it('downloads both files with the correct content when clicked', async () => {
      const spy = vi.spyOn(downloadUtil, 'downloadFile').mockImplementation(() => {});
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const file = new File([VALID_XML], 'results.xml', { type: 'text/xml' });
      await uploadFile(screen.getByLabelText('Upload XML file to split'), file);
      await userEvent.click(screen.getByText('Split'));
      await screen.findByTestId('split-result');

      await userEvent.click(screen.getByText(/Download File A/));
      await userEvent.click(screen.getByText(/Download File B/));

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('test-results-split-a.xml', expect.stringContaining('<testsuites'), 'application/xml');
      expect(spy).toHaveBeenCalledWith('test-results-split-b.xml', expect.stringContaining('<testsuites'), 'application/xml');
    });

    it('pre-fills from the currently loaded xmlContent when provided', () => {
      render(<SplitPage xmlContent={VALID_XML} onCombined={onCombined} setActiveTab={setActiveTab} />);

      expect(screen.getByText('Using: currently loaded file')).toBeInTheDocument();
      expect(screen.getByText('Split').closest('button')).not.toBeDisabled();
    });

    it('shows an error for invalid XML', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const file = new File(['<root></root>'], 'bad.xml', { type: 'text/xml' });
      await uploadFile(screen.getByLabelText('Upload XML file to split'), file);
      await userEvent.click(screen.getByText('Split'));

      expect(await screen.findByText('Invalid JUnit XML format')).toBeInTheDocument();
    });

    it('disables the Split button until a file is available', () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      expect(screen.getByText('Split').closest('button')).toBeDisabled();
    });

    it('tells the user when a file has no failures to split', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const noFailuresXml = `<?xml version="1.0" encoding="UTF-8"?>
        <testsuites><testsuite name="Suite" tests="1" failures="0" errors="0" skipped="0" time="1">
          <testcase name="passes" classname="C" time="1" />
        </testsuite></testsuites>`;
      const file = new File([noFailuresXml], 'clean.xml', { type: 'text/xml' });
      await uploadFile(screen.getByLabelText('Upload XML file to split'), file);
      await userEvent.click(screen.getByText('Split'));

      expect(await screen.findByText(/no failed or errored tests/)).toBeInTheDocument();
    });

    it('shows an error if the chosen file cannot be read', async () => {
      const readSpy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
        this.onerror?.(new ProgressEvent('error') as unknown as ProgressEvent<FileReader>);
      });
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const file = new File([VALID_XML], 'results.xml', { type: 'text/xml' });
      await uploadFile(screen.getByLabelText('Upload XML file to split'), file);

      expect(await screen.findByText('Could not read "results.xml".')).toBeInTheDocument();
      readSpy.mockRestore();
    });

    it('ignores a file picker change that has no file selected', () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      fireEvent.change(screen.getByLabelText('Upload XML file to split'), { target: { files: [] } });

      expect(screen.queryByText(/^Using:/)).not.toBeInTheDocument();
      expect(screen.getByText('Split').closest('button')).toBeDisabled();
    });

    it('ignores a drop that carries no files', () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const dropZone = screen.getByLabelText('Upload XML file to split').closest('div') as HTMLElement;
      fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

      expect(screen.queryByText(/^Using:/)).not.toBeInTheDocument();
      expect(screen.getByText('Split').closest('button')).toBeDisabled();
    });

    it('uses singular wording when exactly one failed test is split', async () => {
      const oneFailureXml = `<?xml version="1.0" encoding="UTF-8"?>
        <testsuites><testsuite name="Suite" tests="2" failures="1" errors="0" skipped="0" time="2">
          <testcase name="passes" classname="C" time="1" />
          <testcase name="fails" classname="C" time="1"><failure message="m" type="E">x</failure></testcase>
        </testsuite></testsuites>`;
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      await uploadFile(screen.getByLabelText('Upload XML file to split'), new File([oneFailureXml], 'one.xml'));
      await userEvent.click(screen.getByText('Split'));

      expect(await screen.findByTestId('split-result')).toHaveTextContent(/^1 failed, errored, or flaky test split into/);
    });

    it('shows a generic error when splitting throws a non-Error value', async () => {
      vi.spyOn(splitUtil, 'splitJUnitXml').mockImplementation(() => {
        throw 'boom';
      });
      render(<SplitPage xmlContent={VALID_XML} onCombined={onCombined} setActiveTab={setActiveTab} />);

      await userEvent.click(screen.getByText('Split'));

      expect(await screen.findByText('Failed to split this file.')).toBeInTheDocument();
    });
  });

  describe('Combine section', () => {
    it('combines two export files and reports merged totals', async () => {
      // The global test setup stubs localStorage as an inert no-op (see
      // src/test/setup.ts), so persistence is verified via the setItem call
      // args rather than a real get-after-set round trip.
      const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const bundleA = makeBundle('fail1');
      const bundleB = makeBundle('fail2');
      const fileA = new File([JSON.stringify(bundleA)], 'a.json', { type: 'application/json' });
      const fileB = new File([JSON.stringify(bundleB)], 'b.json', { type: 'application/json' });

      await uploadFile(screen.getByLabelText('Upload export A'), fileA);
      await uploadFile(screen.getByLabelText('Upload export B'), fileB);
      await userEvent.click(screen.getByText('Combine'));

      const result = await screen.findByTestId('combine-result');
      // 1 shared "passes" + fail1 + fail2 = 3 total, 2 failed
      expect(result).toHaveTextContent('Combined 3 tests (2 failed)');
      expect(onCombined).toHaveBeenCalledTimes(1);
      expect(onCombined.mock.calls[0][0].summary.total).toBe(3);

      expect(setItemSpy).toHaveBeenCalledWith('testFixProgress', expect.any(String));
      const storedProgress = JSON.parse(setItemSpy.mock.calls[0][1]);
      expect(Object.keys(storedProgress).sort()).toEqual(['Suite-fail1', 'Suite-fail2']);
    });

    it('also stores a results hash for the combined result, so a later upload can tell it apart from a different XML', async () => {
      const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const fileA = new File([JSON.stringify(makeBundle('fail1'))], 'a.json', { type: 'application/json' });
      const fileB = new File([JSON.stringify(makeBundle('fail2'))], 'b.json', { type: 'application/json' });
      await uploadFile(screen.getByLabelText('Upload export A'), fileA);
      await uploadFile(screen.getByLabelText('Upload export B'), fileB);
      await userEvent.click(screen.getByText('Combine'));

      await screen.findByTestId('combine-result');

      // Written after the progress blob, so combine-result's own `setItem('testFixProgress', ...)`
      // assertion (mock.calls[0]) keeps indexing the right call.
      expect(setItemSpy).toHaveBeenCalledWith('testFixProgress_resultsHash', expect.any(String));
    });

    it('navigates to the report tab when "Continue to Report" is clicked', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const fileA = new File([JSON.stringify(makeBundle('fail1'))], 'a.json');
      const fileB = new File([JSON.stringify(makeBundle('fail2'))], 'b.json');
      await uploadFile(screen.getByLabelText('Upload export A'), fileA);
      await uploadFile(screen.getByLabelText('Upload export B'), fileB);
      await userEvent.click(screen.getByText('Combine'));
      await screen.findByTestId('combine-result');

      await userEvent.click(screen.getByText('Continue to Report'));

      expect(setActiveTab).toHaveBeenCalledWith('report');
    });

    it('shows a warning banner when combine reports one (e.g. identical uploads)', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const bundle = makeBundle('fail1');
      const file1 = new File([JSON.stringify(bundle)], 'a.json');
      const file2 = new File([JSON.stringify(bundle)], 'b.json');
      await uploadFile(screen.getByLabelText('Upload export A'), file1);
      await uploadFile(screen.getByLabelText('Upload export B'), file2);
      await userEvent.click(screen.getByText('Combine'));

      expect(await screen.findByText(/identical/i)).toBeInTheDocument();
    });

    it('shows an error when a file is not a valid export bundle', async () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      const fileA = new File(['not json'], 'a.json');
      const fileB = new File([JSON.stringify(makeBundle('fail2'))], 'b.json');
      await uploadFile(screen.getByLabelText('Upload export A'), fileA);
      await uploadFile(screen.getByLabelText('Upload export B'), fileB);
      await userEvent.click(screen.getByText('Combine'));

      expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
      expect(onCombined).not.toHaveBeenCalled();
    });

    it('shows a generic error when combining fails with a non-Error value', async () => {
      vi.spyOn(exportBundleUtil, 'readExportBundle').mockRejectedValue('boom');
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      await uploadFile(screen.getByLabelText('Upload export A'), new File(['{}'], 'a.json'));
      await uploadFile(screen.getByLabelText('Upload export B'), new File(['{}'], 'b.json'));
      await userEvent.click(screen.getByText('Combine'));

      expect(await screen.findByText('Failed to combine these files.')).toBeInTheDocument();
      expect(onCombined).not.toHaveBeenCalled();
    });

    it('disables the Combine button until both files are selected', () => {
      render(<SplitPage xmlContent={null} onCombined={onCombined} setActiveTab={setActiveTab} />);

      expect(screen.getByText('Combine').closest('button')).toBeDisabled();
    });
  });
});
