import { useState, useCallback, useEffect } from 'react';
import { StationFileUpload } from '../components/StationFileUpload';
import { AnalyticsTabs } from '../components/AnalyticsTabs';
import { DashboardView } from '../components/DashboardView';
import { ErrorTimelineView } from '../components/ErrorTimelineView';
import { EventTimelineView } from '../components/EventTimelineView';
import { IssueAnalysisView } from '../components/IssueAnalysisView';
import { SerialAnalysisView } from '../components/SerialAnalysisView';
import { AnalyticsHome } from '../components/AnalyticsHome';
import { useAssistantContext } from '../components/Assistant/AssistantContext';
import { 
  STATIONS, 
  type StationFiles, 
  type AnalyticsTab, 
  type AnalyticsState 
} from '../types';
import { generateDashboardHtml, generateErrorTimelineHtml, generateEventTimelineHtml, generateCrossStationHtml, generateSerialHtml, downloadHtml } from '../utils/exportHtml';
import './ProductAnalytics.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

export function ProductAnalytics() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('dashboard');
  const [state, setState] = useState<AnalyticsState>({
    stationFiles: {},
    isAnalyzing: false,
    analysisComplete: false,
    stationAnalyses: [],
    crossStationAnalysis: null,
    serialAnalyses: [],
    allEvents: [],
  });
  
  const [timeFilter, setTimeFilter] = useState<string>('');
  const [excludeWindows, setExcludeWindows] = useState<Array<{start: string; end: string}>>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [view, setView] = useState<'home' | 'upload' | 'results'>('home');
  const [loadedAnalysisId, setLoadedAnalysisId] = useState<string | null>(null);

  const handleFileUpload = useCallback((stationCode: string, fileType: 'barcode' | 'error' | 'sql', file: File) => {
    const fileKey  = fileType === 'sql' ? 'sqlExport'     : `${fileType}Log`;
    const nameKey  = fileType === 'sql' ? 'sqlExportName' : `${fileType}LogName`;
    setState(prev => ({
      ...prev,
      stationFiles: {
        ...prev.stationFiles,
        [stationCode]: {
          ...prev.stationFiles[stationCode],
          stationCode,
          [fileKey]: file,
          [nameKey]: file.name,
        }
      }
    }));
  }, []);

  const handleFileRemove = useCallback((stationCode: string, fileType: 'barcode' | 'error' | 'sql') => {
    const fileKey  = fileType === 'sql' ? 'sqlExport'     : `${fileType}Log`;
    const nameKey  = fileType === 'sql' ? 'sqlExportName' : `${fileType}LogName`;
    setState(prev => {
      const stationFiles = { ...prev.stationFiles };
      if (stationFiles[stationCode]) {
        const updated = { ...stationFiles[stationCode] };
        delete updated[fileKey as keyof StationFiles];
        delete updated[nameKey as keyof StationFiles];
        stationFiles[stationCode] = updated;
      }
      return { ...prev, stationFiles };
    });
  }, []);

  const runAnalysis = useCallback(async () => {
    setState(prev => ({ ...prev, isAnalyzing: true }));

    try {
      await fetch(`${API_BASE}/analytics/reset`, { method: 'POST' });

      const uploadPromises: Promise<Response>[] = [];
      
      for (const [stationCode, files] of Object.entries(state.stationFiles)) {
        if (files.barcodeLog) {
          const formData = new FormData();
          formData.append('file', files.barcodeLog);
          formData.append('station', stationCode);
          formData.append('type', 'barcode');
          uploadPromises.push(fetch(`${API_BASE}/analytics/upload`, { method: 'POST', body: formData }));
        }
        if (files.errorLog) {
          const formData = new FormData();
          formData.append('file', files.errorLog);
          formData.append('station', stationCode);
          formData.append('type', 'error');
          uploadPromises.push(fetch(`${API_BASE}/analytics/upload`, { method: 'POST', body: formData }));
        }
        if (files.sqlExport) {
          const formData = new FormData();
          formData.append('file', files.sqlExport);
          formData.append('station', stationCode);
          formData.append('type', 'sql');
          uploadPromises.push(fetch(`${API_BASE}/analytics/upload`, { method: 'POST', body: formData }));
        }
      }

      await Promise.all(uploadPromises);

      const params = new URLSearchParams();
      if (timeFilter) params.append('start_time', timeFilter);
      const validWindows = excludeWindows.filter(w => w.start && w.end);
      if (validWindows.length > 0) params.append('exclude_windows', JSON.stringify(validWindows));
      
      const analysisRes = await fetch(`${API_BASE}/analytics/analyze?${params}`, { method: 'POST' });
      const analysisData = await analysisRes.json();

      const newState = {
        stationAnalyses: analysisData.station_analyses || [],
        crossStationAnalysis: analysisData.cross_station || null,
        serialAnalyses: analysisData.serial_analyses || [],
        allEvents: analysisData.all_events || [],
      };

      // Auto-save to database with summary stats
      try {
        const totalUnits = (analysisData.station_analyses || []).reduce(
          (acc: number, s: any) => Math.max(acc, s.barcode?.completedUnits || 0), 0
        );
        const totalErrors = (analysisData.station_analyses || []).reduce(
          (acc: number, s: any) => acc + (s.errors?.totalEvents || s.errors?.events?.length || 0), 0
        );
        const saveRes = await fetch(`${API_BASE}/analyses/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            result: analysisData,
            total_units: totalUnits,
            total_errors: totalErrors,
            station_count: (analysisData.station_analyses || []).length,
          }),
        });
        const saved = await saveRes.json();
        setLoadedAnalysisId(saved.id);
      } catch (e) {
        console.warn('Failed to save analysis to DB', e);
      }

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        analysisComplete: true,
        ...newState,
      }));
      
      setView('results');
    } catch (error) {
      console.error('Analysis failed:', error);
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  }, [state.stationFiles, timeFilter]);

  const reset = useCallback(() => {
    fetch(`${API_BASE}/analytics/reset`, { method: 'POST' });
    setState({
      stationFiles: {},
      isAnalyzing: false,
      analysisComplete: false,
      stationAnalyses: [],
      crossStationAnalysis: null,
      serialAnalyses: [],
      allEvents: [],
    });
    setActiveTab('dashboard');
    setLoadedAnalysisId(null);
    setView('home');
  }, []);

  const openAnalysis = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/analyses/${id}`);
      const data = await res.json();
      const result = data.result;
      setState(prev => ({
        ...prev,
        analysisComplete: true,
        stationAnalyses: result?.station_analyses || [],
        crossStationAnalysis: result?.cross_station || null,
        serialAnalyses: result?.serial_analyses || [],
        allEvents: result?.all_events || [],
      }));
      setLoadedAnalysisId(id);
      setView('results');
    } catch (e) {
      console.error('Failed to load analysis', e);
    }
  }, []);

  const hasFiles = Object.keys(state.stationFiles).some(key => {
    const f = state.stationFiles[key];
    return f.barcodeLog || f.errorLog || f.sqlExport;
  });

  const { mergeContext } = useAssistantContext();
  useEffect(() => {
    mergeContext({
      analytics_view: view,
      analytics_tab: view === 'results' ? activeTab : undefined,
      station_count: state.stationAnalyses.length,
      total_units: state.stationAnalyses.reduce(
        (acc, s: any) => acc + ((s.sql?.rowCount ?? s.barcode?.completedUnits) || 0), 0
      ),
      total_errors: state.stationAnalyses.reduce(
        (acc, s: any) => acc + (s.errors?.totalErrors || 0), 0
      ),
    });
  }, [view, activeTab, state.stationAnalyses]);

  // Home screen
  if (view === 'home') {
    return (
      <div className="analytics-page">
        <AnalyticsHome
          onNewAnalysis={() => setView('upload')}
          onOpenAnalysis={openAnalysis}
        />
      </div>
    );
  }

  // Upload view
  if (view === 'upload') {
    return (
      <div className="analytics-page">
        <section className="analytics-hero">
          <button className="back-button" onClick={() => setView('home')}>
            ← Back
          </button>
          <span className="hero-badge">Factory Tools Suite</span>
          <h1>Production Analytics</h1>
          <p className="hero-subtitle">
            Multi-station analysis for cycle times, errors, throughput, and cross-station patterns.
          </p>
        </section>

        <section className="upload-instructions">
          <h2>Upload Station Data</h2>
          <p>
            Upload log files for each station. All files are optional — partial data will give partial results.
          </p>
          
          <div className="time-filter-row">
            <label>
              <span>Start Time Filter (optional)</span>
              <input 
                type="text" 
                placeholder="e.g., 9:54:00 AM"
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
              />
            </label>
            <span className="hint">Only analyze events after this time</span>
          </div>

          <div className="exclude-windows-section">
            <div className="exclude-windows-header">
              <span className="exclude-windows-label">Exclude Time Windows (optional)</span>
              <button
                className="exclude-add-btn"
                onClick={() => setExcludeWindows(prev => [...prev, { start: '', end: '' }])}
              >
                + Add Window
              </button>
            </div>
            {excludeWindows.length === 0 && (
              <p className="hint">Exclude specific periods from calculations — e.g. lunch breaks, shift changes.</p>
            )}
            {excludeWindows.map((w, i) => (
              <div key={i} className="exclude-window-row">
                <input
                  type="text"
                  placeholder="e.g., 11:00:00 AM"
                  value={w.start}
                  onChange={e => setExcludeWindows(prev => prev.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                />
                <span className="exclude-to">to</span>
                <input
                  type="text"
                  placeholder="e.g., 11:30:00 AM"
                  value={w.end}
                  onChange={e => setExcludeWindows(prev => prev.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                />
                <button
                  className="exclude-remove-btn"
                  onClick={() => setExcludeWindows(prev => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="stations-upload-grid">
          {STATIONS.map(station => (
            <StationFileUpload
              key={station.code}
              station={station}
              files={state.stationFiles[station.code]}
              onUpload={(type, file) => handleFileUpload(station.code, type, file)}
              onRemove={(type) => handleFileRemove(station.code, type)}
            />
          ))}
        </div>

        <div className="analyze-actions">
          <button
            className={`analyze-button ${hasFiles ? 'ready' : 'disabled'}`}
            onClick={runAnalysis}
            disabled={!hasFiles || state.isAnalyzing}
          >
            {state.isAnalyzing ? (
              <>
                <span className="spinner" />
                Analyzing...
              </>
            ) : (
              'Run Analysis'
            )}
          </button>
          {hasFiles && (
            <span className="files-count">
              {Object.values(state.stationFiles).reduce((acc, f) => 
                acc + (f.barcodeLog ? 1 : 0) + (f.errorLog ? 1 : 0) + (f.sqlExport ? 1 : 0), 0
              )} files ready
            </span>
          )}
        </div>

        <section className="features-section">
          <h2>Analysis Features</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">📊</div>
              <h3>Station Dashboard</h3>
              <p>KPIs, cycle times, throughput, MTBF/MTBA for each station at a glance.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">⚠️</div>
              <h3>Error Timeline</h3>
              <p>Interactive timeline showing when each error code occurs across all stations.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📈</div>
              <h3>Event Timeline</h3>
              <p>Full event visualization with filtering by station, category, and time range.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔗</div>
              <h3>Cross-Station Issues</h3>
              <p>Detect error cascades, recurring patterns, and station-to-station correlations.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔢</div>
              <h3>Serial Analysis</h3>
              <p>Unit-by-unit cycle time analysis with production runs and stoppage detection.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📥</div>
              <h3>Export Reports</h3>
              <p>Download analysis results as HTML reports or CSV data.</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Results view
  return (
    <div className="analytics-page results-mode">
      <div className="analytics-header">
        <div className="header-left">
          <button className="back-button" onClick={() => setView('home')}>
            ← Back
          </button>
          <h1>Production Analytics</h1>
          <span className="header-sep">/</span>
          <span className="analysis-info">
            {state.stationAnalyses.length} stations
          </span>
          <span className="header-sep">/</span>
          <span className="analysis-info">
            {state.allEvents.length.toLocaleString()} events
          </span>
        </div>
        <div className="header-actions">
          <div className="export-dropdown-wrapper">
            <button
              className="export-button"
              onClick={() => setShowExportMenu(!showExportMenu)}
            >
              ↓ Export
            </button>
            {showExportMenu && (
              <div className="export-dropdown">
                <button onClick={() => {
                  downloadHtml(generateDashboardHtml(state.stationAnalyses), 'dashboard-report.html');
                  downloadHtml(generateErrorTimelineHtml(state.stationAnalyses), 'error-timeline.html');
                  downloadHtml(generateEventTimelineHtml(state.allEvents), 'event-timeline.html');
                  downloadHtml(generateCrossStationHtml(state.crossStationAnalysis), 'cross-station-issues.html');
                  downloadHtml(generateSerialHtml(state.serialAnalyses), 'serial-analysis.html');
                  setShowExportMenu(false);
                }}>
                  📁 All Reports
                </button>
                <div className="export-divider" />
                <button onClick={() => {
                  downloadHtml(generateDashboardHtml(state.stationAnalyses), 'dashboard-report.html');
                  setShowExportMenu(false);
                }}>
                  📊 Dashboard
                </button>
                <button onClick={() => {
                  downloadHtml(generateErrorTimelineHtml(state.stationAnalyses), 'error-timeline.html');
                  setShowExportMenu(false);
                }}>
                  ⚠️ Error Timeline
                </button>
                <button onClick={() => {
                  downloadHtml(generateEventTimelineHtml(state.allEvents), 'event-timeline.html');
                  setShowExportMenu(false);
                }}>
                  📈 Event Timeline
                </button>
                <button onClick={() => {
                  downloadHtml(generateCrossStationHtml(state.crossStationAnalysis), 'cross-station-issues.html');
                  setShowExportMenu(false);
                }}>
                  🔗 Cross-Station Issues
                </button>
                <button onClick={() => {
                  downloadHtml(generateSerialHtml(state.serialAnalyses), 'serial-analysis.html');
                  setShowExportMenu(false);
                }}>
                  # Serial Analysis
                </button>
              </div>
            )}
          </div>
          <button className="reset-button" onClick={reset}>
            ← New
          </button>
        </div>
      </div>

      <AnalyticsTabs activeTab={activeTab} onTabChange={setActiveTab} state={state} />

      <div className="analytics-content">
        {activeTab === 'dashboard' && (
          <DashboardView analyses={state.stationAnalyses} />
        )}
        {activeTab === 'errors' && (
          <ErrorTimelineView analyses={state.stationAnalyses} />
        )}
        {activeTab === 'timeline' && (
          <EventTimelineView events={state.allEvents} />
        )}
        {activeTab === 'issues' && (
          <IssueAnalysisView analysis={state.crossStationAnalysis} />
        )}
        {activeTab === 'serial' && (
          <SerialAnalysisView analyses={state.serialAnalyses} />
        )}
      </div>
    </div>
  );
}