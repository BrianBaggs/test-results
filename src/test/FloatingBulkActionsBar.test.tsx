import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingBulkActionsBar } from '../components/FailureAnalysis/FloatingBulkActionsBar';

describe('FloatingBulkActionsBar', () => {
  const defaultProps = {
    selectedCount: 3,
    totalCount: 10,
    allSelected: false,
    onToggleSelectAll: vi.fn(),
    onMarkPending: vi.fn(),
    onMarkInProgress: vi.fn(),
    onMarkComplete: vi.fn(),
    onBulkComment: vi.fn(),
    onClearSelection: vi.fn(),
  };

  it('should not render when no items are selected', () => {
    const { container } = render(
      <FloatingBulkActionsBar {...defaultProps} selectedCount={0} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render when items are selected', () => {
    render(<FloatingBulkActionsBar {...defaultProps} />);
    expect(screen.getByTestId('floating-bulk-actions-bar')).toBeInTheDocument();
  });

  it('should display the correct selected count', () => {
    render(<FloatingBulkActionsBar {...defaultProps} selectedCount={5} />);
    expect(screen.getByTestId('floating-selected-count')).toHaveTextContent('5 selected');
  });

  it('should show select all checkbox unchecked when not all selected', () => {
    render(<FloatingBulkActionsBar {...defaultProps} allSelected={false} />);
    const checkbox = screen.getByTestId('floating-select-all');
    expect(checkbox).not.toBeChecked();
  });

  it('should show select all checkbox checked when all selected', () => {
    render(<FloatingBulkActionsBar {...defaultProps} allSelected={true} />);
    const checkbox = screen.getByTestId('floating-select-all');
    expect(checkbox).toBeChecked();
  });

  it('should call onToggleSelectAll when select all checkbox is clicked', () => {
    const onToggleSelectAll = vi.fn();
    render(<FloatingBulkActionsBar {...defaultProps} onToggleSelectAll={onToggleSelectAll} />);
    fireEvent.click(screen.getByTestId('floating-select-all'));
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1);
  });

  it('should call onMarkPending when Mark as Pending is clicked', () => {
    const onMarkPending = vi.fn();
    render(<FloatingBulkActionsBar {...defaultProps} onMarkPending={onMarkPending} />);
    fireEvent.click(screen.getByTestId('floating-mark-pending'));
    expect(onMarkPending).toHaveBeenCalledTimes(1);
  });

  it('should call onMarkInProgress when Mark as In Progress is clicked', () => {
    const onMarkInProgress = vi.fn();
    render(<FloatingBulkActionsBar {...defaultProps} onMarkInProgress={onMarkInProgress} />);
    fireEvent.click(screen.getByTestId('floating-mark-in-progress'));
    expect(onMarkInProgress).toHaveBeenCalledTimes(1);
  });

  it('should call onMarkComplete when Mark as Complete is clicked', () => {
    const onMarkComplete = vi.fn();
    render(<FloatingBulkActionsBar {...defaultProps} onMarkComplete={onMarkComplete} />);
    fireEvent.click(screen.getByTestId('floating-mark-complete'));
    expect(onMarkComplete).toHaveBeenCalledTimes(1);
  });

  it('should call onBulkComment when Bulk Comment is clicked', () => {
    const onBulkComment = vi.fn();
    render(<FloatingBulkActionsBar {...defaultProps} onBulkComment={onBulkComment} />);
    fireEvent.click(screen.getByTestId('floating-bulk-comment-btn'));
    expect(onBulkComment).toHaveBeenCalledTimes(1);
  });

  it('should call onClearSelection when Clear Selection is clicked', () => {
    const onClearSelection = vi.fn();
    render(<FloatingBulkActionsBar {...defaultProps} onClearSelection={onClearSelection} />);
    fireEvent.click(screen.getByTestId('floating-clear-selection'));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('should have fixed positioning at the bottom of the screen', () => {
    render(<FloatingBulkActionsBar {...defaultProps} />);
    const bar = screen.getByTestId('floating-bulk-actions-bar');
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('bottom-0');
  });

  it('should display all bulk action buttons', () => {
    render(<FloatingBulkActionsBar {...defaultProps} />);
    expect(screen.getByText('Mark as Pending')).toBeInTheDocument();
    expect(screen.getByText('Mark as In Progress')).toBeInTheDocument();
    expect(screen.getByText('Mark as Complete')).toBeInTheDocument();
    expect(screen.getByText('Bulk Comment')).toBeInTheDocument();
    expect(screen.getByText('Clear Selection')).toBeInTheDocument();
  });
});
