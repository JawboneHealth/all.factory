import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { StatsBar } from '../components/StatsBar';
import { IssueList } from '../components/IssueList';
import { EvidencePanel } from '../components/EvidencePanel';
import { useAssistantContext } from '../components/Assistant/AssistantContext';
import { type Change } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

// ── Station definitions ────────────────────────────────────────────────────

const STATIONS = [
  { code: 'BS', name: 'Bottom Shell', icon: '📦' },
  { code: 'BA', name: 'Battery',      icon: '🔋' },
  { code: 'TR', name: 'Transfer',     icon: '🔄' },
  { code: 'TO', name: 'Top Shell',    icon: '🔝' },
  { code: 'LA', name: 'Laser',        icon: '⚡' },
  { code: 'FV', name: 'FVT',          icon: '🧪' },
] as const;

type StationCode = typeof STATIONS[number]['code'];

// ── File slot definitions ──────────────────────────────────────────────────

type SlotKey = 'mmi_barcode' | 'mmi_error' | 'sql_product' | 'sql_error';

interface SlotDef {
  label: string;
  accept: string;
  endpoint: string;
}

const SLOTS: Record<SlotKey, SlotDef> = {
  mmi_barcode: {
    label: 'MMI Barcode Log',
    accept: '.log,.txt',
    endpoint: '/cleanup/upload/mmi',
  },
  mmi_error: {
    label: 'MMI Error Log',
    accept: '.log,.txt',
    endpoint: '/cleanup/upload/mmi-error',
  },
  sql_product: {
    label: 'SQL Product Table',
    accept: '.csv,.xlsx,.xls',
    endpoint: '/cleanup/upload/sql',
  },
  sql_error: {
    label: 'SQL Error Table',
    accept: '.csv,.xlsx,.xls',
    endpoint: '/cleanup/upload/sql-errors',
  },
};

const DETECTOR_REQUIREMENTS: Record<string, { slots: SlotKey[]; label: string }> = {
  DUPLICATE_INSERT:     { slots: ['mmi_barcode', 'sql_product'], label: 'Duplicate Inserts' },
  MISSING_PSA_TAPE:     { slots: ['mmi_barcode', 'sql_product'], label: 'Missing PSA Tape' },
  ORPHAN_ROW:           { slots: ['sql_product'],                label: 'Orphan Rows' },
  INDEX_MISMATCH:       { slots: ['sql_product'],                label: 'Index Mismatch' },
  ERROR_EVENT_MISMATCH: { slots: ['mmi_error', 'sql_error'],     label: 'OEE Error Mismatch' },
  REPEATED_INSERT:      { slots: ['mmi_barcode'],                label: 'Repeated Inserts' },
  MISSING_INSERT:       { slots: ['mmi_barcode', 'sql_product'], label: 'Missing Insert' },
  STUCK_RETRY:          { slots: ['mmi_barcode'],                label: 'Stuck Retry' },
  MANUAL_PUSH:          { slots: ['mmi_barcode', 'sql_product'], label: 'Manual Push' },
  GHOST_SCAN:           { slots: ['mmi_barcode'],                label: 'Ghost Scan' },
  MISSING_BARCODE_SCAN: { slots: ['mmi_barcode', 'sql_product'], label: 'Missing Barcode Scan' },
  MULTI_UP_DUPLICATE:   { slots: ['mmi_barcode'],                label: 'Multi-Up Duplicate' },
  LONG_CYCLE_OUTLIER:   { slots: ['sql_product'],                label: 'Long Cycle Outlier' },
  ERROR_NO_RECOVERY:    { slots: ['mmi_error'],                  label: 'Error No Recovery' },
};

// ── Issues catalogue for right panel ──────────────────────────────────────

