import { type Change } from '../types';

interface Props {
  changes: Change[];
  selectedId: string | null;
  onSelect: (change: Change) => void;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  DUPLICATE_INSERT: { label: 'Duplicate', color: '#ef4444' },
  MISSING_PSA_TAPE: { label: 'Missing PSA', color: '#f59e0b' },
  ORPHAN_ROW: { label: 'Orphan', color: '#8b5cf6' },
  INDEX_MISMATCH: { label: 'Index Gap', color: '#3b82f6' },
  ERROR_EVENT_MISMATCH: { label: 'OEE Error', color: '#ec4899' },
  REPEATED_INSERT: { label: 'Repeated', color: '#14b8a6' },
};

export function IssueList({ changes = [], selectedId, onSelect }: Props) {
  return (
    <div className="left-pane">
      <div className="pane-header">
        <h3>Changes</h3>
        <span className="change-count">{changes.length} issues</span>
      </div>
      <div className="change-list">
        {changes.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
            <p>No issues found</p>
          </div>
        ) : (
          changes.map((change) => {
            const type = TYPE_LABELS[change.issue_type] || { label: '???', color: '#666' };
            return (
              <button
                key={change.id}
                className={`change-item ${change.id === selectedId ? 'selected' : ''} ${change.status}`}
                onClick={() => onSelect(change)}
              >
                <div className="change-header">
                  <span className="issue-type-badge" style={{ background: type.color }}>
                    {type.label}
                  </span>
                  <span className="action-badge" data-action={change.action}>
                    {change.action}
                  </span>
                </div>
                <div className="change-meta">
                  {change.sql_row_id !== null ? (
                    <span className="row-id">Row {change.sql_row_id}</span>
                  ) : (
                    <span className="row-id">MMI Line {change.mmi_line_numbers?.[0] || '?'}</span>
                  )}
                  <span className="timestamp">@ {change.timestamp}</span>
                </div>
                <p className="change-description">{change.description}</p>
                {change.status !== 'pending' && (
                  <span className={`status-badge ${change.status}`}>
                    {change.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}