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
import statistics

router = APIRouter(prefix="/analytics", tags=["analytics"])

# In-memory storage for uploaded files and analysis results
store: Dict[str, Any] = {
    "stations": {},  # station_code -> {barcode_content, error_content, sql_content}
    "analysis_results": None,
    "start_time_filter": None,
}

# Station definitions
STATIONS = {
    'BS': {'name': 'Bottom Shell', 'icon': '📦', 'color': '#818cf8', 'multiUp': 3},
    'BA': {'name': 'Battery', 'icon': '🔋', 'color': '#34d399'},
    'TR': {'name': 'Trans', 'icon': '🔄', 'color': '#f472b6'},
    'TO': {'name': 'Top Shell', 'icon': '🔝', 'color': '#fbbf24'},
    'LA': {'name': 'Laser', 'icon': '⚡', 'color': '#ef4444'},
    'FV': {'name': 'FVT', 'icon': '🧪', 'color': '#06b6d4'},
}


def parse_timestamp(ts_str: str, log_date: str = "2025-12-17") -> Optional[datetime]:
    """Parse timestamp string like '9:45:18 AM' or '09:45:18' (24h) into datetime."""
    try:
        ts_str = ts_str.strip()
        if 'AM' not in ts_str and 'PM' not in ts_str:
            return datetime.strptime(f"{log_date} {ts_str}", "%Y-%m-%d %H:%M:%S")
        if len(ts_str) > 0 and ts_str[1] == ':':
            ts_str = '0' + ts_str
        return datetime.strptime(f"{log_date} {ts_str}", "%Y-%m-%d %I:%M:%S %p")
    except:
        return None


def parse_barcode_log(content: str, station_code: str, start_filter: Optional[datetime] = None) -> Dict[str, Any]:
    """Parse barcode log and extract events and metrics."""
    lines = content.split('\n')
    ts_pattern = re.compile(r'^\[(\d{1,2}:\d{2}:\d{2} [AP]M)\](.*)')
    
    events = []
    all_timestamps = []
    sn_timestamps = []
    seen_sns = set()
    sn_counts = defaultdict(int)
    hourly_activity = defaultdict(int)
    
    for line_num, line in enumerate(lines, 1):
        match = ts_pattern.match(line.strip())
        if not match:
            continue
        
        ts_str, content_part = match.groups()
        ts = parse_timestamp(ts_str)
        if not ts:
            continue
        
        if start_filter and ts < start_filter:
            continue
        
        all_timestamps.append(ts)
        hour = ts.strftime('%H')
        hourly_activity[hour] += 1
        
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
            elif re.match(r'^\d+:', content_part):
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
            elif re.match(r'^\d+:', content_part):
                event_type = 'DB_Record'
                category = 'Database'
        elif station_code in ['TR', 'TO', 'LA']:
            if '+1,0,' in content_part or '+3,0,' in content_part:
                event_type = 'SN_Scan'
                category = 'Scan'
                if len(fields) > 2:
                    sn = fields[2]
            elif re.match(r'^\d+:', content_part):
                event_type = 'DB_Record'
                category = 'Database'
        elif station_code == 'FV':
            if 'SN' in content_part or 'Serial' in content_part:
                event_type = 'SN_Scan'
                category = 'Scan'
            elif 'PASS' in content_part or 'FAIL' in content_part:
                event_type = 'Test_Result'
                category = 'Process'
        
        # Track serial numbers
        if sn and sn not in seen_sns:
            seen_sns.add(sn)
            sn_timestamps.append(ts)
        if sn:
            sn_counts[sn] += 1
        
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
    
    # Calculate cycle times from SN scan intervals
    cycle_times = []
    if len(sn_timestamps) > 1:
        for i in range(1, len(sn_timestamps)):
            gap = (sn_timestamps[i] - sn_timestamps[i-1]).total_seconds()
            if 0 < gap < 300:  # Filter outliers
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
        'completedUnits': len(seen_sns),
        'snScans': len(seen_sns),
        'snDuplicates': len(duplicates),
        'snDuplicateList': [{'sn': sn, 'count': c} for sn, c in duplicates[:10]],
        'hourlyActivity': dict(hourly_activity),
        'firstEvent': all_timestamps[0].isoformat() if all_timestamps else None,
        'lastEvent': all_timestamps[-1].isoformat() if all_timestamps else None,
        'cycleTimeMedian': statistics.median(cycle_times) if cycle_times else None,
        'cycleTimeMean': statistics.mean(cycle_times) if cycle_times else None,
        'cycleTimeMax': max(cycle_times) if cycle_times else None,
        'snScanIntervalMedian': statistics.median(cycle_times) if cycle_times else None,
        'snScanIntervalMean': statistics.mean(cycle_times) if cycle_times else None,
    }


