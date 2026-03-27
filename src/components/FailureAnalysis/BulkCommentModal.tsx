import { useState } from 'react';
import { XIcon, MessageSquareIcon } from 'lucide-react';

interface FailureProgressItem {
  id: string;
  name: string;
  suite: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes?: string;
  assignee?: string;
}

export interface BulkCommentResult {
  comments: Record<string, string>;
  assignee?: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

interface BulkCommentModalProps {
  selectedItems: FailureProgressItem[];
  onApply: (result: BulkCommentResult) => void;
  onClose: () => void;
}

type CommentMode = 'same' | 'individual';

export const BulkCommentModal = ({
  selectedItems,
  onApply,
  onClose,
}: BulkCommentModalProps) => {
  const [mode, setMode] = useState<CommentMode>('same');
  const [sharedComment, setSharedComment] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [individualComments, setIndividualComments] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      selectedItems.forEach((item) => {
        initial[item.id] = item.notes || '';
      });
      return initial;
    },
  );

  const handleApply = () => {
    const comments: Record<string, string> = {};
    if (mode === 'same') {
      selectedItems.forEach((item) => {
        comments[item.id] = sharedComment;
      });
    } else {
      selectedItems.forEach((item) => {
        comments[item.id] = individualComments[item.id] || '';
      });
    }
    const result: BulkCommentResult = { comments };
    if (bulkAssignee.trim()) {
      result.assignee = bulkAssignee.trim();
    }
    if (bulkStatus) {
      result.status = bulkStatus as 'pending' | 'in_progress' | 'completed';
    }
    onApply(result);
  };

  const updateIndividualComment = (id: string, value: string) => {
    setIndividualComments((prev) => ({ ...prev, [id]: value }));
  };

  const hasContent =
    mode === 'same'
      ? sharedComment.trim().length > 0 || bulkAssignee.trim().length > 0 || bulkStatus !== ''
      : Object.values(individualComments).some((c) => c.trim().length > 0) || bulkAssignee.trim().length > 0 || bulkStatus !== '';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="bulk-comment-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <MessageSquareIcon className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Bulk Comment ({selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''})
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            aria-label="Close modal"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Status and Assignee */}
        <div className="px-5 pt-4 pb-2 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                data-testid="bulk-status-select"
              >
                <option value="">No Change</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assignee
              </label>
              <input
                type="text"
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                placeholder="Who is working on this?"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                data-testid="bulk-assignee-input"
              />
            </div>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="px-5 pt-2 pb-2">
          <div className="flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setMode('same')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
                mode === 'same'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
              data-testid="mode-same"
            >
              Same Comment for All
            </button>
            <button
              onClick={() => setMode('individual')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
                mode === 'individual'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
              data-testid="mode-individual"
            >
              Individual Comments
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {mode === 'same' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Comment for all selected items
              </label>
              <textarea
                value={sharedComment}
                onChange={(e) => setSharedComment(e.target.value)}
                placeholder="Enter a comment to apply to all selected failures..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                rows={4}
                data-testid="shared-comment-input"
              />
              <p className="mt-2 text-xs text-gray-500">
                This comment will be applied to all {selectedItems.length} selected item
                {selectedItems.length !== 1 ? 's' : ''}.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedItems.map((item) => (
                <div
                  key={item.id}
                  className="border border-gray-200 rounded-lg p-3"
                  data-testid={`individual-item-${item.id}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        item.status === 'completed'
                          ? 'bg-green-500'
                          : item.status === 'in_progress'
                            ? 'bg-blue-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {item.name}
                    </span>
                    <span className="text-xs text-gray-500 truncate">— {item.suite}</span>
                  </div>
                  <textarea
                    value={individualComments[item.id] || ''}
                    onChange={(e) => updateIndividualComment(item.id, e.target.value)}
                    placeholder="Enter comment for this test..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none"
                    rows={2}
                    data-testid={`individual-comment-${item.id}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!hasContent}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              hasContent
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-blue-300 cursor-not-allowed'
            }`}
            data-testid="apply-comments-btn"
          >
            Apply Comments
          </button>
        </div>
      </div>
    </div>
  );
};
