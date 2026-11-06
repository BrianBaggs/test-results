import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { App } from '../App';
import { syncProgressStorageForNewXml } from '../utils/progressStorage';

vi.mock('../utils/progressStorage', () => ({
  syncProgressStorageForNewXml: vi.fn().mockResolvedValue({ cleared: false }),
}));

// Mock the child components to isolate App testing
vi.mock('../components/Layout/Navbar', () => ({
  Navbar: ({ activeTab, setActiveTab }: { activeTab: string; setActiveTab: (tab: string) => void }) => (
    <div data-testid="navbar">
      <button data-testid="dashboard-tab" onClick={() => setActiveTab('dashboard')}>
        Dashboard {activeTab === 'dashboard' && '(active)'}
      </button>
      <button data-testid="failures-tab" onClick={() => setActiveTab('failures')}>
        Failures {activeTab === 'failures' && '(active)'}
      </button>
      <button data-testid="progress-tab" onClick={() => setActiveTab('progress')}>
        Progress {activeTab === 'progress' && '(active)'}
      </button>
      <button data-testid="report-tab" onClick={() => setActiveTab('report')}>
        Report {activeTab === 'report' && '(active)'}
      </button>
      <button data-testid="publish-tab" onClick={() => setActiveTab('publish')}>
        Publish {activeTab === 'publish' && '(active)'}
      </button>
      <button data-testid="split-tab" onClick={() => setActiveTab('split')}>
        Split {activeTab === 'split' && '(active)'}
      </button>
      <button data-testid="shard-tab" onClick={() => setActiveTab('shard')}>
        Shard {activeTab === 'shard' && '(active)'}
      </button>
      <button data-testid="review-tab" onClick={() => setActiveTab('review')}>
        Review {activeTab === 'review' && '(active)'}
      </button>
      <button data-testid="bogus-tab" onClick={() => setActiveTab('bogus')}>
        Bogus
      </button>
    </div>
  ),
}));

vi.mock('../components/Dashboard/Dashboard', () => ({
  Dashboard: ({ onDataUpload, onXmlContent, testData }: { onDataUpload: (data: unknown) => void; onXmlContent?: (content: string) => void; testData: unknown }) => (
    <div data-testid="dashboard">
      Dashboard Component
      <button data-testid="upload-data" onClick={() => { onDataUpload({ test: 'data' }); onXmlContent?.('<test>xml</test>'); }}>
        Upload Data
      </button>
      {testData ? <div data-testid="test-data">Test data loaded</div> : null}
    </div>
  ),
}));

vi.mock('../components/FailureAnalysis/FailureAnalysisPage', () => ({
  FailureAnalysisPage: ({ testData }: { testData: unknown }) => (
    <div data-testid="failure-analysis">
      Failure Analysis
      {testData ? <div data-testid="failure-test-data">Data available</div> : null}
    </div>
  ),
}));

vi.mock('../components/FailureAnalysis/FailureAnalysisProgress', () => ({
  FailureAnalysisProgress: ({ testData }: { testData: unknown }) => (
    <div data-testid="failure-progress">
      Progress Component
      {testData ? <div data-testid="progress-test-data">Data available</div> : null}
    </div>
  ),
}));

vi.mock('../components/ReportGenerator/ReportGenerator', () => ({
  ReportGenerator: ({ testData }: { testData: unknown }) => (
    <div data-testid="report-generator">
      Report Generator
      {testData ? <div data-testid="report-test-data">Data available</div> : null}
    </div>
  ),
}));

vi.mock('../components/Publish/PublishPage', () => ({
  PublishPage: ({ testData }: { testData: unknown }) => (
    <div data-testid="publish-page">
      Publish Page
      {testData ? <div data-testid="publish-test-data">Test data available</div> : null}
    </div>
  ),
}));

vi.mock('../components/Split/SplitPage', () => ({
  SplitPage: ({
    xmlContent,
    onCombined,
    setActiveTab,
  }: {
    xmlContent: string | null;
    onCombined: (data: unknown) => void;
    setActiveTab: (tab: string) => void;
  }) => (
    <div data-testid="split-page">
      Split Page
      {xmlContent ? <div data-testid="split-xml-content">XML content available</div> : null}
      <button data-testid="combine-and-go-to-report" onClick={() => { onCombined({ combined: true }); setActiveTab('report'); }}>
        Combine
      </button>
    </div>
  ),
}));

vi.mock('../components/Shard/ShardPage', () => ({
  ShardPage: ({
    onDataUpload,
    onXmlContent,
    setActiveTab,
  }: {
    onDataUpload: (data: unknown) => void;
    onXmlContent: (content: string) => void;
    setActiveTab: (tab: string) => void;
  }) => (
    <div data-testid="shard-page">
      Shard Page
      <button
        data-testid="shard-and-go-to-dashboard"
        onClick={() => { onDataUpload({ sharded: true }); onXmlContent('<testsuites>sharded</testsuites>'); setActiveTab('dashboard'); }}
      >
        Combine Shards
      </button>
    </div>
  ),
}));

