"""FastAPI app entry. Run via `uv run uvicorn vena_lite.main:app --reload`."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import dimensions as dimensions_api
from .api import drivers as drivers_api
from .api import scenarios as scenarios_api
from .api import slice as slice_api
from .api import submit as submit_api

app = FastAPI(title="Vena-lite", version="0.1.0")

# v1 is single-user / localhost only. CORS allows the Office add-in (Slice 2+)
# served from https://localhost:3000 (Vite dev) to call this API directly when
# the Vite proxy isn't in front of it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://localhost:3000",
        "http://localhost:3000",
        "https://localhost:3001",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(slice_api.router)
app.include_router(submit_api.router)
app.include_router(scenarios_api.router)
app.include_router(drivers_api.router)
app.include_router(dimensions_api.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
