"""
Analysis module for finding data issues and generating change proposals.

Each change has:
- id: unique identifier
- issue_type: One of:
    - DUPLICATE_INSERT: Overlapped events (Battery #2)
    - MISSING_PSA_TAPE: Missing PSA tape picture path (Battery #1)
    - ORPHAN_ROW: Missing SN & PRS with PSA images (Battery #3)
    - INDEX_MISMATCH: Mismatched PSA image indices - Camera 2 (Battery #4)
    - ERROR_EVENT_MISMATCH: SQL/MMI error event discrepancy (Battery #5)
    - REPEATED_INSERT: Same content logged multiple times (PCBA #1)
- description: human readable description
- timestamp: when the issue occurred
- action: DELETE | UPDATE | FLAG
- sql_row_id: the ID field from SQL data (if applicable)
- sql_before: dict of row data before change
- sql_after: dict of row data after change (null for DELETE)
- mmi_evidence: list of relevant MMI log lines
- mmi_line_numbers: list of line numbers for highlighting
- status: pending | approved | rejected
"""

import re
from typing import Optional
import pandas as pd

from .sql_parser import parse_insert_values, compare_rows
from .mmi_parser import find_events_near_timestamp


def find_all_issues(
    mmi_events: list[dict], 
    sql_data: list[dict],
    sql_error_data: list[dict] = None
) -> list[dict]:
    """
    Run all analysis and return change proposals.
    
    Args:
        mmi_events: Parsed MMI log events
        sql_data: Parsed SQL export rows (main data table)
        sql_error_data: Parsed SQL error table rows (optional, for OEE analysis)
    
    Returns:
        List of change proposals with before/after states
    """
    changes = []
    
    # Issue #1: Missing PSA Tape Picture (Battery #1)
    changes.extend(find_missing_psa_tape(mmi_events, sql_data))
    
    # Issue #2: Duplicate rows / overlapped events (Battery #2)
    changes.extend(find_duplicate_rows(mmi_events, sql_data))
    
    # Issue #3: Orphan rows / missing SN & PRS (Battery #3)
    changes.extend(find_orphan_rows(mmi_events, sql_data))
    
    # Issue #4: Camera 2 index mismatch (Battery #4) - UPDATED
    changes.extend(find_cam2_index_mismatches(mmi_events, sql_data))
    
    # Issue #5: Error event mismatch between SQL and MMI (Battery #5)
    if sql_error_data:
        changes.extend(find_error_event_mismatches(mmi_events, sql_error_data))
    
    # Issue #6: Repeated INSERT statements (PCBA #1)
    changes.extend(find_repeated_inserts(mmi_events, sql_data))
    
    return changes


