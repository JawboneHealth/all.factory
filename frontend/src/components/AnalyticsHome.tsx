import { useState, useEffect } from 'react';
import { Plus, Star, Trash2, Pencil, Check, X, Clock, AlertTriangle, ChevronRight, Factory } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

interface AnalysisSummary {
  id: string;
  name: string;
  starred: boolean;
  work_order: string | null;
  created_at: string;
  updated_at: string;
  total_units: number;
  total_errors: number;
  station_count: number;
  result?: { station_analyses?: any[] };
}

interface Props {
  onNewAnalysis: () => void;
  onOpenAnalysis: (id: string) => void;
}

export function AnalyticsHome({ onNewAnalysis, onOpenAnalysis }: Props) {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchAnalyses = async () => {
    try {
      const res = await fetch(`${API_BASE}/analyses/`);
      const data = await res.json();
      setAnalyses(data);
    } catch (e) {
      console.error('Failed to fetch analyses', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAnalyses(); }, []);

  const toggleStar = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${API_BASE}/analyses/${id}/star`, { method: 'PATCH' });
    fetchAnalyses();
  };

  const deleteAnalysis = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this analysis?')) return;
    await fetch(`${API_BASE}/analyses/${id}`, { method: 'DELETE' });
    fetchAnalyses();
  };

  const startRename = (a: AnalysisSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(a.id);
    setRenameValue(a.name);
  };

  const commitRename = async (id: string) => {
    if (!renameValue.trim()) return;
    await fetch(`${API_BASE}/analyses/${id}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    setRenamingId(null);
    fetchAnalyses();
  };

  const starred = analyses.filter(a => a.starred);
  const recent  = analyses.filter(a => !a.starred);

  return (
    <div className="analytics-home">
      {/* Header */}
      <div className="home-header">
        <div className="home-title">
          <Factory size={28} />
          <div>
            <h1>Production Analytics</h1>
            <p>Select a past analysis or start a new one</p>
          </div>
        </div>
        <button className="new-analysis-btn" onClick={onNewAnalysis}>
          <Plus size={16} />
          New Analysis
        </button>
      </div>

      {loading ? (
        <div className="home-loading">Loading analyses...</div>
      ) : analyses.length === 0 ? (
        <div className="home-empty">
          <Factory size={48} />
          <h2>No analyses yet</h2>
          <p>Upload your station logs to get started</p>
          <button className="new-analysis-btn" onClick={onNewAnalysis}>
            <Plus size={16} /> New Analysis
          </button>
        </div>
      ) : (
        <>
          {starred.length > 0 && (
            <section className="home-section">
              <h2 className="section-label"><Star size={14} /> Starred</h2>
              <div className="analyses-grid">
                {starred.map(a => (
                  <AnalysisCard
                    key={a.id} a={a}
                    renamingId={renamingId} renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    onOpen={() => onOpenAnalysis(a.id)}
                    onStar={toggleStar} onDelete={deleteAnalysis}
                    onStartRename={startRename} onCommitRename={commitRename}
                    onCancelRename={() => setRenamingId(null)}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="home-section">
            <h2 className="section-label"><Clock size={14} /> Recent</h2>
            <div className="analyses-grid">
              {recent.map(a => (
                <AnalysisCard
                  key={a.id} a={a}
                  renamingId={renamingId} renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  onOpen={() => onOpenAnalysis(a.id)}
                  onStar={toggleStar} onDelete={deleteAnalysis}
                  onStartRename={startRename} onCommitRename={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const STATION_COLORS: Record<string, string> = {
  'Bottom Shell': '#818cf8',
  'Battery':      '#34d399',
  'Trans':        '#f472b6',
  'Top Shell':    '#fbbf24',
  'Laser':        '#ef4444',
  'FVT':          '#06b6d4',
};

function AnalysisCard({ a, renamingId, renameValue, setRenameValue, onOpen, onStar, onDelete, onStartRename, onCommitRename, onCancelRename }: any) {
  const isRenaming = renamingId === a.id;

  const stations: any[] = a.result?.station_analyses ?? [];
  const maxUnits = Math.max(1, ...stations.map((s: any) =>
    s.sql?.rowCount ?? s.barcode?.completedUnits ?? 0
  ));

  const relTime = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const totalUnits = a.total_units > 0
    ? a.total_units
    : stations.reduce((acc: number, s: any) => acc + (s.sql?.rowCount ?? s.barcode?.completedUnits ?? 0), 0);
  const totalErrors = a.total_errors > 0
    ? a.total_errors
    : stations.reduce((acc: number, s: any) => acc + (s.errors?.totalErrors ?? 0), 0);
  const isClean = totalErrors === 0 && stations.length > 0;

  return (
    <div className="analysis-card" onClick={onOpen}>

      {/* ── Header band ── */}
      <div className="card-header-band">
        <div className="card-header-left">
          {isRenaming ? (
            <div className="rename-row" onClick={e => e.stopPropagation()}>
              <input
                className="rename-input"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onCommitRename(a.id); if (e.key === 'Escape') onCancelRename(); }}
                autoFocus
              />
              <button className="icon-btn confirm" onClick={() => onCommitRename(a.id)}><Check size={13} /></button>
              <button className="icon-btn cancel" onClick={onCancelRename}><X size={13} /></button>
            </div>
          ) : (
            <div className="card-name-row">
              <span className="card-name">{a.name}</span>
              <div className="card-actions" onClick={e => e.stopPropagation()}>
                <button className="icon-btn" onClick={e => onStartRename(a, e)} title="Rename"><Pencil size={13} /></button>
                <button className={`icon-btn star ${a.starred ? 'active' : ''}`} onClick={e => onStar(a.id, e)} title="Star">
                  <Star size={13} fill={a.starred ? 'currentColor' : 'none'} />
                </button>
                <button className="icon-btn danger" onClick={e => onDelete(a.id, e)} title="Delete"><Trash2 size={13} /></button>
              </div>
            </div>
          )}
          {a.work_order && <span className="work-order-badge">{a.work_order}</span>}
        </div>

        <div className="card-header-right">
          <span className="card-units-count">
            {totalUnits > 0 ? <><strong>{totalUnits}</strong> units produced</> : <span className="card-units-dash">— units produced</span>}
          </span>
          {isClean
            ? <span className="card-clean">✓ CLEAN</span>
            : <span className="card-errors-count"><AlertTriangle size={11} /> {totalErrors}</span>
          }
        </div>
      </div>

      {/* ── Station rows ── */}
      {stations.length > 0 && (
        <div className="card-station-rows">
          {stations.map((s: any, i: number) => {
            const name  = s.station?.name ?? '—';
            const color = STATION_COLORS[name] ?? '#6366f1';
            const units = s.sql?.rowCount ?? s.barcode?.completedUnits ?? 0;
            const errs  = s.errors?.totalErrors ?? 0;
            const pct   = units > 0 ? (units / maxUnits) * 100 : 0;
            return (
              <div key={i} className={`card-station-row ${i > 0 ? 'bordered' : ''}`}>
                <div className="station-row-bar" style={{ background: color }} />
                <span className="station-row-name">{name}</span>
                <div className="station-row-track">
                  <div className="station-row-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
                <span className="station-row-units">{units > 0 ? units : '—'}</span>
                <span className={`station-row-errors ${errs > 0 ? 'has-errors' : 'ok'}`}>
                  {errs > 0 ? <><AlertTriangle size={10} /> {errs}</> : '✓'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="card-footer">
        <span className="card-date"><Clock size={12} /> {relTime(a.updated_at)}</span>
        <ChevronRight size={14} className="card-arrow" />
      </div>

    </div>
  );
}