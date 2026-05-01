"""Slice 4 demo hierarchy. Loaded into `dim_member` by the seed CLI.

Account / Entity / Period get one parent layer (Period gets two: months → quarters
→ year). CostCenter / Scenario / Version are flat — every member is its own root.

Every leaf member here MUST appear in seed.py's leaf lists; the test suite
asserts this so the cube and the hierarchy can't drift.
"""
from __future__ import annotations

from .seed import ACCOUNTS, COSTCENTERS, ENTITIES, PERIODS, SCENARIOS, VERSIONS

# (dim, member, parent_or_None, rollup_op, ordinal)
HierarchyRow = tuple[str, str, str | None, str, int]


def _flat(dim: str, members: list[str]) -> list[HierarchyRow]:
    return [(dim, m, None, "sum", i) for i, m in enumerate(members)]


def _account_hierarchy() -> list[HierarchyRow]:
    rows: list[HierarchyRow] = [("account", "Total_PnL", None, "sum", 0)]
    rows += [("account", a, "Total_PnL", "sum", i + 1) for i, a in enumerate(ACCOUNTS)]
    return rows


def _entity_hierarchy() -> list[HierarchyRow]:
    rows: list[HierarchyRow] = [("entity", "Worldwide", None, "sum", 0)]
    rows += [("entity", e, "Worldwide", "sum", i + 1) for i, e in enumerate(ENTITIES)]
    return rows


def _period_hierarchy() -> list[HierarchyRow]:
    """2026-FY -> 2026-Q{1..4} -> 2026-{01..12}.

    Parents are derived from PERIODS so adding a month to seed.py auto-extends.
    """
    rows: list[HierarchyRow] = [("period", "2026-FY", None, "sum", 0)]
    quarters = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]
    for i, q in enumerate(quarters):
        rows.append(("period", q, "2026-FY", "sum", i + 1))
    for i, p in enumerate(PERIODS):
        month = int(p.split("-")[1])
        q = quarters[(month - 1) // 3]
        rows.append(("period", p, q, "sum", 100 + i))
    return rows


def hierarchy_seed() -> list[HierarchyRow]:
    rows: list[HierarchyRow] = []
    rows += _account_hierarchy()
    rows += _entity_hierarchy()
    rows += _flat("costcenter", COSTCENTERS)
    rows += _period_hierarchy()
    rows += _flat("scenario", SCENARIOS)
    rows += _flat("version", VERSIONS)
    return rows
