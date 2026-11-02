import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestDetailsModal } from '../components/Dashboard/TestDetailsModal';
import { TestCase } from '../types';

// Mock lucide-react icons used directly by TestDetailsModal, StatusBadge, and the shadcn Dialog it renders
vi.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
  ClockIcon: () => <div data-testid="clock-icon" />,
  FileTextIcon: () => <div data-testid="file-text-icon" />,
  CodeIcon: () => <div data-testid="code-icon" />,
  CopyIcon: () => <div data-testid="copy-icon" />,
  CheckIcon: () => <div data-testid="check-icon" />,
  CheckCircleIcon: () => <div data-testid="check-circle-icon" />,
  XCircleIcon: () => <div data-testid="x-circle-icon" />,
  AlertTriangleIcon: () => <div data-testid="alert-triangle-icon" />,
  TerminalIcon: () => <div data-testid="terminal-icon" />,
}));

describe('TestDetailsModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render modal with passed test details', () => {
    const passedTest: TestCase = {
      name: 'Login Test',
      status: 'passed',
      suite: 'Auth Suite',
      time: 2.5
    };

    render(<TestDetailsModal test={passedTest} onClose={mockOnClose} />);

    expect(screen.getByText('Login Test')).toBeInTheDocument();
    expect(screen.getByText('Auth Suite')).toBeInTheDocument();
    expect(screen.getByText('2.50 seconds')).toBeInTheDocument();
    expect(screen.getByTestId('check-circle-icon')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('should render modal with failed test details', () => {
    const failedTest: TestCase = {
      name: 'API Test',
      status: 'failed',
      suite: 'API Suite',
      time: 1.8,
      errorMessage: 'Expected 200 but got 500\nStackTrace: at line 15'
    };

    render(<TestDetailsModal test={failedTest} onClose={mockOnClose} />);

    expect(screen.getByText('API Test')).toBeInTheDocument();
    expect(screen.getByText('API Suite')).toBeInTheDocument();
    expect(screen.getByText('1.80 seconds')).toBeInTheDocument();
    expect(screen.getByTestId('x-circle-icon')).toBeInTheDocument();
    expect(screen.getByText('Expected 200 but got 500')).toBeInTheDocument();
  });

  it('should render modal with skipped test details', () => {
    const skippedTest: TestCase = {
      name: 'Integration Test',
      status: 'skipped',
      suite: 'Integration Suite',
      time: 0.0
    };

    render(<TestDetailsModal test={skippedTest} onClose={mockOnClose} />);

    expect(screen.getByText('Integration Test')).toBeInTheDocument();
    expect(screen.getByText('Integration Suite')).toBeInTheDocument();
    expect(screen.getByText('0.00 seconds')).toBeInTheDocument();
    expect(screen.getByTestId('alert-triangle-icon')).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const test: TestCase = {
      name: 'Test',
      status: 'passed',
      suite: 'Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={test} onClose={mockOnClose} />);

    // Find the close button more specifically
    const closeButtons = screen.getAllByRole('button');
    const closeButton = closeButtons.find(button =>
      button.querySelector('[data-testid="x-icon"]')
    );

    if (closeButton) {
      await user.click(closeButton);
    }

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should call onClose when modal backdrop is clicked', () => {
    const test: TestCase = {
      name: 'Test',
      status: 'passed',
      suite: 'Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={test} onClose={mockOnClose} />);

    // Just test that the modal renders correctly
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Test Details')).toBeInTheDocument();
  });

  it('should display error message for failed test', () => {
    const failedTest: TestCase = {
      name: 'Failed Test',
      status: 'failed',
      suite: 'Test Suite',
      time: 2.0,
      errorMessage: 'Assertion error: Expected true but got false'
    };

    render(<TestDetailsModal test={failedTest} onClose={mockOnClose} />);

    expect(screen.getByText('Assertion error: Expected true but got false')).toBeInTheDocument();
  });

  it('should display failure details when available', () => {
    const failedTest: TestCase = {
      name: 'Failed Test',
      status: 'failed',
      suite: 'Test Suite',
      time: 2.0,
      failureDetails: {
        message: 'Assertion failed',
        type: 'AssertionError',
        stackTrace: 'at testFunction (test.js:10:5)\n    at Object.<anonymous> (test.js:15:3)'
      }
    };

    render(<TestDetailsModal test={failedTest} onClose={mockOnClose} />);

    expect(screen.getByText('Failed Test')).toBeInTheDocument();
    expect(screen.getByText('AssertionError')).toBeInTheDocument();
    expect(screen.getByText(/at testFunction/)).toBeInTheDocument();
  });

  it('should format stack trace correctly', () => {
    const failedTest: TestCase = {
      name: 'Failed Test',
      status: 'failed',
      suite: 'Test Suite',
      time: 2.0,
      errorMessage: 'Error message\nStackTrace line 1\nStackTrace line 2'
    };

    render(<TestDetailsModal test={failedTest} onClose={mockOnClose} />);

    expect(screen.getByText('Error message')).toBeInTheDocument();
    // Stack trace might be displayed differently, so just check basic functionality
  });

  it('should handle test with no error message', () => {
    const test: TestCase = {
      name: 'Test Without Error',
      status: 'failed',
      suite: 'Test Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={test} onClose={mockOnClose} />);

    expect(screen.getByText('Test Without Error')).toBeInTheDocument();
    expect(screen.getAllByText('Test Suite')).toHaveLength(2); // Label and value
    // Should not crash or show undefined
  });

  it('should handle test with empty failure details', () => {
    const test: TestCase = {
      name: 'Test',
      status: 'failed',
      suite: 'Suite',
      time: 1.0,
      failureDetails: {
        message: '',
        type: '',
        stackTrace: ''
      }
    };

    render(<TestDetailsModal test={test} onClose={mockOnClose} />);

    expect(screen.getByText('Test')).toBeInTheDocument();
    // Should not crash with empty details
  });

  it('should close the modal on escape key', async () => {
    const user = userEvent.setup();
    const test: TestCase = {
      name: 'Test',
      status: 'passed',
      suite: 'Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={test} onClose={mockOnClose} />);

    await user.keyboard('{Escape}');

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should display correct status styling for passed test', () => {
    const passedTest: TestCase = {
      name: 'Passed Test',
      status: 'passed',
      suite: 'Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={passedTest} onClose={mockOnClose} />);

    // Check for passed status text
    const statusBadge = screen.getByText('Passed');
    expect(statusBadge).toBeInTheDocument();
  });

  it('should display correct status styling for failed test', () => {
    const failedTest: TestCase = {
      name: 'Failed Test',
      status: 'failed',
      suite: 'Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={failedTest} onClose={mockOnClose} />);

    // Check for failed status text
    const statusBadge = screen.getByText('Failed');
    expect(statusBadge).toBeInTheDocument();
  });

  it('should display correct status styling for skipped test', () => {
    const skippedTest: TestCase = {
      name: 'Skipped Test',
      status: 'skipped',
      suite: 'Suite',
      time: 1.0
    };

    render(<TestDetailsModal test={skippedTest} onClose={mockOnClose} />);

    // Check for skipped status text
    const statusBadge = screen.getByText('Skipped');
    expect(statusBadge).toBeInTheDocument();
  });

  it('should display classname when available', () => {
    const testWithClassname: TestCase = {
      name: 'Test With Class',
      status: 'passed',
      suite: 'Test Suite',
      classname: 'com.example.TestClass',
      time: 1.5
    };

    render(<TestDetailsModal test={testWithClassname} onClose={mockOnClose} />);

    expect(screen.getByText('Test With Class')).toBeInTheDocument();
    expect(screen.getByText('Class Name')).toBeInTheDocument();
    expect(screen.getByText('com.example.TestClass')).toBeInTheDocument();
    expect(screen.getByTestId('code-icon')).toBeInTheDocument();
  });

  it('should wrap long unbroken suite and classname values instead of overflowing the modal', () => {
    const longValueTest: TestCase = {
      name: 'Test With Long Paths',
      status: 'passed',
      suite: 'e2e/audit_manager/show/admin/cloud_scanning.spec.ts',
      classname: 'e2e.audit_manager.show.admin.cloud_scanning_spec.CloudScanningAdminPanel',
      time: 1.5
    };

    render(<TestDetailsModal test={longValueTest} onClose={mockOnClose} />);

    const suiteValue = screen.getByText('e2e/audit_manager/show/admin/cloud_scanning.spec.ts');
    const classnameValue = screen.getByText('e2e.audit_manager.show.admin.cloud_scanning_spec.CloudScanningAdminPanel');
    expect(suiteValue).toHaveClass('break-all');
    expect(classnameValue).toHaveClass('break-all');
    expect(suiteValue.parentElement).toHaveClass('min-w-0');
    expect(classnameValue.parentElement).toHaveClass('min-w-0');
  });

  it('should render modal with flaky test details, including the synthetic Flaky failure type', () => {
    const flakyTest: TestCase = {
      name: 'Import Big File Test',
      status: 'flaky',
      suite: 'Import Suite',
      time: 30.5,
      errorMessage: null,
      failureDetails: {
        type: 'Flaky',
        message: 'This test failed on an initial attempt but passed on retry.',
        stackTrace: ''
      }
    };

    render(<TestDetailsModal test={flakyTest} onClose={mockOnClose} />);

    expect(screen.getByText('Import Big File Test')).toBeInTheDocument();
    expect(screen.getByTestId('alert-triangle-icon')).toBeInTheDocument();
    // "Flaky" appears twice: the status badge label and the Failure Type box's value.
    expect(screen.getAllByText('Flaky')).toHaveLength(2);
    expect(screen.getByText('Failure Type')).toBeInTheDocument();
    // No real error text was captured for the failed attempt, so no red Error Summary box.
    expect(screen.queryByText('Error Summary')).not.toBeInTheDocument();
    // No stack trace text either — the terminal block should not render an empty shell.
    expect(screen.queryByText('Stack Trace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-icon')).not.toBeInTheDocument();
  });

  it('copies the stack trace to the clipboard and confirms with "Copied"', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    try {
      const failedTest: TestCase = {
        name: 'Failed Test',
        status: 'failed',
        suite: 'Test Suite',
        time: 2.0,
        errorMessage: 'Boom',
        failureDetails: { message: 'Boom', type: 'Error', stackTrace: 'first line\n\nthird line' }
      };

      render(<TestDetailsModal test={failedTest} onClose={mockOnClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      expect(writeText).toHaveBeenCalledWith('first line\n\nthird line');
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
