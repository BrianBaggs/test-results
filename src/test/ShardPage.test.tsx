import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShardPage } from '../components/Shard/ShardPage';
import * as downloadUtil from '../utils/download';
import * as mergeUtil from '../utils/mergeJUnitXml';

function shardXml(suiteName: string, tests: number, failures: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="" name="" tests="${tests}" failures="${failures}" errors="0" skipped="0" time="1.0">
  <testsuite name="${suiteName}" tests="${tests}" failures="${failures}" errors="0" skipped="0" time="1.0">
    ${Array.from({ length: tests }, (_, i) =>
      i < failures
        ? `<testcase name="fails${i}" classname="C" time="0.5"><failure message="m" type="E">x</failure></testcase>`
        : `<testcase name="passes${i}" classname="C" time="0.5" />`
    ).join('\n')}
  </testsuite>
</testsuites>`;
}

async function uploadFiles(input: HTMLElement, files: File[]) {
  const user = userEvent.setup();
  await user.upload(input, files);
}

describe('ShardPage', () => {
  const onDataUpload = vi.fn();
  const onXmlContent = vi.fn();
  const setActiveTab = vi.fn();

  afterEach(() => {
    vi.restoreAllMocks();
    onDataUpload.mockClear();
    onXmlContent.mockClear();
    setActiveTab.mockClear();
  });

  it('disables the Combine Shards button until at least two files are added', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    expect(screen.getByText('Combine Shards').closest('button')).toBeDisabled();

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    const file1 = new File([shardXml('Suite1', 2, 1)], 'shard-1.xml', { type: 'text/xml' });
    await uploadFiles(input, [file1]);

    await screen.findByText('shard-1.xml');
    expect(screen.getByText('Combine Shards').closest('button')).toBeDisabled();
    expect(screen.getByText('Add at least one more shard report to combine.')).toBeInTheDocument();
  });

  it('accepts multiple files selected at once and enables Combine Shards', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    const file1 = new File([shardXml('Suite1', 2, 1)], 'shard-1.xml', { type: 'text/xml' });
    const file2 = new File([shardXml('Suite2', 1, 0)], 'shard-2.xml', { type: 'text/xml' });
    await uploadFiles(input, [file1, file2]);

    await screen.findByText('shard-1.xml');
    expect(screen.getByText('shard-2.xml')).toBeInTheDocument();
    expect(screen.getByText('Combine Shards').closest('button')).not.toBeDisabled();
  });

  it('accepts files dropped onto the drop zone', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const dropZone = screen.getByLabelText('Upload JUnit XML shard reports').closest('div') as HTMLElement;
    const file1 = new File([shardXml('Suite1', 1, 0)], 'dropped-1.xml', { type: 'text/xml' });
    const file2 = new File([shardXml('Suite2', 1, 0)], 'dropped-2.xml', { type: 'text/xml' });

    fireEvent.dragOver(dropZone);
    expect(dropZone.className).toContain('bg-primary/5');

    fireEvent.dragLeave(dropZone);
    expect(dropZone.className).not.toContain('bg-primary/5');

    fireEvent.drop(dropZone, { dataTransfer: { files: [file1, file2] } });

    await waitFor(() => expect(screen.getByText('dropped-1.xml')).toBeInTheDocument());
    expect(screen.getByText('dropped-2.xml')).toBeInTheDocument();
  });

  it('combines uploaded shards and shows merged totals', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    const file1 = new File([shardXml('Suite1', 2, 1)], 'shard-1.xml', { type: 'text/xml' });
    const file2 = new File([shardXml('Suite2', 3, 0)], 'shard-2.xml', { type: 'text/xml' });
    await uploadFiles(input, [file1, file2]);
    await screen.findByText('shard-2.xml');

    await userEvent.click(screen.getByText('Combine Shards'));

    const result = await screen.findByTestId('shard-result');
    expect(result).toHaveTextContent('Combined 5 tests (1 failed) from 2 files across 2 suites.');
  });

  it('removes a file from the list and clears any existing result', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    const file1 = new File([shardXml('Suite1', 1, 0)], 'shard-1.xml', { type: 'text/xml' });
    const file2 = new File([shardXml('Suite2', 1, 0)], 'shard-2.xml', { type: 'text/xml' });
    await uploadFiles(input, [file1, file2]);
    await screen.findByText('shard-2.xml');
    await userEvent.click(screen.getByText('Combine Shards'));
    await screen.findByTestId('shard-result');

    await userEvent.click(screen.getByLabelText('Remove shard-2.xml'));

    expect(screen.queryByText('shard-2.xml')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shard-result')).not.toBeInTheDocument();
    expect(screen.getByText('Combine Shards').closest('button')).toBeDisabled();
  });

  it('downloads the combined XML with the expected filename and content type', async () => {
    const spy = vi.spyOn(downloadUtil, 'downloadFile').mockImplementation(() => {});
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    await uploadFiles(input, [
      new File([shardXml('Suite1', 1, 0)], 'shard-1.xml', { type: 'text/xml' }),
      new File([shardXml('Suite2', 1, 0)], 'shard-2.xml', { type: 'text/xml' }),
    ]);
    await screen.findByText('shard-2.xml');
    await userEvent.click(screen.getByText('Combine Shards'));
    await screen.findByTestId('shard-result');

    await userEvent.click(screen.getByText('Download Combined XML'));

    expect(spy).toHaveBeenCalledWith('test-results-combined.xml', expect.stringContaining('<testsuites'), 'application/xml');
  });

  it('loads the combined result into the dashboard when "View in Dashboard" is clicked', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    await uploadFiles(input, [
      new File([shardXml('Suite1', 2, 1)], 'shard-1.xml', { type: 'text/xml' }),
      new File([shardXml('Suite2', 1, 0)], 'shard-2.xml', { type: 'text/xml' }),
    ]);
    await screen.findByText('shard-2.xml');
    await userEvent.click(screen.getByText('Combine Shards'));
    await screen.findByTestId('shard-result');

    await userEvent.click(screen.getByText('View in Dashboard'));

    expect(onDataUpload).toHaveBeenCalledTimes(1);
    expect(onDataUpload.mock.calls[0][0].summary.total).toBe(3);
    expect(onXmlContent).toHaveBeenCalledWith(expect.stringContaining('<testsuites'));
    expect(setActiveTab).toHaveBeenCalledWith('dashboard');
  });

  it('shows a warning banner when the same suite name appears in more than one file', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    await uploadFiles(input, [
      new File([shardXml('Overlap', 1, 0)], 'shard-1.xml', { type: 'text/xml' }),
      new File([shardXml('Overlap', 1, 1)], 'shard-2.xml', { type: 'text/xml' }),
    ]);
    await screen.findByText('shard-2.xml');

    await userEvent.click(screen.getByText('Combine Shards'));

    expect(await screen.findByText(/appears in more than one file/)).toBeInTheDocument();
  });

  it('shows an error for invalid XML, naming the offending file', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    await uploadFiles(input, [
      new File([shardXml('Suite1', 1, 0)], 'shard-1.xml', { type: 'text/xml' }),
      new File(['<root></root>'], 'bad.xml', { type: 'text/xml' }),
    ]);
    await screen.findByText('bad.xml');

    await userEvent.click(screen.getByText('Combine Shards'));

    expect(await screen.findByText('"bad.xml": Invalid JUnit XML format')).toBeInTheDocument();
    expect(onDataUpload).not.toHaveBeenCalled();
  });

  it('shows an error if a chosen file cannot be read', async () => {
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as unknown as ProgressEvent<FileReader>);
    });
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports');
    await uploadFiles(input, [new File([shardXml('Suite1', 1, 0)], 'shard-1.xml', { type: 'text/xml' })]);

    expect(await screen.findByText('Could not read one or more of the selected files.')).toBeInTheDocument();
    readSpy.mockRestore();
  });

  it('opens the file picker when "Choose XML Files" is clicked', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const input = screen.getByLabelText('Upload JUnit XML shard reports') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    await userEvent.click(screen.getByText('Choose XML Files'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a file picker change with no files selected', () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    fireEvent.change(screen.getByLabelText('Upload JUnit XML shard reports'), { target: { files: [] } });

    expect(screen.getByText('Combine Shards').closest('button')).toBeDisabled();
  });

  it('uses singular wording when the combined result has one test and one suite', async () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    await uploadFiles(screen.getByLabelText('Upload JUnit XML shard reports'), [
      new File([shardXml('Only', 1, 0)], 'a.xml', { type: 'text/xml' }),
      new File([shardXml('Only', 1, 0)], 'b.xml', { type: 'text/xml' }),
    ]);
    await userEvent.click(screen.getByText('Combine Shards'));

    expect(await screen.findByTestId('shard-result')).toHaveTextContent(/Combined 1 test \(0 failed\) from 2 files across 1 suite\./);
  });

  it('shows a generic error when combining throws a non-Error value', async () => {
    vi.spyOn(mergeUtil, 'mergeJUnitXml').mockImplementation(() => {
      throw 'boom';
    });
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    await uploadFiles(screen.getByLabelText('Upload JUnit XML shard reports'), [
      new File([shardXml('A', 1, 0)], 'a.xml', { type: 'text/xml' }),
      new File([shardXml('B', 1, 0)], 'b.xml', { type: 'text/xml' }),
    ]);
    await userEvent.click(screen.getByText('Combine Shards'));

    expect(await screen.findByText('Failed to combine these files.')).toBeInTheDocument();
  });

  it('ignores an empty file drop', () => {
    render(<ShardPage onDataUpload={onDataUpload} onXmlContent={onXmlContent} setActiveTab={setActiveTab} />);

    const dropZone = screen.getByLabelText('Upload JUnit XML shard reports').closest('div') as HTMLElement;
    fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

    expect(screen.getByText('Combine Shards').closest('button')).toBeDisabled();
  });
});
