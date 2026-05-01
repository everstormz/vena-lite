"""POST /slice — validates members against the hierarchy, expands parents to
leaves, queries the cube, then aggregates back up to the requested level.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..query import aggregate_to_requested, expand_filters
from ..schemas.slice import SliceRequest, SliceResponse
from .deps import get_cube, get_dim_model

router = APIRouter()


def _validate_members(
    req: SliceRequest, dim_model: DimModel
) -> list[dict]:
    errors: list[dict] = []
    for dim, f in req.filters.items():
        if f.members is None:
            continue
        for m in f.members:
            if not dim_model.is_known(dim, m):
                errors.append({"dim": dim, "member": m})
    return errors


@router.post("/slice", response_model=SliceResponse)
def slice_endpoint(
    req: SliceRequest,
    cube: DuckDBCubeStore = Depends(get_cube),
    dim_model: DimModel = Depends(get_dim_model),
) -> SliceResponse:
    errors = _validate_members(req, dim_model)
    if errors:
        raise HTTPException(
            status_code=400,
            detail={"code": "MEMBER_UNKNOWN", "unknown": errors},
        )

    cube_filters, mappings = expand_filters(req.filters, dim_model)
    leaf_rows = cube.slice(cube_filters)
    rows = aggregate_to_requested(leaf_rows, mappings)
    return SliceResponse(rows=rows, total=len(rows))
