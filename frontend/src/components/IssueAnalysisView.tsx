import { useState } from 'react';

interface CrossStationAnalysis {
  cascades: any[];
  recurring: any[];
  sequences: any[];
  insights: Array<{ level: string; text: string }>;
}

interface Props {
  analysis: CrossStationAnalysis | null;
}

export function IssueAnalysisView({ analysis }: Props) {
  const [activeTab, setActiveTab] = useState<'insights' | 'cascades' | 'recurring'>('insights');
  const [expandedCascade, setExpandedCascade] = useState<string | null>(null);

  if (!analysis) {
    return (
      <div className="issue-empty">
        <span className="empty-icon">🔍</span>
        <h3>No Cross-Station Analysis</h3>
        <p>Upload error logs from multiple stations to see patterns</p>
      </div>
    );
  }

  const { cascades, recurring, insights } = analysis;

  const getInsightIcon = (level: string) => {
    switch (level) {
      case 'critical': return '🚨';
      case 'warning': return '⚠️';
      case 'success': return '✅';
      default: return 'ℹ️';
    }
  };

  const formatInterval = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  return (
    <div className="issue-analysis-v2">
      {/* Summary Cards */}
      <div className="issue-summary">
        <div className={`issue-card ${cascades.length > 0 ? 'has-issues' : 'clear'}`}>
          <span className="issue-icon">🌊</span>
          <div className="issue-data">
            <span className="issue-value">{cascades.length}</span>
            <span className="issue-label">Error Cascades</span>
          </div>
          {cascades.length > 0 && <span className="issue-pulse"></span>}
        </div>
        
        <div className={`issue-card ${recurring.length > 0 ? 'has-issues' : 'clear'}`}>
          <span className="issue-icon">🔄</span>
          <div className="issue-data">
            <span className="issue-value">{recurring.length}</span>
            <span className="issue-label">Recurring Patterns</span>
          </div>
          {recurring.length > 0 && <span className="issue-pulse"></span>}
        </div>
        
        <div className="issue-card info">
          <span className="issue-icon">💡</span>
          <div className="issue-data">
            <span className="issue-value">{insights.length}</span>
            <span className="issue-label">Insights</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="issue-tabs">
        <button 
          className={`issue-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >
          💡 Insights
          <span className="tab-count">{insights.length}</span>
        </button>
        <button 
          className={`issue-tab ${activeTab === 'cascades' ? 'active' : ''}`}
          onClick={() => setActiveTab('cascades')}
        >
          🌊 Cascades
          <span className="tab-count">{cascades.length}</span>
        </button>
        <button 
          className={`issue-tab ${activeTab === 'recurring' ? 'active' : ''}`}
          onClick={() => setActiveTab('recurring')}
        >
          🔄 Recurring
          <span className="tab-count">{recurring.length}</span>
        </button>
      </div>

      {/* Content */}
      <div className="issue-content">
        {/* Insights Tab */}
        {activeTab === 'insights' && (
          <div className="insights-panel">
            {insights.length === 0 ? (
              <div className="all-clear">
                <span className="clear-icon">🎉</span>
                <h3>All Systems Healthy</h3>
                <p>No significant cross-station issues detected</p>
              </div>
            ) : (
              <div className="insights-list">
                {insights.map((insight, i) => (
                  <div key={i} className={`insight-item ${insight.level}`}>
                    <span className="insight-icon">{getInsightIcon(insight.level)}</span>
                    <div 
                      className="insight-text"
                      dangerouslySetInnerHTML={{ __html: insight.text }}
                    />
                    <span className={`insight-badge ${insight.level}`}>{insight.level}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cascades Tab */}
        {activeTab === 'cascades' && (
          <div className="cascades-panel">
            {cascades.length === 0 ? (
              <div className="empty-tab">
                <span>✨</span>
                <p>No error cascades detected</p>
              </div>
            ) : (
              <div className="cascades-list">
                {cascades.map((cascade) => {
                  const isExpanded = expandedCascade === cascade.id;
                  return (
                    <div 
                      key={cascade.id}
                      className={`cascade-item ${isExpanded ? 'expanded' : ''}`}
                    >
                      <div 
                        className="cascade-header"
                        onClick={() => setExpandedCascade(isExpanded ? null : cascade.id)}
                      >
                        <span className="cascade-time">⏱️ {cascade.startTime}</span>
                        <div className="cascade-stations">
                          {cascade.stations.map((s: string, i: number) => (
                            <span key={i} className="station-chip">{s}</span>
                          ))}
                        </div>
                        <span className="cascade-count">{cascade.errors.length} errors</span>
                        <span className="cascade-window">within {cascade.windowSec}s</span>
                        <span className={`expand-arrow ${isExpanded ? 'up' : ''}`}>▼</span>
                      </div>
                      
                      {isExpanded && (
                        <div className="cascade-errors">
                          {cascade.errors.map((err: any, i: number) => (
                            <div key={i} className="cascade-error">
                              <div className="error-dot"></div>
                              <div className="error-info">
                                <div className="error-top">
                                  <span className="error-station">{err.station}</span>
                                  <span className="error-time">{err.time}</span>
                                </div>
                                <span className="error-code">{err.code}</span>
                                <span className="error-msg">{err.message}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Recurring Tab */}
        {activeTab === 'recurring' && (
          <div className="recurring-panel">
            {recurring.length === 0 ? (
              <div className="empty-tab">
                <span>✨</span>
                <p>No recurring patterns detected</p>
              </div>
            ) : (
              <div className="recurring-list">
                {recurring.map((pattern, i) => (
                  <div key={i} className="recurring-item">
                    <div className="recurring-header">
                      <span className="recurring-station">{pattern.station}</span>
                      <div className="regularity-meter">
                        <div 
                          className="meter-fill"
                          style={{ 
                            width: `${pattern.consistency * 100}%`,
                            backgroundColor: pattern.consistency > 0.7 ? '#ef4444' : 
                                           pattern.consistency > 0.4 ? '#f59e0b' : '#10b981'
                          }}
                        />
                        <span className="meter-value">{(pattern.consistency * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    
                    <div className="recurring-error">
                      <span className="error-code-badge">{pattern.code}</span>
                      <span className="error-message">{pattern.message}</span>
                    </div>
                    
                    <div className="recurring-stats">
                      <div className="stat">
                        <span className="stat-val">{pattern.occurrences}</span>
                        <span className="stat-lbl">occurrences</span>
                      </div>
                      <div className="stat">
                        <span className="stat-val">{formatInterval(pattern.avgIntervalSec)}</span>
                        <span className="stat-lbl">avg interval</span>
                      </div>
                    </div>
                    
                    {pattern.consistency >= 0.7 && (
                      <div className="systematic-alert">
                        ⚠️ Likely systematic issue - investigate root cause
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}