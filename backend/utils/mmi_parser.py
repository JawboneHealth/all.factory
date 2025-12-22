import re
from typing import Optional


def parse_mmi_log(content: str) -> list[dict]:
    """Parse MMI log into structured events with full context"""
    events = []
    lines = content.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        
        match = re.match(r'\[([^\]]+)\](.+)', line)
        if match:
            time_str = match.group(1)
            event_content = match.group(2)
            
            event = {
                "line_number": i + 1,
                "timestamp": time_str,
                "raw": line,
                "content": event_content,
                "event_type": _classify(event_content),
                "data": _extract_data(event_content)
            }
            events.append(event)
    
    return events


def _classify(content: str) -> str:
    """Classify event type from content"""
    content_upper = content.upper()
    
    if "MMI START" in content_upper:
        return "MMI_START"
    if "insert into" in content.lower():
        return "SQL_INSERT"
    if content.startswith("+2,"):
        # Camera 2 - Serial number read
        return "CAM2_SN"
    if content.startswith("+3,"):
        # Camera 3 - PRS measurement
        return "CAM3_PRS"
    if content.startswith("+4,"):
        # Camera 4 - PSA tape image
        return "CAM4_PSA_TAPE"
    if content.startswith("+5,"):
        # Camera 2 - Power board PSA
        return "CAM2_PSA_POWER"
    if content.startswith("+6,"):
        # Camera 2 - Battery PSA
        return "CAM2_PSA_BATTERY"
    if "PLC DM" in content_upper:
        return "PLC_DM"
    if "TOTAL LOG" in content_upper:
        return "TOTAL_LOG"
    
    # Error event classification (for OEE tracking)
    if "ERROR" in content_upper or "ALARM" in content_upper:
        if any(word in content_upper for word in ["CLEAR", "RESET", "END", "RESOLVED", "OFF"]):
            return "ERROR_CLEAR"
        else:
            return "ERROR"
    
    # PLC flag events (for detecting 6101 issues)
    if "6101" in content or "FLAG" in content_upper:
        return "PLC_FLAG"
    
    return "OTHER"


def _extract_data(content: str) -> dict:
    """Extract structured data from event content"""
    data = {}
    
    if "insert into" in content.lower():
        # Extract VALUES clause
        match = re.search(r"VALUES\s*\(([^)]+)\)", content, re.IGNORECASE)
        if match:
            data["values"] = match.group(1)
            data["parsed_values"] = _parse_values_string(match.group(1))
    
    elif content.startswith("+2,"):
        # +2,OK,SERIAL_NUMBER,IMAGE_PATH
        parts = content.split(",")
        if len(parts) >= 4:
            data["status"] = parts[1]
            data["serial"] = parts[2]
            data["image"] = parts[3] if len(parts) > 3 else ""
    
    elif content.startswith("+3,"):
        # +3,OK,val1,val2,val3,IMAGE_PATH
        parts = content.split(",")
        if len(parts) >= 6:
            data["status"] = parts[1]
            data["prs_values"] = f"{parts[2]},{parts[3]},{parts[4]}"
            data["image"] = parts[5] if len(parts) > 5 else ""
    
    elif content.startswith("+4,"):
        # +4,OK,IMAGE_PATH (PSA tape)
        parts = content.split(",")
        if len(parts) >= 3:
            data["status"] = parts[1]
            data["image"] = parts[2]
    
    elif content.startswith("+5,"):
        # +5,OK,IMAGE_PATH (Power board PSA)
        parts = content.split(",")
        if len(parts) >= 3:
            data["status"] = parts[1]
            data["image"] = parts[2]
    
    elif content.startswith("+6,"):
        # +6,OK,IMAGE_PATH (Battery PSA)
        parts = content.split(",")
        if len(parts) >= 3:
            data["status"] = parts[1]
            data["image"] = parts[2]
    
    return data


def _parse_values_string(values_str: str) -> dict:
    """Parse VALUES(...) string into field dict"""
    fields = [
        "DATE", "LOTID", "PSA_TAPE_PIC",
        "POWER_BOARD_SN", "POWER_BOARD_SN_PIC",
        "POWER_BOARD_PRS", "POWER_BOARD_PRS_PIC", "POWER_BOARD_PSA_PIC",
        "BATTERY_SN", "BATTERY_SN_PIC",
        "BATTERY_PRS", "BATTERY_PRS_PIC", "BATTERY_PSA_PIC",
        "TEMP", "HUMIDITY"
    ]
    
    parts = []
    current = ""
    in_quotes = False
    
    for char in values_str:
        if char == "'" and not in_quotes:
            in_quotes = True
        elif char == "'" and in_quotes:
            in_quotes = False
        elif char == "," and not in_quotes:
            parts.append(current.strip().strip("'"))
            current = ""
        else:
            current += char
    parts.append(current.strip().strip("'"))
    
    return dict(zip(fields, parts))


def find_psa_tape_image(events: list[dict], timestamp: str) -> Optional[str]:
    """Find the PSA tape image path near a given timestamp"""
    # Look for +4 events (CAM4_PSA_TAPE) near this timestamp
    for event in events:
        if event["event_type"] == "CAM4_PSA_TAPE":
            if event["timestamp"] <= timestamp:
                image = event["data"].get("image", "")
                if image:
                    return image
    return None


def find_events_near_timestamp(events: list[dict], timestamp: str, window_seconds: int = 5) -> list[dict]:
    """Find all events within a time window of given timestamp"""
    # Simple string comparison for now (assumes HH:MM:SS format)
    nearby = []
    for event in events:
        if abs(_time_diff(event["timestamp"], timestamp)) <= window_seconds:
            nearby.append(event)
    return nearby


def _time_diff(t1: str, t2: str) -> int:
    """Calculate approximate difference in seconds between two timestamp strings"""
    try:
        def to_seconds(t):
            parts = t.split(":")
            if len(parts) >= 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2].split(".")[0])
            return 0
        return to_seconds(t1) - to_seconds(t2)
    except:
        return 0