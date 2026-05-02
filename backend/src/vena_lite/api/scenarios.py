"""POST /scenarios/copy — fork a (scenario, version) into a new one.

Source must be known leaves in the dim model. Target scenario/version are
auto-registered in `dim_member` (flat, no parent) if they don't yet exist; if
they do exist they must be leaves and we just re-copy on top (latest-loaded
wins via `facts_current`).

Atomicity: dim_member upsert + audit_log rows commit FIRST in the SQLite
transaction; cube facts commit SECOND in the DuckDB transaction. Same
ghost-audit-on-cube-failure tradeoff as /submit.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..audit import build_audit_rows, intersection_key
from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..metadata.store import DimMemberRow, SQLiteMetadataStore
from ..schemas.dimensions import DimFilter
from ..schemas.scenarios import (
    CreatedDimMember,
    ScenarioCopyRequest,
    ScenarioCopyResponse,
    ScenarioRef,
)
from ..schemas.submit import SubmittedCell
from .deps import get_cube, get_dim_model, get_metadata

router = APIRouter()


def _validate_source(src: ScenarioRef, dim_model: DimModel) -> list[dict]:
    errors: list[dict] = []
    for dim, value in (("scenario", src.scenario), ("version", src.version)):
        if not dim_model.is_known(dim, value):
            errors.append({"dim": dim, "member": value, "reason": "unknown"})
        elif not dim_model.is_leaf(dim, value):
            errors.append({"dim": dim, "member": value, "reason": "non_leaf"})
    return errors


def _validate_existing_target(tgt: ScenarioRef, dim_model: DimModel) -> list[dict]:
    """Target members need only be leaves IF they already exist; new members are fine."""
    errors: list[dict] = []
    for dim, value in (("scenario", tgt.scenario), ("version", tgt.version)):
        if dim_model.is_known(dim, value) and not dim_model.is_leaf(dim, value):
            errors.append({"dim": dim, "member": value, "reason": "non_leaf"})
    return errors


def _new_dim_members(tgt: ScenarioRef, dim_model: DimModel) -> list[CreatedDimMember]:
    out: list[CreatedDimMember] = []
    for dim, value in (("scenario", tgt.scenario), ("version", tgt.version)):
        if not dim_model.is_known(dim, value):
            out.append(CreatedDimMember(dim=dim, member=value))
    return out


@router.post("/scenarios/copy", response_model=ScenarioCopyResponse)
def copy_scenario(
    req: ScenarioCopyRequest,
    cube: DuckDBCubeStore = Depends(get_cube),
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
) -> ScenarioCopyResponse:
    src_errors = _validate_source(req.source, dim_model)
    tgt_errors = _validate_existing_target(req.target, dim_model)
    if src_errors or tgt_errors:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "SCENARIO_COPY_INVALID",
                "source_errors": src_errors,
                "target_errors": tgt_errors,
            },
        )

    # Read source facts (latest values) via the existing slice path.
    source_rows = cube.slice(
        {
            "scenario": DimFilter(members=[req.source.scenario]),
            "version": DimFilter(members=[req.source.version]),
        }
    )

    # Build target cube rows + before-value lookup at target.
    target_cells = [
        SubmittedCell(
            account=r.account,
            entity=r.entity,
            costcenter=r.costcenter,
            period=r.period,
            scenario=req.target.scenario,
            version=req.target.version,
            value=r.value,
        )
        for r in source_rows
    ]
    intersections = [intersection_key(c) for c in target_cells]
    before_map = cube.lookup_current_values(intersections)

    cube_rows = [
        (c.account, c.entity, c.costcenter, c.period, c.scenario, c.version, c.value)
        for c in target_cells
    ]
    audit_rows = build_audit_rows(target_cells, before_map, req.request_id, source="copy")

    created = _new_dim_members(req.target, dim_model)
    new_dim_rows: list[DimMemberRow] = [(m.dim, m.member, None, "sum", 0, None) for m in created]

    cube_source = f"copy:{req.request_id}:from={req.source.scenario}/{req.source.version}"

    # Atomic write: cube outer (commits last), audit inner (commits first).
    # dim_member upsert lives inside the SQLite transaction so it rolls back
    # together with audit if cube fails to begin.
    with cube.transaction():
        with audit.transaction():
            if new_dim_rows:
                audit.bulk_insert_dim_members(new_dim_rows)
            cube.bulk_insert(cube_rows, source=cube_source)
            audit.append_audit_rows(audit_rows)

    return ScenarioCopyResponse(
        request_id=req.request_id,
        source=req.source,
        target=req.target,
        copied_count=len(target_cells),
        created_members=created,
    )
