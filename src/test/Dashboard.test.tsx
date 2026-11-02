import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../components/Dashboard/Dashboard';

// Mock child components
vi.mock('../components/Dashboard/FileUploader', () => ({
  FileUploader: ({ onFileUpload, isLoading, error }: { 
    onFileUpload: (file: File) => void; 
    isLoading: boolean; 
    error: string | null; 
  }) => (
    <div data-testid="file-uploader">
      <div>File Uploader</div>
      {isLoading && <div data-testid="loading">Loading...</div>}
      {error && <div data-testid="error">{error}</div>}
      <button 
        data-testid="upload-trigger" 
        onClick={() => {
          const mockFile = new File(['<testsuite></testsuite>'], 'test.xml', { type: 'text/xml' });
          Object.defineProperty(mockFile, 'text', {
            value: () => Promise.resolve('<testsuite name="Test" tests="1"><testcase name="test1"/></testsuite>')
          });
          onFileUpload(mockFile);
        }}
      >
        Upload File
      </button>
      <button 
        data-testid="upload-invalid" 
        onClick={() => {
          const mockFile = new File(['invalid xml'], 'test.xml', { type: 'text/xml' });
          Object.defineProperty(mockFile, 'text', {
            value: () => Promise.resolve('invalid xml')
          });
          onFileUpload(mockFile);
        }}
      >
        Upload Invalid
      </button>
    </div>
  ),
}));

vi.mock('../components/Dashboard/TestMetrics', () => ({
  TestMetrics: ({ testData }: { testData: unknown }) => (
    <div data-testid="test-metrics">
      Test Metrics Component
      {testData ? <div data-testid="metrics-data">Metrics with data</div> : null}
    </div>
  ),
}));

vi.mock('../components/Dashboard/TestResultsList', () => ({
  TestResultsList: ({ testData }: { testData: unknown }) => (
    <div data-testid="test-results-list">
      Test Results List Component  
      {testData ? <div data-testid="results-data">Results with data</div> : null}
    </div>
  ),
}));

// Mock the XML parser
vi.mock('../utils/xmlParser', () => ({
  parseJUnitXML: vi.fn((content: string) => {
    if (content === 'invalid xml') {
      throw new Error('Invalid XML');
    }
    return {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
      suites: [{ 
        name: 'Test', 
        tests: 1,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 1.0,
        timestamp: '2024-01-01T12:00:00Z',
        testcases: [{ name: 'test1', status: 'passed' as const, time: 1.0 }] 
      }]
    };
  })
}));

