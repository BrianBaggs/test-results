import { useEffect, useState, useMemo } from 'react';
import { CheckCircleIcon, XCircleIcon, ClockIcon, AlertTriangleIcon, MessageSquareIcon } from 'lucide-react';
import { TestDetailsModal } from '../Dashboard/TestDetailsModal';
import { FilterControls } from '../Dashboard/FilterControls';
import ClearLocalStorageButton from '../Dashboard/ClearLocalStorage';
import { BulkCommentModal, type BulkCommentResult } from './BulkCommentModal';
import type { TestData, TestCase } from '../../types';

interface FailureProgressItem {
  id: string;
  name: string;
  suite: string;
  errorMessage?: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes?: string;
  updatedAt?: string;
  assignee?: string;
}

interface FailureAnalysisProgressProps {
  testData: TestData | null;
}

export const FailureAnalysisProgress: React.FC<FailureAnalysisProgressProps> = ({
  testData
}) => {
  const [progressData, setProgressData] = useState<{
    [key: string]: FailureProgressItem;
  }>({});
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [assignee, setAssignee] = useState('');
  const [showStackTrace, setShowStackTrace] = useState<TestCase | null>(null);

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [suiteFilter, setSuiteFilter] = useState('all');
  const [classNameFilter, setClassNameFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const testsPerPage = 50;

  // Bulk actions state
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [showBulkCommentModal, setShowBulkCommentModal] = useState(false);
  useEffect(() => {
    if (!testData) return;

    // Load progress data from localStorage
    const savedProgress = localStorage.getItem('testFixProgress');
    if (savedProgress) {
      setProgressData(JSON.parse(savedProgress));
    } else {
      // Initialize progress data for failed tests
      const initialProgress: { [key: string]: FailureProgressItem } = {};
      testData.suites.forEach(suite => {
        suite.testcases.filter(test => test.status === 'failed').forEach(test => {
          const id = `${suite.name}-${test.name}`;
          initialProgress[id] = {
            id,
            name: test.name,
            suite: suite.name,
            errorMessage: test.errorMessage || undefined,
            status: 'pending',
            notes: '',
            updatedAt: new Date().toISOString()
          };
        });
      });
      setProgressData(initialProgress);
      localStorage.setItem('testFixProgress', JSON.stringify(initialProgress));
    }
  }, [testData]);
  const updateTestStatus = (testId: string, status: 'pending' | 'in_progress' | 'completed') => {
    const updatedProgress = {
      ...progressData,
      [testId]: {
        ...progressData[testId],
        status,
        updatedAt: new Date().toISOString(),
        notes: notes || progressData[testId].notes,
        assignee: assignee || progressData[testId].assignee
      }
    };
    setProgressData(updatedProgress);
    localStorage.setItem('testFixProgress', JSON.stringify(updatedProgress));
    setSelectedTest(null);
    setNotes('');
    setAssignee('');
  };

  // Bulk update function
  const updateBulkTestStatus = (testIds: string[], status: 'pending' | 'in_progress' | 'completed') => {
    const updatedProgress = { ...progressData };
    testIds.forEach(testId => {
      updatedProgress[testId] = {
        ...updatedProgress[testId],
        status,
        updatedAt: new Date().toISOString()
      };
    });
    setProgressData(updatedProgress);
    localStorage.setItem('testFixProgress', JSON.stringify(updatedProgress));
    setSelectedTests(new Set()); // Clear selection after bulk update
  };

  // Bulk comment handler
  const applyBulkComments = (result: BulkCommentResult) => {
    const updatedProgress = { ...progressData };
    Object.entries(result.comments).forEach(([testId, comment]) => {
      if (updatedProgress[testId]) {
        const individualAssignee = result.individualAssignees?.[testId];
        const individualStatus = result.individualStatuses?.[testId];
        updatedProgress[testId] = {
          ...updatedProgress[testId],
          notes: comment || updatedProgress[testId].notes,
          assignee: individualAssignee ?? result.assignee ?? updatedProgress[testId].assignee,
          status: individualStatus ?? result.status ?? updatedProgress[testId].status,
          updatedAt: new Date().toISOString()
        };
      }
    });
    setProgressData(updatedProgress);
    localStorage.setItem('testFixProgress', JSON.stringify(updatedProgress));
    setShowBulkCommentModal(false);
    setSelectedTests(new Set());
  };
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      case 'in_progress':
        return <ClockIcon className="w-5 h-5 text-blue-500" />;
      default:
        return <XCircleIcon className="w-5 h-5 text-red-500" />;
    }
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 border-green-200';
      case 'in_progress':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-red-50 border-red-200';
    }
  };
  const failedTests = Object.values(progressData);
  const totalTests = failedTests.length;
  const completedTests = failedTests.filter(test => test.status === 'completed').length;
  const inProgressTests = failedTests.filter(test => test.status === 'in_progress').length;

  // Get unique values for filters
  const suites = ['all', ...new Set(failedTests.map(test => test.suite))];
  const classNames = ['all']; // Progress doesn't track classnames, so just show 'all'

  // Custom status options for progress tracking
  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' }
  ];

  // Reset filters function
  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setSuiteFilter('all');
    setClassNameFilter('all');
    setCurrentPage(1);
  };

  // Filter tests based on search and filter criteria (memoized to prevent infinite re-renders)
  const filteredTests = useMemo(() => {
    return failedTests.filter(test => {
      // Status filter
      if (statusFilter !== 'all' && test.status !== statusFilter) return false;

      // Suite filter
      if (suiteFilter !== 'all' && test.suite !== suiteFilter) return false;

      // Search term (search in name, suite, error message, notes, and assignee)
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesName = test.name.toLowerCase().includes(searchLower);
        const matchesSuite = test.suite.toLowerCase().includes(searchLower);
        const matchesError = test.errorMessage?.toLowerCase().includes(searchLower);
        const matchesNotes = test.notes?.toLowerCase().includes(searchLower);
        const matchesAssignee = test.assignee?.toLowerCase().includes(searchLower);

        if (!matchesName && !matchesSuite && !matchesError && !matchesNotes && !matchesAssignee) {
          return false;
        }
      }

      return true;
    });
  }, [failedTests, statusFilter, suiteFilter, searchTerm]);

  // Reset to page 1 when filters change
  const totalPages = Math.ceil(filteredTests.length / testsPerPage);
  const validCurrentPage = Math.min(currentPage, Math.max(1, totalPages));
  if (validCurrentPage !== currentPage) {
    setCurrentPage(validCurrentPage);
  }

  // Paginate the filtered tests (memoized to prevent infinite re-renders)
  const paginationData = useMemo(() => {
    const startIndex = (validCurrentPage - 1) * testsPerPage;
    const endIndex = startIndex + testsPerPage;
    const paginatedTests = filteredTests.slice(startIndex, endIndex);
    return { startIndex, endIndex, paginatedTests };
  }, [filteredTests, validCurrentPage, testsPerPage]);

  const { startIndex, endIndex, paginatedTests } = paginationData;

  // Reset selectedTests when page changes (not when paginatedTests changes)
  useEffect(() => {
    setSelectedTests(new Set());
  }, [validCurrentPage]);
  // Selection functions (after paginatedTests is defined)
  const toggleTestSelection = (testId: string) => {
    const newSelection = new Set(selectedTests);
    if (newSelection.has(testId)) {
      newSelection.delete(testId);
    } else {
      newSelection.add(testId);
    }
    setSelectedTests(newSelection);
  };

  const toggleSelectAll = () => {
    if (paginatedTests.every(test => selectedTests.has(test.id))) {
      // If all visible tests are selected, deselect all
      setSelectedTests(new Set());
    } else {
      // Select all visible tests
      setSelectedTests(new Set(paginatedTests.map(test => test.id)));
    }
  };

  const handleShowStackTrace = (test: FailureProgressItem) => {
    if (!testData) return;

    // Find the original test data to get all details
    const suite = testData.suites.find(s => s.name === test.suite);
    const testDetails = suite?.testcases.find(t => t.name === test.name);
    if (!testDetails) return;
    // Create a complete test object with all necessary fields
    const modalTest: TestCase = {
      ...testDetails,
      suite: test.suite,
      status: 'failed' as const,
      errorMessage: testDetails.errorMessage || test.errorMessage,
      failureDetails: testDetails.failureDetails || {
        message: testDetails.errorMessage || test.errorMessage || 'Unknown error',
        type: 'Error',
        stackTrace: testDetails.errorMessage || test.errorMessage || 'No stack trace available'
      }
    };
    setShowStackTrace(modalTest);
  };

  if (!testData) {
    return <div className="bg-white p-8 rounded-lg shadow text-center">
        <AlertTriangleIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          No Test Data Available
        </h2>
        <p className="text-gray-600 mb-6">
          Please upload a JUnit XML file from the Dashboard to view failure
          resolution progress.
        </p>
      </div>;
  }

  return <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">
          Failure Resolution Progress
        </h2>
        <div className="flex mb-4">
          <ClearLocalStorageButton />
        </div>
        <div className="mb-4">
          <p className="text-sm text-gray-500">
            {filteredTests.length} test{filteredTests.length !== 1 ? 's' : ''} tracked
            {filteredTests.length > testsPerPage && (
              <span className="ml-2">
                (Showing {startIndex + 1}-{Math.min(endIndex, filteredTests.length)} of {filteredTests.length})
              </span>
            )}
          </p>
        </div>
        {/* Progress Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Total Failed Tests</span>
              <span className="text-xl font-bold text-gray-800">
                {totalTests}
              </span>
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-green-600">Completed</span>
              <span className="text-xl font-bold text-green-700">
                {completedTests}
              </span>
            </div>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-blue-600">In Progress</span>
              <span className="text-xl font-bold text-blue-700">
                {inProgressTests}
              </span>
            </div>
          </div>
        </div>
        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
          <div className="bg-green-600 h-2 rounded-full transition-all duration-300" style={{
          width: `${totalTests > 0 ? (completedTests / totalTests * 100) : 0}%`
        }} />
        </div>

        {/* Filter Controls */}
        <FilterControls
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          suiteFilter={suiteFilter}
          setSuiteFilter={setSuiteFilter}
          classNameFilter={classNameFilter}
          setClassNameFilter={setClassNameFilter}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          suites={suites}
          classNames={classNames}
          resetFilters={resetFilters}
          statusOptions={statusOptions}
        />

        {/* Bulk Actions Bar */}
        {paginatedTests.length > 0 && (
          <div className="bg-gray-50 border rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2">
                  <input
                    id="select-all-tests"
                    name="selectAllTests"
                    type="checkbox"
                    checked={selectedTests.size === paginatedTests.length && paginatedTests.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Select All ({selectedTests.size} selected)
                  </span>
                </label>
              </div>

              {selectedTests.size > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Bulk Actions:</span>
                  <button
                    onClick={() => updateBulkTestStatus(Array.from(selectedTests), 'pending')}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200 text-sm"
                  >
                    Mark as Pending
                  </button>
                  <button
                    onClick={() => updateBulkTestStatus(Array.from(selectedTests), 'in_progress')}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 text-sm"
                  >
                    Mark as In Progress
                  </button>
                  <button
                    onClick={() => updateBulkTestStatus(Array.from(selectedTests), 'completed')}
                    className="px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200 text-sm"
                  >
                    Mark as Complete
                  </button>
                  <span className="border-l border-gray-300 h-5" />
                  <button
                    onClick={() => setShowBulkCommentModal(true)}
                    className="px-3 py-1 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 text-sm flex items-center gap-1"
                    data-testid="bulk-comment-btn"
                  >
                    <MessageSquareIcon className="w-3 h-3" />
                    Bulk Comment
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Failed Tests List */}
        <div className="space-y-4">
          {paginatedTests.map(test => {
            const safeId = test.id.replace(/\s+/g, '_');
            return <div key={test.id} className={`border rounded-lg overflow-hidden ${getStatusColor(test.status)}`}>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <input
                      id={`select-test-${safeId}`}
                      name={`selectTest-${safeId}`}
                      type="checkbox"
                      checked={selectedTests.has(test.id)}
                      onChange={() => toggleTestSelection(test.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label={`Select ${test.name}`}
                    />
                    {getStatusIcon(test.status)}
                    <div>
                      <h4 className="text-lg font-medium text-gray-900">
                        {test.name}
                      </h4>
                      <p className="text-sm text-gray-500">
                        Suite: {test.suite}
                      </p>
                    </div>
                  </div>
                  {selectedTest !== test.id ? <button onClick={() => {
                      setSelectedTest(test.id);
                      setNotes(progressData[test.id]?.notes || '');
                      setAssignee(progressData[test.id]?.assignee || '');
                    }} className="px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                      Edit
                    </button> : <div className="flex space-x-2">
                      <button onClick={() => updateTestStatus(test.id, 'pending')} className="px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200">
                        Pending
                      </button>
                      <button onClick={() => updateTestStatus(test.id, 'in_progress')} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200">
                        In Progress
                      </button>
                      <button onClick={() => updateTestStatus(test.id, 'completed')} className="px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200">
                        Complete
                      </button>
                    </div>}
                </div>
                {/* Add Stack Trace button */}
                <div className="mt-2 flex justify-end">
                  <button onClick={() => handleShowStackTrace(test)} className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">
                    View Stack Trace
                  </button>
                </div>
                {selectedTest === test.id && <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor={`assignee-${safeId}`} className="block text-sm font-medium text-gray-700 mb-1">
                        Assignee
                      </label>
                      <input id={`assignee-${safeId}`} name={`assignee-${safeId}`} type="text" value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Who is working on this?" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    </div>
                    <div>
                      <label htmlFor={`notes-${safeId}`} className="block text-sm font-medium text-gray-700 mb-1">
                        Notes
                      </label>
                      <textarea id={`notes-${safeId}`} name={`notes-${safeId}`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes about the fix..." className="w-full px-3 py-2 border border-gray-300 rounded-md" rows={3} />
                    </div>
                  </div>}
                {!selectedTest && test.notes && <div className="mt-2 text-sm text-gray-600">
                    <p>
                      <strong>Notes:</strong> {test.notes}
                    </p>
                    {test.assignee && <p>
                        <strong>Assignee:</strong> {test.assignee}
                      </p>}
                    <p>
                      <strong>Last Updated:</strong>{' '}
                      {new Date(test.updatedAt || new Date()).toLocaleString()}
                    </p>
                  </div>}
              </div>
            </div>})}
        </div>

        {/* Pagination Controls */}
        {filteredTests.length > testsPerPage && (
          <div className="flex items-center justify-between mt-6 px-4 py-3 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center text-sm text-gray-500">
              Showing {startIndex + 1} to {Math.min(endIndex, filteredTests.length)} of {filteredTests.length} results
              <span className="ml-2">Page {currentPage} of {totalPages}</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>

              <div className="flex items-center space-x-1">
                {/* Show page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-2 text-sm font-medium rounded-md ${
                        currentPage === pageNum
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Stack Trace Modal */}
      {showStackTrace && <TestDetailsModal test={showStackTrace} onClose={() => setShowStackTrace(null)} />}

      {/* Bulk Comment Modal */}
      {showBulkCommentModal && (
        <BulkCommentModal
          selectedItems={Array.from(selectedTests)
            .map(id => progressData[id])
            .filter(Boolean)}
          onApply={applyBulkComments}
          onClose={() => setShowBulkCommentModal(false)}
        />
      )}
    </div>;
};
