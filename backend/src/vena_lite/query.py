"""Hierarchy expansion + post-cube aggregation. Pure functions; no I/O.

The slice endpoint orchestrates: validate -> expand_filters -> cube.slice ->
aggregate_to_requested. Tests live in tests/unit/test_query.py.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from .metadata.dim_model import DimModel
from .schemas.dimensions import DIM_NAMES, DimFilter, DimName
from .schemas.slice import FactRow

# For each dim with an active filter, a {leaf_member -> requested_member} map.
# `None` means "no filter on this dim" — leaves project to themselves.
LeafToRequested = dict[str, str]
Mappings = dict[DimName, LeafToRequested | None]


def expand_filters(
    filters: dict[DimName, DimFilter],
    dim_model: DimModel,
) -> tuple[dict[DimName, DimFilter], Mappings]:
    """For each active filter, expand parents to leaves and remember the
    inverse mapping so aggregation can re-attach the requested level.

    Caller is responsible for pre-validating member existence.
    """
    cube_filters: dict[DimName, DimFilter] = {}
    mappings: Mappings = {dim: None for dim in DIM_NAMES}

    for dim, f in filters.items():
        if f.members is None:
            continue
        if not f.members:
            # Empty list = "match nothing"; preserve that by returning empty cube filter.
            cube_filters[dim] = DimFilter(members=[])
            mappings[dim] = {}
            continue
        leaves: list[str] = []
        m: LeafToRequested = {}
        for requested in f.members:
            for leaf in dim_model.get_leaves(dim, requested):
                leaves.append(leaf)
                m[leaf] = requested
        cube_filters[dim] = DimFilter(members=leaves)
        mappings[dim] = m
    return cube_filters, mappings


_DIM_VALUE_GETTERS: dict[DimName, str] = {
    "account": "account",
    "entity": "entity",
    "costcenter": "costcenter",
    "period": "period",
    "scenario": "scenario",
    "version": "version",
}


def aggregate_to_requested(
    leaf_rows: list[FactRow],
    mappings: Mappings,
) -> list[FactRow]:
    """Group leaf rows by their projected dim values; sum within each group.

    Projection per dim: if a mapping exists, leaf -> requested via mapping; else
    leaf projects to itself (no aggregation collapses across that dim).

    v1: SUM only. Per-Account weighted-avg / first / last lands in a later slice.
    """
    grouped: dict[tuple[str, ...], Decimal] = defaultdict(lambda: Decimal(0))
    for row in leaf_rows:
        key = tuple(
            (mappings[dim] or {}).get(getattr(row, attr), getattr(row, attr))
            if mappings[dim] is not None
            else getattr(row, attr)
            for dim, attr in _DIM_VALUE_GETTERS.items()
        )
        grouped[key] += row.value

    out = [
        FactRow(
            account=k[0],
            entity=k[1],
            costcenter=k[2],
            period=k[3],
            scenario=k[4],
            version=k[5],
            value=v,
        )
        for k, v in grouped.items()
    ]
    out.sort(key=lambda r: (r.account, r.entity, r.costcenter, r.period, r.scenario, r.version))
    return out
