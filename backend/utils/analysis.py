"""
Analysis module for finding data issues and generating change proposals.

Each change has:
- id: unique identifier
- issue_type: DUPLICATE_INSERT | MISSING_PSA_TAPE | ORPHAN_ROW | INDEX_MISMATCH
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
    sql_data: list[dict]
) -> list[dict]:
    """
    Run all analysis and return change proposals.
    
    Args:
        mmi_events: Parsed MMI log events
        sql_data: Parsed SQL export rows
    
    Returns:
        List of change proposals with before/after states
    """
    changes = []
    
    # Issue #1: Missing PSA Tape Picture
    changes.extend(find_missing_psa_tape(mmi_events, sql_data))
    
    # Issue #2: Duplicate rows (overlapped events)
    changes.extend(find_duplicate_rows(mmi_events, sql_data))
    
    # Issue #3: Orphan rows (missing SN & PRS)
    changes.extend(find_orphan_rows(mmi_events, sql_data))
    
    # Issue #4: Index mismatch
    changes.extend(find_index_mismatches(mmi_events, sql_data))
    
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


def find_index_mismatches(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue #4: Find rows where PSA image indices are mismatched.
    
    The POWER_BOARD_PSA_PIC and BATTERY_PSA_PIC should have sequential indices
    from the same camera batch. Large gaps indicate a mismatch.
    """
    changes = []
    
    for row in sql_data:
        row_id = row.get("ID")
        
        power_psa = row.get("POWER_BOARD_PSA_PIC") or ""
        battery_psa = row.get("BATTERY_PSA_PIC") or ""
        
        if power_psa and battery_psa:
            # Extract indices from image names (e.g., "20251106_BaCAM2_0028" -> 28)
            power_match = re.search(r"_(\d+)$", str(power_psa))
            battery_match = re.search(r"_(\d+)$", str(battery_psa))
            
            if power_match and battery_match:
                power_idx = int(power_match.group(1))
                battery_idx = int(battery_match.group(1))
                
                # They should be close (within 5 or so)
                gap = abs(power_idx - battery_idx)
                
                if gap > 10:
                    timestamp = _extract_time(row.get("DATE"))
                    
                    # Find camera events in MMI for evidence
                    cam_events = _find_camera_events_near_time(mmi_events, timestamp)
                    
                    # Try to determine the correct index
                    # Usually BATTERY should be 1 more than POWER for same board
                    expected_battery_idx = power_idx + 1
                    expected_battery_psa = re.sub(r"_\d+$", f"_{expected_battery_idx:04d}", str(power_psa))
                    
                    sql_after = dict(row)
                    sql_after["BATTERY_PSA_PIC"] = expected_battery_psa
                    
                    changes.append({
                        "id": f"mismatch_{row_id}",
                        "issue_type": "INDEX_MISMATCH",
                        "description": f"Row {row_id}: POWER_PSA index ({power_idx}) vs BATTERY_PSA index ({battery_idx}) gap of {gap}",
                        "timestamp": timestamp,
                        "action": "UPDATE",
                        "sql_row_id": row_id,
                        "sql_before": _clean_row(row),
                        "sql_after": _clean_row(sql_after),
                        "power_index": power_idx,
                        "battery_index": battery_idx,
                        "suggested_battery_index": expected_battery_idx,
                        "mmi_evidence": [e["raw"] for e in cam_events],
                        "mmi_line_numbers": [e["line_number"] for e in cam_events],
                        "status": "pending"
                    })
    
    return changes


# === Helper Functions ===

def _extract_time(date_value) -> str:
    """Extract time string from datetime value in HH:MM:SS format"""
    if date_value is None:
        return ""
    if hasattr(date_value, 'strftime'):
        return date_value.strftime("%H:%M:%S")
    # Try to parse from string
    s = str(date_value)
    if " " in s:
        return s.split(" ")[1].split(".")[0]
    return s


def _normalize_time(t: str) -> int:
    """Convert time string to seconds since midnight, handling AM/PM format"""
    t = t.strip().upper()
    is_pm = "PM" in t
    is_am = "AM" in t
    
    # Remove AM/PM
    t = t.replace("AM", "").replace("PM", "").strip()
    
    # Split into parts
    parts = t.replace(".", ":").split(":")[:3]
    if len(parts) < 3:
        return 0
    
    try:
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2].split(".")[0]) if parts[2] else 0
        
        # Handle 12-hour format
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
    cleaned = {}
    for k, v in row.items():
        if pd.isna(v):
            cleaned[k] = None
        elif hasattr(v, 'isoformat'):
            cleaned[k] = v.isoformat()
        else:
            cleaned[k] = v
    return cleaned