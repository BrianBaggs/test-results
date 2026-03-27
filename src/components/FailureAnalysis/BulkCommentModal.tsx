import { useState } from 'react';
import { XIcon, MessageSquareIcon } from 'lucide-react';

type StatusValue = 'pending' | 'in_progress' | 'completed';

interface FailureProgressItem {
  id: string;
  name: string;
  suite: string;
  status: StatusValue;
  notes?: string;
  assignee?: string;
}

export interface BulkCommentResult {
  comments: Record<string, string>;
  assignee?: string;
  status?: StatusValue;
  individualAssignees?: Record<string, string>;
  individualStatuses?: Record<string, StatusValue>;
}

interface BulkCommentModalProps {
  selectedItems: FailureProgressItem[];
  onApply: (result: BulkCommentResult) => void;
  onClose: () => void;
}

type CommentMode = 'same' | 'individual';

/** Replace whitespace with underscores to produce a valid HTML id/name value. */
const sanitizeId = (id: string) => id.replace(/\s+/g, '_');

export const BulkCommentModal = ({
  selectedItems,
  onApply,
  onClose,
}: BulkCommentModalProps) => {
  const [mode, setMode] = useState<CommentMode>('same');
  const [sharedComment, setSharedComment] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkStatus, setBulkStatus] = useState<StatusValue | ''>('');
  const [individualComments, setIndividualComments] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      selectedItems.forEach((item) => {
        initial[item.id] = item.notes || '';
      });
      return initial;
    },
  );
  const [individualAssignees, setIndividualAssignees] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      selectedItems.forEach((item) => {
        initial[item.id] = item.assignee || '';
      });
      return initial;
    },
  );
  const [individualStatuses, setIndividualStatuses] = useState<Record<string, StatusValue | ''>>(
    () => {
      const initial: Record<string, StatusValue | ''> = {};
      selectedItems.forEach((item) => {
        initial[item.id] = '';
      });
      return initial;
    },
  );

  const handleApply = () => {
    const comments: Record<string, string> = {};
    if (mode === 'same') {
      const trimmed = sharedComment.trim();
      selectedItems.forEach((item) => {
        comments[item.id] = trimmed;
      });
    } else {
      selectedItems.forEach((item) => {
        comments[item.id] = (individualComments[item.id] || '').trim();
      });
    }
    const result: BulkCommentResult = { comments };
    if (mode === 'same') {
      if (bulkAssignee.trim()) {
        result.assignee = bulkAssignee.trim();
      }
      if (bulkStatus) {
        result.status = bulkStatus;
      }
    } else {
      // Individual mode: collect per-item assignees and statuses
      const assignees: Record<string, string> = {};
      const statuses: Record<string, StatusValue> = {};
      let hasAssignees = false;
      let hasStatuses = false;
      selectedItems.forEach((item) => {
        const assignee = individualAssignees[item.id]?.trim();
        if (assignee) {
          assignees[item.id] = assignee;
          hasAssignees = true;
        }
        const status = individualStatuses[item.id];
        if (status) {
          statuses[item.id] = status;
          hasStatuses = true;
        }
      });
      if (hasAssignees) {
        result.individualAssignees = assignees;
      }
      if (hasStatuses) {
        result.individualStatuses = statuses;
      }
    }
    onApply(result);
  };

  const updateIndividualComment = (id: string, value: string) => {
    setIndividualComments((prev) => ({ ...prev, [id]: value }));
  };

  const updateIndividualAssignee = (id: string, value: string) => {
    setIndividualAssignees((prev) => ({ ...prev, [id]: value }));
  };

  const updateIndividualStatus = (id: string, value: string) => {
    setIndividualStatuses((prev) => ({ ...prev, [id]: value as StatusValue | '' }));
  };

  const hasContent =
    mode === 'same'
      ? sharedComment.trim().length > 0 || bulkAssignee.trim().length > 0 || bulkStatus !== ''
      : Object.values(individualComments).some((c) => c.trim().length > 0) ||
        Object.values(individualAssignees).some((a) => a.trim().length > 0) ||
        Object.values(individualStatuses).some((s) => s !== '');

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

        {/* Status and Assignee - shown only in "same" mode */}
        {mode === 'same' && (
          <div className="px-5 pt-4 pb-2 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bulk-status" className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  id="bulk-status"
                  name="bulkStatus"
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as StatusValue | '')}
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
                <label htmlFor="bulk-assignee" className="block text-sm font-medium text-gray-700 mb-1">
                  Assignee
                </label>
                <input
                  id="bulk-assignee"
                  name="bulkAssignee"
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
        )}

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
              <label htmlFor="shared-comment" className="block text-sm font-medium text-gray-700 mb-2">
                Comment for all selected items
              </label>
              <textarea
                id="shared-comment"
                name="sharedComment"
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
              {selectedItems.map((item) => {
                const safeId = sanitizeId(item.id);
                return (
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
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label htmlFor={`individual-status-${safeId}`} className="block text-xs font-medium text-gray-600 mb-1">
                        Status
                      </label>
                      <select
                        id={`individual-status-${safeId}`}
                        name={`individualStatus-${safeId}`}
                        value={individualStatuses[item.id] || ''}
                        onChange={(e) => updateIndividualStatus(item.id, e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        data-testid={`individual-status-${item.id}`}
                      >
                        <option value="">No Change</option>
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`individual-assignee-${safeId}`} className="block text-xs font-medium text-gray-600 mb-1">
                        Assignee
                      </label>
                      <input
                        id={`individual-assignee-${safeId}`}
                        name={`individualAssignee-${safeId}`}
                        type="text"
                        value={individualAssignees[item.id] || ''}
                        onChange={(e) => updateIndividualAssignee(item.id, e.target.value)}
                        placeholder="Assignee..."
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        data-testid={`individual-assignee-${item.id}`}
                      />
                    </div>
                  </div>
                  <label htmlFor={`individual-comment-input-${safeId}`} className="block text-xs font-medium text-gray-600 mb-1">
                    Notes
                  </label>
                  <textarea
                    id={`individual-comment-input-${safeId}`}
                    name={`individualComment-${safeId}`}
                    value={individualComments[item.id] || ''}
                    onChange={(e) => updateIndividualComment(item.id, e.target.value)}
                    placeholder="Enter comment for this test..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none"
                    rows={2}
                    data-testid={`individual-comment-${item.id}`}
                  />
                </div>
                );
              })}
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
