from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import uuid

from database import get_db
from models import Analysis

router = APIRouter(prefix="/analyses", tags=["analyses"])


# ── List all analyses (summary only, no result blob) ──────────────────────────

@router.get("/")
def list_analyses(db: Session = Depends(get_db)):
    analyses = db.query(Analysis).order_by(
        Analysis.starred.desc(),
        Analysis.updated_at.desc()
    ).all()
    results = []
    for a in analyses:
        d = a.to_dict()
        # Include lightweight station summary for card display
        if a.result:
            station_analyses = a.result.get("station_analyses", [])
            d["result"] = {
                "station_analyses": [
                    {
                        "station": s.get("station"),
                        "stationCode": s.get("stationCode"),
                        "barcode": {"completedUnits": (s.get("barcode") or {}).get("completedUnits", 0)},
                        "sql": {"rowCount": (s.get("sql") or {}).get("rowCount")} if s.get("sql") else None,
                        "errors": {"totalErrors": (s.get("errors") or {}).get("totalErrors", 0)},
                    }
                    for s in station_analyses
                ]
            }
        results.append(d)
    return results


# ── Get a single analysis with full result ────────────────────────────────────

@router.get("/{analysis_id}")
def get_analysis(analysis_id: str, db: Session = Depends(get_db)):
    a = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return a.to_dict_full()


# ── Save a new analysis (called after /analytics/analyze) ────────────────────

class SaveAnalysisRequest(BaseModel):
    name: Optional[str] = None
    work_order: Optional[str] = None
    result: dict  # the full response from /analytics/analyze

@router.post("/")
def save_analysis(req: SaveAnalysisRequest, db: Session = Depends(get_db)):
    # Extract summary stats from result
    station_analyses = req.result.get("stationAnalyses", [])
    total_units  = sum(s.get("barcode", {}).get("completedUnits", 0) for s in station_analyses if s.get("barcode"))
    total_errors = sum(s.get("errors", {}).get("totalErrors", 0) for s in station_analyses if s.get("errors"))

    # Auto-generate name if not provided
    name = req.name
    if not name:
        from datetime import datetime
        now = datetime.now()
        wo = f"{req.work_order} · " if req.work_order else ""
        name = f"{wo}{now.strftime('%b %d, %Y %I:%M %p')}"

    a = Analysis(
        id=str(uuid.uuid4()),
        name=name,
        work_order=req.work_order,
        result=req.result,
        total_units=total_units,
        total_errors=total_errors,
        station_count=len(station_analyses),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a.to_dict()


# ── Rename ────────────────────────────────────────────────────────────────────

class RenameRequest(BaseModel):
    name: str

@router.patch("/{analysis_id}/rename")
def rename_analysis(analysis_id: str, req: RenameRequest, db: Session = Depends(get_db)):
    a = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    a.name = req.name
    db.commit()
    return a.to_dict()


# ── Star / unstar ─────────────────────────────────────────────────────────────

@router.patch("/{analysis_id}/star")
def toggle_star(analysis_id: str, db: Session = Depends(get_db)):
    a = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    a.starred = not a.starred
    db.commit()
    return a.to_dict()


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{analysis_id}")
def delete_analysis(analysis_id: str, db: Session = Depends(get_db)):
    a = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    db.delete(a)
    db.commit()
    return {"deleted": analysis_id}