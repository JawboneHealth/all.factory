"""
Analytics Router - Handles multi-station log analysis for production analytics.

Endpoints:
- POST /analytics/upload - Upload log file for a station
- POST /analytics/analyze - Run full analysis across all uploaded stations
- GET /analytics/stations - Get list of stations with uploaded files
- GET /analytics/reset - Clear all uploaded data

Analysis Features:
- Station Dashboard: KPIs, cycle times, throughput, MTBF/MTBA
- Error Timeline: Error occurrences by code across stations
- Event Timeline: Full event visualization
- Cross-Station Issues: Cascades, recurring patterns, sequences
- Serial Analysis: Unit-by-unit cycle time analysis
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional, Dict, List, Any
from datetime import datetime
from collections import defaultdict, Counter
import re
import time
import statistics
import csv
import io

router = APIRouter(prefix="/analytics", tags=["analytics"])

# In-memory storage for uploaded files and analysis results
store: Dict[str, Any] = {
    "stations": {},  # station_code -> {barcode_content, error_content, sql_content}
    "analysis_results": None,
    "analysis_cached_at": None,
    "start_time_filter": None,
    "exclude_windows": [],  # list of (start_dt, end_dt) tuples
}

CACHE_EXPIRY_SEC = 30 * 60  # 30 minutes

# Station definitions
STATIONS = {
    'BS': {'name': 'Bottom Shell', 'icon': '📦', 'color': '#818cf8', 'multiUp': 3, 'normalCycleSec': 30},
    'BA': {'name': 'Battery',      'icon': '🔋', 'color': '#34d399', 'normalCycleSec': 40},
    'TR': {'name': 'Trans',        'icon': '🔄', 'color': '#f472b6', 'normalCycleSec': 30},
    'TO': {'name': 'Top Shell',    'icon': '🔝', 'color': '#fbbf24', 'normalCycleSec': 45},
    'LA': {'name': 'Laser',        'icon': '⚡', 'color': '#ef4444', 'normalCycleSec': 55},
    'FV': {'name': 'FVT',          'icon': '🧪', 'color': '#06b6d4', 'normalCycleSec': 120},
}


def extract_log_date(content: str) -> str:
    """Extract date from log content. Looks for YYYY,MM,DD or YYYYMMDD patterns."""
    # Pattern: 2026,02,24 (barcode logs embed date in SN data)
    m = re.search(r'(\d{4}),(\d{2}),(\d{2})', content[:2000])
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # Pattern: 20260224 (compact date in filenames/content)
    m = re.search(r'(20\d{2})(\d{2})(\d{2})', content[:2000])
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return datetime.now().strftime("%Y-%m-%d")


def parse_timestamp(ts_str: str, log_date: str = "") -> Optional[datetime]:
    """Parse timestamp string like '9:45:18 AM' or '09:45:18' (24h) into datetime."""
    if not log_date:
        log_date = datetime.now().strftime("%Y-%m-%d")
    try:
        ts_str = ts_str.strip()
        if 'AM' not in ts_str and 'PM' not in ts_str:
            return datetime.strptime(f"{log_date} {ts_str}", "%Y-%m-%d %H:%M:%S")
        if len(ts_str) > 0 and ts_str[1] == ':':
            ts_str = '0' + ts_str
        return datetime.strptime(f"{log_date} {ts_str}", "%Y-%m-%d %I:%M:%S %p")
    except:
        return None


def is_excluded(ts: datetime, exclude_windows: List[tuple]) -> bool:
    """Return True if ts falls within any excluded window."""
    for (w_start, w_end) in exclude_windows:
        if w_start <= ts <= w_end:
            return True
    return False


def parse_barcode_log(content: str, station_code: str, start_filter: Optional[datetime] = None, exclude_windows: Optional[List[tuple]] = None) -> Dict[str, Any]:
    """Parse barcode log and extract events and metrics."""
    if exclude_windows is None:
        exclude_windows = []
    """Parse barcode log and extract events and metrics."""
    log_date = extract_log_date(content)
    lines = content.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    ts_pattern = re.compile(r'^\[(\d{1,2}:\d{2}:\d{2} [AP]M)\](.*)')

    # For BS: pre-build a set of line indices where 6101 fires,
    # and map each to the motor SN within the next few lines for deduplication.
    bs_6101_sn: dict[int, str] = {}
    if station_code == 'BS':
        for i, line in enumerate(lines):
            if 'PLC DM[6101]' in line:
                sn = None
                for j in range(i + 1, min(i + 6, len(lines))):
                    sn_match = re.search(r'PLC DM\[6100\]-\d+_([A-Z0-9]+B)', lines[j])
                    if sn_match:
                        sn = sn_match.group(1)
                        break
                bs_6101_sn[i] = sn if sn else f'unknown_{i}'
    
    events = []
    all_timestamps = []
    sn_timestamps = []
    seen_sns = set()
    sn_counts = defaultdict(int)
    hourly_activity = defaultdict(int)
    db_inserts = set()          # deduplicate DB records by unit identity
    completion_timestamps = []  # timestamp of each unique unit completion, in order

    for line_idx, line in enumerate(lines):
        line_num = line_idx + 1
        match = ts_pattern.match(line.strip())
        if not match:
            continue
        
        ts_str, content_part = match.groups()
        ts = parse_timestamp(ts_str, log_date)
        if not ts:
            continue
        
        if start_filter and ts < start_filter:
            continue
        
        if exclude_windows and is_excluded(ts, exclude_windows):
            continue
        
        all_timestamps.append(ts)
        hour = ts.strftime('%H')
        
        # Classify event
        is_error = False
        event_type = 'UNKNOWN'
        category = 'System'
        sn = None
        
        # Check for error indicator
        if re.match(r'\+\d,1,', content_part):
            is_error = True
        
        fields = content_part.split(',')
        
        # Station-specific parsing
        if station_code == 'BS':
            if content_part.startswith('+1,'):
                event_type = 'Bottom_Shell_SN'
                category = 'Scan'
                if len(fields) > 2 and fields[2].startswith('B'):
                    sn = fields[2]
            elif content_part.startswith('+2,'):
                event_type = 'Press'
                category = 'Press'
            elif content_part.startswith('+3,'):
                event_type = 'Component_SN'
                category = 'Scan'
            elif 'PLC DM[6101]' in content_part:
                event_type = 'DB_Record'
                category = 'Database'
        elif station_code == 'BA':
            if content_part.startswith('+2,0,F'):
                event_type = 'Power_Board_SN'
                category = 'Scan'
                if len(fields) > 2:
                    sn = fields[2]
            elif content_part.startswith('+2,0,V'):
                event_type = 'Battery_SN'
                category = 'Scan'
            elif content_part.startswith('+4,'):
                event_type = 'PSA_Tape'
                category = 'PSA'
            elif content_part.startswith('+5,'):
                event_type = 'Power_Board_PSA'
                category = 'PSA'
            elif content_part.startswith('+6,'):
                event_type = 'Battery_PSA'
                category = 'PSA'
            elif 'insert into' in content_part.lower() or re.match(r'^\d+:', content_part):
                event_type = 'DB_Record'
                category = 'Database'
        elif station_code in ['TR', 'TO', 'LA']:
            if '+3,0,' in content_part:
                event_type = 'SN_Scan'
                category = 'Scan'
                if len(fields) > 2:
                    sn = fields[2]
            elif '+1,0,' in content_part or '+4,0,' in content_part:
                event_type = 'Component_Scan'
                category = 'Scan'
            elif 'insert into' in content_part.lower() or re.match(r'^\d+:', content_part):
                event_type = 'DB_Record'
                category = 'Database'
        elif station_code == 'FV':
            # FVT barcode log has a leading comma before each data line: ,+1,0,SN,...
            # After splitting on ']', content_part = ",+1,0,T0624..."
            # so fields = ['', '+1', '0', 'SN', ...] — SN is at fields[3]
            if '+1,0,' in content_part:
                event_type = 'SN_Scan'
                category = 'Scan'
                if len(fields) > 3 and fields[3].startswith('T'):
                    sn = fields[3]
            elif 'PASS' in content_part or 'FAIL' in content_part:
                event_type = 'Test_Result'
                category = 'Process'
            elif 'PLC DM' in content_part:
                event_type = 'PLC_DM'
                category = 'System'
        
        # Track serial numbers
        if sn and sn not in seen_sns:
            seen_sns.add(sn)
            sn_timestamps.append(ts)
        if sn:
            sn_counts[sn] += 1

        # Deduplicate DB_Records by unit identity
        if event_type == 'DB_Record':
            if 'insert into' in content_part.lower():
                # Dedup by SN extracted from INSERT VALUES (3rd field)
                sn_match = re.search(r"VALUES\s*\([^,]+,[^,]+,'?([^,']+)'?", content_part, re.IGNORECASE)
                db_key = sn_match.group(1).strip("'\" ") if sn_match else content_part.strip()
            elif station_code == 'BS' and line_idx in bs_6101_sn:
                # Dedup by motor SN from the line following 6101
                db_key = bs_6101_sn[line_idx]
            else:
                db_key = content_part.strip() + str(len(db_inserts))
            if db_key not in db_inserts:
                db_inserts.add(db_key)
                completion_timestamps.append(ts)
                hourly_activity[ts.strftime('%H')] += 1
        
        events.append({
            'station': STATIONS[station_code]['name'],
            'stationCode': station_code,
            'timestamp': ts.isoformat(),
            'timeMs': int(ts.timestamp() * 1000),
            'timeStr': ts_str,
            'eventType': event_type,
            'category': category,
            'isError': is_error,
            'sn': sn,
            'content': content_part[:500],
            'lineNum': line_num,
        })
    
    # Calculate cycle times from completion intervals (completion-to-completion, not scan-to-scan)
    cycle_times = []
    if len(completion_timestamps) > 1:
        for i in range(1, len(completion_timestamps)):
            gap = (completion_timestamps[i] - completion_timestamps[i-1]).total_seconds()
            if 0 < gap < 300:  # filter outliers > 5 min
                cycle_times.append(gap)
    
    # Find duplicates
    duplicates = [(sn, count) for sn, count in sn_counts.items() if count > 1]
    duplicates.sort(key=lambda x: -x[1])
    
    return {
        'events': events,
        'totalEvents': len(events),
        'scanEvents': len([e for e in events if e['category'] == 'Scan']),
        'pressEvents': len([e for e in events if e['category'] == 'Press']),
        'dbEvents': len([e for e in events if e['category'] == 'Database']),
        'completedUnits': len(db_inserts),
        'snScans': len(seen_sns),
        'snDuplicates': len(duplicates),
        'snDuplicateList': [{'sn': sn, 'count': c} for sn, c in duplicates[:10]],
        'hourlyActivity': dict(hourly_activity),
        'firstEvent': all_timestamps[0].isoformat() if all_timestamps else None,
        'lastEvent': all_timestamps[-1].isoformat() if all_timestamps else None,
        'completionTimestamps': [t.isoformat() for t in completion_timestamps],
        'cycleTimeMedian': statistics.median(cycle_times) if cycle_times else None,
        'cycleTimeMean': statistics.mean(cycle_times) if cycle_times else None,
        'cycleTimeMax': max(cycle_times) if cycle_times else None,
    }


def parse_sql_export(
    content: str,
    start_filter: Optional[datetime] = None,
    exclude_windows: Optional[List[tuple]] = None,
) -> Dict[str, Any]:
    """Parse SQL CSV export into unit counts, timestamps, and cycle time stats.
    
    This is the primary source of truth for: completedUnits, UPH, cycle times,
    completionTimestamps, and hourlyActivity. Falls back to barcode only when
    SQL is not uploaded.
    """
    if exclude_windows is None:
        exclude_windows = []
    try:
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
    except Exception:
        return {'rowCount': 0, 'source': 'sql'}

    date_field = None
    for candidate in ('DATE', 'Date', 'date', 'TIMESTAMP'):
        if rows and candidate in rows[0]:
            date_field = candidate
            break

    completion_timestamps: List[datetime] = []
    hourly_activity: Dict[str, int] = defaultdict(int)
    sn_field = None

    # Try to find a serial number field for unit data table
    sn_candidates = [k for k in (rows[0].keys() if rows else [])
                     if any(x in k.upper() for x in ('TOP_SHELL_SN', 'BOTTOM_SHELL_SN', 'LASER', 'SN'))]
    if sn_candidates:
        sn_field = sn_candidates[0]

    units = []
    for row in rows:
        ts = None
        if date_field:
            raw = str(row.get(date_field, '')).strip()
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d%H%M%S"):
                try:
                    ts = datetime.strptime(raw, fmt)
                    break
                except:
                    continue

        if ts is None:
            continue
        if start_filter and ts < start_filter:
            continue
        if exclude_windows and is_excluded(ts, exclude_windows):
            continue

        completion_timestamps.append(ts)
        hourly_activity[ts.strftime('%H')] += 1
        units.append({
            'ts': ts,
            'sn': row.get(sn_field, '') if sn_field else '',
            'row': row,
        })

    # Cycle times from completion-to-completion
    cycle_times = []
    if len(completion_timestamps) > 1:
        sorted_ts = sorted(completion_timestamps)
        for i in range(1, len(sorted_ts)):
            gap = (sorted_ts[i] - sorted_ts[i - 1]).total_seconds()
            if 0 < gap < 300:
                cycle_times.append(gap)

    # Overall UPH
    overall_uph = None
    if len(completion_timestamps) >= 2:
        sorted_ts = sorted(completion_timestamps)
        elapsed = (sorted_ts[-1] - sorted_ts[0]).total_seconds()
        if elapsed > 0:
            overall_uph = round(len(completion_timestamps) / elapsed * 3600, 1)

    all_ts = sorted(completion_timestamps)
    return {
        'rowCount': len(rows),           # raw SQL row count (unfiltered)
        'completedUnits': len(units),    # after start filter + exclusions
        'completionTimestamps': [t.isoformat() for t in sorted(completion_timestamps)],
        'cycleTimeMedian': statistics.median(cycle_times) if cycle_times else None,
        'cycleTimeMean': statistics.mean(cycle_times) if cycle_times else None,
        'cycleTimeMax': max(cycle_times) if cycle_times else None,
        'overallUph': overall_uph,
        'hourlyActivity': dict(hourly_activity),
        'firstEvent': all_ts[0].isoformat() if all_ts else None,
        'lastEvent': all_ts[-1].isoformat() if all_ts else None,
        'units': units,   # kept for serial analysis, not serialized to JSON
        'source': 'sql',
    }


def _sql_is_minute_precision(sql_result: Dict) -> bool:
    """Return True if SQL timestamps lack second-level precision.
    When True, cycle times derived from SQL will be multiples of 60s and useless.
    We detect this by checking whether all cycle time gaps are multiples of 60.
    """
    ts_strs = sql_result.get('completionTimestamps', [])
    if len(ts_strs) < 4:
        return False
    try:
        timestamps = sorted(datetime.fromisoformat(t) for t in ts_strs[:20])
        gaps = [(timestamps[i] - timestamps[i-1]).total_seconds()
                for i in range(1, len(timestamps))
                if 0 < (timestamps[i] - timestamps[i-1]).total_seconds() < 300]
        if not gaps:
            return False
        # If every gap is a multiple of 60, timestamps are minute-only
        return all(g % 60 == 0 for g in gaps)
    except Exception:
        return False


def parse_error_log(content: str, station_code: str, start_filter: Optional[datetime] = None, exclude_windows: Optional[List[tuple]] = None) -> Dict[str, Any]:
    """Parse error log and extract error events with durations."""
    if exclude_windows is None:
        exclude_windows = []
    log_date = extract_log_date(content)
    lines = content.split('\n')
    errors = []
    error_timeline = []
    pending_errors = {}
    
    # Machine state transition codes — not real errors, filter them out
    MACHINE_STATE_CODES = {'12000', '12001'}

    # Different patterns for different stations
    if station_code in ['BS', 'BA']:
        pattern = re.compile(r'^\[(\d{1,2}:\d{2}:\d{2} [AP]M)\],?\s*\[([A-Z]+)\]\s*\[(\d+)\]\s*(.*)')
        
        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue
            
            ts_str, status, code, message = match.groups()
            ts = parse_timestamp(ts_str, log_date)
            if not ts:
                continue
            
            if start_filter and ts < start_filter:
                continue
            
            if exclude_windows and is_excluded(ts, exclude_windows):
                continue
            
            message = message.strip()
            if message == '(null)' or not message:
                continue

            if code in MACHINE_STATE_CODES:
                continue
            
            error_key = f"{code}_{message}"
            
            if status == 'OCCURED':
                pending_errors[error_key] = {
                    'station': STATIONS[station_code]['name'],
                    'code': code,
                    'message': message,
                    'startTime': ts_str,
                    'startTimeMs': int(ts.timestamp() * 1000),
                }
            elif status == 'CLEARED' and error_key in pending_errors:
                err = pending_errors.pop(error_key)
                duration = (ts - datetime.fromtimestamp(err['startTimeMs'] / 1000)).total_seconds()
                error_timeline.append({
                    **err,
                    'endTime': ts_str,
                    'endTimeMs': int(ts.timestamp() * 1000),
                    'durationSec': duration,
                })
                errors.append({
                    'time': ts_str,
                    'timestamp': int(ts.timestamp() * 1000),
                    'code': code,
                    'message': message[:60],
                })
    else:
        # Trans/Top/Laser/FVT format
        if station_code == 'FV':
            error_pattern = re.compile(r'^\[(\d{2}:\d{2}:\d{2})\],\s*(An ERROR|ERROR RESET)\s*,\[(\d+)\],\s*(.*)')
        else:
            error_pattern = re.compile(r'^\[(\d{1,2}:\d{2}:\d{2} [AP]M)\]\s*(An ERROR|ERROR RESET)\s*,\[?(\d+)\]?,\s*(.*)')
        
        for line in lines:
            match = error_pattern.match(line.strip())
            if not match:
                continue
            
            ts_str, status, code, message = match.groups()
            ts = parse_timestamp(ts_str, log_date)
            if not ts:
                continue
            
            if start_filter and ts < start_filter:
                continue
            
            if exclude_windows and is_excluded(ts, exclude_windows):
                continue
            
            # Extract holding time if present
            holding_match = re.search(r'==> HOLDING TIME : \(\s*(\d+):(\d+):(\d+)\s*\)', message)
            duration_from_log = None
            if holding_match:
                h, m, s = map(int, holding_match.groups())
                duration_from_log = h * 3600 + m * 60 + s
                message = message.split('==>')[0].strip()
            
            error_key = f"{code}_{message}"

            if code in MACHINE_STATE_CODES:
                continue

            if status == 'An ERROR':
                pending_errors[error_key] = {
                    'station': STATIONS[station_code]['name'],
                    'code': code,
                    'message': message,
                    'startTime': ts_str,
                    'startTimeMs': int(ts.timestamp() * 1000),
                }
                errors.append({
                    'time': ts_str,
                    'timestamp': int(ts.timestamp() * 1000),
                    'code': code,
                    'message': message[:60],
                })
            elif status == 'ERROR RESET' and error_key in pending_errors:
                err = pending_errors.pop(error_key)
                duration = duration_from_log if duration_from_log else (ts - datetime.fromtimestamp(err['startTimeMs'] / 1000)).total_seconds()
                error_timeline.append({
                    **err,
                    'endTime': ts_str,
                    'endTimeMs': int(ts.timestamp() * 1000),
                    'durationSec': duration,
                })
    
    # Count by code
    error_counts = Counter(e['code'] for e in errors)
    
    # Calculate total downtime
    total_downtime = sum(e.get('durationSec', 0) for e in error_timeline)
    
    # Calculate MTBF: total operating time / number of failures
    mtbf = None
    if len(error_timeline) >= 1:
        times = sorted(e['startTimeMs'] for e in error_timeline)
        total_span_min = (times[-1] - times[0]) / 1000 / 60
        mtbf = {'minutes': total_span_min / len(error_timeline), 'count': len(error_timeline)}
    
    return {
        'totalErrors': len(errors),
        'uniqueCodes': len(error_counts),
        'totalDowntimeMin': total_downtime / 60,
        'errorsByCode': dict(error_counts),
        'errorTimeline': error_timeline,
        'mtbf': mtbf,
        'mtba': None,  # Would need assist data
        'errors': errors,
    }


def analyze_cross_station(all_errors: List[Dict], window_sec: int = 60) -> Dict[str, Any]:
    """Analyze cross-station error patterns."""
    cascades = []
    recurring = []
    sequences = []
    insights = []
    
    if not all_errors:
        return {
            'cascades': cascades,
            'recurring': recurring,
            'sequences': sequences,
            'insights': [{'level': 'info', 'text': 'No error data available for cross-station analysis.'}],
        }
    
    # Sort by time
    sorted_errors = sorted(all_errors, key=lambda x: x.get('startTimeMs', 0))
    
    # Find cascades (errors within window across multiple stations)
    i = 0
    cascade_id = 0
    while i < len(sorted_errors):
        cascade_start = sorted_errors[i].get('startTimeMs', 0)
        cascade_errors = [sorted_errors[i]]
        
        j = i + 1
        while j < len(sorted_errors):
            if (sorted_errors[j].get('startTimeMs', 0) - cascade_start) / 1000 <= window_sec:
                cascade_errors.append(sorted_errors[j])
                j += 1
            else:
                break
        
        # Only record if cascade spans multiple stations
        stations_in_cascade = set(e.get('station', '') for e in cascade_errors)
        if len(stations_in_cascade) > 1:
            cascade_id += 1
            cascades.append({
                'id': f'cascade-{cascade_id}',
                'startTime': sorted_errors[i].get('startTime', ''),
                'stations': list(stations_in_cascade),
                'errors': [
                    {
                        'station': e.get('station', ''),
                        'code': e.get('code', ''),
                        'message': e.get('message', ''),
                        'time': e.get('startTime', ''),
                    }
                    for e in cascade_errors
                ],
                'windowSec': window_sec,
            })
        
        i = j if j > i + 1 else i + 1
    
    # Find recurring patterns (same error code appearing multiple times)
    error_occurrences = defaultdict(list)
    for err in sorted_errors:
        key = f"{err.get('station', '')}:{err.get('code', '')}:{err.get('message', '')}"
        error_occurrences[key].append(err.get('startTimeMs', 0))
    
    for key, times in error_occurrences.items():
        if len(times) >= 3:
            intervals = [(times[i] - times[i-1]) / 1000 for i in range(1, len(times))]
            if intervals:
                avg_interval = statistics.mean(intervals)
                std_dev = statistics.stdev(intervals) if len(intervals) > 1 else 0
                consistency = 1 - (std_dev / avg_interval) if avg_interval > 0 else 0
                consistency = max(0, min(1, consistency))
                
                parts = key.split(':', 2)
                recurring.append({
                    'station': parts[0] if len(parts) > 0 else '',
                    'code': parts[1] if len(parts) > 1 else '',
                    'message': parts[2] if len(parts) > 2 else '',
                    'occurrences': len(times),
                    'avgIntervalSec': avg_interval,
                    'consistency': consistency,
                    'intervals': intervals,
                })
    
    # Sort by consistency
    recurring.sort(key=lambda x: -x['consistency'])
    
    # Generate insights
    if cascades:
        insights.append({
            'level': 'warning',
            'text': f'<strong>{len(cascades)} error cascades</strong> detected across stations. Multiple stations experiencing errors within {window_sec}s windows.',
        })
    
    high_consistency = [r for r in recurring if r['consistency'] > 0.7]
    if high_consistency:
        insights.append({
            'level': 'critical',
            'text': f'<strong>{len(high_consistency)} highly consistent recurring errors</strong> (>70% regularity). These likely have systematic causes.',
        })
    
    if not cascades and not recurring:
        insights.append({
            'level': 'success',
            'text': 'No significant cross-station error patterns detected. Errors appear isolated.',
        })
    
    return {
        'cascades': cascades[:50],  # Limit for performance
        'recurring': recurring[:30],
        'sequences': sequences[:20],
        'insights': insights,
    }


def analyze_serial(barcode_result: Optional[Dict], station_code: str, sql_result: Optional[Dict] = None) -> Optional[Dict[str, Any]]:
    """Analyze serial-by-serial cycle times using unit completion timestamps.
    
    SQL is the primary source when available (already deduplicated, confirmed
    completions with SNs). Falls back to barcode completionTimestamps.
    """
    using_sql = False
    if sql_result and sql_result.get('completionTimestamps'):
        completion_ts_strs = sql_result['completionTimestamps']
        using_sql = True
    elif barcode_result:
        completion_ts_strs = barcode_result.get('completionTimestamps', [])
    else:
        return None

    completion_timestamps = [datetime.fromisoformat(t) for t in completion_ts_strs]

    if len(completion_timestamps) < 2:
        return None

    # Stoppage = gap > 300s (5 min) — a genuine line halt across all stations.
    # Buffer = gap between normal cycle time and 300s — slow but not stopped.
    normal_cycle = STATIONS[station_code].get('normalCycleSec', 60)
    stoppage_threshold = 300
    buffer_threshold = normal_cycle

    # SN lookup: prefer SQL rows (direct), fall back to barcode DB events
    sql_units_by_ts: Dict[int, str] = {}
    if using_sql and sql_result.get('units'):
        for u in sql_result['units']:
            ts_ms = int(u['ts'].timestamp() * 1000)
            sql_units_by_ts[ts_ms] = u.get('sn', '')

    db_events_with_sn = [] if using_sql else [
        e for e in (barcode_result or {}).get('events', [])
        if e.get('category') == 'Database' and e.get('sn')
    ]

    def find_sn_for_completion(ts: datetime) -> Optional[str]:
        ts_ms = int(ts.timestamp() * 1000)
        # SQL path: exact timestamp match
        if using_sql:
            return sql_units_by_ts.get(ts_ms) or None
        # Barcode path: nearest DB event within 5s
        best = None
        best_diff = float('inf')
        for e in db_events_with_sn:
            diff = abs(e['timeMs'] - ts_ms)
            if diff < best_diff:
                best_diff = diff
                best = e['sn']
        return best if best_diff < 5000 else None

    # Build units list from completions
    units = []
    for i, ts in enumerate(completion_timestamps):
        sn = find_sn_for_completion(ts)
        time_ms = int(ts.timestamp() * 1000)
        gap = 0
        if units:
            gap = (time_ms - units[-1]['timeMs']) / 1000

        units.append({
            'n': len(units) + 1,
            'time': ts.strftime('%I:%M:%S %p').lstrip('0'),
            'timeMs': time_ms,
            'sn': sn,
            'gap': int(gap),
            'isStoppage': gap > stoppage_threshold,
            'isBuffer': buffer_threshold < gap <= stoppage_threshold,
        })

    if len(units) < 2:
        return None

    gaps = [u['gap'] for u in units[1:] if 0 < u['gap'] <= stoppage_threshold]

    # Production runs — split on stoppages
    runs = []
    run_start = 0
    run_number = 0

    for i, unit in enumerate(units):
        is_last = i == len(units) - 1
        if unit['isStoppage'] or is_last:
            # Stoppage: run is [run_start, i), stoppage unit is not part of the run
            # Last unit: run is [run_start, i] inclusive
            run_end = i if unit['isStoppage'] else i + 1
            run_units = units[run_start:run_end]
            if len(run_units) > 0:
                run_number += 1
                duration = (run_units[-1]['timeMs'] - run_units[0]['timeMs']) / 1000
                runs.append({
                    'runNumber': run_number,
                    'startTime': run_units[0]['time'],
                    'endTime': run_units[-1]['time'],
                    'numUnits': len(run_units),
                    'durationSec': int(duration),
                    'uph': (len(run_units) / duration * 3600) if duration > 0 else 0,
                    'stoppageTime': unit['gap'] if unit['isStoppage'] else None,
                })
            run_start = i  # next run starts at the stoppage unit itself

    # Overall UPH: total units / total elapsed time
    overall_uph = None
    if len(units) >= 2:
        total_elapsed_sec = (units[-1]['timeMs'] - units[0]['timeMs']) / 1000
        if total_elapsed_sec > 0:
            overall_uph = round(len(units) / total_elapsed_sec * 3600, 1)

    # Avg Normal Cycle Time: mean of gaps below the stoppage threshold
    normal_gaps = [u['gap'] for u in units[1:] if 0 < u['gap'] <= stoppage_threshold]
    avg_normal_cycle_time = round(statistics.mean(normal_gaps), 1) if normal_gaps else None

    return {
        'station': {
            'code': station_code,
            'name': STATIONS[station_code]['name'],
            'icon': STATIONS[station_code]['icon'],
            'color': STATIONS[station_code]['color'],
        },
        'units': units,
        'runs': runs,
        'thresholds': {
            'normal': normal_cycle,
            'stoppage': stoppage_threshold,
        },
        'stats': {
            'totalUnits': len(units),
            'minGap': min(gaps) if gaps else 0,
            'maxGap': max(gaps) if gaps else 0,
            'medianGap': statistics.median(gaps) if gaps else 0,
            'meanGap': statistics.mean(gaps) if gaps else 0,
            'stoppages': len([u for u in units if u['isStoppage']]),
            'bufferClears': len([u for u in units if u['isBuffer']]),
            'totalStoppageTime': sum(u['gap'] for u in units if u['isStoppage']),
            'overallUph': overall_uph,
            'avgNormalCycleTime': avg_normal_cycle_time,
        },
    }


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    station: str = Form(...),
    type: str = Form(...)  # 'barcode', 'error', or 'sql'
):
    """Upload a log file for a station."""
    if station not in STATIONS:
        raise HTTPException(status_code=400, detail=f"Unknown station: {station}")
    
    if type not in ['barcode', 'error', 'sql']:
        raise HTTPException(status_code=400, detail=f"Unknown file type: {type}")
    
    content = await file.read()
    content_str = content.decode('utf-8', errors='ignore')
    
    # Initialize station storage if needed
    if station not in store["stations"]:
        store["stations"][station] = {}
    
    store["stations"][station][f"{type}_content"] = content_str
    store["stations"][station][f"{type}_filename"] = file.filename
    
    return {
        "station": station,
        "type": type,
        "filename": file.filename,
        "size": len(content),
        "lines": len(content_str.split('\n')),
    }


@router.post("/analyze")
async def run_analysis(start_time: Optional[str] = None, exclude_windows: Optional[str] = None):
    """Run full analysis across all uploaded stations."""
    import json as _json
    
    # Parse start time filter
    start_filter = None
    if start_time:
        start_filter = parse_timestamp(start_time)
        store["start_time_filter"] = start_time
    
    # Parse exclusion windows: JSON string like '[{"start":"11:00:00 AM","end":"11:30:00 AM"}]'
    parsed_exclude: List[tuple] = []
    if exclude_windows:
        try:
            windows = _json.loads(exclude_windows)
            log_date = datetime.now().strftime("%Y-%m-%d")
            for w in windows:
                w_start = parse_timestamp(w.get("start", ""), log_date)
                w_end = parse_timestamp(w.get("end", ""), log_date)
                if w_start and w_end and w_start < w_end:
                    parsed_exclude.append((w_start, w_end))
        except Exception:
            pass
    store["exclude_windows"] = parsed_exclude
    
    station_analyses = []
    all_events = []
    all_errors = []
    serial_analyses = []
    
    for station_code, station_data in store["stations"].items():
        station_info = {
            'code': station_code,
            'name': STATIONS[station_code]['name'],
            'icon': STATIONS[station_code]['icon'],
            'color': STATIONS[station_code]['color'],
            'multiUp': STATIONS[station_code].get('multiUp'),
        }
        
        barcode_result = None
        error_result = None
        
        # Parse SQL File if available (primary source for unit stats)
        sql_result = None
        if station_data.get('sql_content'):
            sql_result = parse_sql_export(
                station_data['sql_content'],
                start_filter,
                parsed_exclude,
            )

        # Parse barcode log if available (primary source for scan events/timeline)
        barcode_result = None
        if station_data.get('barcode_content'):
            barcode_result = parse_barcode_log(
                station_data['barcode_content'],
                station_code,
                start_filter,
                parsed_exclude,
            )
            if barcode_result.get('totalEvents', 0) <= 1 and barcode_result.get('scanEvents', 0) == 0:
                barcode_result = None
            else:
                all_events.extend(barcode_result.get('events', []))

        # Serial analysis: SQL timestamps preferred, barcode as fallback
        serial = analyze_serial(barcode_result, station_code, sql_result)
        if serial:
            serial_analyses.append(serial)

        # Parse error log if available
        if station_data.get('error_content'):
            error_result = parse_error_log(
                station_data['error_content'],
                station_code,
                start_filter,
                parsed_exclude,
            )
            for err in error_result.get('errorTimeline', []):
                err['station'] = STATIONS[station_code]['name']
                all_errors.append(err)

        # When SQL is available, override barcode unit/UPH stats so the
        # dashboard uses the more reliable SQL-derived numbers.
        # If barcode is absent, promote SQL stats into a minimal barcode-shaped dict
        # so the rest of the frontend (which reads from barcode) picks them up.
        if sql_result:
            # Detect minute-only timestamp precision — cycle times will be
            # multiples of 60s and are meaningless; keep barcode values instead.
            minute_only = _sql_is_minute_precision(sql_result)

            if barcode_result:
                barcode_result['completedUnits']       = sql_result['completedUnits']
                barcode_result['completionTimestamps'] = sql_result['completionTimestamps']
                barcode_result['sqlUph']               = sql_result['overallUph']
                barcode_result['dataSource']           = 'sql'
                if not minute_only:
                    barcode_result['cycleTimeMedian']  = sql_result['cycleTimeMedian']
                    barcode_result['cycleTimeMean']    = sql_result['cycleTimeMean']
                    barcode_result['cycleTimeMax']     = sql_result['cycleTimeMax']
            else:
                # No barcode — build a minimal barcode-shaped result from SQL
                barcode_result = {
                    'completedUnits':       sql_result['completedUnits'],
                    'completionTimestamps': sql_result['completionTimestamps'],
                    'hourlyActivity':       sql_result['hourlyActivity'],
                    'firstEvent':           sql_result['firstEvent'],
                    'lastEvent':            sql_result['lastEvent'],
                    'cycleTimeMedian':      None if minute_only else sql_result['cycleTimeMedian'],
                    'cycleTimeMean':        None if minute_only else sql_result['cycleTimeMean'],
                    'cycleTimeMax':         None if minute_only else sql_result['cycleTimeMax'],
                    'sqlUph':               sql_result['overallUph'],
                    'totalEvents':          sql_result['completedUnits'],
                    'scanEvents':           0,
                    'events':               [],
                    'snDuplicates':         0,
                    'dataSource':           'sql',
                }
        elif barcode_result:
            barcode_result['dataSource'] = 'barcode'

        station_analyses.append({
            'station': station_info,
            'barcode': barcode_result,
            'errors': error_result,
            'sql': {k: v for k, v in sql_result.items() if k != 'units'} if sql_result else None,
        })
    
    # Run cross-station analysis
    cross_station = analyze_cross_station(all_errors)
    
    # Store results
    store["analysis_results"] = {
        'station_analyses': station_analyses,
        'cross_station': cross_station,
        'serial_analyses': serial_analyses,
        'all_events': all_events,
    }
    store["analysis_cached_at"] = time.time()
    
    return store["analysis_results"]


@router.get("/stations")
def get_stations():
    """Get list of stations with uploaded files."""
    result = []
    for station_code, station_data in store["stations"].items():
        result.append({
            'code': station_code,
            'name': STATIONS[station_code]['name'],
            'hasBarcode': 'barcode_content' in station_data,
            'hasError': 'error_content' in station_data,
            'hasSql': 'sql_content' in station_data,
            'barcodeFilename': station_data.get('barcode_filename'),
            'errorFilename': station_data.get('error_filename'),
            'sqlFilename': station_data.get('sql_filename'),
        })
    return {'stations': result}


@router.post("/reset")
def reset_analytics():
    """Clear all uploaded data and analysis results."""
    store["stations"] = {}
    store["analysis_results"] = None
    store["analysis_cached_at"] = None
    store["start_time_filter"] = None
    store["exclude_windows"] = []
    return {"status": "reset"}


@router.get("/results")
def get_results():
    """Get cached analysis results."""
    if store["analysis_results"] is None:
        return {}
    # Check expiry
    if store["analysis_cached_at"] and (time.time() - store["analysis_cached_at"]) > CACHE_EXPIRY_SEC:
        store["analysis_results"] = None
        store["analysis_cached_at"] = None
        return {}
    return store["analysis_results"]


@router.get("/results/status")
def get_results_status():
    """Get cache status info for the frontend."""
    if store["analysis_results"] is None or store["analysis_cached_at"] is None:
        return {"exists": False}

    age_sec = time.time() - store["analysis_cached_at"]
    remaining_sec = max(0, CACHE_EXPIRY_SEC - age_sec)

    if remaining_sec <= 0:
        store["analysis_results"] = None
        store["analysis_cached_at"] = None
        return {"exists": False, "expired": True}

    def fmt(sec):
        m = int(sec // 60)
        s = int(sec % 60)
        return f"{m}m {s}s" if m > 0 else f"{s}s"

    return {
        "exists": True,
        "expired": False,
        "age": int(age_sec * 1000),
        "ageStr": fmt(age_sec),
        "remaining": int(remaining_sec * 1000),
        "remainingStr": fmt(remaining_sec),
        "stations": list(store["stations"].keys()),
        "fileCount": sum(
            (1 if d.get("barcode_content") else 0)
            + (1 if d.get("error_content") else 0)
            + (1 if d.get("sql_content") else 0)
            for d in store["stations"].values()
        ),
    }


@router.delete("/results/cache")
def clear_results_cache():
    """Clear cached results without clearing uploaded files."""
    store["analysis_results"] = None
    store["analysis_cached_at"] = None
    return {"status": "cleared"}