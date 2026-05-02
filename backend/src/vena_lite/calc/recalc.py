"""Driver recalculation orchestration. Glues CalcEngine to cube + audit.

Called from /submit (after the user's writes land) and from /drivers/define
(initial compute over every cube intersection).
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal

from ..audit import build_audit_rows, intersection_key
from ..cube.store import DuckDBCubeStore, IntersectionKey
from ..schemas.submit import SubmittedCell
from .engine import CalcEngine
from .parser import FormulaError

# (entity, costcenter, period, scenario, version) — intersection minus account
NonAccountKey = tuple[str, str, str, str, str]


def _strip_account(k: IntersectionKey) -> NonAccountKey:
    return (k[1], k[2], k[3], k[4], k[5])


def _attach_account(account: str, k: NonAccountKey) -> IntersectionKey:
    return (account, *k)


def compute_driver_cells(
    engine: CalcEngine,
    cube: DuckDBCubeStore,
    affected_accounts: list[str],
    target_keys: Iterable[NonAccountKey],
) -> list[SubmittedCell]:
    """For each (driver_account, target_key), look up the inputs in the cube
    (sees uncommitted writes within the same DuckDB transaction) and evaluate.

    Missing input facts default to Decimal(0). Order matters: `affected_accounts`
    must already be topo-sorted so a driver that consumes another driver's
    output sees the freshly-computed value.
    """
    target_list = list(target_keys)
    out_cells: list[SubmittedCell] = []
    just_computed: dict[IntersectionKey, Decimal] = {}

    for account in affected_accounts:
        driver = engine.get(account)
        refs = driver.references()
        for tkey in target_list:
            ref_keys = [_attach_account(r, tkey) for r in refs]
            cube_values = cube.lookup_current_values(ref_keys)
            ctx: dict[str, Decimal] = {}
            for r in refs:
                ik = _attach_account(r, tkey)
                # Prefer a value just computed earlier in this batch over the
                # cube — the cube hasn't seen our INSERT yet within Python.
                if ik in just_computed:
                    ctx[r] = just_computed[ik]
                else:
                    v = cube_values.get(ik)
                    ctx[r] = Decimal(0) if v is None else v
            try:
                value = driver.ast.evaluate(ctx)
            except FormulaError as e:
                raise FormulaError(f"driver {account!r} at {tkey}: {e}") from e
            cell = SubmittedCell(
                account=account,
                entity=tkey[0],
                costcenter=tkey[1],
                period=tkey[2],
                scenario=tkey[3],
                version=tkey[4],
                value=value,
            )
            out_cells.append(cell)
            just_computed[_attach_account(account, tkey)] = value

    return out_cells


def recalc_for_submit(
    engine: CalcEngine,
    cube: DuckDBCubeStore,
    audit,  # SQLiteMetadataStore
    submitted_cells: list[SubmittedCell],
    request_id: str,
) -> int:
    """If any submitted account is consumed by a driver, recompute affected
    drivers at the SAME (entity, costcenter, period, scenario, version) keys
    and write the new values + audit rows. Caller must hold the surrounding
    transactions. Returns the number of driver cells written.
    """
    changed_accounts = {c.account for c in submitted_cells}
    affected = engine.affected_in_topo_order(changed_accounts)
    if not affected:
        return 0

    target_keys = sorted({_strip_account(intersection_key(c)) for c in submitted_cells})
    driver_cells = compute_driver_cells(engine, cube, affected, target_keys)
    if not driver_cells:
        return 0

    # Audit before-values come from the cube (which still reflects pre-recalc
    # state for these driver accounts since we haven't inserted yet).
    driver_intersections = [intersection_key(c) for c in driver_cells]
    before_map = cube.lookup_current_values(driver_intersections)
    driver_audit_rows = build_audit_rows(
        driver_cells, before_map, request_id, who="driver", source="driver"
    )

    cube.bulk_insert(
        [
            (c.account, c.entity, c.costcenter, c.period, c.scenario, c.version, c.value)
            for c in driver_cells
        ],
        source=f"driver:{request_id}",
    )
    audit.append_audit_rows(driver_audit_rows)
    return len(driver_cells)


def recalc_for_initial_define(
    engine: CalcEngine,
    cube: DuckDBCubeStore,
    audit,  # SQLiteMetadataStore
    new_driver_account: str,
    request_id: str,
) -> int:
    """Compute the new driver's value for every (entity, costcenter, period,
    scenario, version) currently in the cube. Caller holds the transactions.
    """
    # All distinct intersections that exist in the cube (any account).
    all_rows = cube.slice({})
    target_keys = sorted({_strip_account(intersection_key(c)) for c in all_rows})  # type: ignore[arg-type]
    if not target_keys:
        return 0

    affected = engine.affected_in_topo_order({new_driver_account})
    # Definition itself isn't in `affected` because nothing has changed for it
    # yet — but we want to materialize the new driver's values, so include it.
    if new_driver_account not in affected:
        affected = [new_driver_account] + affected

    driver_cells = compute_driver_cells(engine, cube, affected, target_keys)
    if not driver_cells:
        return 0

    driver_intersections = [intersection_key(c) for c in driver_cells]
    before_map = cube.lookup_current_values(driver_intersections)
    driver_audit_rows = build_audit_rows(
        driver_cells, before_map, request_id, who="driver", source="driver:initial"
    )
    cube.bulk_insert(
        [
            (c.account, c.entity, c.costcenter, c.period, c.scenario, c.version, c.value)
            for c in driver_cells
        ],
        source=f"driver:initial:{request_id}",
    )
    audit.append_audit_rows(driver_audit_rows)
    return len(driver_cells)
