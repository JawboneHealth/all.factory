interface Props {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  activeFilter?: string | null;
  onFilterChange?: (filter: string | null) => void;
}

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  DUPLICATE_INSERT: { label: 'Duplicates', color: '#ef4444' },
  MISSING_PSA_TAPE: { label: 'Missing PSA', color: '#f59e0b' },
  ORPHAN_ROW: { label: 'Orphans', color: '#8b5cf6' },
  INDEX_MISMATCH: { label: 'Index Gaps', color: '#3b82f6' },
  ERROR_EVENT_MISMATCH: { label: 'OEE Errors', color: '#ec4899' },
  REPEATED_INSERT: { label: 'Repeated', color: '#14b8a6' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  approved: { label: 'Approved', color: '#10b981' },
  pending: { label: 'Pending', color: '#f59e0b' },
  rejected: { label: 'Rejected', color: '#ef4444' },
};

export function StatsBar({ 
  total = 0, 
  byType = {}, 
  byStatus = {}, 
  activeFilter = null,
  onFilterChange 
}: Props) {
  const handleClick = (filterKey: string) => {
    if (!onFilterChange) return;
    // Toggle off if clicking the same filter
    onFilterChange(activeFilter === filterKey ? null : filterKey);
  };

  return (
    <div className="stats-bar">
      <div 
        className={`stat-item clickable ${activeFilter === null ? 'active' : ''}`}
        onClick={() => onFilterChange?.(null)}
        title="Show all issues"
      >
        <div className="stat-value">{total}</div>
        <div className="stat-label">Total Issues</div>
      </div>
      
      <div className="stat-divider" />
      
      {Object.entries(TYPE_CONFIG).map(([key, { label, color }]) => (
        <div 
          key={key} 
          className={`stat-item clickable ${activeFilter === `type:${key}` ? 'active' : ''}`}
          onClick={() => handleClick(`type:${key}`)}
          title={`Filter by ${label}`}
        >
          <div className="stat-value" style={{ color }}>{byType[key] || 0}</div>
          <div className="stat-label">{label}</div>
          {activeFilter === `type:${key}` && (
            <div className="filter-indicator" style={{ background: color }} />
          )}
        </div>
      ))}
      
      <div className="stat-divider" />
      
      {Object.entries(STATUS_CONFIG).map(([key, { label, color }]) => (
        <div 
          key={key}
          className={`stat-item clickable ${activeFilter === `status:${key}` ? 'active' : ''}`}
          onClick={() => handleClick(`status:${key}`)}
          title={`Filter by ${label}`}
        >
          <div className="stat-value" style={{ color }}>{byStatus[key] || 0}</div>
          <div className="stat-label">{label}</div>
          {activeFilter === `status:${key}` && (
            <div className="filter-indicator" style={{ background: color }} />
          )}
        </div>
      ))}
    </div>
  );
}