def find_missing_psa_tape(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue #1: Find rows where PSA_TAPE_PIC is empty but should have a value.
    
    The fix is to look in the MMI log for the +4 event (CAM4_PSA_TAPE) 
    that should have been recorded.
    """
    changes = []
    
    # Build a lookup of PSA tape images from MMI by approximate timestamp
    psa_tape_events = [e for e in mmi_events if e["event_type"] == "CAM4_PSA_TAPE"]
    
    for row in sql_data:
        psa_tape = row.get("PSA_TAPE_PIC")
        row_id = row.get("ID")
        
        # Check if PSA_TAPE_PIC is empty/null
        if pd.isna(psa_tape) or psa_tape == "" or psa_tape is None:
            # Has other data? (not a completely empty row)
            has_data = row.get("POWER_BOARD_SN") or row.get("BATTERY_SN")
            
            if has_data:
                # Try to find the correct PSA tape image from MMI
                timestamp = _extract_time(row.get("DATE"))
                suggested_image = None
                evidence_events = []
                
                # Look for CAM4 events near this timestamp
                for event in psa_tape_events:
                    event_time = event["timestamp"]
                    if _times_close(event_time, timestamp, window_seconds=60):
                        suggested_image = event["data"].get("image")
                        evidence_events.append(event)
                        break
                
                # Also find the INSERT statement in MMI for evidence
                insert_events = _find_inserts_near_time(mmi_events, timestamp)
                evidence_events.extend(insert_events)
                
                sql_after = dict(row)
                sql_after["PSA_TAPE_PIC"] = suggested_image
                
                changes.append({
                    "id": f"missing_psa_{row_id}",
                    "issue_type": "MISSING_PSA_TAPE",
                    "description": f"PSA_TAPE_PIC is empty for row {row_id}",
                    "timestamp": timestamp,
                    "action": "UPDATE" if suggested_image else "FLAG",
                    "sql_row_id": row_id,
                    "sql_before": _clean_row(row),
                    "sql_after": _clean_row(sql_after) if suggested_image else None,
                    "suggested_value": suggested_image,
                    "mmi_evidence": [e["raw"] for e in evidence_events],
                    "mmi_line_numbers": [e["line_number"] for e in evidence_events],
                    "status": "pending"
                })
    
    return changes


def find_duplicate_rows(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue #2: Find consecutive duplicate rows (overlapped events).
    
    These occur when the PLC trigger fires twice due to async issues.
    The fix is to delete the duplicate row.
    """
    changes = []
    
    for i in range(1, len(sql_data)):
        curr = sql_data[i]
        prev = sql_data[i - 1]
        
        # Check if same timestamp and same data (excluding ID)
        curr_time = str(curr.get("DATE"))
        prev_time = str(prev.get("DATE"))
        
        if curr_time == prev_time:
            # Compare key fields
            same_data = (
                curr.get("POWER_BOARD_SN") == prev.get("POWER_BOARD_SN") and
                curr.get("BATTERY_SN") == prev.get("BATTERY_SN") and
                curr.get("PSA_TAPE_PIC") == prev.get("PSA_TAPE_PIC")
            )
            
            if same_data:
                row_id = curr.get("ID")
                prev_id = prev.get("ID")
                timestamp = _extract_time(curr.get("DATE"))
                
                # Find the duplicate INSERT statements in MMI
                insert_events = _find_inserts_near_time(mmi_events, timestamp)
                
                changes.append({
                    "id": f"duplicate_{row_id}",
                    "issue_type": "DUPLICATE_INSERT",
                    "description": f"Row {row_id} is duplicate of {prev_id} at {timestamp}",
                    "timestamp": timestamp,
                    "action": "DELETE",
                    "sql_row_id": row_id,
                    "sql_before": _clean_row(curr),
                    "sql_after": None,  # DELETE means row goes away
                    "duplicate_of": prev_id,
                    "mmi_evidence": [e["raw"] for e in insert_events],
                    "mmi_line_numbers": [e["line_number"] for e in insert_events],
                    "status": "pending"
                })
    
    return changes


def find_orphan_rows(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue #3: Find rows with PSA images but no serial numbers (data shift).
    
    These occur when PLC flag 6101 fires twice, causing blank data to be recorded.
    """
    changes = []
    
    for row in sql_data:
        row_id = row.get("ID")
        
        # Check for missing serial numbers
        no_power_sn = pd.isna(row.get("POWER_BOARD_SN")) or row.get("POWER_BOARD_SN") == ""
        no_battery_sn = pd.isna(row.get("BATTERY_SN")) or row.get("BATTERY_SN") == ""
        
        # Check for presence of PSA images
        has_psa_tape = not pd.isna(row.get("PSA_TAPE_PIC")) and row.get("PSA_TAPE_PIC") != ""
        has_power_psa = not pd.isna(row.get("POWER_BOARD_PSA_PIC")) and row.get("POWER_BOARD_PSA_PIC") != ""
        has_battery_psa = not pd.isna(row.get("BATTERY_PSA_PIC")) and row.get("BATTERY_PSA_PIC") != ""
        
        has_any_psa = has_psa_tape or has_power_psa or has_battery_psa
        
        if no_power_sn and no_battery_sn and has_any_psa:
            timestamp = _extract_time(row.get("DATE"))
            
            # Find INSERT statements in MMI
            insert_events = _find_inserts_near_time(mmi_events, timestamp)
            
            changes.append({
                "id": f"orphan_{row_id}",
                "issue_type": "ORPHAN_ROW",
                "description": f"Row {row_id} has PSA images but no serial numbers",
                "timestamp": timestamp,
                "action": "DELETE",  # or FLAG - user can decide
                "sql_row_id": row_id,
                "sql_before": _clean_row(row),
                "sql_after": None,
                "mmi_evidence": [e["raw"] for e in insert_events],
                "mmi_line_numbers": [e["line_number"] for e in insert_events],
                "status": "pending"
            })
    
    return changes


def find_cam2_index_mismatches(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue #4 (Battery #4): Find Camera 2 image index mismatches.
    
    Camera 2 captures images in a specific sequence:
    - Within a unit: PSA_image_index = SN_image_index + 6
    - Between units: next_unit_SN_index = current_unit_SN_index + 6
    
    This detects when the indices don't follow this pattern, indicating
    data was recorded for the wrong unit or images got misaligned.
    """
    changes = []
    EXPECTED_GAP = 6  # The interval between SN image and PSA image should be +6
    
    for row in sql_data:
        row_id = row.get("ID")
        timestamp = _extract_time(row.get("DATE"))
        
        # Extract indices from image names
        pb_sn_idx = _extract_image_index(row.get("POWER_BOARD_SN_PIC"))
        pb_psa_idx = _extract_image_index(row.get("POWER_BOARD_PSA_PIC"))
        bt_sn_idx = _extract_image_index(row.get("BATTERY_SN_PIC"))
        bt_psa_idx = _extract_image_index(row.get("BATTERY_PSA_PIC"))
        
        # Check Power Board: SN to PSA gap should be +6
        if pb_sn_idx is not None and pb_psa_idx is not None:
            pb_gap = pb_psa_idx - pb_sn_idx
            if pb_gap != EXPECTED_GAP:
                expected_idx = pb_sn_idx + EXPECTED_GAP
                
                # Find camera events in MMI for evidence
                cam_events = _find_camera_events_near_time(mmi_events, timestamp)
                
                sql_after = dict(row)
                # Suggest the correct PSA image name
                pb_sn_pic = row.get("POWER_BOARD_SN_PIC", "")
                suggested_psa = re.sub(r"_\d+$", f"_{expected_idx:04d}", str(pb_sn_pic))
                sql_after["POWER_BOARD_PSA_PIC"] = suggested_psa
                
                changes.append({
                    "id": f"cam2_pb_mismatch_{row_id}",
                    "issue_type": "INDEX_MISMATCH",
                    "description": f"Row {row_id}: Power Board PSA index {pb_psa_idx} should be {expected_idx} (SN index={pb_sn_idx}, gap={pb_gap}, expected +{EXPECTED_GAP})",
                    "timestamp": timestamp,
                    "action": "UPDATE",
                    "sql_row_id": row_id,
                    "sql_before": _clean_row(row),
                    "sql_after": _clean_row(sql_after),
                    "field": "POWER_BOARD_PSA_PIC",
                    "current_index": pb_psa_idx,
                    "expected_index": expected_idx,
                    "sn_index": pb_sn_idx,
                    "gap": pb_gap,
                    "mmi_evidence": [e["raw"] for e in cam_events[:5]],
                    "mmi_line_numbers": [e["line_number"] for e in cam_events[:5]],
                    "status": "pending"
                })
        
        # Check Battery: SN to PSA gap should be +6
        if bt_sn_idx is not None and bt_psa_idx is not None:
            bt_gap = bt_psa_idx - bt_sn_idx
            if bt_gap != EXPECTED_GAP:
                expected_idx = bt_sn_idx + EXPECTED_GAP
                
                # Find camera events in MMI for evidence
                cam_events = _find_camera_events_near_time(mmi_events, timestamp)
                
                sql_after = dict(row)
                # Suggest the correct PSA image name
                bt_sn_pic = row.get("BATTERY_SN_PIC", "")
                suggested_psa = re.sub(r"_\d+$", f"_{expected_idx:04d}", str(bt_sn_pic))
                sql_after["BATTERY_PSA_PIC"] = suggested_psa
                
                changes.append({
                    "id": f"cam2_bt_mismatch_{row_id}",
                    "issue_type": "INDEX_MISMATCH",
                    "description": f"Row {row_id}: Battery PSA index {bt_psa_idx} should be {expected_idx} (SN index={bt_sn_idx}, gap={bt_gap}, expected +{EXPECTED_GAP})",
                    "timestamp": timestamp,
                    "action": "UPDATE",
                    "sql_row_id": row_id,
                    "sql_before": _clean_row(row),
                    "sql_after": _clean_row(sql_after),
                    "field": "BATTERY_PSA_PIC",
                    "current_index": bt_psa_idx,
                    "expected_index": expected_idx,
                    "sn_index": bt_sn_idx,
                    "gap": bt_gap,
                    "mmi_evidence": [e["raw"] for e in cam_events[:5]],
                    "mmi_line_numbers": [e["line_number"] for e in cam_events[:5]],
                    "status": "pending"
                })
    
    return changes


# Keep the old function name as alias for backward compatibility
def find_index_mismatches(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """Alias for find_cam2_index_mismatches for backward compatibility."""
    return find_cam2_index_mismatches(mmi_events, sql_data)


def find_error_event_mismatches(mmi_events: list[dict], sql_error_data: list[dict]) -> list[dict]:
    """
    Issue #5 (Battery #5): Find discrepancies between SQL error table and MMI error logs.
    
    Detects:
    - Events recorded only in SQL (not in MMI)
    - Clear time not updated in SQL
    - Event logged once in MMI but twice in SQL
    - Clear event missing in SQL
    """
    changes = []
    
    # Extract ERROR events from MMI log
    mmi_errors = [e for e in mmi_events if e["event_type"] == "ERROR" or "ERROR" in e.get("content", "").upper()]
    
    # Build lookup of MMI error events by approximate time and error code
    mmi_error_map = {}
    for event in mmi_errors:
        timestamp = event["timestamp"]
        error_code = _extract_error_code(event.get("content", ""))
        key = f"{error_code}_{timestamp[:5]}"
        if key not in mmi_error_map:
            mmi_error_map[key] = []
        mmi_error_map[key].append(event)
    
    # Track which SQL errors we've seen
    sql_error_by_time = {}
    
    for i, row in enumerate(sql_error_data):
        row_id = row.get("ID") or i
        error_code = row.get("ERROR_CODE") or row.get("ALARM_CODE") or row.get("CODE")
        set_time = row.get("SET_TIME") or row.get("START_TIME") or row.get("OCCUR_TIME")
        clear_time = row.get("CLEAR_TIME") or row.get("END_TIME") or row.get("RESET_TIME")
        
        timestamp = _extract_time(set_time)
        key = f"{error_code}_{timestamp[:5]}" if timestamp else f"{error_code}_"
        
        # Check for duplicate SQL entries
        dup_key = f"{error_code}_{timestamp}"
        if dup_key in sql_error_by_time:
            prev_row_id = sql_error_by_time[dup_key]
            related_mmi = mmi_error_map.get(key, [])
            
            changes.append({
                "id": f"error_dup_sql_{row_id}",
                "issue_type": "ERROR_EVENT_MISMATCH",
                "description": f"Error {error_code} logged twice in SQL at {timestamp} (duplicate of row {prev_row_id})",
                "timestamp": timestamp,
                "action": "DELETE",
                "sql_row_id": row_id,
                "sql_before": _clean_row(row),
                "sql_after": None,
                "duplicate_of": prev_row_id,
                "mismatch_type": "DUPLICATE_IN_SQL",
                "mmi_evidence": [e["raw"] for e in related_mmi[:5]],
                "mmi_line_numbers": [e["line_number"] for e in related_mmi[:5]],
                "status": "pending"
            })
        else:
            sql_error_by_time[dup_key] = row_id
        
        # Check if error exists in MMI
        mmi_matches = mmi_error_map.get(key, [])
        
        if not mmi_matches:
            changes.append({
                "id": f"error_sql_only_{row_id}",
                "issue_type": "ERROR_EVENT_MISMATCH",
                "description": f"Error {error_code} at {timestamp} exists in SQL but not found in MMI log",
                "timestamp": timestamp,
                "action": "FLAG",
                "sql_row_id": row_id,
                "sql_before": _clean_row(row),
                "sql_after": None,
                "mismatch_type": "SQL_ONLY",
                "mmi_evidence": [],
                "mmi_line_numbers": [],
                "status": "pending"
            })
        
        # Check for missing clear time
        if set_time and (pd.isna(clear_time) or clear_time is None or clear_time == ""):
            clear_events = _find_error_clear_events(mmi_events, error_code, timestamp)
            
            suggested_clear_time = None
            if clear_events:
                suggested_clear_time = clear_events[0]["timestamp"]
            
            sql_after = dict(row)
            if suggested_clear_time:
                sql_after["CLEAR_TIME"] = suggested_clear_time
            
            changes.append({
                "id": f"error_no_clear_{row_id}",
                "issue_type": "ERROR_EVENT_MISMATCH",
                "description": f"Error {error_code} at {timestamp} has no clear time in SQL",
                "timestamp": timestamp,
                "action": "UPDATE" if suggested_clear_time else "FLAG",
                "sql_row_id": row_id,
                "sql_before": _clean_row(row),
                "sql_after": _clean_row(sql_after) if suggested_clear_time else None,
                "suggested_clear_time": suggested_clear_time,
                "mismatch_type": "MISSING_CLEAR_TIME",
                "mmi_evidence": [e["raw"] for e in clear_events[:3]],
                "mmi_line_numbers": [e["line_number"] for e in clear_events[:3]],
                "status": "pending"
            })
    
    return changes


def find_repeated_inserts(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue #6 (PCBA #1): Find identical content logged multiple times in rapid succession.
    """
    changes = []
    
    insert_events = [e for e in mmi_events if e["event_type"] == "SQL_INSERT"]
    
    if len(insert_events) < 2:
        return changes
    
    i = 0
    while i < len(insert_events):
        current = insert_events[i]
        current_values = current["data"].get("values", "")
        
        group = [current]
        j = i + 1
        
        while j < len(insert_events):
            next_event = insert_events[j]
            next_values = next_event["data"].get("values", "")
            
            if next_values == current_values and _times_close(
                current["timestamp"], 
                next_event["timestamp"], 
                window_seconds=30
            ):
                group.append(next_event)
                j += 1
            else:
                break
        
        if len(group) >= 3:
            timestamp = current["timestamp"]
            affected_rows = []
            
            for row in sql_data:
                row_time = _extract_time(row.get("DATE"))
                if _times_close(row_time, timestamp, window_seconds=60):
                    affected_rows.append(row)
            
            for k, event in enumerate(group[1:], start=1):
                matched_row = None
                if k < len(affected_rows):
                    matched_row = affected_rows[k]
                
                row_id = matched_row.get("ID") if matched_row else None
                
                changes.append({
                    "id": f"repeated_{event['line_number']}",
                    "issue_type": "REPEATED_INSERT",
                    "description": f"INSERT repeated {len(group)} times at {timestamp} (occurrence {k+1} of {len(group)})",
                    "timestamp": event["timestamp"],
                    "action": "DELETE" if matched_row else "FLAG",
                    "sql_row_id": row_id,
                    "sql_before": _clean_row(matched_row) if matched_row else None,
                    "sql_after": None,
                    "repeat_count": len(group),
                    "occurrence": k + 1,
                    "first_line_number": group[0]["line_number"],
                    "mmi_evidence": [e["raw"] for e in group[:10]],
                    "mmi_line_numbers": [e["line_number"] for e in group[:10]],
                    "status": "pending"
                })
        
        i = j
    
    return changes


# ============== Helper Functions ==============

def _extract_image_index(img_name) -> Optional[int]:
    """Extract the numeric index from an image filename like '20251217_BaCAM2_0005'"""
    if pd.isna(img_name) or not img_name:
        return None
    match = re.search(r"_(\d+)$", str(img_name))
    return int(match.group(1)) if match else None


def _extract_time(date_value) -> str:
    """Extract time string from datetime value in HH:MM:SS format"""
    if date_value is None:
        return ""
    if hasattr(date_value, 'strftime'):
        return date_value.strftime("%H:%M:%S")
    s = str(date_value)
    if " " in s:
        return s.split(" ")[1].split(".")[0]
    return s


def _normalize_time(t: str) -> int:
    """Convert time string to seconds since midnight, handling AM/PM format"""
    t = t.strip().upper()
    is_pm = "PM" in t
    is_am = "AM" in t
    
    t = t.replace("AM", "").replace("PM", "").strip()
    
    parts = t.replace(".", ":").split(":")[:3]
    if len(parts) < 3:
        return 0
    
    try:
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2].split(".")[0]) if parts[2] else 0
        
        if is_pm and hour != 12:
            hour += 12
        elif is_am and hour == 12:
            hour = 0
        
        return hour * 3600 + minute * 60 + second
    except:
        return 0


def _times_close(t1: str, t2: str, window_seconds: int = 5) -> bool:
    """Check if two time strings are within window_seconds of each other"""
    try:
        secs1 = _normalize_time(t1)
        secs2 = _normalize_time(t2)
        return abs(secs1 - secs2) <= window_seconds
    except:
        return False


def _find_inserts_near_time(events: list[dict], timestamp: str) -> list[dict]:
    """Find SQL INSERT events near a given timestamp"""
    result = []
    for event in events:
        if event["event_type"] == "SQL_INSERT":
            if _times_close(event["timestamp"], timestamp, window_seconds=10):
                result.append(event)
    return result


def _find_camera_events_near_time(events: list[dict], timestamp: str) -> list[dict]:
    """Find camera events (CAM2, CAM3, CAM4) near a given timestamp"""
    result = []
    cam_types = ["CAM2_SN", "CAM3_PRS", "CAM4_PSA_TAPE", "CAM2_PSA_POWER", "CAM2_PSA_BATTERY"]
    for event in events:
        if event["event_type"] in cam_types:
            if _times_close(event["timestamp"], timestamp, window_seconds=30):
                result.append(event)
    return result


def _clean_row(row: dict) -> dict:
    """Clean a row dict for JSON serialization"""
    if row is None:
        return None
    cleaned = {}
    for k, v in row.items():
        if pd.isna(v):
            cleaned[k] = None
        elif hasattr(v, 'isoformat'):
            cleaned[k] = v.isoformat()
        else:
            cleaned[k] = v
    return cleaned


def _extract_error_code(content: str) -> str:
    """Extract error code from MMI log content"""
    if not content:
        return ""
    
    match = re.search(r"ERROR[_:]?\s*(\d+)", content, re.IGNORECASE)
    if match:
        return match.group(1)
    
    match = re.search(r"ALARM[:\s]*(\d+)", content, re.IGNORECASE)
    if match:
        return match.group(1)
    
    match = re.search(r"\[(\d{4,})\]", content)
    if match:
        return match.group(1)
    
    match = re.search(r"^\s*(\d{4,})", content)
    if match:
        return match.group(1)
    
    return ""


def _find_error_clear_events(events: list[dict], error_code: str, after_timestamp: str) -> list[dict]:
    """Find error clear/reset events for a given error code after a timestamp"""
    result = []
    after_secs = _normalize_time(after_timestamp)
    
    for event in events:
        content = event.get("content", "").upper()
        event_secs = _normalize_time(event["timestamp"])
        
        if event_secs <= after_secs:
            continue
        
        is_clear = any(word in content for word in ["CLEAR", "RESET", "END", "RESOLVED", "OFF"])
        has_code = error_code in content if error_code else True
        
        if is_clear and has_code:
            result.append(event)
    
    return result