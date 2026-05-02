"""POST /drivers/define — register a driver and materialize its values.

Validation:
- account must be a known leaf in the dim model.
- formula must parse.
- All references must be known leaf accounts.
- Adding the driver must not create a cycle in the dependency graph.

After validation, INSERT OR REPLACE the driver row, then compute the driver's
value at every (entity, costcenter, period, scenario, version) tuple that
currently exists in the cube. Cube + audit writes are atomic per the standard
nested-transaction pattern.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..audit import build_driver_change_audit_row
from ..calc.engine import CalcEngine, Driver
from ..calc.parser import FormulaError, parse_formula
from ..calc.recalc import recalc_for_initial_define
from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..metadata.store import SQLiteMetadataStore
from ..schemas.drivers import (
    DriverDefineRequest,
    DriverDefineResponse,
    DriverDeleteResponse,
    DriverInfo,
    DriverListResponse,
)
from .deps import get_calc_engine, get_cube, get_dim_model, get_metadata

router = APIRouter()


@router.get("/drivers", response_model=DriverListResponse)
def list_drivers(
    audit: SQLiteMetadataStore = Depends(get_metadata),
) -> DriverListResponse:
    rows = audit.fetch_drivers()
    return DriverListResponse(drivers=[DriverInfo(account=a, formula=f) for a, f in rows])


@router.post("/drivers/define", response_model=DriverDefineResponse)
def define_driver(
    req: DriverDefineRequest,
    cube: DuckDBCubeStore = Depends(get_cube),
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
    engine: CalcEngine = Depends(get_calc_engine),
) -> DriverDefineResponse:
    # 1. Output account must be a known leaf.
    if not dim_model.is_known("account", req.account):
        raise HTTPException(
            status_code=400,
            detail={"code": "DRIVER_DEFINE_INVALID", "message": f"Unknown account {req.account!r}"},
        )
    if not dim_model.is_leaf("account", req.account):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "DRIVER_DEFINE_INVALID",
                "message": f"Driver output must be a leaf account: {req.account!r}",
            },
        )

    # 2. Formula must parse.
    try:
        ast = parse_formula(req.formula)
    except FormulaError as e:
        raise HTTPException(
            status_code=400,
            detail={"code": "DRIVER_FORMULA_INVALID", "message": str(e)},
        ) from e

    refs = sorted(ast.references())

    # 3. Every reference must be a known leaf account.
    for r in refs:
        if not dim_model.is_known("account", r):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "DRIVER_REFERENCE_UNKNOWN",
                    "message": f"Unknown account in formula: {r!r}",
                },
            )
        if not dim_model.is_leaf("account", r):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "DRIVER_REFERENCE_NON_LEAF",
                    "message": f"Reference must be a leaf account: {r!r}",
                },
            )

    # 4. Cycle check.
    if engine.would_cycle(req.account, set(refs)):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "DRIVER_CYCLE",
                "message": f"Adding {req.account!r} = {req.formula!r} creates a cycle",
            },
        )

    # 5. Persist + materialize. Same atomicity model as /submit:
    #    SQLite transaction (audit + driver row + dim_member-style upserts) commits
    #    INSIDE the DuckDB transaction. Cube commits last.
    new_engine = CalcEngine(
        [
            *[Driver(d, f, parse_formula(f)) for d, f in audit.fetch_drivers() if d != req.account],
            Driver(req.account, req.formula, ast),
        ]
    )

    with cube.transaction():
        with audit.transaction():
            audit.upsert_driver(req.account, req.formula)
            initial_count = recalc_for_initial_define(
                new_engine, cube, audit, req.account, req.request_id
            )

    return DriverDefineResponse(
        request_id=req.request_id,
        account=req.account,
        formula=req.formula,
        references=refs,
        initial_computed_count=initial_count,
    )


@router.delete("/drivers/{account}", response_model=DriverDeleteResponse)
def delete_driver_endpoint(
    account: str,
    request_id: str,
    audit: SQLiteMetadataStore = Depends(get_metadata),
) -> DriverDeleteResponse:
    """Undefine a driver. Prior computed facts stay in the cube (append-only);
    future manual /submit calls to this account become legal again."""
    formula = audit.fetch_driver(account)
    if formula is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "DRIVER_NOT_DEFINED",
                "message": f"No driver defined for account {account!r}",
            },
        )

    audit_row = build_driver_change_audit_row(
        request_id=request_id,
        account=account,
        action="undefine",
        formula=formula,
    )
    with audit.transaction():
        audit.delete_driver(account)
        audit.append_audit_rows([audit_row])
        audit_id = audit.last_audit_id()

    return DriverDeleteResponse(
        request_id=request_id,
        account=account,
        formula=formula,
        audit_id=audit_id,
    )
