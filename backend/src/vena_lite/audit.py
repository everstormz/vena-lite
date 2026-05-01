"""Audit-row helpers. Pure functions — no I/O. The SQLite write happens in
`metadata.store.SQLiteMetadataStore.append_audit_rows`.

Decimals serialize to TEXT (matches schema.sql comment). `None` for `before_value`
is the explicit "no previous fact existed" signal.
"""
from __future__ import annotations

from decimal import Decimal

from .metadata.store import AuditRow
from .schemas.submit import SubmittedCell

IntersectionKey = tuple[str, str, str, str, str, str]


def intersection_key(cell: SubmittedCell) -> IntersectionKey:
    return (cell.account, cell.entity, cell.costcenter, cell.period, cell.scenario, cell.version)


def _fmt(d: Decimal | None) -> str | None:
    return None if d is None else format(d, "f")


def build_audit_rows(
    cells: list[SubmittedCell],
    before_values: dict[IntersectionKey, Decimal | None],
    submit_request_id: str,
    who: str = "local",
    source: str = "submit",
) -> list[AuditRow]:
    """Build audit rows for a submit batch.

    `before_values` should contain the latest cube value for every intersection
    in `cells` (or `None` if no fact existed). Caller is responsible for the
    lookup; this function does no I/O.
    """
    rows: list[AuditRow] = []
    for cell in cells:
        key = intersection_key(cell)
        before = before_values.get(key)
        rows.append(
            (
                submit_request_id,
                who,
                cell.account,
                cell.entity,
                cell.costcenter,
                cell.period,
                cell.scenario,
                cell.version,
                _fmt(before),
                _fmt(cell.value) or "",  # after_value is non-null per schema
                source,
            )
        )
    return rows
