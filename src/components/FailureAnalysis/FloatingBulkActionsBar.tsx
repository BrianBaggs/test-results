import { MessageSquareIcon, XIcon } from 'lucide-react';

interface FloatingBulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onMarkPending: () => void;
  onMarkInProgress: () => void;
  onMarkComplete: () => void;
  onBulkComment: () => void;
  onClearSelection: () => void;
}

export const FloatingBulkActionsBar: React.FC<FloatingBulkActionsBarProps> = ({
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onMarkPending,
  onMarkInProgress,
  onMarkComplete,
  onBulkComment,
  onClearSelection,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div
      data-testid="floating-bulk-actions-bar"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-300 shadow-lg"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              data-testid="floating-select-all"
              checked={allSelected && totalCount > 0}
              onChange={onToggleSelectAll}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Select All</span>
          </label>
          <span className="text-sm font-semibold text-blue-600" data-testid="floating-selected-count">
            {selectedCount} selected
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600 mr-1">Bulk Actions:</span>
          <button
            onClick={onMarkPending}
            data-testid="floating-mark-pending"
            className="px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200 text-sm"
          >
            Mark as Pending
          </button>
          <button
            onClick={onMarkInProgress}
            data-testid="floating-mark-in-progress"
            className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 text-sm"
          >
            Mark as In Progress
          </button>
          <button
            onClick={onMarkComplete}
            data-testid="floating-mark-complete"
            className="px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200 text-sm"
          >
            Mark as Complete
          </button>
          <span className="border-l border-gray-300 h-5" />
          <button
            onClick={onBulkComment}
            data-testid="floating-bulk-comment-btn"
            className="px-3 py-1 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 text-sm flex items-center gap-1"
          >
            <MessageSquareIcon className="w-3 h-3" />
            Bulk Comment
          </button>
          <span className="border-l border-gray-300 h-5" />
          <button
            onClick={onClearSelection}
            data-testid="floating-clear-selection"
            className="px-3 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm flex items-center gap-1"
          >
            <XIcon className="w-3 h-3" />
            Clear Selection
          </button>
        </div>
      </div>
    </div>
  );
};
