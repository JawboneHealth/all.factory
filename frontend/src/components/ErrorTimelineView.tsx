import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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

// Light mode colors
const COLORS = {
  background: '#f8fafc',
  canvasBg: '#ffffff',
  gridLine: '#e2e8f0',
  gridLineFaint: '#f1f5f9',
  timeAxisBg: '#f1f5f9',
  timeAxisBorder: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  textDim: '#94a3b8',
  laneOdd: '#fafbfc',
  laneEven: '#ffffff',
  hoverRing: '#0f172a',
  errorGlow: 'rgba(239, 68, 68, 0.3)',
};

export function ErrorTimelineView({ analyses }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });

  const [selectedStation, setSelectedStation] = useState<string>('all');
  const [selectedCode, setSelectedCode] = useState<string>('all');
  const [hoveredError, setHoveredError] = useState<ErrorEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Layout constants
  const TIME_AXIS_HEIGHT = 50;
  const LANE_HEIGHT = 48;
  const LANE_MARGIN = 2;

  // Collect all errors from analyses
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

  // Time range
  const timeRange = useMemo(() => {
    if (filteredErrors.length === 0) return { min: Date.now(), max: Date.now() + 3600000 };
    const times = filteredErrors.map(e => e.startTimeMs);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const padding = (max - min) * 0.05 || 60000;
    return { min: min - padding, max: max + padding };
  }, [filteredErrors]);

  // Sync vertical scroll for labels
  const syncScroll = useCallback(() => {
    if (labelsRef.current) {
      labelsRef.current.style.transform = `translateY(${viewState.offsetY}px)`;
    }
  }, [viewState.offsetY]);

  useEffect(() => {
    syncScroll();
  }, [syncScroll]);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const { offsetX, offsetY, scale } = viewState;

    // Clear
    ctx.fillStyle = COLORS.canvasBg;
    ctx.fillRect(0, 0, width, height);

    const laneHeight = LANE_HEIGHT;
    const laneMargin = LANE_MARGIN;
    const dotRadius = Math.max(5, 7 * Math.min(scale, 2));

    // Draw lanes
    swimlanes.forEach((lane, laneIndex) => {
      const laneY = offsetY + laneIndex * (laneHeight + laneMargin) + TIME_AXIS_HEIGHT;

      // Skip if off screen
      if (laneY + laneHeight < 0 || laneY > height) return;

      // Lane background
      ctx.fillStyle = laneIndex % 2 === 0 ? COLORS.laneEven : COLORS.laneOdd;
      ctx.fillRect(0, laneY, width, laneHeight);

      // Lane border
      ctx.strokeStyle = COLORS.gridLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, laneY + laneHeight);
      ctx.lineTo(width, laneY + laneHeight);
      ctx.stroke();

      // Draw error dots in this lane
      const timeSpan = timeRange.max - timeRange.min;

      lane.errors.forEach(error => {
        const progress = (error.startTimeMs - timeRange.min) / timeSpan;
        const x = offsetX + progress * width * scale;
        const y = laneY + laneHeight / 2;

        // Skip if off screen
        if (x < -20 || x > width + 20) return;

        // Error glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, dotRadius * 2.5);
        gradient.addColorStop(0, COLORS.errorGlow);
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Main dot with station color
        ctx.fillStyle = lane.stationColor;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        // If has duration, draw duration bar
        if (error.endTimeMs && error.durationSec && error.durationSec > 0) {
          const endProgress = (error.endTimeMs - timeRange.min) / timeSpan;
          const endX = offsetX + endProgress * width * scale;
          const barWidth = endX - x;

          if (barWidth > 2) {
            ctx.fillStyle = `${lane.stationColor}40`;
            ctx.fillRect(x, y - dotRadius / 2, barWidth, dotRadius);
          }
        }

        // Hover ring
        if (hoveredError === error) {
          ctx.strokeStyle = COLORS.hoverRing;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, dotRadius * 1.8, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    });

    // Vertical grid lines
    ctx.strokeStyle = COLORS.gridLineFaint;
    ctx.lineWidth = 1;
    const gridSpacing = 100 * scale;
    for (let x = (offsetX % gridSpacing + gridSpacing) % gridSpacing; x < width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, TIME_AXIS_HEIGHT);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Time axis background
    ctx.fillStyle = COLORS.timeAxisBg;
    ctx.fillRect(0, 0, width, TIME_AXIS_HEIGHT);

    ctx.strokeStyle = COLORS.timeAxisBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TIME_AXIS_HEIGHT);
    ctx.lineTo(width, TIME_AXIS_HEIGHT);
    ctx.stroke();

    // Time labels
    const timeSpan = timeRange.max - timeRange.min;
    const visibleWidth = width / scale;
    const tickCount = Math.max(3, Math.min(12, Math.floor(visibleWidth / 100)));

    ctx.fillStyle = COLORS.textMuted;
    ctx.font = '500 11px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';

    for (let i = 0; i <= tickCount; i++) {
      const progress = i / tickCount;
      const x = offsetX + progress * width * scale;

      if (x < -50 || x > width + 50) continue;

      const time = timeRange.min + (timeSpan * progress);
      const date = new Date(time);
      const label = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      ctx.fillText(label, x, 32);

      // Tick mark
      ctx.strokeStyle = COLORS.timeAxisBorder;
      ctx.beginPath();
      ctx.moveTo(x, TIME_AXIS_HEIGHT - 8);
      ctx.lineTo(x, TIME_AXIS_HEIGHT);
      ctx.stroke();
    }
  }, [viewState, swimlanes, timeRange, hoveredError]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      draw();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - viewState.offsetX, y: e.clientY - viewState.offsetY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDragging) {
      setViewState(prev => ({
        ...prev,
        offsetX: e.clientX - dragStart.x,
        offsetY: e.clientY - dragStart.y,
      }));
      return;
    }

    // Hit test for hover
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const { offsetX, offsetY, scale } = viewState;
    const timeSpan = timeRange.max - timeRange.min;
    const width = rect.width;

    let found: ErrorEvent | null = null;

    swimlanes.forEach((lane, laneIndex) => {
      const laneY = offsetY + laneIndex * (LANE_HEIGHT + LANE_MARGIN) + TIME_AXIS_HEIGHT;

      lane.errors.forEach(error => {
        const progress = (error.startTimeMs - timeRange.min) / timeSpan;
        const x = offsetX + progress * width * scale;
        const y = laneY + LANE_HEIGHT / 2;

        const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
        if (dist < 15) {
          found = error;
        }
      });
    });

    setHoveredError(found);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel handler for zoom/pan - needs to be attached with { passive: false }
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    if (e.ctrlKey || e.metaKey) {
      // Pinch zoom
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;

      setViewState(prev => {
        const newScale = Math.max(0.1, Math.min(50, prev.scale * zoomFactor));
        const scaleRatio = newScale / prev.scale;
        const newOffsetX = mouseX - (mouseX - prev.offsetX) * scaleRatio;

        return {
          ...prev,
          scale: newScale,
          offsetX: newOffsetX,
        };
      });
    } else if (e.shiftKey) {
      // Vertical scroll
      setViewState(prev => ({
        ...prev,
        offsetY: prev.offsetY - e.deltaY,
      }));
    } else {
      // Horizontal pan
      setViewState(prev => ({
        ...prev,
        offsetX: prev.offsetX - (e.deltaX || e.deltaY),
      }));
    }
  }, []);

  // Attach wheel event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  const resetView = () => {
    setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
  };

  return (
    <div className="error-timeline-v2">
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

          {/* Zoom Controls */}
          <div className="filter-group">
            <label>Zoom</label>
            <div className="zoom-controls">
              <button
                className="zoom-btn"
                onClick={() => setViewState(p => ({ ...p, scale: Math.max(0.1, p.scale * 0.7) }))}
              >
                −
              </button>
              <span className="zoom-value">{Math.round(viewState.scale * 100)}%</span>
              <button
                className="zoom-btn"
                onClick={() => setViewState(p => ({ ...p, scale: Math.min(50, p.scale * 1.5) }))}
              >
                +
              </button>
              <button className="reset-btn" onClick={resetView}>Reset</button>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Canvas Area */}
      <div className="timeline-canvas-wrapper">
        {/* Sticky Labels */}
        <div className="swimlane-labels-container">
          <div className="labels-header">Error Code</div>
          <div className="labels-scroll" ref={labelsRef}>
            {swimlanes.map((lane, idx) => (
              <div
                key={lane.key}
                className={`swimlane-label ${idx % 2 === 0 ? 'even' : 'odd'}`}
                style={{ height: LANE_HEIGHT + LANE_MARGIN }}
              >
                <span
                  className="label-station-icon"
                  style={{ backgroundColor: lane.stationColor }}
                >
                  {lane.stationIcon}
                </span>
                <div className="label-info">
                  <span className="label-code">{lane.code}</span>
                  <span className="label-message">{lane.message?.slice(0, 30)}...</span>
                </div>
                <span className="label-count">{lane.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="canvas-container"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <canvas ref={canvasRef} />

          {/* Empty state */}
          {swimlanes.length === 0 && (
            <div className="canvas-empty">
              <span className="empty-icon">✨</span>
              <p>No errors match the current filters</p>
            </div>
          )}

          {/* Tooltip */}
          {hoveredError && containerRef.current && (
            <div
              className="error-tooltip"
              style={{
                left: Math.min(tooltipPos.x - containerRef.current.getBoundingClientRect().left + 15,
                  containerRef.current.clientWidth - 280),
                top: Math.max(10, tooltipPos.y - containerRef.current.getBoundingClientRect().top - 100),
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
              {hoveredError.durationSec !== undefined && hoveredError.durationSec > 0 && (
                <div className="tooltip-duration">
                  Duration: <strong>{hoveredError.durationSec.toFixed(1)}s</strong>
                </div>
              )}
              <div className="tooltip-message">{hoveredError.message}</div>
            </div>
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

      {/* Help hint */}
      <div className="timeline-hint">
        <span>🖱️ Drag to pan</span>
        <span>⚙️ Scroll horizontal</span>
        <span>⇧ Shift+scroll vertical</span>
        <span>🔍 Pinch/⌘+scroll zoom</span>
        <span>✨ Hover for details</span>
      </div>
    </div>
  );
}