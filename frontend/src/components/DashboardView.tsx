import { useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Package, Factory, AlertTriangle, Clock, Flame, Info, 
  BarChart3, Wrench, TrendingUp, ChevronDown, ChevronRight, 
  MailOpen
} from 'lucide-react';
import { type StationAnalysis, STATIONS } from '../types';

interface Props {
  analyses: StationAnalysis[];
}

// Tooltip/explanation content for metrics
interface MetricInfo {
  title: string;
  formula: string;
  note: string;
}

const METRIC_INFO: Record<string, MetricInfo> = {
  cycleTime: {
    title: 'Median Cycle Time',
    formula: 'median(t[n+1] − t[n]) across all unit completions',
    note: 'Uses median to ignore stoppage outliers. Timestamps come from INSERT INTO or DM[6101] signals.',
  },
  cycleTimeMean: {
    title: 'Mean Cycle Time',
    formula: 'mean(t[n+1] − t[n]) across all unit completions',
    note: 'Can be skewed high by long stoppages. Use median for typical throughput.',
  },
  cycleTimeMax: {
    title: 'Max Cycle Time',
    formula: 'max(t[n+1] − t[n]) across all unit completions',
    note: 'Longest gap between any two consecutive units. Usually reflects a stoppage or error recovery.',
  },
  units: {
    title: 'Completed Units',
    formula: 'count(completion signals) — deduplicated per station',
    note: 'BS: DM[6101] PLC pulses. BA & LA: INSERT INTO ÷ 2 (paired writes). TO: unique INSERT timestamps.',
  },
  scans: {
    title: 'Barcode Scans',
    formula: 'count(all scan lines in barcode log)',
    note: 'Raw count — includes retries and re-scans. Higher than units when vision errors force rescans.',
  },
  errors: {
    title: 'Error Count',
    formula: 'count([OCCURED] lines in error log)',
    note: 'Each [OCCURED] tag = one error event. CLEARED and MCREADY lines are excluded.',
  },
  downtime: {
    title: 'Downtime',
    formula: 'sum(CLEARED_time − OCCURED_time) for each error pair',
    note: 'Accumulated from matched OCCURED→CLEARED pairs. Unmatched errors (no CLEARED) are excluded.',
  },
  mtbf: {
    title: 'Mean Time Between Failures',
    formula: 'total_operating_time ÷ failure_count',
    note: 'Operating time = total session minus downtime. Higher = more reliable station.',
  },
  dbInserts: {
    title: 'DB Inserts',
    formula: 'count(INSERT INTO lines in barcode log)',
    note: 'Raw SQL insert count. BA and LA write 2 inserts per unit by design — divide by 2 for true unit count.',
  },
  snScans: {
    title: 'SN Scans',
    formula: 'count(lines matching serial number pattern)',
    note: 'BS: M16...B motor SNs. BA: F491... power board SNs. TO/LA/FVT: T0624... top shell SNs.',
  },
  snDuplicates: {
    title: 'SN Duplicates',
    formula: 'count(serial numbers scanned more than once)',
    note: 'Units scanned multiple times — caused by vision errors, retries, or operator re-scans.',
  },
  totalEvents: {
    title: 'Total Events',
    formula: 'count(all non-empty lines in barcode log)',
    note: 'Includes scans, PLC signals, SQL inserts, system messages — everything logged by the MMI.',
  },
};

function InfoTooltip({ metric }: { metric: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const info = METRIC_INFO[metric];

  const handleEnter = useCallback(() => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, []);

  if (!info) return null;

  const tooltip = rect && createPortal(
    <div
      className="info-tooltip"
      style={{
        position: 'fixed',
        left: rect.left + rect.width / 2,
        top: rect.top - 10,
        transform: 'translateX(-50%) translateY(-100%)',
        zIndex: 99999,
      }}
    >
      <div className="info-tooltip-title">{info.title}</div>
      <div className="info-tooltip-formula">{info.formula}</div>
      <div className="info-tooltip-note">{info.note}</div>
    </div>,
    document.body
  );

  return (
    <span
      ref={triggerRef}
      className="info-tooltip-trigger"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setRect(null)}
      onClick={(e) => { e.stopPropagation(); if (rect) setRect(null); else handleEnter(); }}
    >
      <span className="info-icon"><Info size={12} /></span>
      {tooltip}
    </span>
  );
}

