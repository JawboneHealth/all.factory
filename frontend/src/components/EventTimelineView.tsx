import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { type LogEvent, STATIONS } from '../types';

interface Props {
  events: LogEvent[];
}

const CATEGORIES = [
  { key: 'Scan', label: 'Scan', color: '#10b981', icon: '📷' },
  { key: 'Press', label: 'Press', color: '#f59e0b', icon: '🔨' },
  { key: 'PSA', label: 'PSA', color: '#8b5cf6', icon: '🏷️' },
  { key: 'Database', label: 'Database', color: '#3b82f6', icon: '💾' },
  { key: 'System', label: 'System', color: '#6b7280', icon: '⚙️' },
  { key: 'PLC', label: 'PLC', color: '#ec4899', icon: '🔌' },
  { key: 'Error', label: 'Error', color: '#ef4444', icon: '⚠️' },
  { key: 'Process', label: 'Process', color: '#06b6d4', icon: '🔄' },
];

// Full station names
const STATION_NAMES: Record<string, string> = {
  BS: 'Bottom Shell',
  BA: 'Battery Assembly', 
  TR: 'Transfer',
  TO: 'Top Shell',
  LA: 'Label Application',
  FV: 'Final Verification',
};

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
};

export function EventTimelineView({ events }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  
  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  
  const [selectedStations, setSelectedStations] = useState<Set<string>>(new Set(STATIONS.map(s => s.code)));
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.key)));
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [hoveredEvent, setHoveredEvent] = useState<LogEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Constants for layout
  const LABEL_WIDTH = 160;
  const TIME_AXIS_HEIGHT = 50;
  const LANE_HEIGHT = 56;
  const LANE_MARGIN = 2;

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (!selectedStations.has(e.stationCode)) return false;
      if (!selectedCategories.has(e.category)) return false;
      if (showErrorsOnly && !e.isError) return false;
      return true;
    });
  }, [events, selectedStations, selectedCategories, showErrorsOnly]);

  // Time range
  const timeRange = useMemo(() => {
    if (filteredEvents.length === 0) return { min: Date.now(), max: Date.now() + 3600000 };
    const times = filteredEvents.map(e => e.timeMs);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const padding = (max - min) * 0.02 || 60000;
    return { min: min - padding, max: max + padding };
  }, [filteredEvents]);

  // Active stations (only ones with events)
  const activeStations = useMemo(() => {
    const activeCodes = [...new Set(filteredEvents.map(e => e.stationCode))];
    return STATIONS.filter(s => activeCodes.includes(s.code));
  }, [filteredEvents]);

  // Sync vertical scroll between labels and canvas
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

    // Clear with light background
    ctx.fillStyle = COLORS.canvasBg;
    ctx.fillRect(0, 0, width, height);

    // Calculate scaled lane height
    const laneHeight = LANE_HEIGHT;
    const laneMargin = LANE_MARGIN;
    const eventRadius = Math.max(4, 6 * Math.min(scale, 2));

    // Draw lanes
    activeStations.forEach((station, laneIndex) => {
      const laneY = offsetY + laneIndex * (laneHeight + laneMargin) + TIME_AXIS_HEIGHT;

      // Skip if lane is off screen
      if (laneY + laneHeight < 0 || laneY > height) return;

      // Lane background (alternating)
      ctx.fillStyle = laneIndex % 2 === 0 ? COLORS.laneEven : COLORS.laneOdd;
      ctx.fillRect(0, laneY, width, laneHeight);

      // Lane bottom border
      ctx.strokeStyle = COLORS.gridLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, laneY + laneHeight);
      ctx.lineTo(width, laneY + laneHeight);
      ctx.stroke();

      // Draw events in this lane
      const laneEvents = filteredEvents.filter(e => e.stationCode === station.code);
      const timeSpan = timeRange.max - timeRange.min;
      
      laneEvents.forEach(event => {
        const progress = (event.timeMs - timeRange.min) / timeSpan;
        const x = offsetX + progress * width * scale;
        const y = laneY + laneHeight / 2;

        // Skip if off screen
        if (x < -20 || x > width + 20) return;

        const category = CATEGORIES.find(c => c.key === event.category);
        const color = event.isError ? '#ef4444' : (category?.color || '#6b7280');

        // Glow effect for errors
        if (event.isError) {
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, eventRadius * 3);
          gradient.addColorStop(0, 'rgba(239, 68, 68, 0.35)');
          gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(x, y, eventRadius * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Main dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, event.isError ? eventRadius * 1.4 : eventRadius, 0, Math.PI * 2);
        ctx.fill();

        // Hover ring
        if (hoveredEvent === event) {
          ctx.strokeStyle = COLORS.hoverRing;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, eventRadius * 2.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    });

    // Draw vertical grid lines
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
    
    // Time axis bottom border
    ctx.strokeStyle = COLORS.timeAxisBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TIME_AXIS_HEIGHT);
    ctx.lineTo(width, TIME_AXIS_HEIGHT);
    ctx.stroke();
    
    // Time labels
    const timeSpan = timeRange.max - timeRange.min;
    const visibleWidth = width / scale;
    const tickCount = Math.max(3, Math.min(12, Math.floor(visibleWidth / 120)));
    
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = '500 11px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    
    for (let i = 0; i <= tickCount; i++) {
      const progress = i / tickCount;
      const x = offsetX + progress * width * scale;
      
      // Skip if off screen
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
      ctx.strokeStyle = COLORS.textDim;
      ctx.beginPath();
      ctx.moveTo(x, 42);
      ctx.lineTo(x, TIME_AXIS_HEIGHT);
      ctx.stroke();
    }

  }, [viewState, filteredEvents, activeStations, timeRange, hoveredEvent]);

  // Handle resize
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
        draw();
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  // Redraw on state change
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

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDragging) {
      setViewState(prev => ({
        ...prev,
        offsetX: e.clientX - dragStart.x,
        offsetY: e.clientY - dragStart.y,
      }));
      return;
    }

    // Find hovered event
    const { offsetX, offsetY, scale } = viewState;
    const laneHeight = LANE_HEIGHT;
    const laneMargin = LANE_MARGIN;
    const eventRadius = Math.max(4, 6 * Math.min(scale, 2)) * 2;
    const timeSpan = timeRange.max - timeRange.min;

    let found: LogEvent | null = null;

    activeStations.forEach((station, laneIndex) => {
      const laneY = offsetY + laneIndex * (laneHeight + laneMargin) + TIME_AXIS_HEIGHT;
      const laneEvents = filteredEvents.filter(e => e.stationCode === station.code);

      laneEvents.forEach(event => {
        const progress = (event.timeMs - timeRange.min) / timeSpan;
        const ex = offsetX + progress * rect.width * scale;
        const ey = laneY + laneHeight / 2;

        const dist = Math.sqrt((x - ex) ** 2 + (y - ey) ** 2);
        if (dist < eventRadius) {
          found = event;
        }
      });
    });

    setHoveredEvent(found);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Scroll to zoom (up=in, down=out) + horizontal pan + shift for vertical
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Check for pinch-to-zoom (trackpad)
    if (e.ctrlKey || e.metaKey) {
      // Pinch zoom - up = zoom in, down = zoom out
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
      // Shift + scroll = vertical pan (for multiple stations)
      setViewState(prev => ({
        ...prev,
        offsetY: prev.offsetY - e.deltaY,
      }));
    } else {
      // Regular scroll = horizontal pan (natural for timeline)
      // Also support horizontal trackpad scrolling
      setViewState(prev => ({
        ...prev,
        offsetX: prev.offsetX - (e.deltaX || e.deltaY),
      }));
    }
  }, []);

  const toggleStation = (code: string) => {
    setSelectedStations(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleCategory = (key: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resetView = () => {
    setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
  };

  return (
    <div className="event-timeline-view">
      {/* Controls */}
      <div className="timeline-controls">
        <div className="control-group">
          <label>Stations</label>
          <div className="toggle-buttons">
            {STATIONS.map(station => (
              <button
                key={station.code}
                className={`toggle-btn ${selectedStations.has(station.code) ? 'active' : ''}`}
                style={{ '--btn-color': station.color } as React.CSSProperties}
                onClick={() => toggleStation(station.code)}
              >
                <span className="btn-icon">{station.icon}</span>
                <span className="btn-label">{station.code}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label>Categories</label>
          <div className="toggle-buttons">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                className={`toggle-btn ${selectedCategories.has(cat.key) ? 'active' : ''}`}
                style={{ '--btn-color': cat.color } as React.CSSProperties}
                onClick={() => toggleCategory(cat.key)}
              >
                <span className="btn-icon">{cat.icon}</span>
                <span className="btn-label">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="control-group view-group">
          <label>View</label>
          <div className="view-options">
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={showErrorsOnly}
                onChange={(e) => setShowErrorsOnly(e.target.checked)}
              />
              <span>Errors Only</span>
            </label>
            
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

        <div className="event-counter">
          <span className="counter-value">{filteredEvents.length.toLocaleString()}</span>
          <span className="counter-label">events</span>
        </div>
      </div>

      {/* Timeline Container */}
      <div className="timeline-wrapper">
        {/* Sticky Station Labels */}
        <div className="station-labels-container">
          <div className="labels-header">Station</div>
          <div className="labels-scroll" ref={labelsRef}>
            {activeStations.map((station, idx) => (
              <div 
                key={station.code} 
                className={`station-label ${idx % 2 === 0 ? 'even' : 'odd'}`}
                style={{ height: LANE_HEIGHT + LANE_MARGIN }}
              >
                <span 
                  className="label-icon" 
                  style={{ backgroundColor: station.color }}
                >
                  {station.icon}
                </span>
                <div className="label-info">
                  <span className="label-name">{STATION_NAMES[station.code] || station.name}</span>
                  <span className="label-code">{station.code}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas Area */}
        <div 
          ref={containerRef}
          className="canvas-container"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} />

          {/* Tooltip */}
          {hoveredEvent && (
            <div 
              className="event-tooltip"
              style={{ 
                left: Math.min(tooltipPos.x - containerRef.current!.getBoundingClientRect().left + 15, 
                              (containerRef.current?.clientWidth || 400) - 280),
                top: Math.max(10, tooltipPos.y - containerRef.current!.getBoundingClientRect().top - 100),
              }}
            >
              <div className="tooltip-header">
                <span className="tooltip-time">{hoveredEvent.timeStr}</span>
                <span 
                  className="tooltip-station"
                  style={{ color: STATIONS.find(s => s.code === hoveredEvent.stationCode)?.color }}
                >
                  {STATION_NAMES[hoveredEvent.stationCode] || hoveredEvent.station}
                </span>
              </div>
              <div className="tooltip-badges">
                <span className={`badge type ${hoveredEvent.isError ? 'error' : ''}`}>
                  {hoveredEvent.eventType}
                </span>
                <span className="badge category">{hoveredEvent.category}</span>
              </div>
              {hoveredEvent.sn && (
                <div className="tooltip-sn">SN: <code>{hoveredEvent.sn}</code></div>
              )}
              <div className="tooltip-content">
                {hoveredEvent.content.slice(0, 120)}{hoveredEvent.content.length > 120 ? '...' : ''}
              </div>
            </div>
          )}
        </div>
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