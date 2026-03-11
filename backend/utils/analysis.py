"""
Analysis module — finds data issues in MMI logs + SQL Files and generates
change proposals for review in the Data Cleanup UI.

Issue types
───────────
Original 6:
  DUPLICATE_INSERT     Overlapped events: same row inserted twice (Battery #2)
  MISSING_PSA_TAPE     PSA_TAPE_PIC empty but image exists in MMI (Battery #1)
  ORPHAN_ROW           PSA images present, no SN or PRS (Battery #3)
  INDEX_MISMATCH       Camera 2 PSA image indices out of expected range (Battery #4)
  ERROR_EVENT_MISMATCH SQL error table vs MMI error log discrepancy (Battery #5)
  REPEATED_INSERT      Same INSERT content logged multiple times (PCBA #1)

New 8:
  MISSING_INSERT       6101 fired but no INSERT ever logged for that unit
  STUCK_RETRY          Unit entered retry loop; INSERT never succeeded
  MANUAL_PUSH          Row exists in SQL with no MMI log evidence at all
  GHOST_SCAN           Same SN scanned before and after an MMI-START (session restart)
  MISSING_BARCODE_SCAN DB record exists but no preceding scan event for that SN
  MULTI_UP_DUPLICATE   Same SN appearing in two different BS line slots
  LONG_CYCLE_OUTLIER   Cycle time > 3× median for the station (hold / rework)
  ERROR_NO_RECOVERY    Error code fired but no recovery before next unit processed

Change shape
────────────
{
  "id":               str,
  "issue_type":       str,
  "description":      str,
  "timestamp":        str | None,
  "action":           "DELETE" | "UPDATE" | "FLAG",
  "severity":         "critical" | "warning" | "info",
  "sql_row_id":       any | None,
  "sql_before":       dict | None,
  "sql_after":        dict | None,
  "mmi_evidence":     list[str],
  "mmi_line_numbers": list[int],
  "status":           "pending",
}
"""

from __future__ import annotations

import re
import statistics
import uuid
from typing import Optional

import pandas as pd


# ── helpers ──────────────────────────────────────────────────────────────────

def _is_empty(val) -> bool:
    if val is None:
        return True
    try:
        if pd.isna(val):
            return True
    except Exception:
        pass
    return str(val).strip() == ""


def _clean_row(row: dict) -> dict:
    """Return a JSON-safe copy of a SQL row."""
    out = {}
    for k, v in row.items():
        if _is_empty(v):
            out[k] = None
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _extract_time(date_val) -> Optional[str]:
    """Return HH:MM:SS from a datetime or 'YYYY-MM-DD HH:MM:SS' string."""
    if _is_empty(date_val):
        return None
    s = str(date_val).strip()
    m = re.search(r"(\d{1,2}:\d{2}:\d{2})", s)
    return m.group(1) if m else None


def _normalize_time(t: Optional[str]) -> Optional[int]:
    """Convert 'HH:MM:SS' or 'H:MM:SS AM/PM' to total seconds since midnight."""
    if not t:
        return None
    t = t.strip()
    pm = "PM" in t.upper()
    am = "AM" in t.upper()
    t_clean = re.sub(r"[APM\s]", "", t.upper())
    parts = t_clean.split(":")
    if len(parts) != 3:
        return None
    try:
        h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if pm and h != 12:
        h += 12
    if am and h == 12:
        h = 0
    return h * 3600 + m * 60 + s


def _times_close(t1: Optional[str], t2: Optional[str], window_seconds: int = 60) -> bool:
    s1 = _normalize_time(t1)
    s2 = _normalize_time(t2)
    if s1 is None or s2 is None:
        return False
    return abs(s1 - s2) <= window_seconds


def _find_mmi_events_near(mmi_events: list[dict], timestamp: Optional[str],
                           window: int = 60) -> list[dict]:
    if not timestamp:
        return []
    return [e for e in mmi_events if _times_close(e.get("timestamp"), timestamp, window)]


