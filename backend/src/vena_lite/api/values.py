"""GET /value — single-cell lookup (Slice 11).

Powers Excel's `=VENA(...)` custom function. Thin wrapper around
`cube.lookup_current_values`. 404 when no fact exists at the requested
intersection. Returns Decimal-as-string per the wire convention plus the
`source` tag (so the OverridePanel can detect 'override:%' rows).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from ..cube.store import DuckDBCubeStore
from ..schemas.values import ValueResponse
from .deps import get_cube

router = APIRouter()


@router.get("/value", response_model=ValueResponse)
def get_value(
    account: str,
    entity: str,
    costcenter: str,
    period: str,
    scenario: str,
    version: str,
    cube: DuckDBCubeStore = Depends(get_cube),
) -> ValueResponse:
    sql = (
        "SELECT value, source, loaded_at FROM facts_current WHERE "
        "account_id=? AND entity_id=? AND costcenter_id=? AND period_id=? "
        "AND scenario_id=? AND version_id=?"
    )
    row = cube._conn.execute(  # noqa: SLF001 — cube doesn't expose this query yet
        sql, [account, entity, costcenter, period, scenario, version]
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "VALUE_NOT_FOUND",
                "intersection": {
                    "account": account,
                    "entity": entity,
                    "costcenter": costcenter,
                    "period": period,
                    "scenario": scenario,
                    "version": version,
                },
            },
        )
    value, source, loaded_at = row
    loaded_str = (
        loaded_at.isoformat() if isinstance(loaded_at, datetime) else str(loaded_at)
    )
    return ValueResponse(
        account=account,
        entity=entity,
        costcenter=costcenter,
        period=period,
        scenario=scenario,
        version=version,
        value=value,
        source=source,
        loaded_at=loaded_str,
    )