const ISSUE_CATALOGUE = [
  { name: 'Duplicate Insert',     severity: 'critical', action: 'Delete', desc: 'The same unit row was inserted into SQL more than once, skewing yield and traceability.',    source: 'MMI Barcode · SQL Product' },
  { name: 'Missing Insert',       severity: 'critical', action: 'Flag',   desc: 'A 6101 completion signal fired but no INSERT was logged and the unit is absent from SQL.',  source: 'MMI Barcode · SQL Product' },
  { name: 'Stuck Retry',          severity: 'critical', action: 'Flag',   desc: 'The same serial was scanned 3+ times within 15 minutes with no successful INSERT.',         source: 'MMI Barcode' },
  { name: 'Multi-Up Duplicate',   severity: 'critical', action: 'Flag',   desc: 'The same serial appears in multiple BS line slots simultaneously — scan collision.',        source: 'MMI Barcode · BS only' },
  { name: 'Missing PSA Tape',     severity: 'warning',  action: 'Update', desc: 'PSA_TAPE_PIC is empty in SQL but a CAM4_PSA_TAPE event exists in the MMI log.',            source: 'MMI Barcode · SQL Product' },
  { name: 'Orphan Row',           severity: 'warning',  action: 'Delete', desc: 'PSA images present in SQL but both serial fields are null — no unit identity.',             source: 'SQL Product' },
  { name: 'Index Mismatch',       severity: 'warning',  action: 'Update', desc: 'Camera 2 PSA image index gap is not exactly +6 — captured at the wrong slot offset.',      source: 'SQL Product' },
  { name: 'Manual Push',          severity: 'warning',  action: 'Flag',   desc: 'SQL record exists with no MMI evidence — likely entered manually outside normal flow.',     source: 'MMI Barcode · SQL Product' },
  { name: 'Ghost Scan',           severity: 'warning',  action: 'Flag',   desc: 'Serial scanned before and after an MMI-START restart — ambiguous session ownership.',      source: 'MMI Barcode' },
  { name: 'Missing Barcode Scan', severity: 'warning',  action: 'Flag',   desc: 'INSERT in MMI log with no upstream scan event — out-of-order or skipped step.',            source: 'MMI Barcode · SQL Product' },
  { name: 'OEE Error Mismatch',   severity: 'warning',  action: 'Flag',   desc: 'Error code in SQL error table has no match in the MMI error log, or vice versa.',          source: 'MMI Error · SQL Error' },
  { name: 'Error No Recovery',    severity: 'warning',  action: 'Flag',   desc: 'Error fired with no CLEAR, RESET, or next scan within 5 minutes — possibly unresolved.',   source: 'MMI Error' },
  { name: 'Repeated Insert',      severity: 'warning',  action: 'Delete', desc: 'Identical INSERT logged multiple times in the MMI log — PLC timing issue on trigger.',     source: 'MMI Barcode' },
  { name: 'Long Cycle Outlier',   severity: 'info',     action: 'Flag',   desc: 'Cycle time exceeded 3× station median — possible pause, intervention, or rework.',         source: 'SQL Product' },
];

// ── Per-slot state ─────────────────────────────────────────────────────────

interface SlotState {
  filename?: string;
  status: 'idle' | 'uploading' | 'success' | 'error';
  errorMsg?: string;
}

type SlotsState = Record<SlotKey, SlotState>;

const EMPTY_SLOTS: SlotsState = {
  mmi_barcode: { status: 'idle' },
  mmi_error:   { status: 'idle' },
  sql_product: { status: 'idle' },
  sql_error:   { status: 'idle' },
};

// ── Component ──────────────────────────────────────────────────────────────