def _new_change(issue_type: str, description: str, action: str,
                severity: str = "warning", **kwargs) -> dict:
    base = {
        "id": str(uuid.uuid4()),
        "issue_type": issue_type,
        "description": description,
        "timestamp": None,
        "action": action,
        "severity": severity,
        "sql_row_id": None,
        "sql_before": None,
        "sql_after": None,
        "mmi_evidence": [],
        "mmi_line_numbers": [],
        "status": "pending",
    }
    base.update(kwargs)
    return base


# ── entry point ──────────────────────────────────────────────────────────────

def find_all_issues(
    mmi_events: list[dict],
    sql_data: list[dict],
    mmi_error_events: Optional[list[dict]] = None,
    sql_error_data: Optional[list[dict]] = None,
    station: Optional[str] = None,
) -> list[dict]:
    """Run all detectors and return a flat list of change proposals.

    Only runs detectors whose required data sources are present:
      - mmi_barcode-only checks: mmi_events
      - sql_product-only checks: sql_data
      - combined MMI+SQL checks:  both
      - error checks:             mmi_error_events and/or sql_error_data
    """
    changes: list[dict] = []

    have_mmi = bool(mmi_events)
    have_sql = bool(sql_data)
    have_mmi_err = bool(mmi_error_events)
    have_sql_err = bool(sql_error_data)

    # ── original 6 ──
    if have_mmi and have_sql:
        changes.extend(_find_missing_psa_tape(mmi_events, sql_data))
        changes.extend(_find_duplicate_rows(mmi_events, sql_data))
    if have_sql:
        changes.extend(_find_orphan_rows(mmi_events if have_mmi else [], sql_data))
        changes.extend(_find_cam2_index_mismatches(mmi_events if have_mmi else [], sql_data))
    if have_mmi_err and have_sql_err:
        changes.extend(_find_error_event_mismatches(mmi_error_events, sql_error_data))
    if have_mmi:
        changes.extend(_find_repeated_inserts(mmi_events, sql_data if have_sql else []))

    # ── new 8 ──
    if have_mmi and have_sql:
        changes.extend(_find_missing_inserts(mmi_events, sql_data))
        changes.extend(_find_manual_pushes(mmi_events, sql_data))
        changes.extend(_find_missing_barcode_scans(mmi_events, sql_data))
    if have_mmi:
        changes.extend(_find_stuck_retries(mmi_events, sql_data if have_sql else []))
        changes.extend(_find_ghost_scans(mmi_events, sql_data if have_sql else []))
        if station == 'BS':
            changes.extend(_find_multi_up_duplicates(mmi_events, sql_data if have_sql else []))
    if have_sql:
        changes.extend(_find_long_cycle_outliers(mmi_events if have_mmi else [], sql_data))
    if have_mmi_err:
        changes.extend(_find_error_no_recovery(mmi_error_events, sql_data if have_sql else []))

    return changes


# ═════════════════════════════════════════════════════════════════════════════
# ORIGINAL 6 DETECTORS
# ═════════════════════════════════════════════════════════════════════════════

