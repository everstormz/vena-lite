"""POST /submit — write endpoint. v1 enforces leaf-only writes and rejects
direct edits to driver-controlled accounts (Slice 6).

Atomicity: cube `bulk_insert` + SQLite `audit_log` writes in nested
transactions, then driver recalc happens IN THE SAME TRANSACTIONS so a
formula failure rolls back the user write too.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..audit import build_audit_rows, intersection_key
from ..calc.engine import CalcEngine
from ..calc.recalc import recalc_for_submit
from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..metadata.store import SQLiteMetadataStore
from ..schemas.submit import SubmitRequest, SubmitResponse
from .deps import get_calc_engine, get_cube, get_dim_model, get_metadata

router = APIRouter()

_DIMS_PER_CELL: tuple[tuple[str, str], ...] = (
    ("account", "account"),
    ("entity", "entity"),
    ("costcenter", "costcenter"),
    ("period", "period"),
    ("scenario", "scenario"),
    ("version", "version"),
)


def _validate_cells(
    cells: list, dim_model: DimModel, engine: CalcEngine
) -> list[dict]:
    errors: list[dict] = []
    for i, cell in enumerate(cells):
        invalid: list[dict] = []
        for dim, attr in _DIMS_PER_CELL:
            value = getattr(cell, attr)
            if not dim_model.is_known(dim, value):
                invalid.append({"dim": dim, "member": value, "reason": "unknown"})
            elif not dim_model.is_leaf(dim, value):
                invalid.append({"dim": dim, "member": value, "reason": "non_leaf"})
        # Slice 6: driver-controlled accounts are read-only via /submit.
        if engine.has_driver(cell.account):
            invalid.append({"dim": "account", "member": cell.account, "reason": "driver"})
        if invalid:
            errors.append({"cell_index": i, "invalid_members": invalid})
    return errors


@router.post("/submit", response_model=SubmitResponse)
def submit_endpoint(
    req: SubmitRequest,
    cube: DuckDBCubeStore = Depends(get_cube),
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
    engine: CalcEngine = Depends(get_calc_engine),
) -> SubmitResponse:
    errors = _validate_cells(req.cells, dim_model, engine)
    if errors:
        raise HTTPException(
            status_code=400,
            detail={"code": "INTERSECTION_INVALID", "errors": errors},
        )

    intersections = [intersection_key(c) for c in req.cells]
    before_map = cube.lookup_current_values(intersections)

    cube_rows = [
        (c.account, c.entity, c.costcenter, c.period, c.scenario, c.version, c.value)
        for c in req.cells
    ]
    source = f"submit:{req.request_id}"
    audit_rows = build_audit_rows(req.cells, before_map, req.request_id)

    with cube.transaction():
        with audit.transaction():
            cube.bulk_insert(cube_rows, source=source)
            audit.append_audit_rows(audit_rows)
            # Driver recalc happens in the SAME transactions: a formula failure
            # rolls back the user's writes too.
            recalc_for_submit(engine, cube, audit, req.cells, req.request_id)

    return SubmitResponse(request_id=req.request_id, accepted_count=len(req.cells))