export function DashboardView({ analyses }: Props) {
  const [expandedStation, setExpandedStation] = useState<string | null>(null);

  // Sort analyses by the canonical station order defined in STATIONS
  const sortedAnalyses = [...analyses].sort((a, b) => {
    const aIdx = STATIONS.findIndex(s => s.code === a.station.code);
    const bIdx = STATIONS.findIndex(s => s.code === b.station.code);
    return aIdx - bIdx;
  });

  // Calculate totals — prefer SQL row count when available
  const totals = useMemo(() => sortedAnalyses.reduce(
    (acc, a) => ({
      units: acc.units + (a.barcode?.completedUnits ?? 0),
      errors: acc.errors + (a.errors?.totalErrors || 0),
      downtime: acc.downtime + (a.errors?.totalDowntimeMin || 0),
    }),
    { units: 0, errors: 0, downtime: 0 }
  ), [analyses]);

  // Find bottleneck: station with highest median cycle time; break ties using mean
  const bottleneck = useMemo(() => sortedAnalyses.reduce<StationAnalysis | null>((worst, a) => {
    if (!a.barcode?.cycleTimeMedian) return worst;
    const ct = a.barcode.cycleTimeMedian;
    const worstCt = worst?.barcode?.cycleTimeMedian || 0;
    if (ct > worstCt) return a;
    if (ct === worstCt) {
      const mean = a.barcode.cycleTimeMean || 0;
      const worstMean = worst?.barcode?.cycleTimeMean || 0;
      return mean > worstMean ? a : worst;
    }
    return worst;
  }, null), [sortedAnalyses]);

  const getHealthStatus = (analysis: StationAnalysis) => {
    const errors = analysis.errors?.totalErrors || 0;
    const downtime = analysis.errors?.totalDowntimeMin || 0;
    if (errors > 50 || downtime > 30) return 'critical';
    if (errors > 20 || downtime > 15) return 'warning';
    return 'healthy';
  };

  const getHealthExplanation = (health: string) => {
    switch (health) {
      case 'critical': return 'High error count (>50) or extended downtime (>30 min)';
      case 'warning': return 'Elevated errors (>20) or downtime (>15 min)';
      default: return 'Operating within normal parameters';
    }
  };

  const getStationColor = (code: string) => {
    return STATIONS.find(s => s.code === code)?.color || '#6b7280';
  };

  const toggleExpand = (code: string) => {
    setExpandedStation(expandedStation === code ? null : code);
  };

  return (
    <div className="dashboard-epic">
      {/* Summary Cards */}
      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-icon blue"><Package size={24} /></div>
          <div className="summary-data">
            <div className="summary-value">{totals.units.toLocaleString()}</div>
            <div className="summary-label">Total Units Produced</div>
            <div className="summary-hint">Across all stations</div>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon green"><Factory size={24} /></div>
          <div className="summary-data">
            <div className="summary-value">{analyses.length}</div>
            <div className="summary-label">Active Stations</div>
            <div className="summary-hint">With uploaded data</div>
          </div>
        </div>
        
        <div className={`summary-card ${totals.errors > 50 ? 'alert' : ''}`}>
          <div className="summary-icon red"><AlertTriangle size={24} /></div>
          <div className="summary-data">
            <div className="summary-value">{totals.errors}</div>
            <div className="summary-label">Total Errors</div>
            <div className="summary-hint">{totals.errors > 50 ? 'Above threshold!' : 'All stations combined'}</div>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon orange"><Clock size={24} /></div>
          <div className="summary-data">
            <div className="summary-value">{totals.downtime.toFixed(1)}<span className="unit">min</span></div>
            <div className="summary-label">Total Downtime</div>
            <div className="summary-hint">Time lost to errors</div>
          </div>
        </div>
        
        {bottleneck && bottleneck.barcode?.cycleTimeMedian && (
          <div className="summary-card wide bottleneck">
            <div className="summary-icon" style={{ background: `linear-gradient(135deg, ${getStationColor(bottleneck.station.code)}, ${getStationColor(bottleneck.station.code)}88)` }}>
              <Flame size={24} />
            </div>
            <div className="summary-data">
              <div className="summary-value">{bottleneck.station.icon} {bottleneck.station.name}</div>
              <div className="summary-label">Slowest Station (Bottleneck)</div>
              <div className="summary-hint">{bottleneck.barcode.cycleTimeMedian.toFixed(1)}s per unit — limits line throughput</div>
            </div>
          </div>
        )}
      </div>

      {/* Station Cards */}
      <div className="stations-grid">
        {sortedAnalyses.map((analysis) => {
          const health = getHealthStatus(analysis);
          const color = getStationColor(analysis.station.code);
          const isExpanded = expandedStation === analysis.station.code;

          // Prepare hourly data
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
              className={`station-card ${health} ${isExpanded ? 'expanded' : ''}`}
              style={{ '--station-color': color } as React.CSSProperties}
            >
              {/* Header - Always clickable */}
              <div className="station-header" onClick={() => toggleExpand(analysis.station.code)}>
                <div className="station-identity">
                  <span className="station-icon">{analysis.station.icon}</span>
                  <div>
                    <h3 className="station-name">{analysis.station.name}</h3>
                    <span className="station-code">{analysis.station.code}</span>
                  </div>
                </div>
                <div className="header-right">
                  <div className={`health-badge ${health}`} title={getHealthExplanation(health)}>
                    <span className="health-dot"></span>
                    {health}
                  </div>
                  <button className="expand-toggle" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </div>
              </div>

              {analysis.barcode ? (
                <>
                  {/* Cycle Time Hero */}
                  <div className="cycle-hero" onClick={() => toggleExpand(analysis.station.code)}>
                    <div className="cycle-main-group">
                      <div className="cycle-main">
                        <span className="cycle-value">{analysis.barcode.cycleTimeMedian?.toFixed(1) || '—'}</span>
                        <span className="cycle-unit">sec</span>
                      </div>
                      <div className="cycle-label">Median Cycle Time <InfoTooltip metric="cycleTime" /></div>
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

                  {/* Key Metrics Row */}
                  <div className="metrics-row">
                    <div className="metric">
                      <span className="metric-value">{analysis.sql?.rowCount ?? analysis.barcode.completedUnits}</span>
                      <span className="metric-label">Units <InfoTooltip metric="units" /></span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{analysis.sql?.rowCount ?? analysis.barcode.scanEvents}</span>
                      <span className="metric-label">Scans <InfoTooltip metric="scans" /></span>
                    </div>
                    <div className={`metric ${(analysis.errors?.totalErrors || 0) > 10 ? 'warning' : ''}`}>
                      <span className="metric-value">{analysis.errors?.totalErrors || 0}</span>
                      <span className="metric-label">Errors <InfoTooltip metric="errors" /></span>
                    </div>
                    <div className="metric">
                      <span className="metric-value">{(analysis.errors?.totalDowntimeMin || 0).toFixed(1)}</span>
                      <span className="metric-label">Down (min) <InfoTooltip metric="downtime" /></span>
                    </div>
                  </div>

                  {/* EXPANDED VIEW */}
                  {isExpanded ? (
                    <div className="expanded-details">
                      {/* Detailed Statistics */}
                      <div className="detail-section">
                        <h4 className="detail-title"><BarChart3 size={16} /> Detailed Statistics</h4>
                        <div className="detail-grid">
                          <div className="detail-item">
                            <span className="detail-label">First Event</span>
                            <span className="detail-value">{analysis.barcode.firstEvent || '—'}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Last Event</span>
                            <span className="detail-value">{analysis.barcode.lastEvent || '—'}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Total Events <InfoTooltip metric="totalEvents" /></span>
                            <span className="detail-value">{analysis.barcode.totalEvents?.toLocaleString() || '—'}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">DB Inserts <InfoTooltip metric="dbInserts" /></span>
                            <span className="detail-value">{analysis.barcode.dbEvents?.toLocaleString() || '—'}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">SN Scans <InfoTooltip metric="snScans" /></span>
                            <span className="detail-value">{analysis.barcode.snScans || 0}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">SN Duplicates <InfoTooltip metric="snDuplicates" /></span>
                            <span className="detail-value">{analysis.barcode.snDuplicates || 0}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Unique Errors</span>
                            <span className="detail-value">{analysis.errors?.uniqueCodes || 0} codes</span>
                          </div>
                        </div>
                      </div>

                      {/* Reliability Metrics */}
                      {(analysis.errors?.mtbf || analysis.errors?.mtba) && (
                        <div className="detail-section">
                          <h4 className="detail-title"><Wrench size={16} /> Reliability Metrics</h4>
                          <div className="reliability-cards">
                            {analysis.errors?.mtbf && (
                              <div className="reliability-card">
                                <div className="reliability-value">{analysis.errors.mtbf.minutes.toFixed(1)} min</div>
                                <div className="reliability-label">MTBF <InfoTooltip metric="mtbf" /></div>
                                <div className="reliability-note">Mean Time Between Failures</div>
                                <div className="reliability-detail">{analysis.errors.mtbf.count} failures recorded</div>
                              </div>
                            )}
                            {analysis.errors?.mtba && (
                              <div className="reliability-card">
                                <div className="reliability-value">{analysis.errors.mtba.minutes.toFixed(1)} min</div>
                                <div className="reliability-label">MTBA</div>
                                <div className="reliability-note">Mean Time Between Alarms</div>
                                <div className="reliability-detail">{analysis.errors.mtba.count} alarms recorded</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Hourly Activity Chart */}
                      {hourlyEntries.length > 0 && (
                        <div className="detail-section">
                          <h4 className="detail-title">
                            <TrendingUp size={16} /> Hourly Activity
                            <span className="detail-subtitle">{hourlyEntries.length} hours</span>
                          </h4>
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
                        <div className="detail-section">
                          <h4 className="detail-title">
                            <AlertTriangle size={16} /> Top Error Codes
                            <span className="detail-subtitle">{Object.keys(errorData).length} unique codes</span>
                          </h4>
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

                      <div className="expand-hint" onClick={() => toggleExpand(analysis.station.code)}>
                        <ChevronDown size={14} /> Click to collapse
                      </div>
                    </div>
                  ) : (
                    /* COLLAPSED VIEW - Clean compact layout */
                    <div className="collapsed-details">
                      {/* Mini Hourly Chart */}
                      {hourlyEntries.length > 0 && (
                        <div className="mini-section">
                          <div className="mini-header">
                            <span>Hourly Activity</span>
                            <span className="mini-meta">{hourlyEntries.length} hrs</span>
                          </div>
                          <div className="mini-bar-chart">
                            {hourlyEntries.map(([hour, count]) => (
                              <div 
                                key={hour} 
                                className="mini-bar" 
                                style={{ height: `${(count / maxHourly) * 100}%` }}
                                title={`${hour}:00 - ${count} events`}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Top Errors - Compact list */}
                      {errorEntries.length > 0 && (
                        <div className="mini-section">
                          <div className="mini-header">
                            <span>Top Errors</span>
                            <span className="mini-meta">{Object.keys(errorData).length} codes</span>
                          </div>
                          <div className="mini-error-list">
                            {errorEntries.slice(0, 3).map(([code, count]) => (
                              <div key={code} className="mini-error-row">
                                <span className="mini-error-code">{code}</span>
                                <span className="mini-error-count">{count}</span>
                              </div>
                            ))}
                            {errorEntries.length > 3 && (
                              <div className="mini-error-more">+{errorEntries.length - 3} more</div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* MTBF - Single line */}
                      {analysis.errors?.mtbf && (
                        <div className="mini-mtbf">
                          <span className="mtbf-label">MTBF <InfoTooltip metric="mtbf" /></span>
                          <span className="mtbf-value">{analysis.errors.mtbf.minutes.toFixed(1)} min</span>
                          <span className="mtbf-note">({analysis.errors.mtbf.count} failures)</span>
                        </div>
                      )}

                      <div className="expand-hint" onClick={() => toggleExpand(analysis.station.code)}>
                        <ChevronRight size={14} /> Click for detailed breakdown
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="no-data">
                  <span className="no-data-icon"><MailOpen size={24} /></span>
                  <span>No barcode data</span>
                  <span className="no-data-hint">Upload barcode log to see metrics</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}