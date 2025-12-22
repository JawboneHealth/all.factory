import { useState, useCallback, useEffect } from 'react';
import { StationFileUpload } from '../components/StationFileUpload';
import { AnalyticsTabs } from '../components/AnalyticsTabs';
import { DashboardView } from '../components/DashboardView';
import { ErrorTimelineView } from '../components/ErrorTimelineView';
import { EventTimelineView } from '../components/EventTimelineView';
import { IssueAnalysisView } from '../components/IssueAnalysisView';
import { SerialAnalysisView } from '../components/SerialAnalysisView';
import { 
  STATIONS, 
  type StationFiles, 
  type AnalyticsTab, 
  type AnalyticsState 
} from '../types';
import {
  cacheAnalyticsData,
  getCachedAnalyticsData,
  hasValidAnalyticsCache,
  getAnalyticsCacheInfo,
  clearAnalyticsCache,
} from '../utils/cache';
import './ProductAnalytics.css';

const API_BASE = 'http://localhost:8000';

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
  const [cacheInfo, setCacheInfo] = useState<ReturnType<typeof getAnalyticsCacheInfo>>(null);

  // Check for cached data on mount
  useEffect(() => {
    if (hasValidAnalyticsCache()) {
      const cached = getCachedAnalyticsData();
      if (cached) {
        setState(prev => ({
          ...prev,
          analysisComplete: true,
          stationAnalyses: cached.stationAnalyses || [],
          crossStationAnalysis: cached.crossStationAnalysis || null,
          serialAnalyses: cached.serialAnalyses || [],
          allEvents: cached.allEvents || [],
        }));
        setCacheInfo(getAnalyticsCacheInfo());
      }
    }
  }, []);

  // Update cache info periodically
  useEffect(() => {
    if (!state.analysisComplete) return;
    
    const interval = setInterval(() => {
      const info = getAnalyticsCacheInfo();
      setCacheInfo(info);
      
      // If cache expired, reset state
      if (!info) {
        setState(prev => ({
          ...prev,
          analysisComplete: false,
          stationAnalyses: [],
          crossStationAnalysis: null,
          serialAnalyses: [],
          allEvents: [],
        }));
      }
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(interval);
  }, [state.analysisComplete]);

  const handleFileUpload = useCallback((stationCode: string, fileType: 'barcode' | 'error' | 'sql', file: File) => {
    setState(prev => ({
      ...prev,
      stationFiles: {
        ...prev.stationFiles,
        [stationCode]: {
          ...prev.stationFiles[stationCode],
          stationCode,
          [`${fileType}Log`]: file,
          [`${fileType}LogName`]: file.name,
        }
      }
    }));
  }, []);

  const handleFileRemove = useCallback((stationCode: string, fileType: 'barcode' | 'error' | 'sql') => {
    setState(prev => {
      const stationFiles = { ...prev.stationFiles };
      if (stationFiles[stationCode]) {
        const updated = { ...stationFiles[stationCode] };
        delete updated[`${fileType}Log` as keyof StationFiles];
        delete updated[`${fileType}LogName` as keyof StationFiles];
        stationFiles[stationCode] = updated;
      }
      return { ...prev, stationFiles };
    });
  }, []);

  const runAnalysis = useCallback(async () => {
    setState(prev => ({ ...prev, isAnalyzing: true }));

    try {
      // Upload all files
      const uploadPromises: Promise<Response>[] = [];
      const uploadedFiles: string[] = [];
      const stations: string[] = [];
      
      for (const [stationCode, files] of Object.entries(state.stationFiles)) {
        stations.push(stationCode);
        
        if (files.barcodeLog) {
          const formData = new FormData();
          formData.append('file', files.barcodeLog);
          formData.append('station', stationCode);
          formData.append('type', 'barcode');
          uploadPromises.push(
            fetch(`${API_BASE}/analytics/upload`, { method: 'POST', body: formData })
          );
          uploadedFiles.push(`${stationCode}_barcode`);
        }
        if (files.errorLog) {
          const formData = new FormData();
          formData.append('file', files.errorLog);
          formData.append('station', stationCode);
          formData.append('type', 'error');
          uploadPromises.push(
            fetch(`${API_BASE}/analytics/upload`, { method: 'POST', body: formData })
          );
          uploadedFiles.push(`${stationCode}_error`);
        }
        if (files.sqlExport) {
          const formData = new FormData();
          formData.append('file', files.sqlExport);
          formData.append('station', stationCode);
          formData.append('type', 'sql');
          uploadPromises.push(
            fetch(`${API_BASE}/analytics/upload`, { method: 'POST', body: formData })
          );
          uploadedFiles.push(`${stationCode}_sql`);
        }
      }

      await Promise.all(uploadPromises);

      // Run analysis
      const params = new URLSearchParams();
      if (timeFilter) params.append('start_time', timeFilter);
      
      const analysisRes = await fetch(`${API_BASE}/analytics/analyze?${params}`, { method: 'POST' });
      const analysisData = await analysisRes.json();

      const newState = {
        stationAnalyses: analysisData.station_analyses || [],
        crossStationAnalysis: analysisData.cross_station || null,
        serialAnalyses: analysisData.serial_analyses || [],
        allEvents: analysisData.all_events || [],
      };

      // Cache the results for 5 minutes
      cacheAnalyticsData({
        ...newState,
        stations,
        uploadedFiles,
        analysisTimestamp: Date.now(),
      });

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        analysisComplete: true,
        ...newState,
      }));
      
      setCacheInfo(getAnalyticsCacheInfo());
    } catch (error) {
      console.error('Analysis failed:', error);
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  }, [state.stationFiles, timeFilter]);

  const reset = useCallback(() => {
    // Clear cache when resetting
    clearAnalyticsCache();
    
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
    setCacheInfo(null);
  }, []);

  const hasFiles = Object.keys(state.stationFiles).some(key => {
    const f = state.stationFiles[key];
    return f.barcodeLog || f.errorLog || f.sqlExport;
  });

  // Landing / Upload view
  if (!state.analysisComplete) {
    return (
      <div className="analytics-page">
        <section className="analytics-hero">
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

  // Analysis results view
  return (
    <div className="analytics-page results-mode">
      <div className="analytics-header">
        <div className="header-left">
          <h1>Production Analytics</h1>
          <span className="analysis-info">
            {state.stationAnalyses.length} stations • {state.allEvents.length.toLocaleString()} events
          </span>
        </div>
        <div className="header-actions">
          {/* Cache indicator */}
          {cacheInfo && (
            <div className="cache-indicator">
              <span className="cache-icon">💾</span>
              <span className="cache-text">
                Cached • {cacheInfo.remainingFormatted} remaining
              </span>
            </div>
          )}
          <button className="reset-button" onClick={reset}>
            ← New Analysis
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