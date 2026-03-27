import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkCommentModal } from '../components/FailureAnalysis/BulkCommentModal';

// --- Mock selected items ---
const makeItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `Suite-test${i}`,
    name: `test${i}`,
    suite: `Suite`,
    status: 'pending' as const,
    notes: i === 0 ? 'existing note' : '',
    assignee: '',
  }));

const twoItems = makeItems(2);
const fiveItems = makeItems(5);

describe('BulkCommentModal', () => {
  let onApply: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onApply = vi.fn();
    onClose = vi.fn();
  });

  describe('Rendering', () => {
    it('should render the modal with correct item count', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('bulk-comment-modal')).toBeInTheDocument();
      expect(screen.getByText(/Bulk Comment \(2 items\)/)).toBeInTheDocument();
    });

    it('should render singular label for 1 item', () => {
      render(
        <BulkCommentModal
          selectedItems={[twoItems[0]]}
          onApply={onApply}
          onClose={onClose}
        />,
      );
      expect(screen.getByText(/Bulk Comment \(1 item\)/)).toBeInTheDocument();
    });

    it('should default to "same" comment mode', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('shared-comment-input')).toBeInTheDocument();
      expect(screen.getByText(/Same Comment for All/)).toBeInTheDocument();
    });

    it('should show description text in same mode', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(
        screen.getByText(/This comment will be applied to all 2 selected items/),
      ).toBeInTheDocument();
    });

    it('should show singular description for 1 item in same mode', () => {
      render(
        <BulkCommentModal
          selectedItems={[twoItems[0]]}
          onApply={onApply}
          onClose={onClose}
        />,
      );
      expect(
        screen.getByText(/This comment will be applied to all 1 selected item\./),
      ).toBeInTheDocument();
    });

    it('should render many items without error', () => {
      render(
        <BulkCommentModal selectedItems={fiveItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByText(/Bulk Comment \(5 items\)/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('mode-individual'));
      for (let i = 0; i < 5; i++) {
        expect(
          screen.getByTestId(`individual-comment-Suite-test${i}`),
        ).toBeInTheDocument();
      }
    });
  });

  describe('Mode switching', () => {
    it('should switch to individual mode when clicked', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      expect(screen.getByTestId('individual-comment-Suite-test0')).toBeInTheDocument();
      expect(screen.getByTestId('individual-comment-Suite-test1')).toBeInTheDocument();
    });

    it('should switch back to same mode', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      fireEvent.click(screen.getByTestId('mode-same'));
      expect(screen.getByTestId('shared-comment-input')).toBeInTheDocument();
    });

    it('should preserve shared comment when switching modes and back', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.type(screen.getByTestId('shared-comment-input'), 'My comment');
      fireEvent.click(screen.getByTestId('mode-individual'));
      fireEvent.click(screen.getByTestId('mode-same'));
      const textarea = screen.getByTestId('shared-comment-input') as HTMLTextAreaElement;
      expect(textarea.value).toBe('My comment');
    });

    it('should preserve individual comments when switching modes and back', async () => {
      const user = userEvent.setup();
      const items = [
        { ...twoItems[0], notes: '' },
        { ...twoItems[1], notes: '' },
      ];
      render(
        <BulkCommentModal selectedItems={items} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      await user.type(
        screen.getByTestId('individual-comment-Suite-test0'),
        'Keep this',
      );
      fireEvent.click(screen.getByTestId('mode-same'));
      fireEvent.click(screen.getByTestId('mode-individual'));
      const textarea = screen.getByTestId(
        'individual-comment-Suite-test0',
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('Keep this');
    });

    it('should show test names and suites in individual mode', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      expect(screen.getByText('test0')).toBeInTheDocument();
      expect(screen.getByText('test1')).toBeInTheDocument();
      expect(screen.getAllByText(/Suite/).length).toBeGreaterThanOrEqual(2);
    });

    it('should pre-fill existing notes in individual mode', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      const input0 = screen.getByTestId(
        'individual-comment-Suite-test0',
      ) as HTMLTextAreaElement;
      expect(input0.value).toBe('existing note');
    });

    it('should show status indicators in individual mode', () => {
      const items = [
        { ...twoItems[0], status: 'completed' as const },
        { ...twoItems[1], status: 'in_progress' as const },
      ];
      render(
        <BulkCommentModal selectedItems={items} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      expect(screen.getByTestId('individual-item-Suite-test0')).toBeInTheDocument();
      expect(screen.getByTestId('individual-item-Suite-test1')).toBeInTheDocument();
    });
  });

  describe('Apply button state', () => {
    it('should disable Apply button when shared comment is empty', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('apply-comments-btn')).toBeDisabled();
    });

    it('should enable Apply button when shared comment has content', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.type(screen.getByTestId('shared-comment-input'), 'Fix applied');
      expect(screen.getByTestId('apply-comments-btn')).not.toBeDisabled();
    });

    it('should disable Apply when individual comments are all empty', () => {
      const items = [
        { ...twoItems[0], notes: '' },
        { ...twoItems[1], notes: '' },
      ];
      render(
        <BulkCommentModal selectedItems={items} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      expect(screen.getByTestId('apply-comments-btn')).toBeDisabled();
    });

    it('should enable Apply when at least one individual comment has content', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));
      expect(screen.getByTestId('apply-comments-btn')).not.toBeDisabled();
    });

    it('should not call onApply when Apply is clicked but disabled', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      const btn = screen.getByTestId('apply-comments-btn');
      expect(btn).toBeDisabled();
      fireEvent.click(btn);
      expect(onApply).not.toHaveBeenCalled();
    });
  });

  describe('Apply comments', () => {
    it('should apply same comment to all items', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.type(screen.getByTestId('shared-comment-input'), 'Shared fix');
      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': 'Shared fix',
          'Suite-test1': 'Shared fix',
        },
      });
    });

    it('should apply individual comments to each item', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));

      const input0 = screen.getByTestId('individual-comment-Suite-test0');
      const input1 = screen.getByTestId('individual-comment-Suite-test1');

      await user.clear(input0);
      await user.type(input0, 'Fix A');
      await user.type(input1, 'Fix B');

      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': 'Fix A',
          'Suite-test1': 'Fix B',
        },
      });
    });

    it('should handle apply with empty individual comments', async () => {
      const user = userEvent.setup();
      const items = [
        { ...twoItems[0], notes: '' },
        { ...twoItems[1], notes: '' },
      ];
      render(
        <BulkCommentModal selectedItems={items} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByTestId('mode-individual'));

      await user.type(screen.getByTestId('individual-comment-Suite-test0'), 'Only one');
      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': 'Only one',
          'Suite-test1': '',
        },
      });
    });
  });

  describe('Assignee field', () => {
    it('should render the assignee input field', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('bulk-assignee-input')).toBeInTheDocument();
    });

    it('should include assignee in apply result when set', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.type(screen.getByTestId('shared-comment-input'), 'Fix applied');
      await user.type(screen.getByTestId('bulk-assignee-input'), 'John Doe');
      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': 'Fix applied',
          'Suite-test1': 'Fix applied',
        },
        assignee: 'John Doe',
      });
    });

    it('should not include assignee in result when empty', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.type(screen.getByTestId('shared-comment-input'), 'Fix applied');
      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': 'Fix applied',
          'Suite-test1': 'Fix applied',
        },
      });
    });

    it('should enable Apply button when only assignee is set', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('apply-comments-btn')).toBeDisabled();
      await user.type(screen.getByTestId('bulk-assignee-input'), 'Jane');
      expect(screen.getByTestId('apply-comments-btn')).not.toBeDisabled();
    });
  });

  describe('Status selector', () => {
    it('should render the status selector', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('bulk-status-select')).toBeInTheDocument();
    });

    it('should default to No Change', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      const select = screen.getByTestId('bulk-status-select') as HTMLSelectElement;
      expect(select.value).toBe('');
    });

    it('should include status in apply result when selected', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.selectOptions(screen.getByTestId('bulk-status-select'), 'completed');
      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': '',
          'Suite-test1': '',
        },
        status: 'completed',
      });
    });

    it('should enable Apply button when only status is set', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      expect(screen.getByTestId('apply-comments-btn')).toBeDisabled();
      await user.selectOptions(screen.getByTestId('bulk-status-select'), 'in_progress');
      expect(screen.getByTestId('apply-comments-btn')).not.toBeDisabled();
    });

    it('should include both status and assignee in result', async () => {
      const user = userEvent.setup();
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      await user.selectOptions(screen.getByTestId('bulk-status-select'), 'pending');
      await user.type(screen.getByTestId('bulk-assignee-input'), 'Team Lead');
      await user.type(screen.getByTestId('shared-comment-input'), 'Investigating');
      await user.click(screen.getByTestId('apply-comments-btn'));
      expect(onApply).toHaveBeenCalledWith({
        comments: {
          'Suite-test0': 'Investigating',
          'Suite-test1': 'Investigating',
        },
        assignee: 'Team Lead',
        status: 'pending',
      });
    });
  });

  describe('Close modal', () => {
    it('should call onClose when close button is clicked', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByLabelText('Close modal'));
      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when Cancel button is clicked', () => {
      render(
        <BulkCommentModal selectedItems={twoItems} onApply={onApply} onClose={onClose} />,
      );
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
