/**
 * Export analytics views as styled, self-contained HTML reports
 * that visually match the webapp.
 *
 * We build one view at a time. Currently: Dashboard only.
 */

import { type StationAnalysis, type LogEvent, STATIONS } from '../types';

// ── Shared Helpers ──────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stationColor(code: string): string {
  return STATIONS.find(s => s.code === code)?.color || '#6b7280';
}

function healthOf(a: StationAnalysis): 'critical' | 'warning' | 'healthy' {
  const e = a.errors?.totalErrors || 0;
  const d = a.errors?.totalDowntimeMin || 0;
  if (e > 50 || d > 30) return 'critical';
  if (e > 20 || d > 15) return 'warning';
  return 'healthy';
}

function ts(): string { return new Date().toLocaleString(); }

// ── Shared base CSS (used by all views) ─────────────────────

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

:root {
  --bg: #f8fafc; --card: #fff; --bdr: rgba(0,0,0,0.06);
  --txt: #0f172a; --txt2: #475569; --muted: #64748b; --dim: #94a3b8;
  --accent: #0891b2; --danger: #dc2626; --success: #059669; --warn: #d97706;
  --fd: 'Outfit', sans-serif; --fb: 'Space Grotesk', sans-serif; --fm: 'DM Mono', monospace;
}
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box }
body {
  font-family: var(--fb); background: var(--bg); color: var(--txt);
  line-height: 1.6; -webkit-font-smoothing: antialiased; padding: 2rem;
}

/* Page header / footer */
.page-hdr { text-align:center; margin-bottom:2rem; padding-bottom:1.5rem; border-bottom:1px solid var(--bdr) }
.page-hdr h1 { font-family:var(--fd); font-size:2rem; font-weight:800; letter-spacing:-0.03em; margin-bottom:0.25rem }
.page-hdr .meta { font-size:0.8125rem; color:var(--muted) }
.page-footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--bdr); text-align:center; font-size:0.75rem; color:var(--dim) }

