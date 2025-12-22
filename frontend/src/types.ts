// ============================================
// DATA CLEANUP TYPES
// ============================================

export type IssueType = 
  | 'DUPLICATE_INSERT'      // Battery #2: Overlapped events
  | 'MISSING_PSA_TAPE'      // Battery #1: Missing PSA tape picture
  | 'ORPHAN_ROW'            // Battery #3: Missing SN & PRS
  | 'INDEX_MISMATCH'        // Battery #4: Mismatched PSA indices
  | 'ERROR_EVENT_MISMATCH'  // Battery #5: SQL/MMI error discrepancy
  | 'REPEATED_INSERT';      // PCBA #1: Same content logged multiple times

export type MismatchType = 
  | 'SQL_ONLY'              // Event in SQL but not MMI
  | 'MMI_ONLY'              // Event in MMI but not SQL
  | 'DUPLICATE_IN_SQL'      // Same event logged twice in SQL
  | 'MISSING_CLEAR_TIME';   // Error event has no clear time

export interface Change {
  id: string;
  issue_type: IssueType;
  description: string;
  timestamp: string;
  action: 'DELETE' | 'UPDATE' | 'FLAG';
  sql_row_id: number | null;
  sql_before: Record<string, unknown> | null;
  sql_after: Record<string, unknown> | null;
  mmi_evidence: string[];
  mmi_line_numbers: number[];
  status: 'pending' | 'approved' | 'rejected';
  
  // Optional fields for specific issue types
  suggested_value?: string;
  duplicate_of?: number;
  
  // INDEX_MISMATCH specific
  power_index?: number;
  battery_index?: number;
  suggested_battery_index?: number;
  
  // ERROR_EVENT_MISMATCH specific
  mismatch_type?: MismatchType;
  suggested_clear_time?: string;
  
  // REPEATED_INSERT specific
  repeat_count?: number;
  occurrence?: number;
  first_line_number?: number;
}

// ============================================
// PRODUCT ANALYTICS TYPES
// ============================================

// Station definitions
export interface Station {
  code: string;
  name: string;
  icon: string;
  color: string;
  multiUp?: number;
  note?: string;
  noteType?: 'info' | 'warning' | 'success';
}

export const STATIONS: Station[] = [
  { code: 'BS', name: 'Bottom Shell', icon: '📦', color: '#818cf8', multiUp: 3, note: '3-up design: processes 3 units simultaneously', noteType: 'warning' },
  { code: 'BA', name: 'Battery', icon: '🔋', color: '#34d399' },
  { code: 'TR', name: 'Trans', icon: '🔄', color: '#f472b6' },
  { code: 'TO', name: 'Top Shell', icon: '🔝', color: '#fbbf24' },
  { code: 'LA', name: 'Laser', icon: '⚡', color: '#ef4444', note: 'Bottleneck station', noteType: 'warning' },
  { code: 'FV', name: 'FVT', icon: '🧪', color: '#06b6d4' },
];

// File upload state per station
export interface StationFiles {
  stationCode: string;
  barcodeLog?: File;
  barcodeLogName?: string;
  errorLog?: File;
  errorLogName?: string;
  sqlExport?: File;
  sqlExportName?: string;
}

// Parsed event from logs
export interface LogEvent {
  station: string;
  stationCode: string;
  timestamp: string;
  timeMs: number;
  timeStr: string;
  eventType: string;
  category: 'Scan' | 'Press' | 'PSA' | 'Database' | 'System' | 'PLC' | 'Error' | 'Process';
  isError: boolean;
  sn?: string;
  content: string;
  lineNum: number;
  code?: string;
  message?: string;
}

// Error event with duration
export interface ErrorEvent {
  station: string;
  code: string;
  message: string;
  startTime: string;
  endTime?: string;
  durationSec?: number;
  startTimeMs: number;
  endTimeMs?: number;
}

// Station analysis result
export interface StationAnalysis {
  station: Station;
  barcode: BarcodeAnalysis | null;
  errors: ErrorAnalysis | null;
}

export interface BarcodeAnalysis {
  totalEvents: number;
  scanEvents: number;
  pressEvents: number;
  dbEvents: number;
  completedUnits: number;
  snScans: number;
  snDuplicates: number;
  snDuplicateList: Array<{ sn: string; count: number }>;
  hourlyActivity: Record<string, number>;
  firstEvent?: string;
  lastEvent?: string;
  cycleTimeMedian?: number;
  cycleTimeMean?: number;
  cycleTimeMax?: number;
  snScanIntervalMedian?: number;
  snScanIntervalMean?: number;
  effectiveCycleTime?: number;
}

export interface ErrorAnalysis {
  totalErrors: number;
  uniqueCodes: number;
  totalDowntimeMin: number;
  errorsByCode: Record<string, number>;
  errorTimeline: ErrorEvent[];
  mtbf?: { minutes: number; count: number };
  mtba?: { minutes: number; count: number };
}

// Cross-station analysis
export interface ErrorCascade {
  id: string;
  startTime: string;
  stations: string[];
  errors: Array<{
    station: string;
    code: string;
    message: string;
    time: string;
  }>;
  windowSec: number;
}

export interface RecurringPattern {
  station: string;
  code: string;
  message: string;
  occurrences: number;
  avgIntervalSec: number;
  consistency: number; // 0-1, how regular the interval is
  intervals: number[];
}

export interface CrossStationSequence {
  fromStation: string;
  fromError: string;
  toStation: string;
  toError: string;
  count: number;
  avgDelaySec: number;
}

// Serial analysis
export interface SerialUnit {
  n: number;
  time: string;
  timeMs: number;
  sn: string;
  gap: number;
  isStoppage: boolean;
  isBuffer: boolean;
}

export interface ProductionRun {
  runNumber: number;
  startTime: string;
  endTime: string;
  numUnits: number;
  durationSec: number;
  uph: number;
  stoppageTime?: number;
}

export interface SerialAnalysis {
  station: Station;
  units: SerialUnit[];
  runs: ProductionRun[];
  stats: {
    totalUnits: number;
    minGap: number;
    maxGap: number;
    medianGap: number;
    meanGap: number;
    stoppages: number;
    bufferClears: number;
    totalStoppageTime: number;
  };
}

// Full analytics state
export interface AnalyticsState {
  stationFiles: Record<string, StationFiles>;
  isAnalyzing: boolean;
  analysisComplete: boolean;
  stationAnalyses: StationAnalysis[];
  crossStationAnalysis: {
    cascades: ErrorCascade[];
    recurring: RecurringPattern[];
    sequences: CrossStationSequence[];
    insights: Array<{ level: 'critical' | 'warning' | 'info' | 'success'; text: string }>;
  } | null;
  serialAnalyses: SerialAnalysis[];
  allEvents: LogEvent[];
  timeFilter?: { start: string; end: string };
}

// Analytics tab types
export type AnalyticsTab = 'dashboard' | 'errors' | 'timeline' | 'issues' | 'serial';