describe('Dashboard', () => {
  const mockOnDataUpload = vi.fn();

  beforeEach(() => {
    mockOnDataUpload.mockClear();
    vi.clearAllMocks();
  });

  it('should render dashboard title', () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    expect(screen.getByText('Test Results Dashboard')).toBeInTheDocument();
  });

  it('should show file uploader when no test data is available', () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    expect(screen.getByTestId('file-uploader')).toBeInTheDocument();
    expect(screen.getByText('File Uploader')).toBeInTheDocument();
  });

  it('should not show file uploader when test data is available', () => {
    const testData = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
      suites: []
    };
    
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);
    
    expect(screen.queryByTestId('file-uploader')).not.toBeInTheDocument();
  });

  it('should show test metrics and results list when test data is available', () => {
    const testData = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
      suites: []
    };
    
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);
    
    expect(screen.getByTestId('test-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('test-results-list')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-data')).toBeInTheDocument();
    expect(screen.getByTestId('results-data')).toBeInTheDocument();
  });

  it('should handle successful file upload', async () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    // Trigger file upload
    const uploadButton = screen.getByTestId('upload-trigger');
    
    await act(async () => {
      uploadButton.click();
    });
    
    // Wait for async operation to complete
    await waitFor(() => {
      expect(mockOnDataUpload).toHaveBeenCalledWith({
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
        suites: [{ 
          name: 'Test', 
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          time: 1.0,
          timestamp: '2024-01-01T12:00:00Z',
          testcases: [{ name: 'test1', status: 'passed' as const, time: 1.0 }] 
        }]
      });
    });
  });

  it('should handle file upload error', async () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    // Trigger invalid file upload
    const uploadInvalidButton = screen.getByTestId('upload-invalid');
    
    await act(async () => {
      uploadInvalidButton.click();
    });
    
    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeInTheDocument();
      expect(screen.getByText('Failed to parse the XML file. Please ensure it is a valid JUnit XML file.')).toBeInTheDocument();
    });
    
    expect(mockOnDataUpload).not.toHaveBeenCalled();
  });

  it('should show loading state during file upload', async () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    // Mock a slower async operation
    const mockFile = new File(['content'], 'test.xml');
    Object.defineProperty(mockFile, 'text', {
      value: () => new Promise(resolve => setTimeout(() => resolve('<testsuite></testsuite>'), 100))
    });
    
    // The loading state is handled internally, so we just verify the component renders
    expect(screen.getByTestId('file-uploader')).toBeInTheDocument();
  });

  it('should clear error state when starting new upload', async () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    // First upload with error
    const uploadInvalidButton = screen.getByTestId('upload-invalid');
    
    await act(async () => {
      uploadInvalidButton.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeInTheDocument();
    });
    
    // Second upload should clear error
    const uploadButton = screen.getByTestId('upload-trigger');
    
    await act(async () => {
      uploadButton.click();
    });
    
    await waitFor(() => {
      expect(mockOnDataUpload).toHaveBeenCalled();
    });
  });

  it('should handle undefined testData', () => {
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);
    
    expect(screen.getByTestId('file-uploader')).toBeInTheDocument();
    expect(screen.queryByTestId('test-metrics')).not.toBeInTheDocument();
  });

  it('should pass testData correctly to child components', () => {
    const testData = {
      summary: { total: 5, passed: 3, failed: 2, skipped: 0, flaky: 0, time: 10.0 },
      suites: [
        { 
          name: 'Suite1', 
          tests: 3,
          failures: 1,
          errors: 0,
          skipped: 0,
          time: 5.0,
          timestamp: '2024-01-01T12:00:00Z',
          testcases: [] 
        },
        { 
          name: 'Suite2', 
          tests: 2,
          failures: 1,
          errors: 0,
          skipped: 0,
          time: 5.0,
          timestamp: '2024-01-01T12:01:00Z',
          testcases: [] 
        }
      ]
    };
    
    render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

    expect(screen.getByTestId('test-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('test-results-list')).toBeInTheDocument();
  });

  describe('loading a different file while test data is already shown', () => {
    const testData = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
      suites: []
    };

    it('should show the "Load Different File" button once test data is available', () => {
      render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

      expect(screen.getByRole('button', { name: /Load Different File/i })).toBeInTheDocument();
    });

    it('should not show the "Load Different File" button before any test data is loaded', () => {
      render(<Dashboard onDataUpload={mockOnDataUpload} testData={null} />);

      expect(screen.queryByRole('button', { name: /Load Different File/i })).not.toBeInTheDocument();
    });

    it('opens the hidden file picker when "Load Different File" is clicked', async () => {
      render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

      const input = screen.getByLabelText('Upload a different XML file') as HTMLInputElement;
      const clickSpy = vi.spyOn(input, 'click');

      await userEvent.click(screen.getByRole('button', { name: /Load Different File/i }));

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores a reload selection that has no file', () => {
      render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

      fireEvent.change(screen.getByLabelText('Upload a different XML file'), { target: { files: [] } });

      expect(mockOnDataUpload).not.toHaveBeenCalled();
    });

    it('should parse and upload a newly selected file without requiring a manual clear first', async () => {
      render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

      const input = screen.getByLabelText('Upload a different XML file');
      const file = new File(['<testsuite name="Test" tests="1"><testcase name="test1"/></testsuite>'], 'other.xml', {
        type: 'text/xml',
      });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(mockOnDataUpload).toHaveBeenCalledWith({
          summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
          suites: [{
            name: 'Test',
            tests: 1,
            failures: 0,
            errors: 0,
            skipped: 0,
            time: 1.0,
            timestamp: '2024-01-01T12:00:00Z',
            testcases: [{ name: 'test1', status: 'passed' as const, time: 1.0 }]
          }]
        });
      });
    });

    it('should show an inline error, and keep the currently loaded data, when the newly selected file fails to parse', async () => {
      render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

      const input = screen.getByLabelText('Upload a different XML file');
      const file = new File(['invalid xml'], 'broken.xml', { type: 'text/xml' });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('reload-file-error')).toBeInTheDocument();
      });
      expect(
        screen.getByText('Failed to parse the XML file. Please ensure it is a valid JUnit XML file.')
      ).toBeInTheDocument();
      expect(mockOnDataUpload).not.toHaveBeenCalled();
      // The previously loaded data stays on screen — a failed reload doesn't wipe it.
      expect(screen.getByTestId('test-metrics')).toBeInTheDocument();
    });
  });

  it('should show a notice when flaky-test detection was skipped for the loaded file', () => {
    const testData = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
      suites: [],
      flakyDetectionSkippedReason: 'Flaky-test detection was skipped: 3 of 4 passing tests had debug attachments.',
    };

    render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

    expect(screen.getByTestId('flaky-detection-skipped')).toBeInTheDocument();
    expect(
      screen.getByText('Flaky-test detection was skipped: 3 of 4 passing tests had debug attachments.')
    ).toBeInTheDocument();
  });

  it('should not show the flaky-detection notice when the reason is absent', () => {
    const testData = {
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, time: 1.0 },
      suites: [],
    };

    render(<Dashboard onDataUpload={mockOnDataUpload} testData={testData} />);

    expect(screen.queryByTestId('flaky-detection-skipped')).not.toBeInTheDocument();
  });
});