/* Tables */
table { width:100%; border-collapse:collapse; font-size:0.8125rem }
th { font-size:0.6875rem; font-weight:600; text-transform:uppercase; color:var(--muted); background:#f1f5f9; letter-spacing:0.03em }
th, td { padding:0.625rem 0.875rem; text-align:left; border-bottom:1px solid var(--bdr) }

/* Utility */
.mono { font-family: var(--fm) }
.dim  { color: var(--dim); font-size: 0.75rem }

@media print { body { padding: 0.5rem } .card { break-inside: avoid } }
`;

function wrapPage(title: string, subtitle: string, viewCss: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${esc(title)}</title>
  <style>${BASE_CSS}\n${viewCss}</style>
</head>
<body>
  <div class="page-hdr">
    <h1>${esc(title)}</h1>
    <div class="meta">${esc(subtitle)} · Generated ${ts()}</div>
  </div>
  ${body}
  <div class="page-footer">All.Factory Production Analytics · ${ts()}</div>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════
//  1. DASHBOARD
//
//  Matches DashboardView.tsx:
//  - summary-grid  (4 summary cards + bottleneck)
//  - stations-grid (per-station cards with cycle hero, metrics,
//                   hourly bar chart, error distribution, MTBF)
// ═══════════════════════════════════════════════════════════════

const DASH_CSS = `
/* ─── Summary grid ─── */
.summary-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem; margin-bottom: 2rem;
}
.summary-card {
  background: var(--card); border: 1px solid var(--bdr); border-radius: 14px;
  padding: 1.125rem 1.25rem; display: flex; align-items: center; gap: 0.875rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.summary-card.alert { border-color: var(--danger); background: linear-gradient(135deg, var(--card), rgba(220,38,38,0.04)) }
.summary-card.wide  { grid-column: span 2 }
.summary-icon {
  width: 48px; height: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.25rem; color: white; flex-shrink: 0;
}
.summary-icon.blue   { background: linear-gradient(135deg,#0891b2,#06b6d4) }
.summary-icon.green  { background: linear-gradient(135deg,#059669,#10b981) }
.summary-icon.red    { background: linear-gradient(135deg,#dc2626,#ef4444) }
.summary-icon.orange { background: linear-gradient(135deg,#d97706,#f59e0b) }
.summary-value { font-family:var(--fd); font-size:1.5rem; font-weight:700; line-height:1.2 }
.summary-value .unit { font-size:0.8rem; font-weight:500; color:var(--muted) }
.summary-label { font-size:0.6875rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em }
.summary-hint  { font-size:0.6875rem; color:var(--dim) }

/* ─── Station cards grid ─── */
.stations-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 1.25rem;
}
.station-card {
  background: var(--card); border: 1px solid var(--bdr); border-radius: 14px;
  padding: 1.25rem; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  border-top: 4px solid var(--station-color, #6b7280);
}

/* Station header */
.station-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;
}
.station-identity { display:flex; align-items:center; gap:0.75rem }
.station-icon-box {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.125rem; color: white;
}
.station-name { font-family:var(--fd); font-size:1rem; font-weight:600; margin:0 }
.station-code { font-family:var(--fm); font-size:0.75rem; color:var(--dim) }
.health-badge {
  font-size:0.625rem; font-weight:600; text-transform:uppercase;
  padding:0.2rem 0.6rem; border-radius:999px; display:flex; align-items:center; gap:0.375rem;
}
.health-dot { width:6px; height:6px; border-radius:50%; display:inline-block }
.health-badge.healthy { background:rgba(5,150,105,0.08); color:#059669 }
.health-badge.healthy .health-dot { background:#059669 }
.health-badge.warning { background:rgba(217,119,6,0.08); color:#d97706 }
.health-badge.warning .health-dot { background:#d97706 }
.health-badge.critical { background:rgba(220,38,38,0.08); color:#dc2626 }
.health-badge.critical .health-dot { background:#dc2626 }

/* Cycle time hero */
.cycle-hero {
  display: flex; align-items: flex-end; justify-content: space-between;
  padding: 0.875rem 1rem; background: #f8fafc; border-radius: 10px; margin-bottom: 1rem;
  border-left: 3px solid var(--station-color, #6b7280);
}
.cycle-value  { font-family:var(--fd); font-size:2.25rem; font-weight:800; line-height:1 }
.cycle-unit   { font-size:0.875rem; color:var(--muted); margin-left:0.25rem }
.cycle-label  { font-size:0.625rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; margin-top:0.125rem }
.cycle-meta   { display:flex; gap:1rem; text-align:right }
.meta-value   { font-family:var(--fm); font-size:0.875rem; font-weight:600; color:var(--txt2) }
.meta-label   { font-size:0.5625rem; color:var(--dim); text-transform:uppercase }

/* Key metrics row */
.metrics-row {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 0.625rem; margin-bottom: 1rem;
}
.metric {
  text-align:center; padding:0.625rem 0.375rem; background:#f8fafc; border-radius:8px;
}
.metric.warning { background:rgba(220,38,38,0.06) }
.metric-value { font-family:var(--fd); font-size:1.125rem; font-weight:700; display:block; line-height:1.2 }
.metric.warning .metric-value { color:var(--danger) }
.metric-label { font-size:0.5625rem; color:var(--dim); text-transform:uppercase }

/* Detail grid */
.detail-grid {
  display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
  gap:0.75rem; margin-bottom:1rem; padding:0.875rem; background:#f8fafc; border-radius:10px;
}
.detail-item { display:flex; flex-direction:column; gap:0.125rem }
.detail-label { font-size:0.625rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.03em }
.detail-value { font-family:var(--fm); font-size:0.8125rem; font-weight:600 }

/* Reliability cards */
.reliability-cards { display:flex; gap:0.75rem; margin-bottom:1rem }
.reliability-card {
  flex:1; background:#f8fafc; border:1px solid var(--bdr); border-radius:10px; padding:0.75rem; text-align:center;
}
.reliability-value { font-family:var(--fd); font-size:1.25rem; font-weight:700; color:var(--accent); display:block }
.reliability-label { font-size:0.75rem; font-weight:600; margin-top:0.125rem }
.reliability-note  { font-size:0.625rem; color:var(--dim) }
.reliability-detail { font-size:0.625rem; color:var(--dim); margin-top:0.25rem }

/* Section inside station card */
.section-block { margin-bottom:1rem; padding:0.875rem; background:#f8fafc; border-radius:10px }
.section-title {
  font-family:var(--fd); font-size:0.8125rem; font-weight:600; margin-bottom:0.625rem;
  display:flex; align-items:center; gap:0.5rem;
}
.section-subtitle { font-size:0.6875rem; color:var(--dim); margin-left:auto }

/* Mini error list */
.mini-error-list { display:flex; flex-direction:column; gap:0.25rem }
.mini-error-row { display:flex; justify-content:space-between; align-items:center }
.mini-error-code { font-family:var(--fm); font-size:0.75rem; font-weight:600; color:var(--danger) }
.mini-error-count { font-family:var(--fm); font-size:0.75rem; font-weight:600 }
.mini-error-more { font-size:0.6875rem; color:var(--dim); text-align:center; margin-top:0.25rem }

/* No data */
.no-data { text-align:center; padding:2rem; color:var(--dim); font-size:0.8125rem }
`;


// ── SVG chart builders ──

function hourlyBarsSvg(data: Record<string, number>, color: string): string {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return '';
  const max = Math.max(...entries.map(([, v]) => v), 1);
  const bw = Math.min(24, Math.floor(500 / entries.length) - 4);
  const w = entries.length * (bw + 4) + 40, h = 130, ch = 100;
  let bars = '';
  entries.forEach(([hr, c], i) => {
    const bh = (c / max) * ch, x = 36 + i * (bw + 4), y = h - 20 - bh;
    bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="2" fill="${color}" opacity="0.85"><title>${hr}:00 — ${c} events</title></rect>`;
    bars += `<text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle" font-size="8" fill="#94a3b8" font-family="monospace">${hr}</text>`;
    if (bh > 14) bars += `<text x="${x + bw / 2}" y="${y + 12}" text-anchor="middle" font-size="8" fill="white" font-weight="600">${c}</text>`;
  });
  return `<svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="30" y="18" text-anchor="end" font-size="8" fill="#94a3b8" font-family="monospace">${max}</text>
    <text x="30" y="${h - 20}" text-anchor="end" font-size="8" fill="#94a3b8" font-family="monospace">0</text>
    <line x1="34" y1="10" x2="34" y2="${h - 18}" stroke="#e2e8f0"/>
    ${bars}</svg>`;
}

function errorBarsSvg(byCode: Record<string, number>): string {
  const entries = Object.entries(byCode).sort(([, a], [, b]) => b - a).slice(0, 8);
  if (!entries.length) return '';
  const max = Math.max(...entries.map(([, v]) => v), 1);
  const rh = 24, sh = entries.length * rh + 4;
  let rows = '';
  entries.forEach(([code, c], i) => {
    const y = i * rh + 2, w = (c / max) * 340;
    rows += `<text x="44" y="${y + 16}" text-anchor="end" font-size="11" fill="#64748b" font-family="monospace">${esc(code)}</text>`;
    rows += `<rect x="50" y="${y + 4}" width="${w}" height="16" rx="3" fill="#dc2626" opacity="0.18"/>`;
    rows += `<rect x="50" y="${y + 4}" width="${w}" height="16" rx="3" fill="url(#eg)"/>`;
    rows += `<text x="${56 + w}" y="${y + 16}" font-size="11" fill="#dc2626" font-weight="600" font-family="monospace">${c}</text>`;
  });
  return `<svg width="100%" viewBox="0 0 460 ${sh}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="eg" x1="0" x2="1"><stop offset="0%" stop-color="#dc2626" stop-opacity="0.6"/><stop offset="100%" stop-color="#dc2626" stop-opacity="0.15"/></linearGradient></defs>
    ${rows}</svg>`;
}


// ── Build a single station card ──

function buildStationCard(a: StationAnalysis): string {
  const { station, barcode, errors } = a;
  const color = stationColor(station.code);
  const health = healthOf(a);

  if (!barcode) {
    return `<div class="station-card" style="--station-color:${color}">
      <div class="station-header">
        <div class="station-identity">
          <span class="station-icon-box" style="background:${color}">${station.icon}</span>
          <div><h3 class="station-name">${esc(station.name)}</h3><span class="station-code">${station.code}</span></div>
        </div>
        <span class="health-badge ${health}"><span class="health-dot"></span>${health}</span>
      </div>
      <div class="no-data">No barcode data — upload barcode log to see metrics</div>
    </div>`;
  }

  // Hourly chart
  const hourlyHtml = barcode.hourlyActivity
    ? `<div class="section-block">
        <div class="section-title">📈 Hourly Activity <span class="section-subtitle">${Object.keys(barcode.hourlyActivity).length} hrs</span></div>
        ${hourlyBarsSvg(barcode.hourlyActivity, color)}
      </div>`
    : '';

  // Error distribution
  const errChart = (errors?.errorsByCode && Object.keys(errors.errorsByCode).length > 0)
    ? `<div class="section-block">
        <div class="section-title">⚠️ Top Error Codes <span class="section-subtitle">${errors.uniqueCodes ?? 0} unique</span></div>
        ${errorBarsSvg(errors.errorsByCode)}
      </div>`
    : '';

  // Reliability
  const reliabilityHtml = (errors?.mtbf || errors?.mtba)
    ? `<div class="reliability-cards">
        ${errors?.mtbf ? `<div class="reliability-card">
          <div class="reliability-value">${errors.mtbf.minutes.toFixed(1)} min</div>
          <div class="reliability-label">MTBF</div>
          <div class="reliability-note">Mean Time Between Failures</div>
          <div class="reliability-detail">${errors.mtbf.count} failures</div>
        </div>` : ''}
        ${errors?.mtba ? `<div class="reliability-card">
          <div class="reliability-value">${errors.mtba.minutes.toFixed(1)} min</div>
          <div class="reliability-label">MTBA</div>
          <div class="reliability-note">Mean Time Between Alarms</div>
          <div class="reliability-detail">${errors.mtba.count} alarms</div>
        </div>` : ''}
      </div>`
    : '';

  return `<div class="station-card" style="--station-color:${color}">
    <!-- Header -->
    <div class="station-header">
      <div class="station-identity">
        <span class="station-icon-box" style="background:${color}">${station.icon}</span>
        <div><h3 class="station-name">${esc(station.name)}</h3><span class="station-code">${station.code}</span></div>
      </div>
      <span class="health-badge ${health}"><span class="health-dot"></span>${health}</span>
    </div>

    <!-- Cycle Time Hero -->
    <div class="cycle-hero" style="--station-color:${color}">
      <div>
        <span class="cycle-value" style="color:${color}">${barcode.cycleTimeMedian?.toFixed(1) ?? '—'}</span>
        <span class="cycle-unit">sec</span>
        <div class="cycle-label">Median Cycle Time</div>
      </div>
      <div class="cycle-meta">
        <div><span class="meta-value">${barcode.cycleTimeMean?.toFixed(1) ?? '—'}s</span><br/><span class="meta-label">Mean</span></div>
        <div><span class="meta-value">${barcode.cycleTimeMax?.toFixed(0) ?? '—'}s</span><br/><span class="meta-label">Max</span></div>
      </div>
    </div>

    <!-- Key Metrics -->
    <div class="metrics-row">
      <div class="metric"><span class="metric-value">${barcode.completedUnits}</span><span class="metric-label">Units</span></div>
      <div class="metric"><span class="metric-value">${barcode.scanEvents}</span><span class="metric-label">Scans</span></div>
      <div class="metric ${(errors?.totalErrors || 0) > 10 ? 'warning' : ''}"><span class="metric-value">${errors?.totalErrors || 0}</span><span class="metric-label">Errors</span></div>
      <div class="metric"><span class="metric-value">${(errors?.totalDowntimeMin || 0).toFixed(1)}</span><span class="metric-label">Down (min)</span></div>
    </div>

    <!-- Detail Grid -->
    <div class="detail-grid">
      <div class="detail-item"><span class="detail-label">First Event</span><span class="detail-value">${barcode.firstEvent ?? '—'}</span></div>
      <div class="detail-item"><span class="detail-label">Last Event</span><span class="detail-value">${barcode.lastEvent ?? '—'}</span></div>
      <div class="detail-item"><span class="detail-label">Total Events</span><span class="detail-value">${barcode.totalEvents?.toLocaleString() ?? '—'}</span></div>
      <div class="detail-item"><span class="detail-label">DB Inserts</span><span class="detail-value">${barcode.dbEvents?.toLocaleString() ?? '—'}</span></div>
      <div class="detail-item"><span class="detail-label">SN Scans</span><span class="detail-value">${barcode.snScans ?? 0}</span></div>
      <div class="detail-item"><span class="detail-label">SN Duplicates</span><span class="detail-value">${barcode.snDuplicates ?? 0}</span></div>
      <div class="detail-item"><span class="detail-label">Unique Errors</span><span class="detail-value">${errors?.uniqueCodes ?? 0} codes</span></div>
    </div>

    ${reliabilityHtml}
    ${hourlyHtml}
    ${errChart}
  </div>`;
}


// ── Main export function ──

export function generateDashboardHtml(analyses: StationAnalysis[]): string {
  const totals = analyses.reduce(
    (acc, a) => ({
      units: acc.units + (a.barcode?.completedUnits || 0),
      errors: acc.errors + (a.errors?.totalErrors || 0),
      downtime: acc.downtime + (a.errors?.totalDowntimeMin || 0),
    }),
    { units: 0, errors: 0, downtime: 0 }
  );

  const bottleneck = analyses.reduce((worst, a) => {
    const ct = a.barcode?.cycleTimeMedian || 0;
    const worstCt = worst?.barcode?.cycleTimeMedian || 0;
    return ct > worstCt ? a : worst;
  }, analyses[0]);

  const summaryHtml = `
  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-icon blue">📦</div>
      <div class="summary-data">
        <div class="summary-value">${totals.units.toLocaleString()}</div>
        <div class="summary-label">Total Units Produced</div>
        <div class="summary-hint">Across all stations</div>
      </div>
    </div>

    <div class="summary-card">
      <div class="summary-icon green">🏭</div>
      <div class="summary-data">
        <div class="summary-value">${analyses.length}</div>
        <div class="summary-label">Active Stations</div>
        <div class="summary-hint">With uploaded data</div>
      </div>
    </div>

    <div class="summary-card ${totals.errors > 50 ? 'alert' : ''}">
      <div class="summary-icon red">⚠️</div>
      <div class="summary-data">
        <div class="summary-value">${totals.errors}</div>
        <div class="summary-label">Total Errors</div>
        <div class="summary-hint">${totals.errors > 50 ? 'Above threshold!' : 'All stations combined'}</div>
      </div>
    </div>

    <div class="summary-card">
      <div class="summary-icon orange">⏱️</div>
      <div class="summary-data">
        <div class="summary-value">${totals.downtime.toFixed(1)}<span class="unit">min</span></div>
        <div class="summary-label">Total Downtime</div>
        <div class="summary-hint">Time lost to errors</div>
      </div>
    </div>

    ${bottleneck?.barcode?.cycleTimeMedian ? `
    <div class="summary-card wide">
      <div class="summary-icon" style="background:linear-gradient(135deg,${stationColor(bottleneck.station.code)},${stationColor(bottleneck.station.code)}88)">🔥</div>
      <div class="summary-data">
        <div class="summary-value">${bottleneck.station.icon} ${esc(bottleneck.station.name)}</div>
        <div class="summary-label">Slowest Station (Bottleneck)</div>
        <div class="summary-hint">${bottleneck.barcode.cycleTimeMedian.toFixed(1)}s per unit — limits line throughput</div>
      </div>
    </div>` : ''}
  </div>`;

  const stationCardsHtml = `<div class="stations-grid">${analyses.map(buildStationCard).join('')}</div>`;

  return wrapPage(
    'Dashboard Report',
    `${analyses.length} stations · ${totals.units.toLocaleString()} units`,
    DASH_CSS,
    summaryHtml + stationCardsHtml
  );
}


// ═══════════════════════════════════════════════════════════════
//  STUBS — these will be filled in one at a time
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  2. ERROR TIMELINE  (interactive: zoom, pan, hover tooltips)
// ═══════════════════════════════════════════════════════════════

const ERR_CSS = `
/* ─── Outer wrapper ─── */
.error-timeline-v2 {
  background: var(--card); border: 1px solid var(--bdr); border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}

/* ─── Header ─── */
.timeline-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem; border-bottom: 1px solid var(--bdr); flex-wrap: wrap; gap: 0.75rem;
}
.header-left { display: flex; align-items: center; gap: 0.75rem }
.header-left h2 { font-family: var(--fd); font-size: 1.25rem; font-weight: 700; margin: 0 }
.error-badge {
  background: rgba(220,38,38,0.1); color: #dc2626;
  font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 999px;
}
.header-filters { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap }
.filter-group { display: flex; align-items: center; gap: 0.5rem }
.filter-group label {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  color: var(--muted); letter-spacing: 0.04em;
}
.filter-pills { display: flex; gap: 0.375rem }
.pill {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.3rem 0.75rem; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  border: 1.5px solid var(--bdr); background: var(--card); color: var(--txt2);
  cursor: pointer; user-select: none; transition: all 0.15s;
}
.pill:hover { border-color: var(--accent); color: var(--accent) }
.pill.active { background: var(--accent); color: white; border-color: var(--accent) }
.pill[data-station]:not([data-station="all"]).active {
  background: var(--pill-color, var(--accent)); border-color: var(--pill-color, var(--accent)); color: white;
}
.pill { cursor: pointer; user-select: none; transition: all 0.15s }
.pill-count { font-family: var(--fm); font-size: 0.6875rem; opacity: 0.8 }
.code-select {
  font-size: 0.75rem; padding: 0.3rem 0.5rem; border-radius: 6px;
  border: 1.5px solid var(--bdr); background: var(--card); color: var(--txt);
  cursor: pointer;
}
.zoom-controls { display: flex; align-items: center; gap: 0.375rem }
.zoom-btn {
  width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--bdr);
  background: var(--card); font-size: 1rem; display: flex; align-items: center;
  justify-content: center; color: var(--txt2); cursor: pointer; user-select: none;
  transition: all 0.15s;
}
.zoom-btn:hover { background: #f1f5f9; border-color: var(--accent); color: var(--accent) }
.zoom-value { font-family: var(--fm); font-size: 0.75rem; min-width: 3rem; text-align: center }
.reset-btn {
  font-size: 0.6875rem; padding: 0.25rem 0.625rem; border-radius: 6px;
  border: 1px solid var(--bdr); background: var(--card); color: var(--txt2);
  cursor: pointer; transition: all 0.15s;
}
.reset-btn:hover { background: #f1f5f9; border-color: var(--accent); color: var(--accent) }

/* ─── Canvas area ─── */
.timeline-canvas-wrapper { display: flex; border-bottom: 1px solid var(--bdr) }

.swimlane-labels-container {
  flex-shrink: 0; width: 180px; border-right: 1px solid var(--bdr); overflow: hidden;
}
.labels-header {
  height: 50px; display: flex; align-items: center; padding: 0 0.75rem;
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  color: var(--muted); background: #f1f5f9; border-bottom: 1px solid var(--bdr);
}
.labels-scroll { transition: transform 0.05s linear }
.swimlane-label {
  display: flex; align-items: center; gap: 0.5rem; padding: 0 0.75rem;
  border-bottom: 1px solid var(--bdr); overflow: hidden;
}
.swimlane-label.even { background: #fafbfc }
.swimlane-label.odd  { background: #ffffff }
.label-station-icon {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border-radius: 6px; font-size: 0.8rem; color: white; flex-shrink: 0;
}
.label-info { flex: 1; min-width: 0 }
.label-code { font-family: var(--fm); font-size: 0.8125rem; font-weight: 600; display: block }
.label-message { font-size: 0.625rem; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block }
.label-count {
  font-family: var(--fm); font-size: 0.75rem; font-weight: 700; color: var(--danger);
  flex-shrink: 0; background: rgba(220,38,38,0.08); padding: 0.125rem 0.375rem; border-radius: 4px;
}

.canvas-container {
  flex: 1; overflow-x: auto; overflow-y: hidden; position: relative; cursor: grab;
}
.canvas-container.dragging { cursor: grabbing }
.canvas-container svg { display: block }

/* ─── Tooltip ─── */
.err-tooltip {
  position: fixed; pointer-events: none; z-index: 100;
  background: white; border: 1px solid rgba(0,0,0,0.1); border-radius: 10px;
  padding: 0.75rem; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  min-width: 220px; max-width: 300px; font-size: 0.8125rem;
  opacity: 0; transition: opacity 0.12s;
}
.err-tooltip.visible { opacity: 1 }
.tt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.375rem }
.tt-station { font-weight: 600 }
.tt-code { font-family: var(--fm); font-size: 0.75rem; font-weight: 600; padding: 0.125rem 0.375rem; background: rgba(220,38,38,0.08); color: var(--danger); border-radius: 4px }
.tt-time { font-family: var(--fm); font-size: 0.75rem; color: var(--muted); margin-bottom: 0.25rem }
.tt-duration { font-size: 0.75rem; color: var(--danger); margin-bottom: 0.25rem }
.tt-duration strong { font-weight: 700 }
.tt-message { font-size: 0.75rem; color: var(--txt2); line-height: 1.4 }

/* ─── Station summary bar ─── */
.station-summary {
  display: flex; gap: 1rem; padding: 1rem 1.25rem; background: #f8fafc;
  border-bottom: 1px solid var(--bdr); flex-wrap: wrap;
}
.stn-summary-item {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.875rem; background: var(--card);
  border: 1px solid var(--bdr); border-radius: 8px; cursor: pointer;
  transition: all 0.15s;
}
.stn-summary-item:hover { border-color: var(--accent) }
.stn-summary-item { transition: all 0.15s }
.swimlane-label { transition: none }
.stn-summary-item .stn-icon { font-size: 1rem }
.stn-summary-item .stn-name { font-size: 0.8125rem; font-weight: 500 }
.stn-summary-item .stn-count { font-family: var(--fd); font-weight: 700; font-size: 0.875rem }
.stn-bar-track { width: 60px; height: 4px; background: #f1f5f9; border-radius: 2px; overflow: hidden }
.stn-bar-fill { height: 100%; border-radius: 2px }

/* ─── Hint bar ─── */
.timeline-hint {
  display: flex; justify-content: center; gap: 1.5rem; padding: 0.625rem;
  font-size: 0.6875rem; color: var(--dim);
}
`;

export function generateErrorTimelineHtml(analyses: StationAnalysis[]): string {
  // ── Collect all errors ──
  const allErrors: any[] = [];
  analyses.forEach(a => {
    a.errors?.errorTimeline?.forEach((err: any) => {
      allErrors.push({
        ...err,
        stationCode: a.station.code,
        station: a.station.name,
        stationIcon: a.station.icon,
        stationColor: STATIONS.find(s => s.code === a.station.code)?.color || '#6b7280',
      });
    });
  });
  allErrors.sort((a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0));

  if (allErrors.length === 0) {
    return wrapPage('Error Timeline', 'No errors', ERR_CSS,
      '<div class="error-timeline-v2" style="padding:4rem;text-align:center;color:var(--dim)">No error data available</div>');
  }

  // ── Active stations ──
  const activeStations = analyses
    .filter(a => a.errors?.totalErrors)
    .map(a => ({
      code: a.station.code, name: a.station.name, icon: a.station.icon,
      color: STATIONS.find(s => s.code === a.station.code)?.color || '#6b7280',
      errorCount: a.errors?.totalErrors || 0,
    }));

  // ── Unique codes ──
  const uniqueCodes = [...new Set(allErrors.map(e => e.code))].sort();

  // ── Group into swimlanes ──
  const groups: Record<string, any[]> = {};
  allErrors.forEach(err => {
    const key = `${err.stationCode}|${err.code}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(err);
  });
  const swimlanes = Object.entries(groups)
    .map(([key, errs]) => {
      const [sCode, code] = key.split('|');
      return {
        key, stationCode: sCode, code,
        station: errs[0].station, stationIcon: errs[0].stationIcon,
        stationColor: errs[0].stationColor, message: errs[0].message,
        errors: errs, count: errs.length,
      };
    })
    .sort((a, b) => b.count - a.count);

  // ── Time range ──
  const times = allErrors.map(e => e.startTimeMs).filter(Boolean);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const tPad = (tMax - tMin) * 0.05 || 60000;
  const timeMin = tMin - tPad, timeMax = tMax + tPad, timeSpan = timeMax - timeMin;

  // ── SVG layout ──
  const SVG_W = 1200;
  const TIME_AXIS_H = 50;
  const LANE_H = 48;
  const LANE_GAP = 2;
  const SVG_H = TIME_AXIS_H + swimlanes.length * (LANE_H + LANE_GAP) + 10;
  const DOT_R = 7;

  // ── Build left labels HTML ──
  const labelsHtml = swimlanes.map((lane, idx) => `
    <div class="swimlane-label ${idx % 2 === 0 ? 'even' : 'odd'}" data-station="${lane.stationCode}" data-code="${esc(lane.code)}" style="height:${LANE_H + LANE_GAP}px">
      <span class="label-station-icon" style="background:${lane.stationColor}">${lane.stationIcon}</span>
      <div class="label-info">
        <span class="label-code">${esc(lane.code)}</span>
        <span class="label-message">${esc((lane.message || '').slice(0, 30))}...</span>
      </div>
      <span class="label-count">${lane.count}</span>
    </div>`).join('');

  // ── Build SVG with data attributes on dots ──
  let svg = '';

  // Time axis
  svg += `<rect x="0" y="0" width="${SVG_W}" height="${TIME_AXIS_H}" fill="#f1f5f9"/>`;
  svg += `<line x1="0" y1="${TIME_AXIS_H}" x2="${SVG_W}" y2="${TIME_AXIS_H}" stroke="#e2e8f0"/>`;

  // Time labels + grid
  const tickCount = 10;
  for (let i = 0; i <= tickCount; i++) {
    const progress = i / tickCount;
    const x = progress * SVG_W;
    const t = new Date(timeMin + timeSpan * progress);
    const label = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    svg += `<text x="${x}" y="32" text-anchor="middle" font-size="11" fill="#64748b" font-family="ui-monospace,SFMono-Regular,monospace" font-weight="500">${label}</text>`;
    svg += `<line x1="${x}" y1="${TIME_AXIS_H}" x2="${x}" y2="${SVG_H}" stroke="#f1f5f9"/>`;
  }

  // Lanes + dots with data-idx
  let dotIdx = 0;
  // Build JSON array of error data for tooltip lookup
  const tooltipData: { station: string; icon: string; code: string; color: string; startTime: string; endTime?: string; durationSec?: number; message: string }[] = [];

  swimlanes.forEach((lane, laneIdx) => {
    const laneY = TIME_AXIS_H + laneIdx * (LANE_H + LANE_GAP);
    const bg = laneIdx % 2 === 0 ? '#ffffff' : '#fafbfc';
    svg += `<g class="lane-group" data-station="${lane.stationCode}" data-code="${esc(lane.code)}">`;
    svg += `<rect class="lane-bg" x="0" y="${laneY}" width="${SVG_W}" height="${LANE_H}" fill="${bg}"/>`;
    svg += `<line x1="0" y1="${laneY + LANE_H}" x2="${SVG_W}" y2="${laneY + LANE_H}" stroke="#e2e8f0" stroke-width="0.5"/>`;

    lane.errors.forEach((err: any) => {
      if (!err.startTimeMs) return;
      const progress = (err.startTimeMs - timeMin) / timeSpan;
      const x = progress * SVG_W;
      const y = laneY + LANE_H / 2;

      // Duration bar
      if (err.endTimeMs && err.durationSec && err.durationSec > 0) {
        const endX = ((err.endTimeMs - timeMin) / timeSpan) * SVG_W;
        const barW = endX - x;
        if (barW > 2) {
          svg += `<rect x="${x}" y="${y - DOT_R / 2}" width="${barW}" height="${DOT_R}" rx="2" fill="${lane.stationColor}" opacity="0.25"/>`;
        }
      }

      // Glow
      svg += `<circle cx="${x}" cy="${y}" r="${DOT_R * 2.2}" fill="${lane.stationColor}" opacity="0.12"/>`;

      // Main dot — data-idx for JS tooltip lookup
      svg += `<circle class="err-dot" data-idx="${dotIdx}" cx="${x}" cy="${y}" r="${DOT_R}" fill="${lane.stationColor}" opacity="0.9" style="cursor:pointer"/>`;

      tooltipData.push({
        station: err.station, icon: err.stationIcon, code: err.code,
        color: lane.stationColor, startTime: err.startTime,
        endTime: err.endTime, durationSec: err.durationSec, message: err.message,
      });
      dotIdx++;
    });
    svg += `</g>`;
  });

  const svgTag = `<svg id="tl-svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;

  // ── Filter pills ──
  const filterPillsHtml = activeStations.map(s =>
    `<span class="pill" data-station="${s.code}" style="border-color:${s.color}40;--pill-color:${s.color}">
      <span style="color:${s.color}">${s.icon}</span> ${esc(s.code)}
      <span class="pill-count">${s.errorCount}</span>
    </span>`
  ).join('');

  // ── Station summary bar ──
  const maxErr = Math.max(...activeStations.map(s => s.errorCount), 1);
  const summaryHtml = activeStations.map(s => `
    <div class="stn-summary-item" data-station="${s.code}" style="cursor:pointer">
      <span class="stn-icon">${s.icon}</span>
      <span class="stn-name">${esc(s.name)}</span>
      <span class="stn-count" style="color:${s.color}">${s.errorCount}</span>
      <div class="stn-bar-track">
        <div class="stn-bar-fill" style="width:${(s.errorCount / maxErr) * 100}%;background:${s.color}"></div>
      </div>
    </div>`).join('');

  // ── Escape tooltip data for embedding ──
  const tooltipJson = JSON.stringify(tooltipData).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  // ── JavaScript for interactivity ──
  const script = `
<div class="err-tooltip" id="err-tooltip">
  <div class="tt-header">
    <span class="tt-station" id="tt-station"></span>
    <span class="tt-code" id="tt-code"></span>
  </div>
  <div class="tt-time" id="tt-time"></div>
  <div class="tt-duration" id="tt-duration"></div>
  <div class="tt-message" id="tt-message"></div>
</div>

<script>
(function() {
  var data = ${tooltipJson};
  var svg = document.getElementById('tl-svg');
  var container = document.querySelector('.canvas-container');
  var labelsScroll = document.querySelector('.labels-scroll');
  var tooltip = document.getElementById('err-tooltip');
  var zoomValue = document.querySelector('.zoom-value');
  var zoomBtns = document.querySelectorAll('.zoom-btn');
  var resetBtn = document.querySelector('.reset-btn');
  var errorBadge = document.querySelector('.error-badge');
  var stationPills = document.getElementById('station-pills');
  var codeSelect = document.getElementById('code-select');
  var summaryItems = document.querySelectorAll('.stn-summary-item[data-station]');

  // ── Filter state ──
  var filterStation = 'all';
  var filterCode = 'all';

  function applyFilters() {
    var laneGroups = svg.querySelectorAll('.lane-group');
    var labelEls = labelsScroll.querySelectorAll('.swimlane-label');
    var visibleCount = 0;

    laneGroups.forEach(function(g, i) {
      var stn = g.getAttribute('data-station');
      var code = g.getAttribute('data-code');
      var matchStation = (filterStation === 'all' || stn === filterStation);
      var matchCode = (filterCode === 'all' || code === filterCode);
      var show = matchStation && matchCode;

      g.style.display = show ? '' : 'none';
      if (labelEls[i]) labelEls[i].style.display = show ? '' : 'none';

      if (show) {
        var dots = g.querySelectorAll('.err-dot');
        visibleCount += dots.length;
      }
    });

    // Update badge
    errorBadge.textContent = visibleCount + ' errors';

    // Update pill active states
    stationPills.querySelectorAll('.pill').forEach(function(p) {
      var ps = p.getAttribute('data-station');
      if (ps === filterStation) { p.classList.add('active'); }
      else { p.classList.remove('active'); }
    });

    // Highlight matching summary items
    summaryItems.forEach(function(item) {
      var stn = item.getAttribute('data-station');
      if (filterStation !== 'all' && stn === filterStation) {
        item.style.borderColor = 'var(--accent)';
        item.style.background = 'rgba(8,145,178,0.04)';
      } else {
        item.style.borderColor = '';
        item.style.background = '';
      }
    });
  }

  // ── Station pill clicks ──
  stationPills.addEventListener('click', function(e) {
    var pill = e.target.closest('.pill');
    if (!pill) return;
    var stn = pill.getAttribute('data-station');
    // Toggle: clicking active station goes back to all
    filterStation = (filterStation === stn && stn !== 'all') ? 'all' : stn;
    applyFilters();
  });

  // ── Code select ──
  codeSelect.addEventListener('change', function() {
    filterCode = codeSelect.value;
    applyFilters();
  });

  // ── Summary item clicks → filter by station ──
  summaryItems.forEach(function(item) {
    item.addEventListener('click', function() {
      var stn = item.getAttribute('data-station');
      filterStation = (filterStation === stn) ? 'all' : stn;
      applyFilters();
    });
  });

  // ── State: zoom = stretch SVG element width, scroll to pan ──
  var scale = 1;
  var offsetY = 0;
  var BASE_W = ${SVG_W};
  var BASE_H = ${SVG_H};

  function applyView() {
    svg.setAttribute('width', Math.round(BASE_W * scale));
    svg.setAttribute('height', BASE_H);
    if (labelsScroll) labelsScroll.style.transform = 'translateY(' + offsetY + 'px)';
    zoomValue.textContent = Math.round(scale * 100) + '%';
  }

  function zoomTo(newScale, screenAnchorX) {
    var oldScale = scale;
    newScale = Math.max(1, Math.min(50, newScale));
    var scrollX = container.scrollLeft;
    if (screenAnchorX === undefined) screenAnchorX = container.clientWidth / 2;
    var svgXUnderAnchor = (scrollX + screenAnchorX) / oldScale;
    scale = newScale;
    applyView();
    container.scrollLeft = svgXUnderAnchor * scale - screenAnchorX;
  }

  // Zoom buttons
  zoomBtns[0].addEventListener('click', function() { zoomTo(scale * 0.7); });
  zoomBtns[1].addEventListener('click', function() { zoomTo(scale * 1.5); });
  resetBtn.addEventListener('click', function() {
    scale = 1; offsetY = 0;
    applyView();
    container.scrollLeft = 0;
  });

  // ── Wheel ──
  container.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var rect = container.getBoundingClientRect();
      var anchorX = e.clientX - rect.left;
      var factor = e.deltaY < 0 ? 1.2 : 0.83;
      zoomTo(scale * factor, anchorX);
    } else if (e.shiftKey) {
      offsetY -= e.deltaY;
      var maxUp = -(BASE_H - container.clientHeight + 100);
      offsetY = Math.max(maxUp, Math.min(100, offsetY));
      applyView();
    } else {
      container.scrollLeft += (e.deltaX || e.deltaY);
    }
  }, { passive: false });

  // ── Drag to pan ──
  var dragging = false, dsx = 0, dsy = 0, scrollStart = 0, oyStart = 0;
  container.addEventListener('mousedown', function(e) {
    if (e.target.classList && e.target.classList.contains('err-dot')) return;
    dragging = true; dsx = e.clientX; dsy = e.clientY;
    scrollStart = container.scrollLeft; oyStart = offsetY;
    container.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    container.scrollLeft = scrollStart - (e.clientX - dsx);
    offsetY = oyStart + (e.clientY - dsy);
    var maxUp = -(BASE_H - container.clientHeight + 100);
    offsetY = Math.max(maxUp, Math.min(100, offsetY));
    applyView();
  });
  document.addEventListener('mouseup', function() {
    dragging = false; container.classList.remove('dragging');
  });

  // ── Tooltip on hover ──
  var dots = svg.querySelectorAll('.err-dot');
  dots.forEach(function(dot) {
    dot.addEventListener('mouseenter', function(e) {
      var idx = parseInt(dot.getAttribute('data-idx'));
      var d = data[idx]; if (!d) return;
      document.getElementById('tt-station').innerHTML = d.icon + ' ' + d.station;
      document.getElementById('tt-station').style.color = d.color;
      document.getElementById('tt-code').textContent = d.code;
      document.getElementById('tt-time').textContent = d.startTime + (d.endTime ? ' \\u2192 ' + d.endTime : '');
      var durEl = document.getElementById('tt-duration');
      if (d.durationSec && d.durationSec > 0) {
        var s = d.durationSec;
        var txt = s < 60 ? s.toFixed(1) + 's' : Math.floor(s/60) + 'm ' + Math.round(s%60) + 's';
        durEl.innerHTML = 'Duration: <strong>' + txt + '</strong>';
        durEl.style.display = '';
      } else { durEl.style.display = 'none'; }
      document.getElementById('tt-message').textContent = d.message;
      tooltip.classList.add('visible');
    });
    dot.addEventListener('mouseleave', function() { tooltip.classList.remove('visible'); });
  });

  document.addEventListener('mousemove', function(e) {
    if (tooltip.classList.contains('visible')) {
      var x = e.clientX + 15, y = e.clientY - 10;
      if (x + 300 > window.innerWidth) x = e.clientX - 315;
      if (y + 200 > window.innerHeight) y = e.clientY - 200;
      tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
    }
  });

  applyView();
})();
</script>`;

  // ── Assemble ──
  const body = `
  <div class="error-timeline-v2">
    <div class="timeline-header">
      <div class="header-left">
        <h2>Error Timeline</h2>
        <span class="error-badge">${allErrors.length} errors</span>
      </div>
      <div class="header-filters">
        <div class="filter-group">
          <label>Station</label>
          <div class="filter-pills" id="station-pills">
            <span class="pill active" data-station="all">All</span>
            ${filterPillsHtml}
          </div>
        </div>
        <div class="filter-group">
          <label>Error Code</label>
          <select class="code-select" id="code-select">
            <option value="all">All Codes (${uniqueCodes.length})</option>
            ${uniqueCodes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group">
          <label>Zoom</label>
          <div class="zoom-controls">
            <span class="zoom-btn">−</span>
            <span class="zoom-value">100%</span>
            <span class="zoom-btn">+</span>
            <span class="reset-btn">Reset</span>
          </div>
        </div>
      </div>
    </div>

    <div class="timeline-canvas-wrapper">
      <div class="swimlane-labels-container">
        <div class="labels-header">Error Code</div>
        <div class="labels-scroll">
          ${labelsHtml}
        </div>
      </div>
      <div class="canvas-container">${svgTag}</div>
    </div>

    <div class="station-summary">${summaryHtml}</div>

    <div class="timeline-hint">
      <span>🖱️ Drag to pan</span>
      <span>⌨️ Scroll horizontal</span>
      <span>⇅ Shift+scroll vertical</span>
      <span>🔍 Pinch/⌘+scroll zoom</span>
      <span>✨ Hover for details</span>
    </div>
  </div>
  ${script}`;

  return wrapPage(
    'Error Timeline',
    `${allErrors.length} errors across ${analyses.length} stations`,
    ERR_CSS,
    body
  );
}

// ═══════════════════════════════════════════════════════════════
//  3. EVENT TIMELINE  (interactive: zoom, pan, hover tooltips,
//     station + category filters, errors-only toggle)
// ═══════════════════════════════════════════════════════════════

const EVT_CATEGORIES = [
  { key: 'Scan',     label: 'Scan',     color: '#10b981' },
  { key: 'Press',    label: 'Press',    color: '#f59e0b' },
  { key: 'PSA',      label: 'PSA',      color: '#8b5cf6' },
  { key: 'Database', label: 'Database', color: '#3b82f6' },
  { key: 'System',   label: 'System',   color: '#6b7280' },
  { key: 'PLC',      label: 'PLC',      color: '#ec4899' },
  { key: 'Error',    label: 'Error',    color: '#ef4444' },
  { key: 'Process',  label: 'Process',  color: '#06b6d4' },
];

const EVT_STATION_NAMES: Record<string, string> = {
  BS: 'Bottom Shell', BA: 'Battery Assembly', TR: 'Transfer',
  TO: 'Top Shell', LA: 'Laser', FV: 'Final Verification',
};

const EVT_CSS = `
/* ─── Outer wrapper ─── */
.event-timeline-view {
  background: var(--card); border: 1px solid var(--bdr); border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}

/* ─── Controls bar ─── */
.timeline-controls {
  display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;
  padding: 0.875rem 1.25rem; border-bottom: 1px solid var(--bdr); background: var(--card);
}
.control-group { display: flex; align-items: center; gap: 0.5rem }
.control-group > label {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  color: var(--muted); letter-spacing: 0.04em; white-space: nowrap;
}
.toggle-buttons { display: flex; gap: 0.25rem; flex-wrap: wrap }
.toggle-btn {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.25rem 0.625rem; border-radius: 999px;
  font-size: 0.75rem; font-weight: 500;
  border: 1.5px solid var(--bdr); background: var(--card); color: var(--txt2);
  cursor: pointer; user-select: none; transition: all 0.15s;
}
.toggle-btn:hover { border-color: var(--btn-color, var(--accent)); color: var(--btn-color, var(--accent)) }
.toggle-btn.active { background: var(--btn-color, var(--accent)); color: white; border-color: var(--btn-color, var(--accent)) }
.toggle-btn .btn-icon { display: inline-flex }
.toggle-btn .btn-label { font-size: 0.6875rem }

.view-group { margin-left: auto }
.view-options { display: flex; align-items: center; gap: 0.75rem }
.checkbox-label { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; cursor: pointer; user-select: none }
.checkbox-label input[type="checkbox"] { accent-color: var(--accent) }

.event-counter {
  display: flex; align-items: baseline; gap: 0.375rem;
  padding: 0.375rem 0.75rem; background: rgba(8,145,178,0.06); border-radius: 999px;
}
.counter-value { font-family: var(--fd); font-size: 1.125rem; font-weight: 700; color: var(--accent) }
.counter-label { font-size: 0.6875rem; color: var(--muted) }

/* ─── Zoom controls ─── */
.evt-zoom-controls { display: flex; align-items: center; gap: 0.375rem }
.evt-zoom-btn {
  width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--bdr);
  background: var(--card); font-size: 1rem; display: flex; align-items: center;
  justify-content: center; color: var(--txt2); cursor: pointer; transition: all 0.15s;
}
.evt-zoom-btn:hover { background: #f1f5f9; border-color: var(--accent); color: var(--accent) }
.evt-zoom-value { font-family: var(--fm); font-size: 0.75rem; min-width: 3rem; text-align: center }
.evt-reset-btn {
  font-size: 0.6875rem; padding: 0.25rem 0.625rem; border-radius: 6px;
  border: 1px solid var(--bdr); background: var(--card); color: var(--txt2);
  cursor: pointer; transition: all 0.15s;
}
.evt-reset-btn:hover { background: #f1f5f9; border-color: var(--accent); color: var(--accent) }

/* ─── Timeline wrapper (labels + SVG) ─── */
.timeline-wrapper { display: flex; border-bottom: 1px solid var(--bdr) }

.station-labels-container {
  flex-shrink: 0; width: 180px; border-right: 1px solid var(--bdr); overflow: hidden;
}
.evt-labels-header {
  height: 50px; display: flex; align-items: center; padding: 0 0.75rem;
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  color: var(--muted); background: #f1f5f9; border-bottom: 1px solid var(--bdr);
}
.evt-labels-scroll { transition: transform 0.05s linear }
.station-label {
  display: flex; align-items: center; gap: 0.5rem; padding: 0 0.75rem;
  border-bottom: 1px solid var(--bdr); overflow: hidden;
}
.station-label.even { background: #fafbfc }
.station-label.odd  { background: #ffffff }
.label-icon {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; font-size: 0.9rem; color: white; flex-shrink: 0;
}
.label-info { flex: 1; min-width: 0 }
.label-name { font-size: 0.8125rem; font-weight: 600; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.evt-label-code { font-family: var(--fm); font-size: 0.6875rem; color: var(--dim); display: block }

.evt-canvas-container {
  flex: 1; overflow-x: auto; overflow-y: hidden; position: relative; cursor: grab;
}
.evt-canvas-container.dragging { cursor: grabbing }

/* ─── Tooltip ─── */
.evt-tooltip {
  position: fixed; pointer-events: none; z-index: 100;
  background: white; border: 1px solid rgba(0,0,0,0.1); border-radius: 10px;
  padding: 0.75rem; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  min-width: 220px; max-width: 320px; font-size: 0.8125rem;
  opacity: 0; transition: opacity 0.12s;
}
.evt-tooltip.visible { opacity: 1 }
.evt-tt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.375rem }
.evt-tt-time { font-family: var(--fm); font-size: 0.75rem; color: var(--muted) }
.evt-tt-station { font-weight: 600 }
.evt-tt-badges { display: flex; gap: 0.375rem; margin-bottom: 0.375rem }
.evt-tt-badge {
  font-size: 0.6875rem; font-weight: 600; padding: 0.125rem 0.5rem;
  border-radius: 4px; background: #f1f5f9; color: var(--txt2);
}
.evt-tt-badge.error { background: rgba(239,68,68,0.1); color: #dc2626 }
.evt-tt-badge.cat { color: white }
.evt-tt-sn { font-size: 0.75rem; color: var(--muted); margin-bottom: 0.25rem }
.evt-tt-sn code { font-family: var(--fm); font-weight: 600; color: var(--txt) }
.evt-tt-content { font-size: 0.75rem; color: var(--txt2); line-height: 1.4 }

/* ─── Hint bar ─── */
.evt-timeline-hint {
  display: flex; justify-content: center; gap: 1.5rem; padding: 0.625rem;
  font-size: 0.6875rem; color: var(--dim);
}
`;

export function generateEventTimelineHtml(events: LogEvent[]): string {
  if (events.length === 0) {
    return wrapPage('Event Timeline', 'No events', EVT_CSS,
      '<div class="event-timeline-view" style="padding:4rem;text-align:center;color:var(--dim)">No event data available</div>');
  }

  // ── Active stations (stations that have events) ──
  const stationCodes = [...new Set(events.map(e => e.stationCode))];
  const activeStations = STATIONS.filter(s => stationCodes.includes(s.code));

  // ── Unique categories present ──
  const activeCategories: Set<string> = new Set(events.map(e => e.category));

  // ── Time range ──
  const times = events.map(e => e.timeMs).filter(Boolean);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const tPad = (tMax - tMin) * 0.02 || 60000;
  const timeMin = tMin - tPad, timeMax = tMax + tPad, timeSpan = timeMax - timeMin;

  // ── SVG layout ──
  const SVG_W = 1200;
  const TIME_AXIS_H = 50;
  const LANE_H = 56;
  const LANE_GAP = 2;
  const SVG_H = TIME_AXIS_H + activeStations.length * (LANE_H + LANE_GAP) + 10;
  const DOT_R = 6;
  const ERR_R = 8;

  // ── Build left labels HTML ──
  const labelsHtml = activeStations.map((stn, idx) => `
    <div class="station-label ${idx % 2 === 0 ? 'even' : 'odd'}" data-station="${stn.code}" style="height:${LANE_H + LANE_GAP}px">
      <span class="label-icon" style="background:${stn.color}">${stn.icon}</span>
      <div class="label-info">
        <span class="label-name">${esc(EVT_STATION_NAMES[stn.code] || stn.name)}</span>
        <span class="evt-label-code">${stn.code}</span>
      </div>
    </div>`).join('');

  // ── Build SVG ──
  let svg = '';
  let dotIdx = 0;
  const tooltipData: any[] = [];

  // Time axis
  svg += `<rect x="0" y="0" width="${SVG_W}" height="${TIME_AXIS_H}" fill="#f1f5f9"/>`;
  svg += `<line x1="0" y1="${TIME_AXIS_H}" x2="${SVG_W}" y2="${TIME_AXIS_H}" stroke="#e2e8f0"/>`;

  // Time labels + grid
  const tickCount = 10;
  for (let i = 0; i <= tickCount; i++) {
    const progress = i / tickCount;
    const x = progress * SVG_W;
    const t = new Date(timeMin + timeSpan * progress);
    const label = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    svg += `<text x="${x}" y="32" text-anchor="middle" font-size="11" fill="#64748b" font-family="ui-monospace,SFMono-Regular,monospace" font-weight="500">${label}</text>`;
    svg += `<line x1="${x}" y1="${TIME_AXIS_H}" x2="${x}" y2="${SVG_H}" stroke="#f1f5f9"/>`;
  }

  // Lanes + dots
  activeStations.forEach((stn, laneIdx) => {
    const laneY = TIME_AXIS_H + laneIdx * (LANE_H + LANE_GAP);
    const bg = laneIdx % 2 === 0 ? '#ffffff' : '#fafbfc';
    svg += `<g class="evt-lane" data-station="${stn.code}">`;
    svg += `<rect class="lane-bg" x="0" y="${laneY}" width="${SVG_W}" height="${LANE_H}" fill="${bg}"/>`;
    svg += `<line x1="0" y1="${laneY + LANE_H}" x2="${SVG_W}" y2="${laneY + LANE_H}" stroke="#e2e8f0" stroke-width="0.5"/>`;

    const laneEvents = events.filter(e => e.stationCode === stn.code);
    laneEvents.forEach(evt => {
      if (!evt.timeMs) return;
      const progress = (evt.timeMs - timeMin) / timeSpan;
      const x = progress * SVG_W;
      const y = laneY + LANE_H / 2;

      const cat = EVT_CATEGORIES.find(c => c.key === evt.category);
      const color = evt.isError ? '#ef4444' : (cat?.color || '#6b7280');
      const r = evt.isError ? ERR_R : DOT_R;

      // Error glow
      if (evt.isError) {
        svg += `<circle cx="${x}" cy="${y}" r="${r * 2.5}" fill="#ef4444" opacity="0.12" class="evt-dot-el" data-cat="${esc(evt.category)}" data-error="${evt.isError ? '1' : '0'}"/>`;
      }

      // Main dot
      svg += `<circle class="evt-dot" data-idx="${dotIdx}" data-cat="${esc(evt.category)}" data-error="${evt.isError ? '1' : '0'}" cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.9" style="cursor:pointer"/>`;

      tooltipData.push({
        station: EVT_STATION_NAMES[evt.stationCode] || evt.station,
        stationCode: evt.stationCode,
        stationColor: stn.color,
        time: evt.timeStr,
        eventType: evt.eventType,
        category: evt.category,
        catColor: cat?.color || '#6b7280',
        isError: evt.isError,
        sn: evt.sn || null,
        content: evt.content || '',
      });
      dotIdx++;
    });
    svg += `</g>`;
  });

  const svgTag = `<svg id="evt-svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;

  // ── Station toggle buttons ──
  const stationBtnsHtml = activeStations.map(s =>
    `<span class="toggle-btn active" data-station="${s.code}" style="--btn-color:${s.color}">${s.icon} ${s.code}</span>`
  ).join('');

  // ── Category toggle buttons ──
  const catBtnsHtml = EVT_CATEGORIES
    .filter(c => activeCategories.has(c.key))
    .map(c =>
    `<span class="toggle-btn active" data-cat="${c.key}" style="--btn-color:${c.color}">${c.label}</span>`
  ).join('');

  // ── Tooltip data JSON ──
  const tooltipJson = JSON.stringify(tooltipData).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  // ── JS for interactivity ──
  const script = `
<div class="evt-tooltip" id="evt-tooltip">
  <div class="evt-tt-header">
    <span class="evt-tt-time" id="evt-tt-time"></span>
    <span class="evt-tt-station" id="evt-tt-station"></span>
  </div>
  <div class="evt-tt-badges" id="evt-tt-badges"></div>
  <div class="evt-tt-sn" id="evt-tt-sn"></div>
  <div class="evt-tt-content" id="evt-tt-content"></div>
</div>

<script>
(function() {
  var data = ${tooltipJson};
  var svgEl = document.getElementById('evt-svg');
  var container = document.querySelector('.evt-canvas-container');
  var labelsScroll = document.querySelector('.evt-labels-scroll');
  var tooltip = document.getElementById('evt-tooltip');
  var counterValue = document.querySelector('.counter-value');

  // ── Filter state ──
  var activeStations = {};
  var activeCategories = {};
  var errorsOnly = false;

  // Init all on
  document.querySelectorAll('.toggle-btn[data-station]').forEach(function(btn) {
    activeStations[btn.getAttribute('data-station')] = true;
  });
  document.querySelectorAll('.toggle-btn[data-cat]').forEach(function(btn) {
    activeCategories[btn.getAttribute('data-cat')] = true;
  });

  function applyFilters() {
    var visibleCount = 0;

    // Station lanes
    var lanes = svgEl.querySelectorAll('.evt-lane');
    var labels = labelsScroll.querySelectorAll('.station-label');
    lanes.forEach(function(lane, i) {
      var stn = lane.getAttribute('data-station');
      var showLane = !!activeStations[stn];
      lane.style.display = showLane ? '' : 'none';
      if (labels[i]) labels[i].style.display = showLane ? '' : 'none';

      if (showLane) {
        // Filter individual dots within visible lanes
        var dots = lane.querySelectorAll('.evt-dot, .evt-dot-el');
        dots.forEach(function(dot) {
          var cat = dot.getAttribute('data-cat');
          var isErr = dot.getAttribute('data-error') === '1';
          var showDot = !!activeCategories[cat] && (!errorsOnly || isErr);
          dot.style.display = showDot ? '' : 'none';
          // Only count main dots (not glows)
          if (showDot && dot.classList.contains('evt-dot')) visibleCount++;
        });
      }
    });

    counterValue.textContent = visibleCount.toLocaleString();

    // Update button states
    document.querySelectorAll('.toggle-btn[data-station]').forEach(function(btn) {
      var stn = btn.getAttribute('data-station');
      if (activeStations[stn]) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    document.querySelectorAll('.toggle-btn[data-cat]').forEach(function(btn) {
      var cat = btn.getAttribute('data-cat');
      if (activeCategories[cat]) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  // Station toggle clicks
  document.querySelectorAll('.toggle-btn[data-station]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var stn = btn.getAttribute('data-station');
      activeStations[stn] = !activeStations[stn];
      applyFilters();
    });
  });

  // Category toggle clicks
  document.querySelectorAll('.toggle-btn[data-cat]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var cat = btn.getAttribute('data-cat');
      activeCategories[cat] = !activeCategories[cat];
      applyFilters();
    });
  });

  // Errors only checkbox
  var errCheckbox = document.getElementById('errors-only-cb');
  if (errCheckbox) {
    errCheckbox.addEventListener('change', function() {
      errorsOnly = errCheckbox.checked;
      applyFilters();
    });
  }

  // ── Zoom / Pan state ──
  var scale = 1, offsetY = 0;
  var BASE_W = ${SVG_W}, BASE_H = ${SVG_H};
  var zoomValue = document.querySelector('.evt-zoom-value');
  var zoomBtns = document.querySelectorAll('.evt-zoom-btn');
  var resetBtn = document.querySelector('.evt-reset-btn');

  function applyView() {
    svgEl.setAttribute('width', Math.round(BASE_W * scale));
    svgEl.setAttribute('height', BASE_H);
    if (labelsScroll) labelsScroll.style.transform = 'translateY(' + offsetY + 'px)';
    if (zoomValue) zoomValue.textContent = Math.round(scale * 100) + '%';
  }

  function zoomTo(newScale, anchorX) {
    var oldScale = scale;
    newScale = Math.max(1, Math.min(50, newScale));
    var scrollX = container.scrollLeft;
    if (anchorX === undefined) anchorX = container.clientWidth / 2;
    var svgX = (scrollX + anchorX) / oldScale;
    scale = newScale;
    applyView();
    container.scrollLeft = svgX * scale - anchorX;
  }

  if (zoomBtns.length >= 2) {
    zoomBtns[0].addEventListener('click', function() { zoomTo(scale * 0.7); });
    zoomBtns[1].addEventListener('click', function() { zoomTo(scale * 1.5); });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      scale = 1; offsetY = 0; applyView(); container.scrollLeft = 0;
    });
  }

  // Wheel
  container.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var rect = container.getBoundingClientRect();
      var ax = e.clientX - rect.left;
      zoomTo(scale * (e.deltaY < 0 ? 1.2 : 0.83), ax);
    } else if (e.shiftKey) {
      offsetY -= e.deltaY;
      var maxUp = -(BASE_H - container.clientHeight + 100);
      offsetY = Math.max(maxUp, Math.min(100, offsetY));
      applyView();
    } else {
      container.scrollLeft += (e.deltaX || e.deltaY);
    }
  }, { passive: false });

  // Drag
  var dragging = false, dsx = 0, dsy = 0, scrollStart = 0, oyStart = 0;
  container.addEventListener('mousedown', function(e) {
    if (e.target.classList && e.target.classList.contains('evt-dot')) return;
    dragging = true; dsx = e.clientX; dsy = e.clientY;
    scrollStart = container.scrollLeft; oyStart = offsetY;
    container.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    container.scrollLeft = scrollStart - (e.clientX - dsx);
    offsetY = oyStart + (e.clientY - dsy);
    var maxUp = -(BASE_H - container.clientHeight + 100);
    offsetY = Math.max(maxUp, Math.min(100, offsetY));
    applyView();
  });
  document.addEventListener('mouseup', function() {
    dragging = false; container.classList.remove('dragging');
  });

  // ── Tooltip ──
  svgEl.querySelectorAll('.evt-dot').forEach(function(dot) {
    dot.addEventListener('mouseenter', function() {
      var idx = parseInt(dot.getAttribute('data-idx'));
      var d = data[idx]; if (!d) return;
      document.getElementById('evt-tt-time').textContent = d.time;
      var stnEl = document.getElementById('evt-tt-station');
      stnEl.textContent = d.station;
      stnEl.style.color = d.stationColor;

      var badges = '';
      badges += '<span class="evt-tt-badge' + (d.isError ? ' error' : '') + '">' + d.eventType + '</span>';
      badges += '<span class="evt-tt-badge cat" style="background:' + d.catColor + '">' + d.category + '</span>';
      document.getElementById('evt-tt-badges').innerHTML = badges;

      var snEl = document.getElementById('evt-tt-sn');
      if (d.sn) { snEl.innerHTML = 'SN: <code>' + d.sn + '</code>'; snEl.style.display = ''; }
      else { snEl.style.display = 'none'; }

      var content = d.content || '';
      document.getElementById('evt-tt-content').textContent = content.length > 120 ? content.slice(0, 120) + '...' : content;
      tooltip.classList.add('visible');
    });
    dot.addEventListener('mouseleave', function() { tooltip.classList.remove('visible'); });
  });

  document.addEventListener('mousemove', function(e) {
    if (tooltip.classList.contains('visible')) {
      var x = e.clientX + 15, y = e.clientY - 10;
      if (x + 320 > window.innerWidth) x = e.clientX - 335;
      if (y + 200 > window.innerHeight) y = e.clientY - 200;
      tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
    }
  });

  applyView();
})();
</script>`;

  // ── Count errors ──
  const errorCount = events.filter(e => e.isError).length;

  // ── Assemble ──
  const body = `
  <div class="event-timeline-view">
    <div class="timeline-controls">
      <div class="control-group">
        <label>Stations</label>
        <div class="toggle-buttons">
          ${stationBtnsHtml}
        </div>
      </div>

      <div class="control-group">
        <label>Categories</label>
        <div class="toggle-buttons">
          ${catBtnsHtml}
        </div>
      </div>

      <div class="control-group view-group">
        <label>View</label>
        <div class="view-options">
          <label class="checkbox-label">
            <input type="checkbox" id="errors-only-cb"/>
            <span>Errors Only${errorCount > 0 ? ' (' + errorCount + ')' : ''}</span>
          </label>
          <div class="evt-zoom-controls">
            <span class="evt-zoom-btn">−</span>
            <span class="evt-zoom-value">100%</span>
            <span class="evt-zoom-btn">+</span>
            <span class="evt-reset-btn">Reset</span>
          </div>
        </div>
      </div>

      <div class="event-counter">
        <span class="counter-value">${events.length.toLocaleString()}</span>
        <span class="counter-label">events</span>
      </div>
    </div>

    <div class="timeline-wrapper">
      <div class="station-labels-container">
        <div class="evt-labels-header">Station</div>
        <div class="evt-labels-scroll">
          ${labelsHtml}
        </div>
      </div>
      <div class="evt-canvas-container">${svgTag}</div>
    </div>

    <div class="evt-timeline-hint">
      <span>🖱️ Drag to pan</span>
      <span>⌨️ Scroll horizontal</span>
      <span>⇅ Shift+scroll vertical</span>
      <span>🔍 Pinch/⌘+scroll zoom</span>
      <span>✨ Hover for details</span>
    </div>
  </div>
  ${script}`;

  return wrapPage(
    'Event Timeline',
    `${events.length.toLocaleString()} events across ${activeStations.length} stations`,
    EVT_CSS,
    body
  );
}

// ═══════════════════════════════════════════════════════════════
//  4. CROSS-STATION ISSUES  (tabs, expandable cascades,
//     recurring pattern meters, insights)
// ═══════════════════════════════════════════════════════════════

const CROSS_CSS = `
/* ─── Wrapper ─── */
.issue-analysis-v2 {
  background: var(--card); border: 1px solid var(--bdr); border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}

/* ─── Summary cards row ─── */
.issue-summary {
  display: flex; gap: 1rem; padding: 1.25rem; border-bottom: 1px solid var(--bdr);
  flex-wrap: wrap;
}
.issue-card {
  flex: 1; min-width: 180px; display: flex; align-items: center; gap: 0.875rem;
  padding: 1rem 1.25rem; background: #f8fafc; border: 1px solid var(--bdr);
  border-radius: 12px; position: relative; overflow: hidden;
}
.issue-card.has-issues { border-color: rgba(220,38,38,0.2); background: linear-gradient(135deg, #fff, rgba(220,38,38,0.03)) }
.issue-card.clear { border-color: rgba(5,150,105,0.2); background: linear-gradient(135deg, #fff, rgba(5,150,105,0.03)) }
.issue-card.info { border-color: rgba(8,145,178,0.2); background: linear-gradient(135deg, #fff, rgba(8,145,178,0.03)) }
.issue-icon { font-size: 1.5rem; flex-shrink: 0 }
.issue-data { display: flex; flex-direction: column }
.issue-value { font-family: var(--fd); font-size: 1.75rem; font-weight: 800; line-height: 1 }
.issue-card.has-issues .issue-value { color: var(--danger) }
.issue-card.clear .issue-value { color: var(--success) }
.issue-card.info .issue-value { color: var(--accent) }
.issue-label { font-size: 0.75rem; color: var(--muted); margin-top: 0.125rem }

/* ─── Tabs ─── */
.issue-tabs {
  display: flex; border-bottom: 1px solid var(--bdr); background: #fafbfc;
}
.issue-tab {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.75rem 1.25rem; font-size: 0.8125rem; font-weight: 600;
  color: var(--muted); background: transparent; border: none; border-bottom: 2px solid transparent;
  cursor: pointer; transition: all 0.15s; user-select: none;
}
.issue-tab:hover { color: var(--txt); background: rgba(0,0,0,0.02) }
.issue-tab.active { color: var(--accent); border-bottom-color: var(--accent); background: white }
.tab-count {
  font-family: var(--fm); font-size: 0.6875rem; font-weight: 700;
  background: rgba(0,0,0,0.06); padding: 0.1rem 0.4rem; border-radius: 4px;
}
.issue-tab.active .tab-count { background: rgba(8,145,178,0.1); color: var(--accent) }

/* ─── Content panels ─── */
.issue-content { min-height: 200px }
.issue-panel { display: none; padding: 1.25rem }
.issue-panel.active { display: block }

/* Empty / all-clear states */
.all-clear { text-align: center; padding: 3rem 1rem; color: var(--muted) }
.all-clear h3 { font-family: var(--fd); font-size: 1.25rem; font-weight: 700; color: var(--success); margin: 0.75rem 0 0.25rem }
.all-clear p { font-size: 0.875rem; color: var(--dim) }
.clear-icon { font-size: 3rem; display: block; margin-bottom: 0.25rem }
.empty-tab { text-align: center; padding: 3rem 1rem; color: var(--dim) }
.empty-tab p { margin-top: 0.5rem; font-size: 0.875rem }

/* ─── Insights ─── */
.insights-list { display: flex; flex-direction: column; gap: 0.625rem }
.insight-item {
  display: flex; align-items: flex-start; gap: 0.75rem;
  padding: 0.875rem 1rem; border-radius: 10px; border: 1px solid var(--bdr);
  background: white;
}
.insight-item.critical { border-left: 3px solid var(--danger); background: rgba(220,38,38,0.02) }
.insight-item.warning { border-left: 3px solid var(--warn); background: rgba(217,119,6,0.02) }
.insight-item.success { border-left: 3px solid var(--success); background: rgba(5,150,105,0.02) }
.insight-item.info { border-left: 3px solid var(--accent); background: rgba(8,145,178,0.02) }
.insight-icon { flex-shrink: 0; margin-top: 0.125rem }
.insight-item.critical .insight-icon { color: var(--danger) }
.insight-item.warning .insight-icon { color: var(--warn) }
.insight-item.success .insight-icon { color: var(--success) }
.insight-item.info .insight-icon { color: var(--accent) }
.insight-text { flex: 1; font-size: 0.8125rem; line-height: 1.5; color: var(--txt2) }
.insight-text strong { color: var(--txt); font-weight: 600 }
.insight-badge {
  font-size: 0.625rem; font-weight: 600; text-transform: uppercase;
  padding: 0.15rem 0.5rem; border-radius: 999px; flex-shrink: 0;
}
.insight-badge.critical { background: rgba(220,38,38,0.1); color: var(--danger) }
.insight-badge.warning { background: rgba(217,119,6,0.1); color: var(--warn) }
.insight-badge.success { background: rgba(5,150,105,0.1); color: var(--success) }
.insight-badge.info { background: rgba(8,145,178,0.1); color: var(--accent) }

/* ─── Cascades ─── */
.cascades-list { display: flex; flex-direction: column; gap: 0.625rem }
.cascade-item {
  border: 1px solid var(--bdr); border-radius: 10px; overflow: hidden;
  background: white; transition: box-shadow 0.15s;
}
.cascade-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06) }
.cascade-header {
  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  padding: 0.75rem 1rem; cursor: pointer; user-select: none;
}
.cascade-header:hover { background: #fafbfc }
.cascade-time { font-family: var(--fm); font-size: 0.75rem; color: var(--muted); display: flex; align-items: center; gap: 0.25rem }
.cascade-stations { display: flex; gap: 0.25rem }
.station-chip {
  font-size: 0.6875rem; font-weight: 600; padding: 0.15rem 0.5rem;
  background: rgba(8,145,178,0.08); color: var(--accent); border-radius: 4px;
}
.cascade-count { font-family: var(--fm); font-size: 0.75rem; font-weight: 600; color: var(--danger) }
.cascade-window { font-size: 0.6875rem; color: var(--dim) }
.expand-arrow { margin-left: auto; color: var(--dim); transition: transform 0.2s; display: flex }
.expand-arrow.up { transform: rotate(180deg) }

.cascade-errors {
  padding: 0 1rem 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.375rem;
  border-top: 1px solid var(--bdr);
}
.cascade-error {
  display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.5rem 0;
}
.error-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--danger);
  flex-shrink: 0; margin-top: 0.375rem;
}
.error-info { flex: 1 }
.error-top { display: flex; justify-content: space-between; margin-bottom: 0.125rem }
.error-station { font-size: 0.75rem; font-weight: 600; color: var(--txt) }
.error-time { font-family: var(--fm); font-size: 0.6875rem; color: var(--dim) }
.error-code { font-family: var(--fm); font-size: 0.75rem; font-weight: 600; color: var(--danger); display: block }
.error-msg { font-size: 0.75rem; color: var(--muted) }

/* ─── Recurring ─── */
.recurring-list { display: flex; flex-direction: column; gap: 0.75rem }
.recurring-item {
  padding: 1rem; border: 1px solid var(--bdr); border-radius: 10px;
  background: white;
}
.recurring-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem }
.recurring-station { font-size: 0.875rem; font-weight: 600 }
.regularity-meter {
  position: relative; width: 120px; height: 6px; background: #f1f5f9;
  border-radius: 3px; overflow: hidden;
}
.meter-fill { height: 100%; border-radius: 3px; transition: width 0.3s }
.meter-value {
  position: absolute; right: -2.5rem; top: -0.5rem;
  font-family: var(--fm); font-size: 0.6875rem; font-weight: 700; color: var(--txt2);
}
.recurring-error { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem }
.error-code-badge {
  font-family: var(--fm); font-size: 0.75rem; font-weight: 600;
  padding: 0.15rem 0.5rem; background: rgba(220,38,38,0.08); color: var(--danger);
  border-radius: 4px;
}
.error-message { font-size: 0.8125rem; color: var(--txt2) }
.recurring-stats { display: flex; gap: 1.5rem; margin-bottom: 0.5rem }
.recurring-stats .stat { display: flex; flex-direction: column }
.stat-val { font-family: var(--fd); font-size: 1rem; font-weight: 700; color: var(--txt) }
.stat-lbl { font-size: 0.625rem; color: var(--dim); text-transform: uppercase }
.systematic-alert {
  display: flex; align-items: center; gap: 0.375rem;
  font-size: 0.75rem; font-weight: 600; color: var(--danger);
  padding: 0.375rem 0.625rem; background: rgba(220,38,38,0.05);
  border-radius: 6px; margin-top: 0.25rem;
}
`;

function fmtInterval(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function insightIconSvg(level: string): string {
  switch (level) {
    case 'critical': return '🚨';
    case 'warning': return '⚠️';
    case 'success': return '✅';
    default: return 'ℹ️';
  }
}

export function generateCrossStationHtml(analysis: any): string {
  if (!analysis) {
    return wrapPage('Cross-Station Issues', 'No data', CROSS_CSS,
      '<div class="issue-analysis-v2" style="padding:4rem;text-align:center;color:var(--dim)">No cross-station analysis data available</div>');
  }

  const { cascades = [], recurring = [], insights = [] } = analysis;
  const totalIssues = cascades.length + recurring.length;

  // ── Summary cards ──
  const summaryHtml = `
  <div class="issue-summary">
    <div class="issue-card ${cascades.length > 0 ? 'has-issues' : 'clear'}">
      <span class="issue-icon">🌊</span>
      <div class="issue-data">
        <span class="issue-value">${cascades.length}</span>
        <span class="issue-label">Error Cascades</span>
      </div>
    </div>
    <div class="issue-card ${recurring.length > 0 ? 'has-issues' : 'clear'}">
      <span class="issue-icon">🔄</span>
      <div class="issue-data">
        <span class="issue-value">${recurring.length}</span>
        <span class="issue-label">Recurring Patterns</span>
      </div>
    </div>
    <div class="issue-card info">
      <span class="issue-icon">💡</span>
      <div class="issue-data">
        <span class="issue-value">${insights.length}</span>
        <span class="issue-label">Insights</span>
      </div>
    </div>
  </div>`;

  // ── Tabs ──
  const tabsHtml = `
  <div class="issue-tabs">
    <button class="issue-tab active" data-tab="insights">
      💡 Insights <span class="tab-count">${insights.length}</span>
    </button>
    <button class="issue-tab" data-tab="cascades">
      🌊 Cascades <span class="tab-count">${cascades.length}</span>
    </button>
    <button class="issue-tab" data-tab="recurring">
      🔄 Recurring <span class="tab-count">${recurring.length}</span>
    </button>
  </div>`;

  // ── Insights panel ──
  const insightsHtml = insights.length === 0
    ? `<div class="all-clear">
        <span class="clear-icon">🎉</span>
        <h3>All Systems Healthy</h3>
        <p>No significant cross-station issues detected</p>
      </div>`
    : `<div class="insights-list">
        ${insights.map((ins: any) => `
          <div class="insight-item ${ins.level}">
            <span class="insight-icon">${insightIconSvg(ins.level)}</span>
            <div class="insight-text">${ins.text}</div>
            <span class="insight-badge ${ins.level}">${esc(ins.level)}</span>
          </div>
        `).join('')}
      </div>`;

  // ── Cascades panel ──
  const cascadesHtml = cascades.length === 0
    ? `<div class="empty-tab"><span>✨</span><p>No error cascades detected</p></div>`
    : `<div class="cascades-list">
        ${cascades.map((c: any) => `
          <div class="cascade-item">
            <div class="cascade-header" data-cascade="${esc(c.id)}">
              <span class="cascade-time">🕐 ${esc(c.startTime)}</span>
              <div class="cascade-stations">
                ${(c.stations || []).map((s: string) => `<span class="station-chip">${esc(s)}</span>`).join('')}
              </div>
              <span class="cascade-count">${c.errors?.length || 0} errors</span>
              <span class="cascade-window">within ${c.windowSec}s</span>
              <span class="expand-arrow">▼</span>
            </div>
            <div class="cascade-errors" style="display:none">
              ${(c.errors || []).map((err: any) => `
                <div class="cascade-error">
                  <div class="error-dot"></div>
                  <div class="error-info">
                    <div class="error-top">
                      <span class="error-station">${esc(err.station)}</span>
                      <span class="error-time">${esc(err.time)}</span>
                    </div>
                    <span class="error-code">${esc(err.code)}</span>
                    <span class="error-msg">${esc(err.message)}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>`;

  // ── Recurring panel ──
  const recurringHtml = recurring.length === 0
    ? `<div class="empty-tab"><span>✨</span><p>No recurring patterns detected</p></div>`
    : `<div class="recurring-list">
        ${recurring.map((p: any) => {
          const pct = ((p.consistency || 0) * 100).toFixed(0);
          const barColor = p.consistency > 0.7 ? '#ef4444' : p.consistency > 0.4 ? '#f59e0b' : '#10b981';
          return `
          <div class="recurring-item">
            <div class="recurring-header">
              <span class="recurring-station">${esc(p.station)}</span>
              <div class="regularity-meter">
                <div class="meter-fill" style="width:${pct}%;background:${barColor}"></div>
                <span class="meter-value">${pct}%</span>
              </div>
            </div>
            <div class="recurring-error">
              <span class="error-code-badge">${esc(p.code)}</span>
              <span class="error-message">${esc(p.message)}</span>
            </div>
            <div class="recurring-stats">
              <div class="stat">
                <span class="stat-val">${p.occurrences}</span>
                <span class="stat-lbl">occurrences</span>
              </div>
              <div class="stat">
                <span class="stat-val">${fmtInterval(p.avgIntervalSec || 0)}</span>
                <span class="stat-lbl">avg interval</span>
              </div>
            </div>
            ${p.consistency >= 0.7 ? `
            <div class="systematic-alert">
              ⚠️ Likely systematic issue — investigate root cause
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>`;

  // ── JS for tab switching + cascade expand/collapse ──
  const script = `
<script>
(function() {
  // Tab switching
  var tabs = document.querySelectorAll('.issue-tab');
  var panels = document.querySelectorAll('.issue-panel');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = tab.getAttribute('data-tab');
      tabs.forEach(function(t) { t.classList.remove('active'); });
      panels.forEach(function(p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var panel = document.getElementById('panel-' + target);
      if (panel) panel.classList.add('active');
    });
  });

  // Cascade expand/collapse
  document.querySelectorAll('.cascade-header').forEach(function(hdr) {
    hdr.addEventListener('click', function() {
      var item = hdr.parentElement;
      var errors = item.querySelector('.cascade-errors');
      var arrow = hdr.querySelector('.expand-arrow');
      if (errors.style.display === 'none') {
        errors.style.display = '';
        arrow.classList.add('up');
      } else {
        errors.style.display = 'none';
        arrow.classList.remove('up');
      }
    });
  });
})();
</script>`;

  // ── Assemble ──
  const body = `
  <div class="issue-analysis-v2">
    ${summaryHtml}
    ${tabsHtml}
    <div class="issue-content">
      <div class="issue-panel active" id="panel-insights">${insightsHtml}</div>
      <div class="issue-panel" id="panel-cascades">${cascadesHtml}</div>
      <div class="issue-panel" id="panel-recurring">${recurringHtml}</div>
    </div>
  </div>
  ${script}`;

  return wrapPage(
    'Cross-Station Issues',
    `${totalIssues} issues · ${insights.length} insights`,
    CROSS_CSS,
    body
  );
}

// ═══════════════════════════════════════════════════════════════
//  5. SERIAL ANALYSIS  (station tabs, stats, gap chart, gantt,
//     runs table, units table — all interactive)
// ═══════════════════════════════════════════════════════════════

const SERIAL_CSS = `
/* ─── Wrapper ─── */
.serial-analysis-v2 {
  background: var(--card); border: 1px solid var(--bdr); border-radius: 14px;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}

/* ─── Station tabs ─── */
.station-tabs {
  display: flex; gap: 0.5rem; padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--bdr); background: #fafbfc;
  flex-wrap: wrap;
}
.station-tab {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 1rem; border-radius: 10px;
  border: 1.5px solid var(--bdr); background: var(--card);
  font-size: 0.8125rem; font-weight: 500; color: var(--txt2);
  cursor: pointer; transition: all 0.15s; user-select: none;
}
.station-tab:hover { border-color: var(--tab-color, var(--accent)); color: var(--tab-color, var(--accent)) }
.station-tab.active {
  background: var(--tab-color, var(--accent)); color: white; border-color: var(--tab-color, var(--accent));
}
.tab-icon { font-size: 1rem }
.tab-name { font-weight: 600 }
.tab-units { font-family: var(--fm); font-size: 0.6875rem; opacity: 0.8 }

/* ─── Station panels (one per station, toggled) ─── */
.station-panel { display: none }
.station-panel.active { display: block }

/* ─── Stats row ─── */
.stats-row {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem; padding: 1.25rem;
}
.stat-card {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.875rem 1rem; background: #f8fafc; border: 1px solid var(--bdr);
  border-radius: 10px;
}
.stat-card.primary { border-left: 3px solid var(--accent); background: rgba(8,145,178,0.03) }
.stat-card.warning { border-left: 3px solid var(--danger); background: rgba(220,38,38,0.03) }
.stat-icon { color: var(--muted); flex-shrink: 0 }
.stat-card.primary .stat-icon { color: var(--accent) }
.stat-card.warning .stat-icon { color: var(--danger) }
.stat-data { display: flex; flex-direction: column }
.stat-value { font-family: var(--fd); font-size: 1.25rem; font-weight: 700; line-height: 1.2 }
.stat-value small { font-size: 0.75rem; font-weight: 500; color: var(--muted) }
.stat-card.warning .stat-value { color: var(--danger) }
.stat-label { font-size: 0.625rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.03em }

/* ─── View toggle ─── */
.view-toggle {
  display: flex; gap: 0.375rem; padding: 0 1.25rem 1rem;
}
.view-toggle-btn {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.375rem 0.875rem; border-radius: 8px;
  border: 1.5px solid var(--bdr); background: var(--card);
  font-size: 0.8125rem; font-weight: 600; color: var(--txt2);
  cursor: pointer; transition: all 0.15s;
}
.view-toggle-btn:hover { border-color: var(--accent); color: var(--accent) }
.view-toggle-btn.active { background: var(--accent); color: white; border-color: var(--accent) }

/* ─── Gap chart ─── */
.gap-chart-container { padding: 0 1.25rem 1.25rem }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem }
.chart-header h3 { font-family: var(--fd); font-size: 1rem; font-weight: 600; margin: 0 }
.chart-legend { display: flex; gap: 1rem }
.legend-item { display: flex; align-items: center; gap: 0.375rem; font-size: 0.6875rem; color: var(--muted) }
.legend-color { width: 10px; height: 10px; border-radius: 2px; display: inline-block }
.legend-color.normal { background: #10b981 }
.legend-color.buffer { background: #f59e0b }
.legend-color.stoppage { background: #ef4444 }

.gap-chart-svg { width: 100%; border: 1px solid var(--bdr); border-radius: 8px; background: #fafbfc }

.x-axis-label { text-align: center; font-size: 0.6875rem; color: var(--dim); margin-top: 0.375rem }

/* ─── Gap chart tooltip ─── */
.gap-tooltip {
  position: fixed; pointer-events: none; z-index: 100;
  background: white; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px;
  padding: 0.625rem; box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  font-size: 0.75rem; min-width: 160px; opacity: 0; transition: opacity 0.1s;
}
.gap-tooltip.visible { opacity: 1 }
.gap-tt-row { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 0.125rem }
.gap-tt-row span { color: var(--muted) }
.gap-tt-row strong { font-weight: 600 }
.gap-tt-row code { font-family: var(--fm); font-size: 0.6875rem }

/* ─── Gantt timeline ─── */
.gantt-section { padding: 0 1.25rem 1.25rem }
.gantt-section h3 { font-family: var(--fd); font-size: 1rem; font-weight: 600; margin: 0 0 0.75rem }
.gantt-track {
  display: flex; height: 36px; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--bdr); background: #f8fafc;
}
.gantt-segment {
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; position: relative; min-width: 2px;
}
.gantt-run { background: linear-gradient(135deg, #10b981, #059669); color: white }
.gantt-stop { background: linear-gradient(135deg, #ef4444, #dc2626); color: white }
.segment-label { font-size: 0.625rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 0.25rem }
.run-id { margin-right: 0.25rem }
.gantt-axis { display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem }
.axis-start, .axis-end { font-family: var(--fm); font-size: 0.6875rem; color: var(--dim) }
.axis-label { font-size: 0.6875rem; color: var(--dim) }
.gantt-legend-bar { display: flex; gap: 1rem; margin-top: 0.5rem }
.gantt-legend-bar .legend-item { display: flex; align-items: center; gap: 0.375rem; font-size: 0.6875rem; color: var(--muted) }
.dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block }
.dot.run { background: #10b981 }
.dot.stop { background: #ef4444 }

/* ─── Runs table ─── */
.runs-table-section { padding: 0 1.25rem 1.25rem }
.runs-table-section h3 { font-family: var(--fd); font-size: 1rem; font-weight: 600; margin: 0 0 0.75rem }
.table-wrapper { overflow-x: auto; border: 1px solid var(--bdr); border-radius: 8px }
table.runs-table, table.units-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem }
table.runs-table th, table.units-table th {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; color: var(--muted);
  background: #f1f5f9; padding: 0.5rem 0.75rem; letter-spacing: 0.03em; white-space: nowrap;
}
table.runs-table td, table.units-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--bdr) }
.run-num { font-family: var(--fm); font-weight: 600; color: var(--accent) }
.units-col { font-family: var(--fd); font-weight: 700 }
.time-col { font-family: var(--fm); font-size: 0.75rem; color: var(--muted); white-space: nowrap }
.uph { font-family: var(--fm); font-weight: 700; padding: 0.125rem 0.375rem; border-radius: 4px }
.uph.good { background: rgba(16,185,129,0.1); color: #059669 }
.uph.ok { background: rgba(245,158,11,0.1); color: #d97706 }
.uph.slow { background: rgba(239,68,68,0.1); color: #dc2626 }
.stoppage { font-family: var(--fm); font-size: 0.75rem; color: var(--danger); font-weight: 600 }

/* ─── Units table ─── */
.units-section { padding: 0 1.25rem 1.25rem }
.units-section h3 { font-family: var(--fd); font-size: 1rem; font-weight: 600; margin: 0 0 0.75rem }
.unit-count { font-size: 0.75rem; font-weight: 400; color: var(--dim) }
.num-col { font-family: var(--fm); font-size: 0.75rem; color: var(--dim) }
.sn-col code { font-family: var(--fm); font-size: 0.75rem }
.gap-val { font-family: var(--fm); font-weight: 700 }
.status { font-size: 0.6875rem; font-weight: 600; padding: 0.1rem 0.5rem; border-radius: 4px }
.status.normal { background: rgba(16,185,129,0.1); color: #059669 }
.status.buffer { background: rgba(245,158,11,0.1); color: #d97706 }
.status.stoppage { background: rgba(239,68,68,0.1); color: #dc2626 }
.stoppage-row { background: rgba(239,68,68,0.02) }
.buffer-row { background: rgba(245,158,11,0.02) }
.table-more { text-align: center; padding: 0.75rem; font-size: 0.75rem; color: var(--dim); border-top: 1px solid var(--bdr) }

/* ─── View sections (toggled by JS) ─── */
.view-section { display: none }
.view-section.active { display: block }
`;

function serialFmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function gapColor(gap: number, isStoppage: boolean, isBuffer: boolean): string {
  if (isStoppage) return '#ef4444';
  if (isBuffer) return '#f59e0b';
  return '#10b981';
}

function gapStatus(isStoppage: boolean, isBuffer: boolean): string {
  if (isStoppage) return 'Stoppage';
  if (isBuffer) return 'Buffer';
  return 'Normal';
}

function gapStatusClass(isStoppage: boolean, isBuffer: boolean): string {
  if (isStoppage) return 'stoppage';
  if (isBuffer) return 'buffer';
  return 'normal';
}

function buildGapChartSvg(units: any[], stationCode: string): string {
  const gaps = units.slice(1).filter((u: any) => u.gap > 0 && u.gap < 300);
  if (gaps.length === 0) return '';

  const maxGap = Math.max(...gaps.map((u: any) => u.gap));
  const niceMax = Math.ceil(maxGap / 10) * 10 || 10;
  const displayUnits = units.slice(1, 201); // max 200 bars

  const W = 1000, H = 250, PAD_L = 50, PAD_R = 10, PAD_T = 10, PAD_B = 20;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const barW = Math.max(1, Math.min(8, chartW / displayUnits.length - 1));

  let svg = '';

  // Y axis grid + labels
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round((niceMax / yTicks) * i);
    const y = PAD_T + chartH - (i / yTicks) * chartH;
    svg += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#e2e8f0" stroke-width="0.5"/>`;
    svg += `<text x="${PAD_L - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="monospace">${val}s</text>`;
  }

  // Bars with data attributes for tooltip
  displayUnits.forEach((unit: any, idx: number) => {
    const x = PAD_L + (idx / displayUnits.length) * chartW + barW * 0.2;
    const heightPct = Math.min(unit.gap / niceMax, 1);
    const barH = heightPct * chartH;
    const y = PAD_T + chartH - barH;
    const color = gapColor(unit.gap, unit.isStoppage, unit.isBuffer);

    svg += `<rect class="gap-bar" data-stn="${stationCode}" data-idx="${idx}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="1" fill="${color}" opacity="0.85" style="cursor:pointer">` +
      `<title>Unit #${unit.n}: ${unit.gap}s</title></rect>`;
  });

  return `<svg class="gap-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
}

function buildGanttHtml(runs: any[]): string {
  if (!runs || runs.length === 0) return '<div class="empty-tab"><span>✨</span><p>No production runs data</p></div>';

  const totalTime = runs.reduce((sum: number, r: any) => sum + r.durationSec + (r.stoppageTime || 0), 0) || 1;

  const segments = runs.map((run: any) => {
    const runW = Math.max((run.durationSec / totalTime) * 100, 3);
    const stopW = run.stoppageTime ? Math.max((run.stoppageTime / totalTime) * 100, 2) : 0;
    let html = `<div class="gantt-segment gantt-run" style="width:${runW}%" title="Run ${run.runNumber}: ${run.numUnits} units in ${serialFmtDuration(run.durationSec)}">`;
    html += `<span class="segment-label"><span class="run-id">R${run.runNumber}</span><span class="run-units">${run.numUnits}u</span></span></div>`;
    if (stopW > 0) {
      html += `<div class="gantt-segment gantt-stop" style="width:${stopW}%" title="Stoppage: ${serialFmtDuration(run.stoppageTime || 0)}">`;
      html += `<span class="segment-label stop-label">${serialFmtDuration(run.stoppageTime || 0)}</span></div>`;
    }
    return html;
  }).join('');

  return `
    <div class="gantt-section">
      <h3>Production Timeline</h3>
      <div class="gantt-track">${segments}</div>
      <div class="gantt-axis">
        <span class="axis-start">${esc(runs[0]?.startTime || '')}</span>
        <span class="axis-label">Timeline</span>
        <span class="axis-end">${esc(runs[runs.length - 1]?.endTime || '')}</span>
      </div>
      <div class="gantt-legend-bar">
        <span class="legend-item"><span class="dot run"></span> Production Run</span>
        <span class="legend-item"><span class="dot stop"></span> Stoppage</span>
      </div>
    </div>`;
}

function buildRunsTable(runs: any[]): string {
  if (!runs || runs.length === 0) return '';

  const rows = runs.map((run: any) => {
    const uphClass = run.uph > 60 ? 'good' : run.uph > 30 ? 'ok' : 'slow';
    return `<tr>
      <td><span class="run-num">#${run.runNumber}</span></td>
      <td class="units-col">${run.numUnits}</td>
      <td class="time-col">${esc(run.startTime)}</td>
      <td class="time-col">${esc(run.endTime)}</td>
      <td>${serialFmtDuration(run.durationSec)}</td>
      <td><span class="uph ${uphClass}">${run.uph.toFixed(1)}</span></td>
      <td>${run.stoppageTime ? `<span class="stoppage">${serialFmtDuration(run.stoppageTime)}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="runs-table-section">
      <h3>Run Details</h3>
      <div class="table-wrapper">
        <table class="runs-table">
          <thead><tr><th>Run</th><th>Units</th><th>Start</th><th>End</th><th>Duration</th><th>UPH</th><th>Stoppage After</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function buildUnitsTable(units: any[]): string {
  if (!units || units.length === 0) return '';

  const displayUnits = units.slice(0, 50);
  const rows = displayUnits.map((unit: any) => {
    const color = gapColor(unit.gap, unit.isStoppage, unit.isBuffer);
    const statusCls = gapStatusClass(unit.isStoppage, unit.isBuffer);
    const statusTxt = gapStatus(unit.isStoppage, unit.isBuffer);
    const rowCls = unit.isStoppage ? 'stoppage-row' : unit.isBuffer ? 'buffer-row' : '';
    return `<tr class="${rowCls}">
      <td class="num-col">${unit.n}</td>
      <td class="time-col">${esc(unit.time)}</td>
      <td><span class="gap-val" style="color:${color}">${unit.gap}s</span></td>
      <td class="sn-col"><code>${esc(unit.sn || '—')}</code></td>
      <td><span class="status ${statusCls}">${statusTxt}</span></td>
    </tr>`;
  }).join('');

  const more = units.length > 50 ? `<div class="table-more">+ ${units.length - 50} more units</div>` : '';

  return `
    <div class="units-section">
      <h3>Unit Data <span class="unit-count">(${units.length} records)</span></h3>
      <div class="table-wrapper">
        <table class="units-table">
          <thead><tr><th>#</th><th>Time</th><th>Gap</th><th>Serial Number</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${more}
      </div>
    </div>`;
}

export function generateSerialHtml(analyses: any[]): string {
  if (!analyses || analyses.length === 0) {
    return wrapPage('Serial Analysis', 'No data', SERIAL_CSS,
      '<div class="serial-analysis-v2" style="padding:4rem;text-align:center;color:var(--dim)">No serial analysis data available</div>');
  }

  // ── Build station tabs ──
  const tabsHtml = analyses.map((a: any, i: number) => {
    const station = a.station;
    const stationDef = STATIONS.find(s => s.code === station?.code);
    return `<span class="station-tab ${i === 0 ? 'active' : ''}" data-stn="${station?.code}" style="--tab-color:${stationDef?.color || '#6b7280'}">
      <span class="tab-icon">${stationDef?.icon || ''}</span>
      <span class="tab-name">${esc(station?.name)}</span>
      <span class="tab-units">${a.stats?.totalUnits || 0} units</span>
    </span>`;
  }).join('');

  // ── Build per-station panels ──
  const panelsHtml = analyses.map((a: any, i: number) => {
    const station = a.station;
    const stats = a.stats || {};
    const units = a.units || [];
    const runs = a.runs || [];

    // Stats row
    const statsHtml = `
    <div class="stats-row">
      <div class="stat-card primary">
        <span class="stat-icon">📦</span>
        <div class="stat-data">
          <span class="stat-value">${stats.totalUnits || 0}</span>
          <span class="stat-label">Total Units</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">🕐</span>
        <div class="stat-data">
          <span class="stat-value">${stats.medianGap?.toFixed(1) || 0}<small>s</small></span>
          <span class="stat-label">Median Gap</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">📈</span>
        <div class="stat-data">
          <span class="stat-value">${stats.meanGap?.toFixed(1) || 0}<small>s</small></span>
          <span class="stat-label">Mean Gap</span>
        </div>
      </div>
      <div class="stat-card ${(stats.stoppages || 0) > 3 ? 'warning' : ''}">
        <span class="stat-icon">🛑</span>
        <div class="stat-data">
          <span class="stat-value">${stats.stoppages || 0}</span>
          <span class="stat-label">Stoppages</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">⏸️</span>
        <div class="stat-data">
          <span class="stat-value">${serialFmtDuration(stats.totalStoppageTime || 0)}</span>
          <span class="stat-label">Stoppage Time</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">▶️</span>
        <div class="stat-data">
          <span class="stat-value">${runs.length}</span>
          <span class="stat-label">Production Runs</span>
        </div>
      </div>
    </div>`;

    // View toggle
    const viewToggle = `
    <div class="view-toggle">
      <span class="view-toggle-btn active" data-view="gaps" data-stn="${station?.code}">📊 Gap Chart</span>
      <span class="view-toggle-btn" data-view="runs" data-stn="${station?.code}">📈 Production Runs</span>
    </div>`;

    // Gap chart
    const gapChartSvg = buildGapChartSvg(units, station?.code || '');
    const gapChartHtml = gapChartSvg ? `
    <div class="view-section active" data-stn="${station?.code}" data-view-panel="gaps">
      <div class="gap-chart-container">
        <div class="chart-header">
          <h3>Unit-to-Unit Cycle Gaps</h3>
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-color normal"></span> Normal (&lt;30s)</span>
            <span class="legend-item"><span class="legend-color buffer"></span> Buffer (30-60s)</span>
            <span class="legend-item"><span class="legend-color stoppage"></span> Stoppage (&gt;60s)</span>
          </div>
        </div>
        ${gapChartSvg}
        <div class="x-axis-label">Unit Sequence (${Math.min(units.length - 1, 200)} of ${units.length} shown)</div>
      </div>
    </div>` : '';

    // Runs view (gantt + table)
    const runsHtml = `
    <div class="view-section" data-stn="${station?.code}" data-view-panel="runs">
      ${buildGanttHtml(runs)}
      ${buildRunsTable(runs)}
    </div>`;

    // Units table (always shown)
    const unitsTableHtml = buildUnitsTable(units);

    return `<div class="station-panel ${i === 0 ? 'active' : ''}" data-stn-panel="${station?.code}">
      ${statsHtml}
      ${viewToggle}
      ${gapChartHtml}
      ${runsHtml}
      ${unitsTableHtml}
    </div>`;
  }).join('');

  // ── Tooltip JSON for gap chart bars ──
  const tooltipDataMap: Record<string, any[]> = {};
  analyses.forEach((a: any) => {
    const code = a.station?.code || '';
    tooltipDataMap[code] = (a.units || []).slice(1, 201).map((u: any) => ({
      n: u.n, gap: u.gap, time: u.time, sn: u.sn || null,
      status: gapStatus(u.isStoppage, u.isBuffer),
      color: gapColor(u.gap, u.isStoppage, u.isBuffer),
    }));
  });
  const tooltipJson = JSON.stringify(tooltipDataMap).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  // ── JS ──
  const script = `
<div class="gap-tooltip" id="gap-tooltip">
  <div class="gap-tt-row"><span>Unit</span><strong id="gtt-unit"></strong></div>
  <div class="gap-tt-row"><span>Gap</span><strong id="gtt-gap"></strong></div>
  <div class="gap-tt-row"><span>Time</span><strong id="gtt-time"></strong></div>
  <div class="gap-tt-row"><span>Status</span><strong id="gtt-status"></strong></div>
  <div class="gap-tt-row" id="gtt-sn-row"><span>SN</span><code id="gtt-sn"></code></div>
</div>

<script>
(function() {
  var ttData = ${tooltipJson};
  var tooltip = document.getElementById('gap-tooltip');

  // ── Station tab switching ──
  var stationTabs = document.querySelectorAll('.station-tab');
  var stationPanels = document.querySelectorAll('.station-panel');
  stationTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var stn = tab.getAttribute('data-stn');
      stationTabs.forEach(function(t) { t.classList.remove('active'); });
      stationPanels.forEach(function(p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var panel = document.querySelector('.station-panel[data-stn-panel="' + stn + '"]');
      if (panel) panel.classList.add('active');
    });
  });

  // ── View toggle (gaps / runs) per station ──
  document.querySelectorAll('.view-toggle-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var stn = btn.getAttribute('data-stn');
      var view = btn.getAttribute('data-view');

      // Toggle button state within same station
      var panel = document.querySelector('.station-panel[data-stn-panel="' + stn + '"]');
      if (!panel) return;
      panel.querySelectorAll('.view-toggle-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      // Toggle view sections
      panel.querySelectorAll('.view-section').forEach(function(s) { s.classList.remove('active'); });
      var target = panel.querySelector('.view-section[data-view-panel="' + view + '"]');
      if (target) target.classList.add('active');
    });
  });

  // ── Gap bar tooltips ──
  document.querySelectorAll('.gap-bar').forEach(function(bar) {
    bar.addEventListener('mouseenter', function() {
      var stn = bar.getAttribute('data-stn');
      var idx = parseInt(bar.getAttribute('data-idx'));
      var d = (ttData[stn] || [])[idx];
      if (!d) return;
      document.getElementById('gtt-unit').textContent = '#' + d.n;
      var gapEl = document.getElementById('gtt-gap');
      gapEl.textContent = d.gap + 's';
      gapEl.style.color = d.color;
      document.getElementById('gtt-time').textContent = d.time;
      var statusEl = document.getElementById('gtt-status');
      statusEl.textContent = d.status;
      statusEl.style.color = d.color;
      var snRow = document.getElementById('gtt-sn-row');
      if (d.sn) { document.getElementById('gtt-sn').textContent = d.sn; snRow.style.display = ''; }
      else { snRow.style.display = 'none'; }
      tooltip.classList.add('visible');
    });
    bar.addEventListener('mouseleave', function() { tooltip.classList.remove('visible'); });
  });

  document.addEventListener('mousemove', function(e) {
    if (tooltip.classList.contains('visible')) {
      var x = e.clientX + 15, y = e.clientY - 10;
      if (x + 200 > window.innerWidth) x = e.clientX - 215;
      if (y + 150 > window.innerHeight) y = e.clientY - 150;
      tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
    }
  });
})();
</script>`;

  // ── Assemble ──
  const totalUnits = analyses.reduce((s: number, a: any) => s + (a.stats?.totalUnits || 0), 0);
  const body = `
  <div class="serial-analysis-v2">
    <div class="station-tabs">${tabsHtml}</div>
    ${panelsHtml}
  </div>
  ${script}`;

  return wrapPage(
    'Serial Analysis',
    `${analyses.length} stations · ${totalUnits.toLocaleString()} total units`,
    SERIAL_CSS,
    body
  );
}


// ── Download trigger ────────────────────────────────────────

export function downloadHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// IR-003: Save As — uses the File System Access API where available,
// falling back to the standard download trigger.
export async function saveAsHtml(html: string, suggestedFilename: string): Promise<void> {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });

  // Modern browsers: show native Save As dialog
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: suggestedFilename,
        types: [{ description: 'HTML Report', accept: { 'text/html': ['.html'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      // User cancelled — do nothing
      if (err?.name === 'AbortError') return;
      // Any other error: fall through to standard download
    }
  }

  // Fallback: standard anchor-click download
  downloadHtml(html, suggestedFilename);
}