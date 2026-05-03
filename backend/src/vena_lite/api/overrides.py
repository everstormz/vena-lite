"""POST /overrides + DELETE /overrides — manual driver-cell overrides (Slice 11).

Override semantics:
- POST writes a fact at the user-supplied driver-cell intersection with
  source='override:<request_id>'. Recalc detects this via `cube.lookup_overrides`
  (source LIKE 'override:%') and SKIPS the cell on subsequent recompute.
- DELETE re-evaluates the formula at the intersection and writes the result
  with source='driver:released:<request_id>'. The next lookup_overrides no
  longer flags the cell, so future recalcs include it.

Both paths trigger downstream recalc via `recalc_for_submit` in the same
nested transactions, so a formula failure rolls back the user's write.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..audit import (
    build_audit_rows,
    build_override_release_audit_rows,
    intersection_key,
)
from ..calc.engine import CalcEngine
from ..calc.recalc import compute_driver_cells, recalc_for_submit
from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..metadata.store import SQLiteMetadataStore
from ..schemas.overrides import (
    OverrideReleaseRequest,
    OverrideRequest,
    OverrideResponse,
)
from ..schemas.submit import SubmittedCell
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


def _validate_override_cells(
    cells: list, dim_model: DimModel, engine: CalcEngine
) -> list[dict]:
    """All dim members must be known leaves, AND the account must be a
    driver-controlled account (overrides only make sense on driver outputs).
    """
    errors: list[dict] = []
    for i, cell in enumerate(cells):
        invalid: list[dict] = []
        for dim, attr in _DIMS_PER_CELL:
            value = getattr(cell, attr)
            if not dim_model.is_known(dim, value):
                invalid.append({"dim": dim, "member": value, "reason": "unknown"})
            elif not dim_model.is_leaf(dim, value):
                invalid.append({"dim": dim, "member": value, "reason": "non_leaf"})
        if not engine.has_driver(cell.account):
            invalid.append(
                {"dim": "account", "member": cell.account, "reason": "not_driver"}
            )
        if invalid:
            errors.append({"cell_index": i, "invalid_members": invalid})
    return errors


@router.post("/overrides", response_model=OverrideResponse)
def post_overrides(
    req: OverrideRequest,
    cube: DuckDBCubeStore = Depends(get_cube),
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
    engine: CalcEngine = Depends(get_calc_engine),
) -> OverrideResponse:
    errors = _validate_override_cells(req.cells, dim_model, engine)
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
    audit_rows = build_audit_rows(
        req.cells, before_map, req.request_id, source="override"
    )

    with cube.transaction():
        with audit.transaction():
            cube.bulk_insert(cube_rows, source=f"override:{req.request_id}")
            audit.append_audit_rows(audit_rows)
            # Downstream recalc: drivers consuming the overridden account see
            # the new value via facts_current. The override account itself
            # isn't recomputed (engine.affected_in_topo_order excludes it
            # unless it self-references — drivers never do).
            recalc_for_submit(engine, cube, audit, req.cells, req.request_id)

    return OverrideResponse(
        request_id=req.request_id, accepted_count=len(req.cells)
    )


@router.delete("/overrides", response_model=OverrideResponse)
def delete_overrides(
    req: OverrideReleaseRequest,
    cube: DuckDBCubeStore = Depends(get_cube),
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
    engine: CalcEngine = Depends(get_calc_engine),
) -> OverrideResponse:
    """Release overrides at the listed intersections. Each intersection's
    account must be driver-controlled and the cell must currently be
    overridden — non-overridden cells are rejected so the audit log stays
    meaningful (no spurious "release" rows for never-overridden cells).
    """
    errors: list[dict] = []
    raw_keys = []
    for i, inter in enumerate(req.cells):
        invalid: list[dict] = []
        for dim, attr in _DIMS_PER_CELL:
            value = getattr(inter, attr)
            if not dim_model.is_known(dim, value):
                invalid.append({"dim": dim, "member": value, "reason": "unknown"})
            elif not dim_model.is_leaf(dim, value):
                invalid.append({"dim": dim, "member": value, "reason": "non_leaf"})
        if not engine.has_driver(inter.account):
            invalid.append(
                {"dim": "account", "member": inter.account, "reason": "not_driver"}
            )
        if invalid:
            errors.append({"cell_index": i, "invalid_members": invalid})
        else:
            raw_keys.append(
                (
                    inter.account,
                    inter.entity,
                    inter.costcenter,
                    inter.period,
                    inter.scenario,
                    inter.version,
                )
            )
    if errors:
        raise HTTPException(
            status_code=400,
            detail={"code": "INTERSECTION_INVALID", "errors": errors},
        )

    overridden = cube.lookup_overrides(raw_keys)
    not_overridden = [k for k in raw_keys if k not in overridden]
    if not_overridden:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "NOT_OVERRIDDEN",
                "message": (
                    f"{len(not_overridden)} of {len(raw_keys)} intersection(s) "
                    "are not currently overridden."
                ),
                "intersections": [
                    {
                        "account": k[0],
                        "entity": k[1],
                        "costcenter": k[2],
                        "period": k[3],
                        "scenario": k[4],
                        "version": k[5],
                    }
                    for k in not_overridden
                ],
            },
        )

    # Compute released-cell values (formulas evaluated with overrides=set()
    # so we get the un-overridden value at each intersection).
    released_cells: list[SubmittedCell] = []
    for k in raw_keys:
        account = k[0]
        target_key = k[1:]
        cells = compute_driver_cells(
            engine, cube, [account], [target_key], overrides=set()
        )
        released_cells.extend(cells)

    if not released_cells:
        return OverrideResponse(request_id=req.request_id, accepted_count=0)

    # before-values are the current (override) values about to be replaced.
    before_map = cube.lookup_current_values(
        [intersection_key(c) for c in released_cells]
    )
    audit_rows = build_override_release_audit_rows(
        released_cells, before_map, req.request_id
    )
    cube_rows = [
        (c.account, c.entity, c.costcenter, c.period, c.scenario, c.version, c.value)
        for c in released_cells
    ]

    with cube.transaction():
        with audit.transaction():
            cube.bulk_insert(cube_rows, source=f"driver:released:{req.request_id}")
            audit.append_audit_rows(audit_rows)
            # Downstream drivers may have consumed the override value; trigger
            # recalc using the released cells as the changed set.
            recalc_for_submit(engine, cube, audit, released_cells, req.request_id)

    return OverrideResponse(
        request_id=req.request_id, accepted_count=len(released_cells)
    )
