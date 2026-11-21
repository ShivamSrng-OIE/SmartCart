"""Serve derived evidence artifacts from the run that produced them."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend import evidence

evidence_router = APIRouter()


@evidence_router.get("/api/evidence/{run_id}/{file}")
def get_evidence(run_id: str, file: str):
    if evidence.FILE_NAME.fullmatch(file):
        try:
            path = evidence.run_directory(run_id) / file
            if path.resolve(strict=True) == path and path.is_file():
                return FileResponse(path)
        except (ValueError, OSError, RuntimeError):
            pass
    raise HTTPException(404, "Evidence file not found")