export function DataCleanup() {
  const [station, setStation]   = useState<StationCode | ''>('');
  const [slots, setSlots]       = useState<SlotsState>(EMPTY_SLOTS);
  const [changes, setChanges]   = useState<Change[]>([]);
  const [selectedChange, setSelectedChange] = useState<Change | null>(null);
  const [byType, setByType]     = useState<Record<string, number>>({});
  const [byStatus, setByStatus] = useState<Record<string, number>>({ pending: 0, approved: 0, rejected: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const fileRefs = useRef<Record<SlotKey, HTMLInputElement | null>>({
    mmi_barcode: null, mmi_error: null, sql_product: null, sql_error: null,
  });

  // ── derived ───────────────────────────────────────────────────────────────

  const filledSlots = useMemo(() =>
    (Object.keys(slots) as SlotKey[]).filter(k => slots[k].status === 'success'),
    [slots]
  );

  const willRun = useMemo(() => {
    return Object.values(DETECTOR_REQUIREMENTS)
      .filter(req => req.slots.every(s => filledSlots.includes(s as SlotKey)))
      .map(req => req.label);
  }, [filledSlots]);

  const canAnalyze = station !== '' && filledSlots.length > 0 && !isAnalyzing;

  const filteredChanges = useMemo(() => {
    if (!activeFilter) return changes;
    if (activeFilter.startsWith('type:'))
      return changes.filter(c => c.issue_type === activeFilter.replace('type:', ''));
    if (activeFilter.startsWith('status:'))
      return changes.filter(c => c.status === activeFilter.replace('status:', ''));
    return changes;
  }, [changes, activeFilter]);

  // ── upload ────────────────────────────────────────────────────────────────

  const uploadSlot = useCallback(async (slotKey: SlotKey, file: File) => {
    setSlots(prev => ({ ...prev, [slotKey]: { status: 'uploading', filename: file.name } }));
    const formData = new FormData();
    formData.append('file', file);
    if (station) formData.append('station', station);
    try {
      const res = await fetch(`${API_BASE}${SLOTS[slotKey].endpoint}`, {
        method: 'POST', body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }
      setSlots(prev => ({ ...prev, [slotKey]: { status: 'success', filename: file.name } }));
    } catch (e: any) {
      setSlots(prev => ({
        ...prev,
        [slotKey]: { status: 'error', filename: file.name, errorMsg: e.message },
      }));
    }
  }, [station]);

  const clearSlot = useCallback((slotKey: SlotKey) => {
    setSlots(prev => ({ ...prev, [slotKey]: { status: 'idle' } }));
    const ref = fileRefs.current[slotKey];
    if (ref) ref.value = '';
  }, []);

  // ── analyze ───────────────────────────────────────────────────────────────

  const analyze = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch(`${API_BASE}/cleanup/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station }),
      });
      const data = await res.json();
      const changesRes = await fetch(`${API_BASE}/cleanup/changes`).then(r => r.json());
      const changesData = changesRes.changes || [];
      setChanges(changesData);
      setByType(data.by_type || {});
      setByStatus(data.by_status || { pending: 0, approved: 0, rejected: 0 });
      setAnalyzed(true);
      if (changesData.length > 0) setSelectedChange(changesData[0]);
    } finally {
      setIsAnalyzing(false);
    }
  }, [station]);

  const updateChangeStatus = useCallback(async (id: string, action: 'approve' | 'reject') => {
    await fetch(`${API_BASE}/cleanup/changes/${id}/${action}`, { method: 'POST' });
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    setChanges(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
    setSelectedChange(prev => prev?.id === id ? { ...prev, status: newStatus } : prev);
    setByStatus(prev => {
      const oldStatus = changes.find(c => c.id === id)?.status || 'pending';
      return {
        ...prev,
        [oldStatus]: Math.max(0, (prev[oldStatus] || 0) - 1),
        [newStatus]: (prev[newStatus] || 0) + 1,
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
    setStation('');
    setSlots(EMPTY_SLOTS);
    setChanges([]);
    setSelectedChange(null);
    setByType({});
    setByStatus({ pending: 0, approved: 0, rejected: 0 });
    setAnalyzed(false);
    setActiveFilter(null);
  }, []);

  // ── assistant context ─────────────────────────────────────────────────────

  const { mergeContext } = useAssistantContext();
  useEffect(() => {
    mergeContext({
      station,
      mmi_uploaded: slots.mmi_barcode.status === 'success',
      sql_uploaded: slots.sql_product.status === 'success',
      analyzed,
      total_changes: changes.length,
      pending_changes: byStatus.pending,
    });
  }, [station, slots, analyzed, changes.length, byStatus.pending]);

  // ── results view ──────────────────────────────────────────────────────────

  if (analyzed) {
    const stationInfo = STATIONS.find(s => s.code === station);
    return (
      <div className="cleanup-page analysis-mode">
        <div className="analysis-header">
          <div className="analysis-title">
            <h1>Analysis Results</h1>
            {stationInfo && (
              <span className="station-badge">
                {stationInfo.icon} {stationInfo.name}
              </span>
            )}
          </div>
          <div className="header-actions">
            <button className="export-button" onClick={() => downloadFile('sql')}>↓ Export SQL</button>
            <button className="export-button" onClick={() => downloadFile('mmi')}>↓ Export MMI</button>
            <button className="reset-button" onClick={reset}>Start Over</button>
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
              Showing:{' '}
              <strong>
                {activeFilter.replace('type:', '').replace('status:', '').replace(/_/g, ' ')}
              </strong>{' '}
              ({filteredChanges.length} of {changes.length})
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

  // ── upload / setup view ───────────────────────────────────────────────────

  const analyzeLabel = isAnalyzing
    ? 'Analyzing…'
    : !station
    ? 'Select a station first'
    : filledSlots.length === 0
    ? 'Upload at least one file'
    : `Run ${willRun.length} check${willRun.length !== 1 ? 's' : ''}`;

  const scrollItems = [...ISSUE_CATALOGUE, ...ISSUE_CATALOGUE];

  return (
    <div className="cleanup-page">
      <div className="cleanup-split">

        {/* ── LEFT: setup ── */}
        <div className="setup-panel">
          <div className="setup-hero">
            <div className="setup-eyebrow">Factory Tools Suite</div>
            <h1>Data Cleanup</h1>
            <p>Select a station, upload any combination of files, and review every issue the system detects.</p>
          </div>

          <div className="setup-steps">

            <div className="setup-step">
              <div className="step-label">
                <span className="step-num">1</span> Station
              </div>
              <select
                className="station-select"
                value={station}
                onChange={e => setStation(e.target.value as '' | 'BS' | 'BA' | 'TR' | 'TO' | 'LA' | 'FV')}
              >
                <option value="">Select a station</option>
                {STATIONS.map(s => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="setup-step">
              <div className="step-label">
                <span className="step-num">2</span> Upload Files
                <span className="step-hint">all optional — more files unlock more checks</span>
              </div>
              <div className="file-slots-grid">
                {(Object.keys(SLOTS) as SlotKey[]).map(slotKey => {
                  const slotDef = SLOTS[slotKey];
                  const state   = slots[slotKey];
                  const isOk    = state.status === 'success';
                  const isErr   = state.status === 'error';
                  const isBusy  = state.status === 'uploading';

                  const cardContent = (
                    <>
                      <div className="file-slot-header">
                        <span className="file-slot-label">{slotDef.label}</span>
                        {isOk && (
                          <button className="slot-clear-btn" onClick={e => { e.preventDefault(); clearSlot(slotKey); }}>✕</button>
                        )}
                      </div>

                      {isOk ? (
                        <div className="file-slot-drop success-state">
                          <span className="slot-check">✓</span>
                          <span className="slot-filename">{state.filename}</span>
                        </div>
                      ) : isErr ? (
                        <div className="file-slot-drop error-state">
                          <span>Upload failed</span>
                          <button className="slot-retry-btn" onClick={e => { e.preventDefault(); fileRefs.current[slotKey]?.click(); }}>Retry</button>
                        </div>
                      ) : isBusy ? (
                        <div className="file-slot-drop busy-state">
                          <span className="slot-uploading-dot" />
                        </div>
                      ) : (
                        <div className="file-slot-drop">↑</div>
                      )}
                    </>
                  );

                  return (
                    <div key={slotKey}>
                      {state.status === 'idle' ? (
                        <label className={`file-slot ${state.status}`} htmlFor={`slot-${slotKey}`}>
                          {cardContent}
                        </label>
                      ) : (
                        <div className={`file-slot ${state.status}`}>
                          {cardContent}
                        </div>
                      )}

                      <input
                        id={`slot-${slotKey}`}
                        type="file"
                        accept={slotDef.accept}
                        style={{ display: 'none' }}
                        ref={el => { fileRefs.current[slotKey] = el; }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) uploadSlot(slotKey, f);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              className={`analyze-btn ${canAnalyze ? 'ready' : 'disabled'}`}
              onClick={analyze}
              disabled={!canAnalyze}
            >
              {analyzeLabel}
            </button>

          </div>
        </div>

        {/* ── RIGHT: scrolling issues catalogue ── */}
        <div className="issues-panel">
          <div className="issues-panel-header">
            <div className="issues-panel-eyebrow">What we detect</div>
            <div className="issues-panel-title">14 checks across all stations</div>
          </div>

          <div className="issues-fade-top" />
          <div className="issues-fade-bottom" />

          <div className="issues-scroll-outer">
            <div className="issues-scroll-track">
              {scrollItems.map((issue, i) => (
                <div key={i} className="issue-row">
                  <div className={`sev-dot sev-${issue.severity}`} />
                  <div className="issue-row-body">
                    <div className="issue-row-top">
                      <span className="issue-row-name">{issue.name}</span>
                      <span className="issue-row-action">{issue.action}</span>
                    </div>
                    <div className="issue-row-desc">{issue.desc}</div>
                    <div className="issue-row-source">{issue.source}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}