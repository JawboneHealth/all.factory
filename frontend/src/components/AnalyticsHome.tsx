import { useState, useEffect, useMemo } from 'react';
import { Plus, Star, Trash2, Pencil, Check, X, Clock, ChevronRight, Factory, Search } from 'lucide-react';

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
  result?: any;
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
  const [search, setSearch] = useState('');

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

  const fmtDateShort = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / 3600000;
    const diffD = diffMs / 86400000;
    if (diffH < 1) return 'Just now';
    if (diffH < 24) return `${Math.floor(diffH)}h ago`;
    if (diffD < 7) return `${Math.floor(diffD)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return analyses;
    return analyses.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.work_order?.toLowerCase().includes(q))
    );
  }, [analyses, search]);

  const starred = filtered.filter(a => a.starred);
  const recent  = filtered.filter(a => !a.starred);

  const sharedProps = { renamingId, renameValue, setRenameValue, onStar: toggleStar, onDelete: deleteAnalysis, onStartRename: startRename, onCommitRename: commitRename, onCancelRename: () => setRenamingId(null), fmtDate, fmtDateShort };

  return (
    <div className="analytics-home">
      {/* Header */}
      <div className="home-header">
        <div className="home-title">
          <div className="home-title-icon">
            <Factory size={20} />
          </div>
          <div>
            <h1>Production Analytics</h1>
            <p>Review past runs or start a new analysis</p>
          </div>
        </div>
        <button className="new-analysis-btn" onClick={onNewAnalysis}>
          <Plus size={15} />
          New Analysis
        </button>
      </div>

      {/* Search bar */}
      {analyses.length > 0 && !loading && (
        <div className="home-search-row">
          <div className="home-search">
            <Search size={14} className="search-icon" />
            <input
              className="search-input"
              type="text"
              placeholder="Search by name or work order…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>
                <X size={13} />
              </button>
            )}
          </div>
          <span className="search-count">
            {filtered.length} of {analyses.length}
          </span>
        </div>
      )}

      {loading ? (
        <div className="home-loading">
          <div className="loading-dots"><span/><span/><span/></div>
          Loading analyses…
        </div>
      ) : analyses.length === 0 ? (
        <div className="home-empty">
          <div className="empty-icon-wrap"><Factory size={32} /></div>
          <h2>No analyses yet</h2>
          <p>Upload station logs to get started</p>
          <button className="new-analysis-btn" onClick={onNewAnalysis}>
            <Plus size={15} /> New Analysis
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="home-empty">
          <div className="empty-icon-wrap"><Search size={28} /></div>
          <h2>No results</h2>
          <p>No analyses match "<strong>{search}</strong>"</p>
        </div>
      ) : (
        <>
          {starred.length > 0 && (
            <section className="home-section">
              <h2 className="section-label"><Star size={12} /> Starred</h2>
              <div className="analyses-grid">
                {starred.map(a => (
                  <AnalysisCard key={a.id} a={a} onOpen={() => onOpenAnalysis(a.id)} {...sharedProps} />
                ))}
              </div>
            </section>
          )}

          <section className="home-section">
            <h2 className="section-label"><Clock size={12} /> {starred.length > 0 ? 'Recent' : 'All Analyses'}</h2>
            <div className="analyses-grid">
              {recent.map(a => (
                <AnalysisCard key={a.id} a={a} onOpen={() => onOpenAnalysis(a.id)} {...sharedProps} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const STATION_COLORS: Record<string, string> = {
  BS: '#818cf8', BA: '#34d399', TR: '#f472b6',
  TO: '#fbbf24', LA: '#ef4444', FV: '#06b6d4',
};
const STATION_NAMES: Record<string, string> = {
  BS: 'Bottom Shell', BA: 'Battery', TR: 'Trans',
  TO: 'Top Shell',   LA: 'Laser',   FV: 'FVT',
};

function AnalysisCard({ a, renamingId, renameValue, setRenameValue, onOpen, onStar, onDelete, onStartRename, onCommitRename, onCancelRename, fmtDate, fmtDateShort }: any) {
  const isRenaming = renamingId === a.id;
  const isHighError = a.total_errors > 20;

  // Build station list from result if available, otherwise fall back to station_count placeholder
  const stations: Array<{ code: string; units: number; errors: number }> =
    a.result?.station_analyses?.map((s: any) => ({
      code: s.station?.code ?? s.stationCode ?? '',
      units: s.sql?.rowCount ?? s.barcode?.completedUnits ?? 0,
      errors: s.errors?.totalErrors ?? 0,
    })) ?? [];

  return (
    <div className="analysis-card" onClick={onOpen}>
      {/* Header band */}
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
              {a.starred && <Star size={12} className="card-star-icon" fill="currentColor" />}
              <span className="card-name">{a.name}</span>
              <div className="card-actions">
                <button className="icon-btn" onClick={e => onStartRename(a, e)} title="Rename"><Pencil size={12} /></button>
                <button className={`icon-btn star ${a.starred ? 'active' : ''}`} onClick={e => onStar(a.id, e)} title="Star">
                  <Star size={12} fill={a.starred ? 'currentColor' : 'none'} />
                </button>
                <button className="icon-btn danger" onClick={e => onDelete(a.id, e)} title="Delete"><Trash2 size={12} /></button>
              </div>
            </div>
          )}
          {a.work_order && <span className="work-order-badge">{a.work_order}</span>}
        </div>
        <div className="card-header-right">
          <div className="card-unit-count">
            <span className="unit-big">{a.total_units > 0 ? a.total_units.toLocaleString() : '—'}</span>
            <span className="unit-label">units produced</span>
          </div>
          <div className={`card-error-count ${isHighError ? 'danger' : a.total_errors === 0 ? 'clean' : ''}`}>
            {a.total_errors === 0 ? '✓ clean' : `${a.total_errors.toLocaleString()} errors`}
          </div>
        </div>
      </div>

      {/* Station rows */}
      {stations.length > 0 && (
        <div className="card-station-rows">
          {stations.map((s, i) => (
            <div key={s.code} className={`card-station-row ${i > 0 ? 'bordered' : ''}`}>
              <div className="station-row-bar" style={{ background: STATION_COLORS[s.code] ?? '#94a3b8' }} />
              <span className="station-row-name">{STATION_NAMES[s.code] ?? s.code}</span>
              <div className="station-row-track">
                <div
                  className="station-row-fill"
                  style={{
                    width: `${a.total_units > 0 ? Math.min(100, (s.units / a.total_units) * 100) : 0}%`,
                    background: (STATION_COLORS[s.code] ?? '#94a3b8') + 'bb',
                  }}
                />
              </div>
              <span className="station-row-units">{s.units > 0 ? s.units : '—'}</span>
              <span className={`station-row-errors ${s.errors > 0 ? 'has-errors' : 'ok'}`}>
                {s.errors > 0 ? `⚠ ${s.errors}` : '✓'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="card-footer">
        <span className="card-date" title={fmtDate(a.updated_at)}>
          <Clock size={11} /> {fmtDateShort(a.updated_at)}
        </span>
        <ChevronRight size={14} className="card-arrow" />
      </div>
    </div>
  );
}