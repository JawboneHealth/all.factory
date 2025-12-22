import { useState } from 'react';
import { type Change } from '../types';

interface Props {
  change: Change | null;
  onApprove: () => void;
  onReject: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  DUPLICATE_INSERT: '#ef4444',
  MISSING_PSA_TAPE: '#f59e0b',
  ORPHAN_ROW: '#8b5cf6',
  INDEX_MISMATCH: '#3b82f6',
};

const IMPORTANT_FIELDS = [
  'ID', 'DATE', 'PSA_TAPE_PIC', 'POWER_BOARD_SN', 'POWER_BOARD_PSA_PIC',
  'BATTERY_SN', 'BATTERY_PSA_PIC'
];

function formatValue(val: any): string {
  if (val === null || val === undefined) return '∅ null';
  if (val === '') return '∅ empty';
  return String(val);
}

interface ParsedLogLine {
  timestamp?: string;
  level?: string;
  event?: string;
  data?: string;
  raw: string;
}

function parseLogLine(line: string): ParsedLogLine {
  // Try to parse common log formats
  // Format 1: [2024-01-15 10:42:20] INFO: Event - Data
  // Format 2: 2024-01-15 10:42:20 | INFO | Event | Data
  // Format 3: 10:42:20 EVENT_NAME key=value key2=value2
  
  const result: ParsedLogLine = { raw: line };
  
  // Try bracket timestamp format: [timestamp]
  const bracketMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracketMatch) {
    result.timestamp = bracketMatch[1];
    const rest = bracketMatch[2];
    
    // Try to extract level (INFO, ERROR, WARN, DEBUG)
    const levelMatch = rest.match(/^(INFO|ERROR|WARN|DEBUG|TRACE):\s*(.*)$/i);
    if (levelMatch) {
      result.level = levelMatch[1].toUpperCase();
      result.data = levelMatch[2];
    } else {
      result.data = rest;
    }
    return result;
  }
  
  // Try pipe-separated format
  const pipeMatch = line.match(/^([^|]+)\|([^|]+)\|(.*)$/);
  if (pipeMatch) {
    result.timestamp = pipeMatch[1].trim();
    result.event = pipeMatch[2].trim();
    result.data = pipeMatch[3].trim();
    return result;
  }
  
  // Try space-separated with timestamp at start (HH:MM:SS or YYYY-MM-DD HH:MM:SS)
  const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2}(?:\.\d+)?|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)$/);
  if (timeMatch) {
    result.timestamp = timeMatch[1];
    const rest = timeMatch[2];
    
    // Try to find an event name (usually UPPER_CASE or CamelCase word)
    const eventMatch = rest.match(/^([A-Z][A-Z0-9_]+|[A-Z][a-zA-Z0-9]+)\s*(.*)$/);
    if (eventMatch) {
      result.event = eventMatch[1];
      result.data = eventMatch[2];
    } else {
      result.data = rest;
    }
    return result;
  }
  
  // Fallback: just return raw
  result.data = line;
  return result;
}

