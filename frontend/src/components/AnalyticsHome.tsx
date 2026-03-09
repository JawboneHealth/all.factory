import { useState, useEffect } from 'react';
import { Plus, Star, Trash2, Pencil, Check, X, Clock, Package, AlertTriangle, ChevronRight, Factory } from 'lucide-react';

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

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
                    fmtDate={fmtDate}
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
                  fmtDate={fmtDate}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function AnalysisCard({ a, renamingId, renameValue, setRenameValue, onOpen, onStar, onDelete, onStartRename, onCommitRename, onCancelRename, fmtDate }: any) {
  const isRenaming = renamingId === a.id;

  return (
    <div className="analysis-card" onClick={onOpen}>
      <div className="card-top">
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
            <div className="card-actions">
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

      <div className="card-stats">
        <span className="card-stat"><Package size={12} /> {a.total_units} units</span>
        <span className={`card-stat ${a.total_errors > 20 ? 'error' : ''}`}>
          <AlertTriangle size={12} /> {a.total_errors} errors
        </span>
        <span className="card-stat">{a.station_count} stations</span>
      </div>

      <div className="card-footer">
        <span className="card-date">{fmtDate(a.updated_at)}</span>
        <ChevronRight size={14} className="card-arrow" />
      </div>
    </div>
  );
}