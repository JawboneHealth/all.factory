import React, { useState, useMemo } from 'react';
import { 
  BarChart3, Package, Clock, TrendingUp, OctagonX, Pause, 
  Play, BarChart2, LineChart 
} from 'lucide-react';
import { type SerialAnalysis, STATIONS } from '../types';

interface Props {
  analyses: SerialAnalysis[];
}

export function SerialAnalysisView({ analyses }: Props) {
  const [selectedStation, setSelectedStation] = useState<string>(analyses[0]?.station?.code || '');
  const [viewMode, setViewMode] = useState<'gaps' | 'runs'>('gaps');
  const [hoveredUnit, setHoveredUnit] = useState<number | null>(null);

  const currentAnalysis = useMemo(() => 
    analyses.find(a => a.station?.code === selectedStation),
  [analyses, selectedStation]);

  // Calculate chart scales
  const chartData = useMemo(() => {
    if (!currentAnalysis?.units) return null;
    
    const units = currentAnalysis.units;
    const gaps = units.slice(1).map(u => u.gap).filter(g => g > 0 && g < 300); // Filter outliers
    
    if (gaps.length === 0) return null;
    
    // Calculate nice max value for Y axis
    const maxGap = Math.max(...gaps);
    const niceMax = Math.ceil(maxGap / 10) * 10; // Round up to nearest 10
    
    // Generate Y axis ticks
    const yTicks: number[] = [];
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      yTicks.push(Math.round((niceMax / tickCount) * i));
    }
    
    return {
      units: units.slice(0, 200), // Limit to 200 for performance
      maxGap: niceMax,
      yTicks: yTicks.reverse(),
      totalUnits: units.length,
    };
  }, [currentAnalysis]);

  const getGapColor = (gap: number, isStoppage: boolean, isBuffer: boolean) => {
    if (isStoppage) return '#ef4444';
    if (isBuffer) return '#f59e0b';
    return '#10b981';
  };

  const getGapStatus = (gap: number, isStoppage: boolean, isBuffer: boolean) => {
    if (isStoppage) return 'Stoppage';
    if (isBuffer) return 'Buffer';
    return 'Normal';
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  if (analyses.length === 0) {
    return (
      <div className="serial-empty">
        <span className="empty-icon"><BarChart3 size={48} /></span>
        <h3>No Serial Analysis Data</h3>
        <p>Upload barcode logs to see unit-by-unit analysis</p>
      </div>
    );
  }

  return (
    <div className="serial-analysis-v2">
      {/* Station Tabs */}
      <div className="station-tabs">
        {analyses.map(a => {
          const station = a.station;
          const stationDef = STATIONS.find(s => s.code === station?.code);
          const isActive = selectedStation === station?.code;
          
          return (
            <button
              key={station?.code}
              className={`station-tab ${isActive ? 'active' : ''}`}
              style={{ '--tab-color': stationDef?.color || '#6b7280' } as React.CSSProperties}
              onClick={() => setSelectedStation(station?.code || '')}
            >
              <span className="tab-icon">{stationDef?.icon}</span>
              <span className="tab-name">{station?.name}</span>
              <span className="tab-units">{a.stats?.totalUnits || 0} units</span>
            </button>
          );
        })}
      </div>

      {currentAnalysis && (
        <>
          {/* Stats Row */}
          <div className="stats-row">
            <div className="stat-card primary">
              <span className="stat-icon"><Package size={20} /></span>
              <div className="stat-data">
                <span className="stat-value">{currentAnalysis.stats?.totalUnits || 0}</span>
                <span className="stat-label">Total Units</span>
              </div>
            </div>
            
            <div className="stat-card">
              <span className="stat-icon"><Clock size={20} /></span>
              <div className="stat-data">
                <span className="stat-value">{currentAnalysis.stats?.medianGap?.toFixed(1) || 0}<small>s</small></span>
                <span className="stat-label">Median Gap</span>
              </div>
            </div>
            
            <div className="stat-card">
              <span className="stat-icon"><TrendingUp size={20} /></span>
              <div className="stat-data">
                <span className="stat-value">{currentAnalysis.stats?.meanGap?.toFixed(1) || 0}<small>s</small></span>
                <span className="stat-label">Mean Gap</span>
              </div>
            </div>
            
            <div className={`stat-card ${(currentAnalysis.stats?.stoppages || 0) > 3 ? 'warning' : ''}`}>
              <span className="stat-icon"><OctagonX size={20} /></span>
              <div className="stat-data">
                <span className="stat-value">{currentAnalysis.stats?.stoppages || 0}</span>
                <span className="stat-label">Stoppages</span>
              </div>
            </div>
            
            <div className="stat-card">
              <span className="stat-icon"><Pause size={20} /></span>
              <div className="stat-data">
                <span className="stat-value">{formatDuration(currentAnalysis.stats?.totalStoppageTime || 0)}</span>
                <span className="stat-label">Stoppage Time</span>
              </div>
            </div>
            
            <div className="stat-card">
              <span className="stat-icon"><Play size={20} /></span>
              <div className="stat-data">
                <span className="stat-value">{currentAnalysis.runs?.length || 0}</span>
                <span className="stat-label">Production Runs</span>
              </div>
            </div>
          </div>

          {/* View Toggle */}
          <div className="view-toggle">
            <button 
              className={viewMode === 'gaps' ? 'active' : ''}
              onClick={() => setViewMode('gaps')}
            >
              <BarChart2 size={16} /> Gap Chart
            </button>
            <button 
              className={viewMode === 'runs' ? 'active' : ''}
              onClick={() => setViewMode('runs')}
            >
              <LineChart size={16} /> Production Runs
            </button>
          </div>

          {/* Gap Chart */}
          {viewMode === 'gaps' && chartData && (
            <div className="gap-chart-container">
              <div className="chart-header">
                <h3>Unit-to-Unit Cycle Gaps</h3>
                <div className="chart-legend">
                  <span className="legend-item">
                    <span className="legend-color normal"></span>
                    Normal (&lt;30s)
                  </span>
                  <span className="legend-item">
                    <span className="legend-color buffer"></span>
                    Buffer (30-60s)
                  </span>
                  <span className="legend-item">
                    <span className="legend-color stoppage"></span>
                    Stoppage (&gt;60s)
                  </span>
                </div>
              </div>
              
              <div className="gap-chart">
                {/* Y Axis */}
                <div className="y-axis">
                  {chartData.yTicks.map((tick, i) => (
                    <div key={i} className="y-tick">
                      <span className="y-label">{tick}s</span>
                      <div className="y-line"></div>
                    </div>
                  ))}
                </div>
                
                {/* Bars */}
                <div className="chart-area">
                  <div className="bars">
                    {chartData.units.slice(1).map((unit, idx) => {
                      const color = getGapColor(unit.gap, unit.isStoppage, unit.isBuffer);
                      const heightPct = Math.min((unit.gap / chartData.maxGap) * 100, 100);
                      const isHovered = hoveredUnit === idx;
                      
                      return (
                        <div 
                          key={idx}
                          className={`bar-wrapper ${isHovered ? 'hovered' : ''}`}
                          onMouseEnter={() => setHoveredUnit(idx)}
                          onMouseLeave={() => setHoveredUnit(null)}
                        >
                          <div 
                            className="bar"
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: color,
                            }}
                          />
                          
                          {/* Tooltip */}
                          {isHovered && (
                            <div className="bar-tooltip">
                              <div className="tt-row">
                                <span>Unit</span>
                                <strong>#{unit.n}</strong>
                              </div>
                              <div className="tt-row">
                                <span>Gap</span>
                                <strong style={{ color }}>{unit.gap}s</strong>
                              </div>
                              <div className="tt-row">
                                <span>Time</span>
                                <strong>{unit.time}</strong>
                              </div>
                              <div className="tt-row">
                                <span>Status</span>
                                <strong style={{ color }}>
                                  {getGapStatus(unit.gap, unit.isStoppage, unit.isBuffer)}
                                </strong>
                              </div>
                              {unit.sn && (
                                <div className="tt-row">
                                  <span>SN</span>
                                  <code>{unit.sn}</code>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              
              {/* X Axis Label */}
              <div className="x-axis-label">
                Unit Sequence ({chartData.units.length - 1} of {chartData.totalUnits} shown)
              </div>
            </div>
          )}

          {/* Production Runs */}
          {viewMode === 'runs' && currentAnalysis.runs && currentAnalysis.runs.length > 0 && (
            <div className="runs-container">
              {/* Gantt Chart - Horizontal Timeline */}
              <div className="gantt-section">
                <h3>Production Timeline</h3>
                <div className="gantt-timeline">
                  <div className="gantt-track">
                    {currentAnalysis.runs.map((run, i) => {
                      const totalTime = currentAnalysis.runs!.reduce(
                        (sum, r) => sum + r.durationSec + (r.stoppageTime || 0), 0
                      );
                      const runWidth = Math.max((run.durationSec / totalTime) * 100, 3); // Min 3%
                      const stopWidth = run.stoppageTime ? Math.max(((run.stoppageTime) / totalTime) * 100, 2) : 0;
                      
                      return (
                        <React.Fragment key={i}>
                          <div 
                            className="gantt-segment gantt-run"
                            style={{ width: `${runWidth}%` }}
                            title={`Run ${run.runNumber}: ${run.numUnits} units in ${formatDuration(run.durationSec)}`}
                          >
                            <span className="segment-label">
                              <span className="run-id">R{run.runNumber}</span>
                              <span className="run-units">{run.numUnits}u</span>
                            </span>
                          </div>
                          {stopWidth > 0 && (
                            <div 
                              className="gantt-segment gantt-stop"
                              style={{ width: `${stopWidth}%` }}
                              title={`Stoppage: ${formatDuration(run.stoppageTime || 0)}`}
                            >
                              <span className="segment-label stop-label">
                                {formatDuration(run.stoppageTime || 0)}
                              </span>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
                <div className="gantt-axis">
                  <span className="axis-start">{currentAnalysis.runs[0]?.startTime}</span>
                  <span className="axis-label">Timeline</span>
                  <span className="axis-end">{currentAnalysis.runs[currentAnalysis.runs.length - 1]?.endTime}</span>
                </div>
                <div className="gantt-legend-bar">
                  <span className="legend-item"><span className="dot run"></span> Production Run</span>
                  <span className="legend-item"><span className="dot stop"></span> Stoppage</span>
                </div>
              </div>
              
              {/* Runs Table */}
              <div className="runs-table-section">
                <h3>Run Details</h3>
                <div className="table-wrapper">
                  <table className="runs-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Units</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Duration</th>
                        <th>UPH</th>
                        <th>Stoppage After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentAnalysis.runs.map((run, i) => (
                        <tr key={i}>
                          <td><span className="run-num">#{run.runNumber}</span></td>
                          <td className="units-col">{run.numUnits}</td>
                          <td className="time-col">{run.startTime}</td>
                          <td className="time-col">{run.endTime}</td>
                          <td>{formatDuration(run.durationSec)}</td>
                          <td>
                            <span className={`uph ${run.uph > 60 ? 'good' : run.uph > 30 ? 'ok' : 'slow'}`}>
                              {run.uph.toFixed(1)}
                            </span>
                          </td>
                          <td>
                            {run.stoppageTime ? (
                              <span className="stoppage">{formatDuration(run.stoppageTime)}</span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Units Table */}
          <div className="units-section">
            <h3>Unit Data <span className="unit-count">({currentAnalysis.units?.length || 0} records)</span></h3>
            <div className="table-wrapper">
              <table className="units-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Gap</th>
                    <th>Serial Number</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {currentAnalysis.units?.slice(0, 50).map((unit, i) => (
                    <tr key={i} className={unit.isStoppage ? 'stoppage-row' : unit.isBuffer ? 'buffer-row' : ''}>
                      <td className="num-col">{unit.n}</td>
                      <td className="time-col">{unit.time}</td>
                      <td>
                        <span 
                          className="gap-val"
                          style={{ color: getGapColor(unit.gap, unit.isStoppage, unit.isBuffer) }}
                        >
                          {unit.gap}s
                        </span>
                      </td>
                      <td className="sn-col"><code>{unit.sn || '—'}</code></td>
                      <td>
                        <span className={`status ${unit.isStoppage ? 'stoppage' : unit.isBuffer ? 'buffer' : 'normal'}`}>
                          {getGapStatus(unit.gap, unit.isStoppage, unit.isBuffer)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(currentAnalysis.units?.length || 0) > 50 && (
                <div className="table-more">
                  + {(currentAnalysis.units?.length || 0) - 50} more units
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