def parse_error_log(content: str, station_code: str, start_filter: Optional[datetime] = None) -> Dict[str, Any]:
    """Parse error log and extract error events with durations."""
    lines = content.split('\n')
    errors = []
    error_timeline = []
    pending_errors = {}
    
    # Different patterns for different stations
    if station_code in ['BS', 'BA']:
        if station_code == 'BS':
            pattern = re.compile(r'^\[(\d{1,2}:\d{2}:\d{2} [AP]M)\],?\s*\[([A-Z]+)\]\s*\[(\d+)\]\s*(.*)')
        else:
            pattern = re.compile(r'^\[(\d{1,2}:\d{2}:\d{2} [AP]M)\]\[([A-Z]+)\]\s*\[(\d+)\]\s*(.*)')
        
        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue
            
            ts_str, status, code, message = match.groups()
            ts = parse_timestamp(ts_str)
            if not ts:
                continue
            
            if start_filter and ts < start_filter:
                continue
            
            message = message.strip()
            if message == '(null)' or not message:
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
            ts = parse_timestamp(ts_str)
            if not ts:
                continue
            
            if start_filter and ts < start_filter:
                continue
            
            # Extract holding time if present
            holding_match = re.search(r'==> HOLDING TIME : \(\s*(\d+):(\d+):(\d+)\s*\)', message)
            duration_from_log = None
            if holding_match:
                h, m, s = map(int, holding_match.groups())
                duration_from_log = h * 3600 + m * 60 + s
                message = message.split('==>')[0].strip()
            
            error_key = f"{code}_{message}"
            
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
    
    # Calculate MTBF (Mean Time Between Failures)
    mtbf = None
    if len(error_timeline) > 1:
        times = sorted(e['startTimeMs'] for e in error_timeline)
        intervals = [(times[i] - times[i-1]) / 1000 / 60 for i in range(1, len(times))]
        if intervals:
            mtbf = {'minutes': statistics.mean(intervals), 'count': len(error_timeline)}
    
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


def analyze_serial(barcode_result: Dict, station_code: str) -> Optional[Dict[str, Any]]:
    """Analyze serial-by-serial cycle times."""
    events = barcode_result.get('events', [])
    
    # Filter to SN scan events only
    sn_events = [e for e in events if e.get('sn') and e.get('category') == 'Scan']
    
    if len(sn_events) < 2:
        return None
    
    # Build units list with gaps
    units = []
    seen_sns = set()
    
    for i, event in enumerate(sn_events):
        sn = event.get('sn')
        if sn in seen_sns:
            continue
        seen_sns.add(sn)
        
        time_ms = event.get('timeMs', 0)
        gap = 0
        if units:
            gap = (time_ms - units[-1]['timeMs']) / 1000
        
        units.append({
            'n': len(units) + 1,
            'time': event.get('timeStr', ''),
            'timeMs': time_ms,
            'sn': sn,
            'gap': int(gap),
            'isStoppage': gap > 60,
            'isBuffer': gap < 30 and gap > 0,
        })
    
    if len(units) < 2:
        return None
    
    # Calculate stats
    gaps = [u['gap'] for u in units[1:] if u['gap'] > 0]
    
    # Identify production runs (gaps > 60s indicate stoppages)
    runs = []
    run_start = 0
    run_number = 0
    
    for i, unit in enumerate(units):
        if unit['isStoppage'] or i == len(units) - 1:
            if i > run_start:
                run_number += 1
                run_units = units[run_start:i] if unit['isStoppage'] else units[run_start:i+1]
                if len(run_units) > 0:
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
            run_start = i
    
    return {
        'station': {
            'code': station_code,
            'name': STATIONS[station_code]['name'],
            'icon': STATIONS[station_code]['icon'],
            'color': STATIONS[station_code]['color'],
        },
        'units': units,
        'runs': runs,
        'stats': {
            'totalUnits': len(units),
            'minGap': min(gaps) if gaps else 0,
            'maxGap': max(gaps) if gaps else 0,
            'medianGap': statistics.median(gaps) if gaps else 0,
            'meanGap': statistics.mean(gaps) if gaps else 0,
            'stoppages': len([u for u in units if u['isStoppage']]),
            'bufferClears': len([u for u in units if u['isBuffer']]),
            'totalStoppageTime': sum(u['gap'] for u in units if u['isStoppage']),
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
def run_analysis(start_time: Optional[str] = None):
    """Run full analysis across all uploaded stations."""
    
    # Parse start time filter
    start_filter = None
    if start_time:
        start_filter = parse_timestamp(start_time)
        store["start_time_filter"] = start_time
    
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
        
        # Parse barcode log if available
        if station_data.get('barcode_content'):
            barcode_result = parse_barcode_log(
                station_data['barcode_content'],
                station_code,
                start_filter
            )
            all_events.extend(barcode_result.get('events', []))
            
            # Run serial analysis
            serial = analyze_serial(barcode_result, station_code)
            if serial:
                serial_analyses.append(serial)
        
        # Parse error log if available
        if station_data.get('error_content'):
            error_result = parse_error_log(
                station_data['error_content'],
                station_code,
                start_filter
            )
            # Add station info to errors for cross-station analysis
            for err in error_result.get('errorTimeline', []):
                err['station'] = STATIONS[station_code]['name']
                all_errors.append(err)
        
        station_analyses.append({
            'station': station_info,
            'barcode': barcode_result,
            'errors': error_result,
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
    store["start_time_filter"] = None
    return {"status": "reset"}


@router.get("/results")
def get_results():
    """Get cached analysis results."""
    if store["analysis_results"] is None:
        raise HTTPException(status_code=404, detail="No analysis results available. Run /analyze first.")
    return store["analysis_results"]