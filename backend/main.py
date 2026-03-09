from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine
from models import Base

from routers.cleanup import router as cleanup_router
from routers.analytics import router as analytics_router
from routers.analyses import router as analyses_router
from routers.assistant import router as assistant_router

# Create tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="all.factory API",
    description="Manufacturing data quality and analytics tools",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cleanup_router)
app.include_router(analytics_router)
app.include_router(analyses_router)
app.include_router(assistant_router)

@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "All.Factory API",
        "endpoints": {
            "cleanup":  "/cleanup - Data cleanup tools",
            "analytics": "/analytics - Production analytics",
            "analyses": "/analyses - Saved analysis sessions",
        }
    }

@app.get("/health")
def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)