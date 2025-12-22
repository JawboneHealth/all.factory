import { useState, useMemo, useRef } from 'react';
import { type StationAnalysis, STATIONS } from '../types';

interface Props {
  analyses: StationAnalysis[];
}

interface ErrorEvent {
  station: string;
  stationCode: string;
  stationIcon: string;
  stationColor: string;
  code: string;
  message: string;
  startTime: string;
  startTimeMs: number;
  endTime?: string;
  endTimeMs?: number;
  durationSec?: number;
}

export function ErrorTimelineView({ analyses }: Props) {
  const [selectedStation, setSelectedStation] = useState<string>('all');
  const [selectedCode, setSelectedCode] = useState<string>('all');
  const [hoveredError, setHoveredError] = useState<ErrorEvent | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Collect all errors
  const allErrors = useMemo(() => {
    const errors: ErrorEvent[] = [];
    analyses.forEach(a => {
      if (a.errors?.errorTimeline) {
        a.errors.errorTimeline.forEach((err: any) => {
          errors.push({
            ...err,
            stationCode: a.station.code,
            station: a.station.name,
            stationIcon: a.station.icon,
            stationColor: STATIONS.find(s => s.code === a.station.code)?.color || '#6b7280',
          });
        });
      }
    });
    return errors.sort((a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0));
  }, [analyses]);

  // Get unique codes and active stations
  const uniqueCodes = useMemo(() => [...new Set(allErrors.map(e => e.code))].sort(), [allErrors]);
  const activeStations = useMemo(() => 
    analyses.filter(a => a.errors?.totalErrors).map(a => ({
      ...a.station,
      color: STATIONS.find(s => s.code === a.station.code)?.color || '#6b7280',
      errorCount: a.errors?.totalErrors || 0,
    })),
  [analyses]);

  // Filter errors
  const filteredErrors = useMemo(() => {
    return allErrors.filter(e => {
      if (selectedStation !== 'all' && e.stationCode !== selectedStation) return false;
      if (selectedCode !== 'all' && e.code !== selectedCode) return false;
      return true;
    });
  }, [allErrors, selectedStation, selectedCode]);

  // Calculate time range
  const timeRange = useMemo(() => {
    if (filteredErrors.length === 0) return { min: Date.now(), max: Date.now() + 3600000, span: 3600000 };
    const times = filteredErrors.map(e => e.startTimeMs);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const padding = (max - min) * 0.05 || 60000; // 5% padding or 1 minute
    return { 
      min: min - padding, 
      max: max + padding, 
      span: (max - min) + (padding * 2) 
    };
  }, [filteredErrors]);

  // Group errors by station+code for swimlanes
  const swimlanes = useMemo(() => {
    const groups: Record<string, ErrorEvent[]> = {};
    filteredErrors.forEach(err => {
      const key = `${err.stationCode}|${err.code}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(err);
    });
    
    return Object.entries(groups)
      .map(([key, errors]) => {
        const [stationCode, code] = key.split('|');
        return {
          key,
          stationCode,
          code,
          station: errors[0].station,
          stationIcon: errors[0].stationIcon,
          stationColor: errors[0].stationColor,
          message: errors[0].message,
          errors,
          count: errors.length,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [filteredErrors]);

  // Format time for axis
  const formatTime = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Calculate position percentage
  const getPositionPct = (ms: number) => {
    return ((ms - timeRange.min) / timeRange.span) * 100;
  };

  // Generate time axis ticks
  const axisTicks = useMemo(() => {
    const ticks: { ms: number; label: string; pct: number }[] = [];
    const tickCount = 8;
    for (let i = 0; i <= tickCount; i++) {
      const ms = timeRange.min + (timeRange.span * i / tickCount);
      ticks.push({
        ms,
        label: formatTime(ms),
        pct: (i / tickCount) * 100,
      });
    }
    return ticks;
  }, [timeRange]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  return (
    <div className="error-timeline-v2" ref={containerRef} onMouseMove={handleMouseMove}>
      {/* Header */}
      <div className="timeline-header">
        <div className="header-left">
          <h2>Error Timeline</h2>
          <span className="error-badge">{filteredErrors.length} errors</span>
        </div>
        
        <div className="header-filters">
          {/* Station Filter */}
          <div className="filter-group">
            <label>Station</label>
            <div className="filter-pills">
              <button 
                className={`pill ${selectedStation === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedStation('all')}
              >
                All
              </button>
              {activeStations.map(s => (
                <button
                  key={s.code}
                  className={`pill ${selectedStation === s.code ? 'active' : ''}`}
                  style={{ '--pill-color': s.color } as React.CSSProperties}
                  onClick={() => setSelectedStation(s.code)}
                >
                  {s.icon} {s.code}
                  <span className="pill-count">{s.errorCount}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Code Filter */}
          <div className="filter-group">
            <label>Error Code</label>
            <select 
              value={selectedCode} 
              onChange={(e) => setSelectedCode(e.target.value)}
              className="code-select"
            >
              <option value="all">All Codes ({uniqueCodes.length})</option>
              {uniqueCodes.map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="timeline-main">
        {/* Time Axis */}
        <div className="time-axis">
          <div className="axis-label-space"></div>
          <div className="axis-track">
            {axisTicks.map((tick, i) => (
              <div 
                key={i} 
                className="axis-tick"
                style={{ left: `${tick.pct}%` }}
              >
                <div className="tick-line"></div>
                <span className="tick-label">{tick.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Swimlanes */}
        <div className="swimlanes">
          {swimlanes.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">✨</span>
              <p>No errors match the current filters</p>
            </div>
          ) : (
            swimlanes.map(lane => (
              <div key={lane.key} className="swimlane">
                <div className="lane-label">
                  <span 
                    className="lane-station" 
                    style={{ backgroundColor: lane.stationColor }}
                  >
                    {lane.stationIcon}
                  </span>
                  <div className="lane-info">
                    <span className="lane-code">{lane.code}</span>
                    <span className="lane-message">{lane.message?.slice(0, 35)}...</span>
                  </div>
                  <span className="lane-count">{lane.count}</span>
                </div>
                
                <div className="lane-track">
                  <div className="track-bg"></div>
                  <div className="track-grid">
                    {axisTicks.map((tick, i) => (
                      <div 
                        key={i} 
                        className="grid-line"
                        style={{ left: `${tick.pct}%` }}
                      />
                    ))}
                  </div>
                  
                  {lane.errors.map((error, i) => {
                    const leftPct = getPositionPct(error.startTimeMs);
                    const isHovered = hoveredError === error;
                    
                    return (
                      <div
                        key={i}
                        className={`error-dot ${isHovered ? 'hovered' : ''}`}
                        style={{ 
                          left: `${leftPct}%`,
                          backgroundColor: lane.stationColor,
                        }}
                        onMouseEnter={() => setHoveredError(error)}
                        onMouseLeave={() => setHoveredError(null)}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Station Summary */}
      <div className="station-summary">
        {activeStations.map(s => {
          const stationErrors = filteredErrors.filter(e => e.stationCode === s.code);
          const isSelected = selectedStation === s.code;
          return (
            <div 
              key={s.code}
              className={`summary-item ${isSelected ? 'selected' : ''}`}
              style={{ '--item-color': s.color } as React.CSSProperties}
              onClick={() => setSelectedStation(isSelected ? 'all' : s.code)}
            >
              <span className="item-icon">{s.icon}</span>
              <span className="item-name">{s.name}</span>
              <span className="item-count">{stationErrors.length}</span>
              <div className="item-bar">
                <div 
                  className="item-fill"
                  style={{ 
                    width: `${(stationErrors.length / Math.max(...activeStations.map(x => x.errorCount), 1)) * 100}%` 
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {hoveredError && (
        <div 
          className="error-tooltip"
          style={{ 
            left: Math.min(mousePos.x + 15, (containerRef.current?.clientWidth || 500) - 280),
            top: mousePos.y - 10,
          }}
        >
          <div className="tooltip-header">
            <span className="tooltip-station" style={{ color: hoveredError.stationColor }}>
              {hoveredError.stationIcon} {hoveredError.station}
            </span>
            <span className="tooltip-code">{hoveredError.code}</span>
          </div>
          <div className="tooltip-time">
            {hoveredError.startTime}
            {hoveredError.endTime && (
              <> → {hoveredError.endTime}</>
            )}
          </div>
          {hoveredError.durationSec && (
            <div className="tooltip-duration">
              Duration: <strong>{hoveredError.durationSec.toFixed(1)}s</strong>
            </div>
          )}
          <div className="tooltip-message">{hoveredError.message}</div>
        </div>
      )}
    </div>
  );
}