vi.mock('../components/Review/ReviewPage', () => ({
  ReviewPage: () => <div data-testid="review-page">Review Page</div>,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with dashboard as default tab', () => {
    render(<App />);

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByText('Dashboard (active)')).toBeInTheDocument();
  });

  it('should switch to failures tab when clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('failures-tab'));

    expect(screen.getByTestId('failure-analysis')).toBeInTheDocument();
    expect(screen.getByText('Failures (active)')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('should switch to progress tab when clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('progress-tab'));

    expect(screen.getByTestId('failure-progress')).toBeInTheDocument();
    expect(screen.getByText('Progress (active)')).toBeInTheDocument();
  });

  it('should switch to report tab when clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('report-tab'));

    expect(screen.getByTestId('report-generator')).toBeInTheDocument();
    expect(screen.getByText('Report (active)')).toBeInTheDocument();
  });

  it('should handle data upload and pass data to components', () => {
    render(<App />);

    // Upload data from dashboard
    fireEvent.click(screen.getByTestId('upload-data'));

    // Verify data is shown in dashboard
    expect(screen.getByTestId('test-data')).toBeInTheDocument();

    // Switch to failures tab and verify data is passed
    fireEvent.click(screen.getByTestId('failures-tab'));
    expect(screen.getByTestId('failure-test-data')).toBeInTheDocument();

    // Switch to progress tab and verify data is passed
    fireEvent.click(screen.getByTestId('progress-tab'));
    expect(screen.getByTestId('progress-test-data')).toBeInTheDocument();

    // Switch to report tab and verify data is passed
    fireEvent.click(screen.getByTestId('report-tab'));
    expect(screen.getByTestId('report-test-data')).toBeInTheDocument();
  });

  it('should fall back to dashboard for an unrecognized tab value', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('failures-tab'));
    expect(screen.getByTestId('failure-analysis')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bogus-tab'));

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('failure-analysis')).not.toBeInTheDocument();
  });

  it('should switch to publish tab when clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('publish-tab'));

    expect(screen.getByTestId('publish-page')).toBeInTheDocument();
    expect(screen.getByText('Publish (active)')).toBeInTheDocument();
  });

  it('should switch to split tab when clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('split-tab'));

    expect(screen.getByTestId('split-page')).toBeInTheDocument();
    expect(screen.getByText('Split (active)')).toBeInTheDocument();
  });

  it('should pass xml content to split page after upload', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('upload-data'));
    fireEvent.click(screen.getByTestId('split-tab'));

    expect(screen.getByTestId('split-xml-content')).toBeInTheDocument();
  });

  it('should load combined data and switch to report when split page combines', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('split-tab'));
    fireEvent.click(screen.getByTestId('combine-and-go-to-report'));

    expect(screen.getByTestId('report-generator')).toBeInTheDocument();
    expect(screen.getByTestId('report-test-data')).toBeInTheDocument();
  });

  it('should pass parsed test data to publish page after upload', () => {
    render(<App />);

    // Upload data from dashboard
    fireEvent.click(screen.getByTestId('upload-data'));

    // Switch to publish tab
    fireEvent.click(screen.getByTestId('publish-tab'));

    expect(screen.getByTestId('publish-test-data')).toBeInTheDocument();
  });

  it('should maintain test data when switching tabs', () => {
    render(<App />);

    // Upload data
    fireEvent.click(screen.getByTestId('upload-data'));

    // Switch tabs multiple times
    fireEvent.click(screen.getByTestId('failures-tab'));
    fireEvent.click(screen.getByTestId('dashboard-tab'));
    fireEvent.click(screen.getByTestId('report-tab'));

    // Data should still be available
    expect(screen.getByTestId('report-test-data')).toBeInTheDocument();
  });

  it('checks whether the uploaded XML matches what was already stored', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('upload-data'));

    await waitFor(() => {
      expect(syncProgressStorageForNewXml).toHaveBeenCalledWith({ test: 'data' });
    });
  });

  it('toasts when the uploaded XML differs from what was already stored', async () => {
    vi.mocked(syncProgressStorageForNewXml).mockResolvedValueOnce({ cleared: true });
    const toastSpy = vi.spyOn(toast, 'success');

    render(<App />);
    fireEvent.click(screen.getByTestId('upload-data'));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        'Loaded a different XML file — previous failure-resolution progress was cleared.'
      );
    });
  });

  it('does not toast when the uploaded XML matches what was already stored', async () => {
    const toastSpy = vi.spyOn(toast, 'success');

    render(<App />);
    fireEvent.click(screen.getByTestId('upload-data'));

    await waitFor(() => {
      expect(syncProgressStorageForNewXml).toHaveBeenCalled();
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('does not check for a different XML when data arrives via Combine', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('split-tab'));
    fireEvent.click(screen.getByTestId('combine-and-go-to-report'));

    expect(syncProgressStorageForNewXml).not.toHaveBeenCalled();
  });

  it('should switch to the review tab when clicked', () => {
    render(<App />);

    expect(screen.queryByTestId('review-page')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('review-tab'));

    expect(screen.getByTestId('review-page')).toBeInTheDocument();
    expect(screen.getByTestId('review-tab')).toHaveTextContent('(active)');
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('should switch to shard tab when clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('shard-tab'));

    expect(screen.getByTestId('shard-page')).toBeInTheDocument();
    expect(screen.getByText('Shard (active)')).toBeInTheDocument();
  });

  it('loads combined shard data into the dashboard and treats it like any other XML upload', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('shard-tab'));
    fireEvent.click(screen.getByTestId('shard-and-go-to-dashboard'));

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('test-data')).toBeInTheDocument();
    await waitFor(() => {
      expect(syncProgressStorageForNewXml).toHaveBeenCalledWith({ sharded: true });
    });
  });
});