def _find_missing_psa_tape(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue: PSA_TAPE_PIC column is empty but the image was captured in MMI.
    Fix: fill from the matching CAM4_PSA_TAPE event.
    """
    changes = []
    psa_tape_events = [e for e in mmi_events if e.get("event_type") == "CAM4_PSA_TAPE"]

    for row in sql_data:
        if not _is_empty(row.get("PSA_TAPE_PIC")):
            continue
        if not (row.get("POWER_BOARD_SN") or row.get("BATTERY_SN")):
            continue

        row_id = row.get("ID")
        ts = _extract_time(row.get("DATE"))
        nearby = [e for e in psa_tape_events if _times_close(e.get("timestamp"), ts, 120)]

        after = dict(_clean_row(row))
        if nearby:
            after["PSA_TAPE_PIC"] = nearby[0].get("data", {}).get("image_path", "")

        changes.append(_new_change(
            issue_type="MISSING_PSA_TAPE",
            description=f"Row {row_id}: PSA_TAPE_PIC is empty but image found in MMI log",
            action="UPDATE",
            severity="warning",
            timestamp=ts,
            sql_row_id=row_id,
            sql_before=_clean_row(row),
            sql_after=after,
            mmi_evidence=[e["raw"] for e in nearby],
            mmi_line_numbers=[e.get("line_number", 0) for e in nearby],
        ))
    return changes


def _find_duplicate_rows(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue: Same unit inserted twice — timestamps within 5 s, same SNs.
    Fix: delete the second (duplicate) row.
    """
    changes = []
    for i in range(1, len(sql_data)):
        curr, prev = sql_data[i], sql_data[i - 1]
        same_sn = (
            curr.get("POWER_BOARD_SN") == prev.get("POWER_BOARD_SN")
            and curr.get("BATTERY_SN") == prev.get("BATTERY_SN")
            and not _is_empty(curr.get("POWER_BOARD_SN"))
        )
        ts_curr = _extract_time(curr.get("DATE"))
        ts_prev = _extract_time(prev.get("DATE"))
        if same_sn and _times_close(ts_curr, ts_prev, 5):
            nearby = _find_mmi_events_near(mmi_events, ts_curr, 30)
            changes.append(_new_change(
                issue_type="DUPLICATE_INSERT",
                description=(
                    f"Rows {prev.get('ID')} and {curr.get('ID')} are duplicate inserts "
                    f"(same SNs, {ts_curr})"
                ),
                action="DELETE",
                severity="critical",
                timestamp=ts_curr,
                sql_row_id=curr.get("ID"),
                sql_before=_clean_row(curr),
                sql_after=None,
                mmi_evidence=[e["raw"] for e in nearby],
                mmi_line_numbers=[e.get("line_number", 0) for e in nearby],
            ))
    return changes


def _find_orphan_rows(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue: Row has PSA images but both POWER_BOARD_SN and BATTERY_SN are empty.
    These are ghost rows from a data-shift — flag for deletion.
    """
    changes = []
    for row in sql_data:
        no_sn = _is_empty(row.get("POWER_BOARD_SN")) and _is_empty(row.get("BATTERY_SN"))
        has_psa = (
            not _is_empty(row.get("PSA_TAPE_PIC"))
            or not _is_empty(row.get("POWER_BOARD_PSA_PIC"))
            or not _is_empty(row.get("BATTERY_PSA_PIC"))
        )
        if no_sn and has_psa:
            row_id = row.get("ID")
            ts = _extract_time(row.get("DATE"))
            nearby = _find_mmi_events_near(mmi_events, ts, 60)
            changes.append(_new_change(
                issue_type="ORPHAN_ROW",
                description=f"Row {row_id}: PSA images present but no serial numbers",
                action="DELETE",
                severity="critical",
                timestamp=ts,
                sql_row_id=row_id,
                sql_before=_clean_row(row),
                mmi_evidence=[e["raw"] for e in nearby],
                mmi_line_numbers=[e.get("line_number", 0) for e in nearby],
            ))
    return changes


def _find_cam2_index_mismatches(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue: Camera 2 image indices don't follow the expected +6 gap between
    SN_index and PSA_index (or between consecutive units).
    """
    changes = []
    idx_re = re.compile(r"_(\d+)$")

    for row in sql_data:
        row_id = row.get("ID")
        ts = _extract_time(row.get("DATE"))
        for pic_field, sn_field, label in [
            ("POWER_BOARD_PSA_PIC", "POWER_BOARD_SN", "Power Board"),
            ("BATTERY_PSA_PIC",     "BATTERY_SN",     "Battery"),
        ]:
            psa_val = row.get(pic_field, "")
            sn_val  = row.get(sn_field, "")
            if _is_empty(psa_val) or _is_empty(sn_val):
                continue
            psa_m = idx_re.search(str(psa_val))
            sn_m  = idx_re.search(str(sn_val))
            if not (psa_m and sn_m):
                continue
            gap = int(psa_m.group(1)) - int(sn_m.group(1))
            if gap != 6:
                nearby = _find_mmi_events_near(mmi_events, ts, 60)
                after = dict(_clean_row(row))
                # Suggest correction
                try:
                    corrected_idx = int(sn_m.group(1)) + 6
                    after[pic_field] = idx_re.sub(f"_{corrected_idx}", str(psa_val))
                except Exception:
                    after = None
                changes.append(_new_change(
                    issue_type="INDEX_MISMATCH",
                    description=(
                        f"Row {row_id} {label}: PSA index gap is {gap:+d}, expected +6"
                    ),
                    action="UPDATE",
                    severity="warning",
                    timestamp=ts,
                    sql_row_id=row_id,
                    sql_before=_clean_row(row),
                    sql_after=after,
                    mmi_evidence=[e["raw"] for e in nearby],
                    mmi_line_numbers=[e.get("line_number", 0) for e in nearby],
                ))
    return changes


def _find_error_event_mismatches(mmi_events: list[dict],
                                  sql_error_data: list[dict]) -> list[dict]:
    """
    Issue: An error row exists in the SQL error table but no corresponding
    error event appears in the MMI log within ±5 minutes, or vice-versa.
    """
    changes = []
    error_mmi = [e for e in mmi_events if e.get("event_type") in
                 ("ERROR_START", "ERROR_CODE", "PLC_ERROR")]

    for row in sql_error_data:
        row_id = row.get("ID")
        ts = _extract_time(row.get("DATE") or row.get("TIMESTAMP"))
        code = row.get("ERROR_CODE") or row.get("CODE") or "?"
        matched = [e for e in error_mmi if _times_close(e.get("timestamp"), ts, 300)]
        if not matched:
            changes.append(_new_change(
                issue_type="ERROR_EVENT_MISMATCH",
                description=(
                    f"SQL error row {row_id} (code {code} @ {ts}) has no matching "
                    f"MMI error event within ±5 min"
                ),
                action="FLAG",
                severity="warning",
                timestamp=ts,
                sql_row_id=row_id,
                sql_before=_clean_row(row),
            ))
    return changes


def _find_repeated_inserts(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    Issue: Identical INSERT content appears in the MMI log more than once.
    Keep the first occurrence, flag the rest.
    """
    changes = []
    insert_events = [e for e in mmi_events if "insert into" in
                     e.get("raw", "").lower()]
    seen: dict[str, int] = {}   # normalised content → first line_number

    for event in insert_events:
        key = re.sub(r"\s+", " ", event.get("raw", "").strip().lower())
        ln = event.get("line_number", 0)
        if key in seen:
            ts = event.get("timestamp")
            changes.append(_new_change(
                issue_type="REPEATED_INSERT",
                description=(
                    f"MMI line {ln}: INSERT duplicates line {seen[key]} "
                    f"(same content, {ts})"
                ),
                action="DELETE",
                severity="warning",
                timestamp=ts,
                mmi_evidence=[event.get("raw", "")],
                mmi_line_numbers=[ln],
                first_line_number=seen[key],
            ))
        else:
            seen[key] = ln
    return changes


# ═════════════════════════════════════════════════════════════════════════════
# NEW 8 DETECTORS
# ═════════════════════════════════════════════════════════════════════════════

def _find_missing_inserts(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    MISSING_INSERT — 6101 completion signal fired but no INSERT ever logged
    for that unit in the MMI, AND the unit is absent from the SQL table.

    Detection:
      1. Find every 6101 event in MMI and extract the motor/unit SN from
         the PLC DM[6100] line that follows within 6 lines.
      2. Check whether that SN appears in any INSERT line in the MMI log.
      3. Check whether that SN appears in any SQL row.
      If neither → MISSING_INSERT.
    """
    changes = []
    lines = [e.get("raw", "") for e in mmi_events]

    # Build set of SNs known to SQL
    sql_sns: set[str] = set()
    for row in sql_data:
        for field in ("POWER_BOARD_SN", "BATTERY_SN", "BOTTOM_SN", "MOTOR_SN"):
            v = row.get(field)
            if not _is_empty(v):
                sql_sns.add(str(v).strip())

    # Build set of SNs that appear in any INSERT line
    insert_sns: set[str] = set()
    for e in mmi_events:
        if "insert into" in e.get("raw", "").lower():
            for m in re.finditer(r"'([A-Z0-9]{6,})'", e.get("raw", "")):
                insert_sns.add(m.group(1))

    for i, event in enumerate(mmi_events):
        if "PLC DM[6101]" not in event.get("raw", ""):
            continue

        # Extract SN from nearby DM[6100] lines
        sn: Optional[str] = None
        for j in range(i + 1, min(i + 8, len(mmi_events))):
            sn_match = re.search(
                r"PLC DM\[6100\]-\d+_([A-Z0-9]+B|[A-Z0-9]{8,})",
                mmi_events[j].get("raw", "")
            )
            if sn_match:
                sn = sn_match.group(1)
                break

        if not sn:
            continue

        if sn not in insert_sns and sn not in sql_sns:
            ts = event.get("timestamp")
            ln = event.get("line_number", 0)
            changes.append(_new_change(
                issue_type="MISSING_INSERT",
                description=(
                    f"Unit {sn} @ {ts}: 6101 fired but no INSERT logged "
                    f"and absent from SQL — requires manual review"
                ),
                action="FLAG",
                severity="critical",
                timestamp=ts,
                mmi_evidence=[event.get("raw", "")],
                mmi_line_numbers=[ln],
                extra={"unit_sn": sn},
            ))
    return changes


def _find_stuck_retries(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    STUCK_RETRY — unit scanned, entered a retry loop visible in MMI
    (same SN re-attempted 3+ times within a window), and never produced
    an INSERT or SQL row.

    Detection:
      1. Collect all scan events grouped by SN.
      2. If the same SN appears 3+ times within 15 min with no INSERT → flag.
    """
    changes = []
    scan_pattern = re.compile(
        r"(?:\+[12],0,|PLC DM\[6100\]-\d+_)([A-Z0-9]{6,})"
    )

    from collections import defaultdict
    sn_events: dict[str, list[dict]] = defaultdict(list)
    for event in mmi_events:
        m = scan_pattern.search(event.get("raw", ""))
        if m:
            sn_events[m.group(1)].append(event)

    insert_sns: set[str] = set()
    for e in mmi_events:
        if "insert into" in e.get("raw", "").lower():
            for m in re.finditer(r"'([A-Z0-9]{6,})'", e.get("raw", "")):
                insert_sns.add(m.group(1))

    sql_sns: set[str] = set()
    for row in sql_data:
        for field in ("POWER_BOARD_SN", "BATTERY_SN", "BOTTOM_SN", "MOTOR_SN"):
            v = row.get(field)
            if not _is_empty(v):
                sql_sns.add(str(v).strip())

    for sn, events in sn_events.items():
        if len(events) < 3:
            continue
        if sn in insert_sns or sn in sql_sns:
            continue

        times = [_normalize_time(e.get("timestamp")) for e in events]
        times = [t for t in times if t is not None]
        if not times:
            continue
        span_min = (max(times) - min(times)) / 60
        if span_min > 15:
            continue

        ts = events[0].get("timestamp")
        changes.append(_new_change(
            issue_type="STUCK_RETRY",
            description=(
                f"Unit {sn}: scanned {len(events)}× over {span_min:.1f} min "
                f"with no successful INSERT — retry loop detected"
            ),
            action="FLAG",
            severity="critical",
            timestamp=ts,
            mmi_evidence=[e.get("raw", "") for e in events],
            mmi_line_numbers=[e.get("line_number", 0) for e in events],
            extra={"unit_sn": sn, "retry_count": len(events),
                   "span_minutes": round(span_min, 1)},
        ))
    return changes


def _find_manual_pushes(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    MANUAL_PUSH — a SQL row exists but there is absolutely no MMI log
    evidence (no scan, no INSERT, no 6101) for that unit's SNs.

    These are typically units an operator pushed directly into the DB.
    """
    changes = []

    # All SNs mentioned anywhere in MMI
    mmi_all_text = " ".join(e.get("raw", "") for e in mmi_events)

    for row in sql_data:
        row_id = row.get("ID")
        ts = _extract_time(row.get("DATE"))

        # Collect non-empty SNs for this row
        sns = []
        for field in ("POWER_BOARD_SN", "BATTERY_SN", "BOTTOM_SN", "MOTOR_SN"):
            v = row.get(field)
            if not _is_empty(v):
                sns.append(str(v).strip())

        if not sns:
            continue

        # If none of this row's SNs appear anywhere in MMI text → manual push
        if not any(sn in mmi_all_text for sn in sns):
            changes.append(_new_change(
                issue_type="MANUAL_PUSH",
                description=(
                    f"Row {row_id} ({', '.join(sns)}): exists in SQL but zero "
                    f"MMI log evidence — likely manually inserted by operator"
                ),
                action="FLAG",
                severity="warning",
                timestamp=ts,
                sql_row_id=row_id,
                sql_before=_clean_row(row),
            ))
    return changes


def _find_ghost_scans(mmi_events: list[dict], sql_data: list[dict]) -> list[dict]:
    """
    GHOST_SCAN — same SN scanned both before and after an MMI-START event
    (session restart).  The pre-restart scan is a ghost that may have
    contributed to a corrupt row.
    """
    changes = []

    # Find session restart line numbers
    restart_lines: list[int] = [
        e.get("line_number", 0)
        for e in mmi_events
        if "MMI-START" in e.get("raw", "") or "SYSTEM START" in e.get("raw", "")
    ]
    if not restart_lines:
        return changes

    scan_pattern = re.compile(r"(?:\+[12],0,|PLC DM\[6100\]-\d+_)([A-Z0-9]{6,})")

    from collections import defaultdict
    sn_line_nums: dict[str, list[int]] = defaultdict(list)
    for event in mmi_events:
        m = scan_pattern.search(event.get("raw", ""))
        if m:
            sn_line_nums[m.group(1)].append(event.get("line_number", 0))

    for sn, lns in sn_line_nums.items():
        for restart_ln in restart_lines:
            before = [ln for ln in lns if ln < restart_ln]
            after  = [ln for ln in lns if ln > restart_ln]
            if before and after:
                # Grab first pre-restart event for evidence
                pre_event = next(
                    (e for e in mmi_events
                     if e.get("line_number") == before[0]), None
                )
                ts = pre_event.get("timestamp") if pre_event else None
                changes.append(_new_change(
                    issue_type="GHOST_SCAN",
                    description=(
                        f"Unit {sn}: scanned before (line {before[0]}) AND after "
                        f"(line {after[0]}) MMI-START at line {restart_ln} — "
                        f"pre-restart scan is a ghost"
                    ),
                    action="FLAG",
                    severity="warning",
                    timestamp=ts,
                    mmi_evidence=[pre_event.get("raw", "")] if pre_event else [],
                    mmi_line_numbers=before,
                    extra={"unit_sn": sn, "restart_line": restart_ln},
                ))
    return changes


def _find_missing_barcode_scans(mmi_events: list[dict],
                                 sql_data: list[dict]) -> list[dict]:
    """
    MISSING_BARCODE_SCAN — a SQL row exists (implying a successful INSERT)
    but the MMI log shows no barcode scan event for that unit's primary SN
    within 10 minutes of the row's timestamp.

    Distinguishable from MANUAL_PUSH: the INSERT exists in MMI but the
    upstream scan event is absent (e.g. scan gun failure, manual SN entry).
    """
    changes = []

    scan_pattern = re.compile(r"(?:\+[12],0,|PLC DM\[6100\]-\d+_)([A-Z0-9]{6,})")
    scanned_sns: set[str] = set()
    for event in mmi_events:
        m = scan_pattern.search(event.get("raw", ""))
        if m:
            scanned_sns.add(m.group(1))

    # We only flag rows where an INSERT is traceable in MMI but no scan
    insert_sns: set[str] = set()
    for e in mmi_events:
        if "insert into" in e.get("raw", "").lower():
            for m in re.finditer(r"'([A-Z0-9]{6,})'", e.get("raw", "")):
                insert_sns.add(m.group(1))

    for row in sql_data:
        row_id = row.get("ID")
        primary_sn = row.get("POWER_BOARD_SN") or row.get("BOTTOM_SN")
        if _is_empty(primary_sn):
            continue
        sn = str(primary_sn).strip()

        if sn not in scanned_sns and sn in insert_sns:
            ts = _extract_time(row.get("DATE"))
            changes.append(_new_change(
                issue_type="MISSING_BARCODE_SCAN",
                description=(
                    f"Row {row_id} (SN {sn}): INSERT exists in MMI but no "
                    f"barcode scan event — SN may have been typed manually"
                ),
                action="FLAG",
                severity="warning",
                timestamp=ts,
                sql_row_id=row_id,
                sql_before=_clean_row(row),
                extra={"unit_sn": sn},
            ))
    return changes


def _find_multi_up_duplicates(mmi_events: list[dict],
                               sql_data: list[dict]) -> list[dict]:
    """
    MULTI_UP_DUPLICATE — BS station is 3-up; same motor or PCBA SN appearing
    in more than one line-slot within the same cycle window.

    Detection: look for the same SN in DM[6100]-1_*, DM[6100]-2_*, DM[6100]-3_*
    patterns within a 2-minute window.
    """
    changes = []
    slot_pattern = re.compile(r"PLC DM\[6100\]-(\d+)_([A-Z0-9]{6,})")

    from collections import defaultdict
    # sn → list of (slot, timestamp, line_number, raw)
    sn_slots: dict[str, list[tuple]] = defaultdict(list)

    for event in mmi_events:
        for m in slot_pattern.finditer(event.get("raw", "")):
            slot = int(m.group(1))
            sn   = m.group(2)
            sn_slots[sn].append((
                slot,
                event.get("timestamp"),
                event.get("line_number", 0),
                event.get("raw", ""),
            ))

    for sn, appearances in sn_slots.items():
        if len(appearances) < 2:
            continue
        # Group by slot
        slots_seen = {a[0] for a in appearances}
        if len(slots_seen) < 2:
            continue  # same SN scanned in same slot multiple times — different issue
        # Check time proximity
        times = [_normalize_time(a[1]) for a in appearances if _normalize_time(a[1])]
        if not times or (max(times) - min(times)) > 120:
            continue
        ts = appearances[0][1]
        changes.append(_new_change(
            issue_type="MULTI_UP_DUPLICATE",
            description=(
                f"SN {sn} appears in slots {sorted(slots_seen)} within 2 min "
                f"— component assigned to multiple BS positions"
            ),
            action="FLAG",
            severity="critical",
            timestamp=ts,
            mmi_evidence=[a[3] for a in appearances],
            mmi_line_numbers=[a[2] for a in appearances],
            extra={"unit_sn": sn, "slots": sorted(slots_seen)},
        ))
    return changes


def _find_long_cycle_outliers(mmi_events: list[dict],
                               sql_data: list[dict]) -> list[dict]:
    """
    LONG_CYCLE_OUTLIER — inter-unit cycle time exceeds 3× the station median.
    Derived from completion timestamps in the SQL data (DATE column).

    Flags units that likely had a hold, rework, or operator intervention.
    """
    changes = []
    if len(sql_data) < 5:
        return changes

    # Extract timestamps
    ts_list = []
    for row in sql_data:
        t = _normalize_time(_extract_time(row.get("DATE")))
        if t is not None:
            ts_list.append((t, row))

    ts_list.sort(key=lambda x: x[0])
    if len(ts_list) < 5:
        return changes

    gaps = [ts_list[i][0] - ts_list[i - 1][0]
            for i in range(1, len(ts_list))]
    # Exclude zeros (duplicate timestamps)
    gaps_nonzero = [g for g in gaps if g > 0]
    if not gaps_nonzero:
        return changes

    median_gap = statistics.median(gaps_nonzero)
    threshold  = 3 * median_gap

    for i in range(1, len(ts_list)):
        gap = ts_list[i][0] - ts_list[i - 1][0]
        if gap <= threshold or gap <= 0:
            continue
        row = ts_list[i][1]
        row_id = row.get("ID")
        ts = _extract_time(row.get("DATE"))
        nearby = _find_mmi_events_near(mmi_events, ts, 60)
        changes.append(_new_change(
            issue_type="LONG_CYCLE_OUTLIER",
            description=(
                f"Row {row_id} @ {ts}: cycle gap {gap//60:.0f}m {gap%60:.0f}s "
                f"vs median {median_gap:.0f}s — possible hold or rework"
            ),
            action="FLAG",
            severity="info",
            timestamp=ts,
            sql_row_id=row_id,
            sql_before=_clean_row(row),
            mmi_evidence=[e.get("raw", "") for e in nearby],
            mmi_line_numbers=[e.get("line_number", 0) for e in nearby],
            extra={"gap_seconds": int(gap), "median_seconds": int(median_gap)},
        ))
    return changes


def _find_error_no_recovery(mmi_events: list[dict],
                              sql_data: list[dict]) -> list[dict]:
    """
    ERROR_NO_RECOVERY — an error code fired in the MMI log but no recovery
    event (CLEAR, RESET, or the next unit's scan) appeared before the
    station processed the next unit.

    Detection: find ERROR events not followed by a recovery-style event
    within 5 minutes.
    """
    changes = []
    recovery_keywords = ("CLEAR", "RESET", "RECOVER", "OK", "ACK")
    error_pattern = re.compile(r"\+\d,1,|ERROR|FAULT|ALARM", re.IGNORECASE)

    for i, event in enumerate(mmi_events):
        if not error_pattern.search(event.get("raw", "")):
            continue

        ts_err = _normalize_time(event.get("timestamp"))
        if ts_err is None:
            continue

        # Look ahead up to 5 minutes
        recovered = False
        for j in range(i + 1, len(mmi_events)):
            ts_next = _normalize_time(mmi_events[j].get("timestamp"))
            if ts_next is None:
                continue
            if ts_next - ts_err > 300:
                break
            raw_next = mmi_events[j].get("raw", "").upper()
            if any(kw in raw_next for kw in recovery_keywords):
                recovered = True
                break
            # Next unit scan = implicit recovery
            if re.search(r"\+[12],0,[A-Z0-9]{6}", raw_next):
                recovered = True
                break

        if not recovered:
            ts = event.get("timestamp")
            ln = event.get("line_number", 0)
            changes.append(_new_change(
                issue_type="ERROR_NO_RECOVERY",
                description=(
                    f"MMI line {ln} @ {ts}: error fired with no recovery "
                    f"event in the next 5 minutes"
                ),
                action="FLAG",
                severity="warning",
                timestamp=ts,
                mmi_evidence=[event.get("raw", "")],
                mmi_line_numbers=[ln],
            ))
    return changes