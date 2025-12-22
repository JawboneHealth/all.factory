interface Props {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  DUPLICATE_INSERT: { label: 'Duplicates', color: '#ef4444' },
  MISSING_PSA_TAPE: { label: 'Missing', color: '#f59e0b' },
  ORPHAN_ROW: { label: 'Orphans', color: '#8b5cf6' },
  INDEX_MISMATCH: { label: 'Mismatches', color: '#3b82f6' },
};

export function StatsBar({ total = 0, byType = {}, byStatus = {} }: Props) {
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <div className="stat-value">{total}</div>
        <div className="stat-label">Total Issues</div>
      </div>
      
      <div className="stat-divider" />
      
      {Object.entries(TYPE_CONFIG).map(([key, { label, color }]) => (
        <div key={key} className="stat-item">
          <div className="stat-value" style={{ color }}>{byType[key] || 0}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
      
      <div className="stat-divider" />
      
      <div className="stat-item">
        <div className="stat-value" style={{ color: '#10b981' }}>{byStatus.approved || 0}</div>
        <div className="stat-label">Approved</div>
      </div>
      <div className="stat-item">
        <div className="stat-value" style={{ color: '#f59e0b' }}>{byStatus.pending || 0}</div>
        <div className="stat-label">Pending</div>
      </div>
      <div className="stat-item">
        <div className="stat-value" style={{ color: '#ef4444' }}>{byStatus.rejected || 0}</div>
        <div className="stat-label">Rejected</div>
      </div>
    </div>
  );
}