"""
Cleanup Router - Handles file uploads, analysis, and change management.

Endpoints:
- POST /cleanup/upload/mmi - Upload MMI log file
- POST /cleanup/upload/sql - Upload SQL export (Excel)
- POST /cleanup/analyze - Run analysis and generate change proposals
- GET /cleanup/changes - Get all proposed changes
- GET /cleanup/changes/{id} - Get single change with full details
- POST /cleanup/changes/{id}/approve - Approve a change
- POST /cleanup/changes/{id}/reject - Reject a change
- POST /cleanup/changes/approve-all - Approve all pending changes
- GET /cleanup/export/sql - Download cleaned SQL data as Excel
- GET /cleanup/export/mmi - Download cleaned MMI log
- GET /cleanup/stats - Get summary statistics
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
import pandas as pd
import io
from typing import Optional

from utils.mmi_parser import parse_mmi_log
from utils.sql_parser import parse_sql_export, parse_sql_export_df
from utils.analysis import find_all_issues

router = APIRouter(prefix="/cleanup", tags=["cleanup"])


# In-memory storage (resets on server restart)
store = {
    "mmi_raw": "",           # Original MMI log content
    "mmi_events": [],        # Parsed MMI events
    "mmi_filename": "",
    "sql_raw": None,         # Original SQL Excel bytes
    "sql_data": [],          # Parsed SQL rows
    "sql_df": None,          # Pandas DataFrame
    "sql_filename": "",
    "changes": [],           # Proposed changes with status
}


@router.post("/upload/mmi")
async def upload_mmi(file: UploadFile = File(...)):
    """Upload and parse MMI log file"""
    content = await file.read()
    content_str = content.decode("utf-8", errors="ignore")
    
    store["mmi_raw"] = content_str
    store["mmi_events"] = parse_mmi_log(content_str)
    store["mmi_filename"] = file.filename
    store["changes"] = []  # Reset changes
    
    # Count event types
    event_counts = {}
    for event in store["mmi_events"]:
        t = event["event_type"]
        event_counts[t] = event_counts.get(t, 0) + 1
    
    return {
        "filename": file.filename,
        "total_events": len(store["mmi_events"]),
        "total_lines": len(content_str.split("\n")),
        "event_types": event_counts
    }


@router.post("/upload/sql")
async def upload_sql(file: UploadFile = File(...)):
    """Upload and parse SQL export Excel file"""
    content = await file.read()
    
    store["sql_raw"] = content
    store["sql_data"] = parse_sql_export(content)
    store["sql_df"] = parse_sql_export_df(content)
    store["sql_filename"] = file.filename
    store["changes"] = []  # Reset changes
    
    return {
        "filename": file.filename,
        "total_rows": len(store["sql_data"]),
        "columns": list(store["sql_df"].columns) if store["sql_df"] is not None else []
    }


@router.post("/analyze")
def analyze():
    """Run analysis and generate change proposals"""
    if not store["mmi_events"]:
        raise HTTPException(status_code=400, detail="No MMI log uploaded")
    if not store["sql_data"]:
        raise HTTPException(status_code=400, detail="No SQL data uploaded")
    
    # Run analysis
    store["changes"] = find_all_issues(store["mmi_events"], store["sql_data"])
    
    # Count by type and status
    by_type = {}
    by_status = {"pending": 0, "approved": 0, "rejected": 0}
    
    for change in store["changes"]:
        t = change["issue_type"]
        by_type[t] = by_type.get(t, 0) + 1
        by_status[change["status"]] += 1
    
    return {
        "total_changes": len(store["changes"]),
        "by_type": by_type,
        "by_status": by_status
    }


@router.get("/changes")
def get_changes(
    issue_type: Optional[str] = None,
    status: Optional[str] = None
):
    """Get all proposed changes, optionally filtered"""
    changes = store["changes"]
    
    if issue_type:
        changes = [c for c in changes if c["issue_type"] == issue_type]
    if status:
        changes = [c for c in changes if c["status"] == status]
    
    return {"changes": changes, "total": len(changes)}


@router.get("/changes/{change_id}")
def get_change(change_id: str):
    """Get single change with full details"""
    for change in store["changes"]:
        if change["id"] == change_id:
            return {"change": change}
    raise HTTPException(status_code=404, detail="Change not found")


@router.post("/changes/{change_id}/approve")
def approve_change(change_id: str):
    """Approve a change"""
    for change in store["changes"]:
        if change["id"] == change_id:
            change["status"] = "approved"
            return {"change": change}
    raise HTTPException(status_code=404, detail="Change not found")


@router.post("/changes/{change_id}/reject")
def reject_change(change_id: str):
    """Reject a change"""
    for change in store["changes"]:
        if change["id"] == change_id:
            change["status"] = "rejected"
            return {"change": change}
    raise HTTPException(status_code=404, detail="Change not found")


@router.post("/changes/approve-all")
def approve_all_changes():
    """Approve all pending changes"""
    count = 0
    for change in store["changes"]:
        if change["status"] == "pending":
            change["status"] = "approved"
            count += 1
    return {"approved_count": count}


@router.post("/changes/reject-all")
def reject_all_changes():
    """Reject all pending changes"""
    count = 0
    for change in store["changes"]:
        if change["status"] == "pending":
            change["status"] = "rejected"
            count += 1
    return {"rejected_count": count}


@router.get("/stats")
def get_stats():
    """Get summary statistics"""
    by_type = {}
    by_status = {"pending": 0, "approved": 0, "rejected": 0}
    by_action = {"DELETE": 0, "UPDATE": 0, "FLAG": 0}
    
    for change in store["changes"]:
        t = change["issue_type"]
        by_type[t] = by_type.get(t, 0) + 1
        by_status[change["status"]] += 1
        by_action[change.get("action", "FLAG")] += 1
    
    return {
        "mmi_filename": store["mmi_filename"],
        "mmi_total_events": len(store["mmi_events"]),
        "sql_filename": store["sql_filename"],
        "sql_total_rows": len(store["sql_data"]),
        "total_changes": len(store["changes"]),
        "by_type": by_type,
        "by_status": by_status,
        "by_action": by_action
    }


@router.get("/export/sql")
def export_sql():
    """Export cleaned SQL data as Excel file"""
    if store["sql_df"] is None:
        raise HTTPException(status_code=400, detail="No SQL data to export")
    
    # Start with original DataFrame
    df = store["sql_df"].copy()
    
    # Apply approved changes
    rows_to_delete = set()
    updates = {}  # row_id -> {field: new_value}
    
    for change in store["changes"]:
        if change["status"] != "approved":
            continue
        
        row_id = change.get("sql_row_id")
        action = change.get("action")
        
        if action == "DELETE":
            rows_to_delete.add(row_id)
        elif action == "UPDATE" and change.get("sql_after"):
            if row_id not in updates:
                updates[row_id] = {}
            # Get the changed fields
            before = change.get("sql_before", {})
            after = change.get("sql_after", {})
            for key, new_val in after.items():
                if before.get(key) != new_val:
                    updates[row_id][key] = new_val
    
    # Apply updates
    for row_id, field_updates in updates.items():
        mask = df["ID"] == row_id
        for field, value in field_updates.items():
            df.loc[mask, field] = value
    
    # Delete rows
    df = df[~df["ID"].isin(rows_to_delete)]
    
    # Write to Excel
    output = io.BytesIO()
    df.to_excel(output, index=False, sheet_name="Cleaned Data")
    output.seek(0)
    
    filename = store["sql_filename"].replace(".xlsx", "_cleaned.xlsx")
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/export/mmi")
def export_mmi():
    """Export cleaned MMI log file"""
    if not store["mmi_raw"]:
        raise HTTPException(status_code=400, detail="No MMI log to export")
    
    # For MMI, we remove duplicate INSERT lines
    lines = store["mmi_raw"].split("\n")
    
    # Get line numbers to remove (from approved DELETE changes on duplicates)
    lines_to_remove = set()
    for change in store["changes"]:
        if change["status"] == "approved" and change["issue_type"] == "DUPLICATE_INSERT":
            # Remove the second occurrence (higher line numbers)
            line_nums = change.get("mmi_line_numbers", [])
            if len(line_nums) >= 2:
                # Keep first, remove rest
                for ln in line_nums[1:]:
                    lines_to_remove.add(ln)
    
    # Filter lines
    cleaned_lines = []
    for i, line in enumerate(lines):
        if (i + 1) not in lines_to_remove:
            cleaned_lines.append(line)
    
    cleaned_content = "\n".join(cleaned_lines)
    
    filename = store["mmi_filename"].replace(".log", "_cleaned.log")
    
    return StreamingResponse(
        io.BytesIO(cleaned_content.encode("utf-8")),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/sql-data")
def get_sql_data(limit: int = 100, offset: int = 0):
    """Get SQL data rows for display"""
    data = store["sql_data"]
    
    # Clean for JSON
    cleaned = []
    for row in data[offset:offset + limit]:
        cleaned_row = {}
        for k, v in row.items():
            if pd.isna(v):
                cleaned_row[k] = None
            elif hasattr(v, 'isoformat'):
                cleaned_row[k] = v.isoformat()
            else:
                cleaned_row[k] = v
        cleaned.append(cleaned_row)
    
    return {
        "rows": cleaned,
        "total": len(data),
        "limit": limit,
        "offset": offset
    }


@router.get("/mmi-events")
def get_mmi_events(
    event_type: Optional[str] = None,
    limit: int = 500,
    offset: int = 0
):
    """Get MMI events for display"""
    events = store["mmi_events"]
    
    if event_type:
        events = [e for e in events if e["event_type"] == event_type]
    
    return {
        "events": events[offset:offset + limit],
        "total": len(events),
        "limit": limit,
        "offset": offset
    }