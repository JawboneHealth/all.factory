import { useState, useCallback, useMemo } from 'react';
import { FileUploader } from '../components/FileUploader';
import { StatsBar } from '../components/StatsBar';
import { IssueList } from '../components/IssueList';
import { EvidencePanel } from '../components/EvidencePanel';
import { type Change } from '../types';

const API_BASE = 'http://localhost:8000';

export function DataCleanup() {
  const [mmiStatus, setMmiStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [sqlStatus, setSqlStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [mmiFilename, setMmiFilename] = useState<string>();
  const [sqlFilename, setSqlFilename] = useState<string>();
  const [changes, setChanges] = useState<Change[]>([]);
  const [selectedChange, setSelectedChange] = useState<Change | null>(null);
  const [byType, setByType] = useState<Record<string, number>>({});
  const [byStatus, setByStatus] = useState<Record<string, number>>({ pending: 0, approved: 0, rejected: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Filter changes based on active filter
  const filteredChanges = useMemo(() => {
    if (!activeFilter) return changes;

    if (activeFilter.startsWith('type:')) {
      const issueType = activeFilter.replace('type:', '');
      return changes.filter(c => c.issue_type === issueType);
    }

    if (activeFilter.startsWith('status:')) {
      const status = activeFilter.replace('status:', '');
      return changes.filter(c => c.status === status);
    }

    return changes;
  }, [changes, activeFilter]);

  const uploadMMI = useCallback(async (file: File) => {
    setMmiStatus('uploading');
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch(`${API_BASE}/cleanup/upload/mmi`, { method: 'POST', body: formData });
      setMmiFilename(file.name);
      setMmiStatus('success');
    } catch {
      setMmiStatus('error');
    }
  }, []);

  const uploadSQL = useCallback(async (file: File) => {
    setSqlStatus('uploading');
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch(`${API_BASE}/cleanup/upload/sql`, { method: 'POST', body: formData });
      setSqlFilename(file.name);
      setSqlStatus('success');
    } catch {
      setSqlStatus('error');
    }
  }, []);

  const analyze = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch(`${API_BASE}/cleanup/analyze`, { method: 'POST' });
      const data = await res.json();
      
      const changesRes = await fetch(`${API_BASE}/cleanup/changes`).then(r => r.json());
      const changesData = changesRes.changes || [];
      setChanges(changesData);
      setByType(data.by_type || {});
      setByStatus(data.by_status || { pending: 0, approved: 0, rejected: 0 });
      setAnalyzed(true);
      
      if (changesData.length > 0) {
        setSelectedChange(changesData[0]);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const updateChangeStatus = useCallback(async (id: string, action: 'approve' | 'reject') => {
    await fetch(`${API_BASE}/cleanup/changes/${id}/${action}`, { method: 'POST' });
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    setChanges(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
    setSelectedChange(prev => prev?.id === id ? { ...prev, status: newStatus } : prev);
    
    // Update status counts
    setByStatus(prev => {
      const oldStatus = changes.find(c => c.id === id)?.status || 'pending';
      return {
        ...prev,
        [oldStatus]: Math.max(0, (prev[oldStatus] || 0) - 1),
        [newStatus]: (prev[newStatus] || 0) + 1
      };
    });
  }, [changes]);

  const downloadFile = useCallback(async (type: 'sql' | 'mmi') => {
    const res = await fetch(`${API_BASE}/cleanup/export/${type}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = type === 'sql' ? 'cleaned_data.xlsx' : 'cleaned_log.log';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const reset = useCallback(() => {
    setMmiStatus('idle');
    setSqlStatus('idle');
    setMmiFilename(undefined);
    setSqlFilename(undefined);
    setChanges([]);
    setSelectedChange(null);
    setByType({});
    setByStatus({ pending: 0, approved: 0, rejected: 0 });
    setAnalyzed(false);
    setActiveFilter(null);
  }, []);

  const canAnalyze = mmiStatus === 'success' && sqlStatus === 'success';

  if (!analyzed) {
    return (
      <div className="cleanup-page">
        {/* Hero Section */}
        <section className="hero-section">
          <span className="hero-badge">Factory Tools Suite</span>
          <h1>Data Cleanup</h1>
          <p className="hero-subtitle">
            Analyze, clean, and validate manufacturing data from MMI logs and SQL databases.
          </p>
        </section>

        {/* Upload Section */}
        <div className="upload-section">
          <p className="upload-intro">
            Upload your MMI log and SQL export to begin analysis.
          </p>
          <div className="upload-grid">
            <FileUploader
              label="MMI Log File"
              accept=".log,.txt"
              onUpload={uploadMMI}
              status={mmiStatus}
              filename={mmiFilename}
            />
            <FileUploader
              label="SQL Export (Excel)"
              accept=".xlsx,.xls"
              onUpload={uploadSQL}
              status={sqlStatus}
              filename={sqlFilename}
            />
          </div>
          <button
            className={`analyze-button ${canAnalyze ? 'ready' : 'disabled'}`}
            onClick={analyze}
            disabled={!canAnalyze || isAnalyzing}
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Files'}
          </button>
        </div>

        {/* How It Works */}
        <section className="guide-section">
          <h2>How It Works</h2>
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">01</div>
              <h3>Upload Files</h3>
              <p>Upload your MMI log file and SQL export (Excel) to begin analysis.</p>
            </div>
            <div className="step-card">
              <div className="step-number">02</div>
              <h3>Analyze</h3>
              <p>The system scans for duplicates, missing data, orphan rows, and mismatches.</p>
            </div>
            <div className="step-card">
              <div className="step-number">03</div>
              <h3>Review Changes</h3>
              <p>Review each proposed change with full MMI log evidence and SQL diffs.</p>
            </div>
            <div className="step-card">
              <div className="step-number">04</div>
              <h3>Export</h3>
              <p>Download cleaned SQL and MMI files with all approved changes applied.</p>
            </div>
          </div>
        </section>

        {/* Issues We Detect */}
        <section className="issues-section">
          <h2>Issues We Detect</h2>
          <div className="issue-grid">
            <div className="issue-card duplicate">
              <div className="issue-icon">⊘</div>
              <h4>Duplicate Inserts</h4>
              <p>Same row inserted twice due to PLC trigger firing multiple times.</p>
              <span className="issue-tag">Auto-delete duplicates</span>
            </div>
            <div className="issue-card missing">
              <div className="issue-icon">○</div>
              <h4>Missing PSA Tape</h4>
              <p>PSA_TAPE_PIC field is empty but the image was captured.</p>
              <span className="issue-tag">Auto-fill from MMI</span>
            </div>
            <div className="issue-card orphan">
              <div className="issue-icon">◇</div>
              <h4>Orphan Rows</h4>
              <p>Rows with PSA images but no serial numbers due to data shift.</p>
              <span className="issue-tag">Flag for deletion</span>
            </div>
            <div className="issue-card mismatch">
              <div className="issue-icon">⇄</div>
              <h4>Index Mismatch</h4>
              <p>PSA image indices are too far apart, indicating wrong file references.</p>
              <span className="issue-tag">Auto-correct indices</span>
            </div>
            <div className="issue-card oee-error">
              <div className="issue-icon">⚡</div>
              <h4>OEE Errors</h4>
              <p>Discrepancies between SQL error table and MMI error logs.</p>
              <span className="issue-tag">Fix for accurate OEE</span>
            </div>
            <div className="issue-card repeated">
              <div className="issue-icon">⟳</div>
              <h4>Repeated Inserts</h4>
              <p>Same content logged multiple times due to PLC 6101 timing issues.</p>
              <span className="issue-tag">Remove duplicates</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="cleanup-page analysis-mode">
      <div className="analysis-header">
        <h1>Analysis Results</h1>
        <div className="header-actions">
          <button className="export-button" onClick={() => downloadFile('sql')}>
            ↓ Export SQL
          </button>
          <button className="export-button" onClick={() => downloadFile('mmi')}>
            ↓ Export MMI
          </button>
          <button className="reset-button" onClick={reset}>
            Start Over
          </button>
        </div>
      </div>

      <StatsBar 
        total={changes.length} 
        byType={byType} 
        byStatus={byStatus}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
      />

      {activeFilter && (
        <div className="active-filter-banner">
          <span>
            Showing: <strong>{activeFilter.replace('type:', '').replace('status:', '').replace(/_/g, ' ')}</strong>
            {' '}({filteredChanges.length} of {changes.length})
          </span>
          <button onClick={() => setActiveFilter(null)}>✕ Clear filter</button>
        </div>
      )}

      <div className="split-pane">
        <IssueList
          changes={filteredChanges}
          selectedId={selectedChange?.id || null}
          onSelect={setSelectedChange}
        />
        <EvidencePanel
          change={selectedChange}
          onApprove={() => selectedChange && updateChangeStatus(selectedChange.id, 'approve')}
          onReject={() => selectedChange && updateChangeStatus(selectedChange.id, 'reject')}
        />
      </div>
    </div>
  );
}