import { useState, useMemo } from 'react';
import { type StationAnalysis, STATIONS } from '../types';

interface Props {
  analyses: StationAnalysis[];
}

export function DashboardView({ analyses }: Props) {
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  // Calculate totals
  const totals = useMemo(() => analyses.reduce(
    (acc, a) => ({
      units: acc.units + (a.barcode?.completedUnits || 0),
      errors: acc.errors + (a.errors?.totalErrors || 0),
      downtime: acc.downtime + (a.errors?.totalDowntimeMin || 0),
    }),
    { units: 0, errors: 0, downtime: 0 }
  ), [analyses]);

  // Find bottleneck (highest cycle time)
  const bottleneck = useMemo(() => analyses.reduce((worst, a) => {
    const ct = a.barcode?.cycleTimeMedian || 0;
    const worstCt = worst?.barcode?.cycleTimeMedian || 0;
    return ct > worstCt ? a : worst;
  }, analyses[0]), [analyses]);

  const getHealthStatus = (analysis: StationAnalysis) => {
    const errors = analysis.errors?.totalErrors || 0;
    const downtime = analysis.errors?.totalDowntimeMin || 0;
    if (errors > 50 || downtime > 30) return 'critical';
    if (errors > 20 || downtime > 15) return 'warning';
    return 'healthy';
  };

  const getStationColor = (code: string) => {
    return STATIONS.find(s => s.code === code)?.color || '#6b7280';
  };

  return (
    <div className="dashboard-epic">
      {/* Summary Cards */}
      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-icon blue">📦</div>
          <div className="summary-data">
            <div className="summary-value">{totals.units.toLocaleString()}</div>
            <div className="summary-label">Total Units</div>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon green">🏭</div>
          <div className="summary-data">
            <div className="summary-value">{analyses.length}</div>
            <div className="summary-label">Active Stations</div>
          </div>
        </div>
        
        <div className={`summary-card ${totals.errors > 50 ? 'alert' : ''}`}>
          <div className="summary-icon red">⚠️</div>
          <div className="summary-data">
            <div className="summary-value">{totals.errors}</div>
            <div className="summary-label">Total Errors</div>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon orange">⏱️</div>
          <div className="summary-data">
            <div className="summary-value">{totals.downtime.toFixed(1)}<span className="unit">min</span></div>
            <div className="summary-label">Total Downtime</div>
          </div>
        </div>
        
        {bottleneck && (
          <div className="summary-card wide">
            <div className="summary-icon" style={{ background: `linear-gradient(135deg, ${getStationColor(bottleneck.station.code)}, ${getStationColor(bottleneck.station.code)}88)` }}>
              🔥
            </div>
            <div className="summary-data">
              <div className="summary-value">{bottleneck.station.icon} {bottleneck.station.name}</div>
              <div className="summary-label">Bottleneck • {bottleneck.barcode?.cycleTimeMedian?.toFixed(1)}s cycle</div>
            </div>
          </div>
        )}
      </div>

      {/* Station Cards */}
      <div className="stations-grid">
        {analyses.map((analysis) => {
          const health = getHealthStatus(analysis);
          const color = getStationColor(analysis.station.code);
          const isSelected = selectedStation === analysis.station.code;

          // Prepare hourly data with proper scaling
          const hourlyData = analysis.barcode?.hourlyActivity || {};
          const hourlyEntries = Object.entries(hourlyData).sort(([a], [b]) => a.localeCompare(b));
          const maxHourly = Math.max(...Object.values(hourlyData), 1);

          // Prepare error data
          const errorData = analysis.errors?.errorsByCode || {};
          const errorEntries = Object.entries(errorData).sort(([, a], [, b]) => b - a).slice(0, 5);
          const maxError = Math.max(...Object.values(errorData), 1);

          return (
            <div
              key={analysis.station.code}
              className={`station-card ${health} ${isSelected ? 'selected' : ''}`}
              style={{ '--station-color': color } as React.CSSProperties}
              onClick={() => setSelectedStation(isSelected ? null : analysis.station.code)}
            >
              {/* Header */}
              <div className="station-header">
                <div className="station-identity">
                  <span className="station-icon">{analysis.station.icon}</span>
                  <div>
                    <h3 className="station-name">{analysis.station.name}</h3>
                    <span className="station-code">{analysis.station.code}</span>
                  </div>
                </div>
                <div className={`health-badge ${health}`}>
                  <span className="health-dot"></span>
                  {health}
                </div>
              </div>

              {analysis.barcode ? (
                <>
                  {/* Cycle Time Hero */}
                  <div className="cycle-hero">
                    <div className="cycle-main">
                      <span className="cycle-value">{analysis.barcode.cycleTimeMedian?.toFixed(1) || '—'}</span>
                      <span className="cycle-unit">sec</span>
                    </div>
                    <div className="cycle-meta">
                      <div className="meta-item">
                        <span className="meta-value">{analysis.barcode.cycleTimeMean?.toFixed(1) || '—'}s</span>
                        <span className="meta-label">Mean</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-value">{analysis.barcode.cycleTimeMax?.toFixed(0) || '—'}s</span>
                        <span className="meta-label">Max</span>
                      </div>
                    </div>
                  </div>

                  {/* Key Metrics */}
                  <div className="metrics-row">
                    <div className="metric">
                      <span className="metric-value">{analysis.barcode.completedUnits}</span>
                      <span className="metric-label">Units</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{analysis.barcode.scanEvents}</span>
                      <span className="metric-label">Scans</span>
                    </div>
                    <div className={`metric ${(analysis.errors?.totalErrors || 0) > 10 ? 'warning' : ''}`}>
                      <span className="metric-value">{analysis.errors?.totalErrors || 0}</span>
                      <span className="metric-label">Errors</span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{(analysis.errors?.totalDowntimeMin || 0).toFixed(1)}</span>
                      <span className="metric-label">Down (min)</span>
                    </div>
                  </div>

                  {/* Hourly Activity Chart */}
                  {hourlyEntries.length > 0 && (
                    <div className="chart-section">
                      <div className="chart-header">
                        <span className="chart-title">Hourly Activity</span>
                        <span className="chart-subtitle">{hourlyEntries.length} hours</span>
                      </div>
                      <div className="bar-chart">
                        <div className="chart-y-axis">
                          <span>{maxHourly}</span>
                          <span>{Math.round(maxHourly / 2)}</span>
                          <span>0</span>
                        </div>
                        <div className="chart-bars">
                          {hourlyEntries.map(([hour, count]) => {
                            const heightPct = (count / maxHourly) * 100;
                            return (
                              <div key={hour} className="bar-group">
                                <div className="bar-container">
                                  <div 
                                    className="bar" 
                                    style={{ height: `${heightPct}%` }}
                                    title={`${hour}:00 - ${count} events`}
                                  >
                                    {heightPct > 20 && <span className="bar-value">{count}</span>}
                                  </div>
                                </div>
                                <span className="bar-label">{hour}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error Distribution */}
                  {errorEntries.length > 0 && (
                    <div className="chart-section">
                      <div className="chart-header">
                        <span className="chart-title">Top Errors</span>
                        <span className="chart-subtitle">{Object.keys(errorData).length} codes</span>
                      </div>
                      <div className="error-bars">
                        {errorEntries.map(([code, count]) => {
                          const widthPct = (count / maxError) * 100;
                          return (
                            <div key={code} className="error-row">
                              <span className="error-code">{code}</span>
                              <div className="error-bar-track">
                                <div 
                                  className="error-bar-fill" 
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                              <span className="error-count">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MTBF if available */}
                  {analysis.errors?.mtbf && (
                    <div className="mtbf-row">
                      <span className="mtbf-label">MTBF</span>
                      <span className="mtbf-value">{analysis.errors.mtbf.minutes.toFixed(1)} min</span>
                      <span className="mtbf-note">({analysis.errors.mtbf.count} failures)</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="no-data">
                  <span className="no-data-icon">📭</span>
                  <span>No barcode data</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}