function LogLine({ line, lineNumber, defaultExpanded = false }: { 
  line: string; 
  lineNumber: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const parsed = parseLogLine(line);
  const isLong = line.length > 80;
  
  return (
    <div className={`mmi-log-line ${expanded ? 'expanded' : ''}`}>
      <div className="log-line-header" onClick={() => isLong && setExpanded(!expanded)}>
        <span className="log-line-number">{lineNumber}</span>
        {parsed.timestamp && (
          <span className="log-timestamp">{parsed.timestamp}</span>
        )}
        {parsed.level && (
          <span className={`log-level log-level-${parsed.level.toLowerCase()}`}>
            {parsed.level}
          </span>
        )}
        {parsed.event && (
          <span className="log-event">{parsed.event}</span>
        )}
        {isLong && (
          <button className="log-expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? '▼' : '▶'}
          </button>
        )}
      </div>
      <div className={`log-line-data ${expanded || !isLong ? 'show' : 'truncate'}`}>
        {parsed.data || parsed.raw}
      </div>
    </div>
  );
}

export function EvidencePanel({ change, onApprove, onReject }: Props) {
  if (!change) {
    return (
      <div className="right-pane">
        <div className="pane-header">
          <h3>Change Details</h3>
        </div>
        <div className="evidence-panel empty">
          <div className="empty-state">
            <span className="empty-icon">📄</span>
            <p>Select a change to view details</p>
          </div>
        </div>
      </div>
    );
  }

  // Find changed fields
  const changedFields: string[] = [];
  if (change.sql_before && change.sql_after) {
    for (const key of Object.keys(change.sql_before)) {
      if (change.sql_before[key] !== change.sql_after[key]) {
        changedFields.push(key);
      }
    }
  }

  const badgeColor = TYPE_COLORS[change.issue_type] || '#666';
  const mmiEvidence = change.mmi_evidence || [];
  const mmiLineNumbers = change.mmi_line_numbers || [];

  return (
    <div className="right-pane">
      <div className="pane-header">
        <h3>Change Details</h3>
      </div>
      <div className="evidence-panel">
        {/* Header */}
        <div className="evidence-header">
          <span className="evidence-badge" style={{ background: badgeColor }}>
            {change.issue_type.replace(/_/g, ' ')}
          </span>
          <span className="evidence-time">@ {change.timestamp}</span>
          <span className={`action-tag ${change.action.toLowerCase()}`}>
            {change.action}
          </span>
        </div>
        <p className="evidence-description">{change.description}</p>

        {/* SQL Diff Table */}
        <div className="diff-section">
          <div className="section-header">
            <span className="section-icon">📊</span>
            <span className="section-title">SQL Data Change</span>
            <span className="row-indicator">Row {change.sql_row_id}</span>
          </div>

          {change.action === 'DELETE' ? (
            <div className="diff-table-container">
              <div className="delete-banner">− Row will be deleted</div>
              <table className="diff-table">
                <tbody>
                  {IMPORTANT_FIELDS.map(field => (
                    <tr key={field} className="deleted-row">
                      <td className="field-name">{field}</td>
                      <td className="field-value deleted">
                        {formatValue(change.sql_before?.[field])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="diff-table-container">
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th className="before-header">Before</th>
                    <th className="after-header">After</th>
                  </tr>
                </thead>
                <tbody>
                  {IMPORTANT_FIELDS.map(field => {
                    const isChanged = changedFields.includes(field);
                    return (
                      <tr key={field} className={isChanged ? 'changed-row' : ''}>
                        <td className="field-name">
                          {isChanged && <span className="change-indicator" />}
                          {field}
                        </td>
                        <td className={`field-value ${isChanged ? 'before' : ''}`}>
                          {formatValue(change.sql_before?.[field])}
                        </td>
                        <td className={`field-value ${isChanged ? 'after' : ''}`}>
                          {formatValue(change.sql_after?.[field])}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* MMI Evidence */}
        <div className="diff-section">
          <div className="section-header">
            <span className="section-icon">📜</span>
            <span className="section-title">MMI Log Evidence</span>
            <span className="line-count">{mmiEvidence.length} lines</span>
          </div>
          <div className="mmi-log-container">
            {mmiEvidence.length === 0 ? (
              <div className="empty-state" style={{ padding: '1rem', textAlign: 'center' }}>
                <p>No MMI evidence available</p>
              </div>
            ) : (
              mmiEvidence.map((line, idx) => (
                <LogLine 
                  key={idx} 
                  line={line} 
                  lineNumber={mmiLineNumbers[idx] || idx + 1}
                  defaultExpanded={mmiEvidence.length <= 3}
                />
              ))
            )}
          </div>
        </div>

        {/* Action Buttons */}
        {change.status === 'pending' ? (
          <div className="action-buttons">
            <button className="approve-button" onClick={onApprove}>
              ✓ Approve Change
            </button>
            <button className="reject-button" onClick={onReject}>
              ✗ Reject
            </button>
          </div>
        ) : (
          <div className={`status-banner ${change.status}`}>
            {change.status === 'approved' ? '✓ Change Approved' : '✗ Change Rejected'}
          </div>
        )}
      </div>
    </div>
  );
}