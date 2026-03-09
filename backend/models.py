from sqlalchemy import Column, String, Boolean, DateTime, JSON, Text, Integer
from sqlalchemy.sql import func
from database import Base
import uuid

class Analysis(Base):
    __tablename__ = "analyses"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String, nullable=False, default="Untitled Analysis")
    starred     = Column(Boolean, default=False)
    work_order  = Column(String, nullable=True)   # e.g. "WO0926-01"
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Full analysis result blob (what /analytics/analyze returns)
    result      = Column(JSON, nullable=True)

    # Summary stats for list view (denormalized for speed)
    total_units   = Column(Integer, default=0)
    total_errors  = Column(Integer, default=0)
    station_count = Column(Integer, default=0)

    def to_dict(self):
        # Build a slim station summary for the card view (no full event/timeline data)
        station_analyses = []
        if self.result:
            for s in (self.result.get("station_analyses") or []):
                station_analyses.append({
                    "station": s.get("station"),
                    "barcode": {"completedUnits": (s.get("barcode") or {}).get("completedUnits")} if s.get("barcode") else None,
                    "sql":     {"rowCount": (s.get("sql") or {}).get("rowCount")} if s.get("sql") else None,
                    "errors":  {"totalErrors": (s.get("errors") or {}).get("totalErrors", 0)} if s.get("errors") else None,
                })

        return {
            "id":            self.id,
            "name":          self.name,
            "starred":       self.starred,
            "work_order":    self.work_order,
            "created_at":    self.created_at.isoformat() if self.created_at else None,
            "updated_at":    self.updated_at.isoformat() if self.updated_at else None,
            "total_units":   self.total_units,
            "total_errors":  self.total_errors,
            "station_count": self.station_count,
            "result":        {"station_analyses": station_analyses},
        }

    def to_dict_full(self):
        d = self.to_dict()
        d["result"] = self.result
        return d