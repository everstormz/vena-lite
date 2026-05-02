"""Audit-row helpers. Pure functions — no I/O. The SQLite write happens in
`metadata.store.SQLiteMetadataStore.append_audit_rows`.

Decimals serialize to TEXT (matches schema.sql comment). `None` for `before_value`
is the explicit "no previous fact existed" signal.

Slice 9: `details` is a JSON column for non-submit kinds (dim_change,
driver_change). For submit-style rows it stays None.
"""

from __future__ import annotations

import json
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
                None,  # details
            )
        )
    return rows


def build_dim_change_audit_row(
    *,
    request_id: str,
    dim: str,
    member: str,
    field: str,
    before: object,
    after: object,
    who: str = "local",
) -> AuditRow:
    """Audit row for a dim_member CRUD event.

    Reuses the submit intersection columns as sentinels: account_id=dim,
    entity_id=member, others="" (NOT NULL satisfied). `before_value`/`after_value`
    carry the field's old/new value as strings; `details` JSON has the structured
    record for downstream consumers.
    """
    details = json.dumps(
        {"dim": dim, "member": member, "field": field, "before": before, "after": after},
        separators=(",", ":"),
        default=str,
    )
    return (
        request_id,
        who,
        dim,
        member,
        "",
        "",
        "",
        "",
        None if before is None else str(before),
        "" if after is None else str(after),
        "dim_change",
        details,
    )


def build_driver_change_audit_row(
    *,
    request_id: str,
    account: str,
    action: str,
    formula: str | None,
    who: str = "local",
) -> AuditRow:
    """Audit row for a driver definition or removal."""
    details = json.dumps(
        {"account": account, "action": action, "formula": formula},
        separators=(",", ":"),
    )
    return (
        request_id,
        who,
        account,
        "",
        "",
        "",
        "",
        "",
        None,
        formula or "",
        "driver_change",
        details,
    )
