from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.cleanup import router as cleanup_router
from routers.analytics import router as analytics_router

app = FastAPI(
    title="all.factory API",
    description="Manufacturing data quality and analytics tools",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(cleanup_router)
app.include_router(analytics_router)


@app.get("/")
def root():
    return {
        "status": "ok", 
        "message": "All.Factory API",
        "endpoints": {
            "cleanup": "/cleanup - Data cleanup tools",
            "analytics": "/analytics - Production analytics",
        }
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)