"""Pure query helpers: expand_filters + aggregate_to_requested."""
from __future__ import annotations

from decimal import Decimal

from vena_lite.metadata.dim_model import DimModel
from vena_lite.query import aggregate_to_requested, expand_filters
from vena_lite.schemas.dimensions import DimFilter
from vena_lite.schemas.slice import FactRow


def _row(value: str, **overrides) -> FactRow:
    base = dict(
        account="4000_Revenue",
        entity="E001_US",
        costcenter="CC100_Sales",
        period="2026-01",
        scenario="Actual",
        version="v1",
        value=Decimal(value),
    )
    base.update(overrides)
    return FactRow(**base)


# --- expand_filters --------------------------------------------------


def test_expand_with_no_filters_yields_no_cube_filters(dim_model: DimModel):
    cube_filters, mappings = expand_filters({}, dim_model)
    assert cube_filters == {}
    assert all(v is None for v in mappings.values())


def test_expand_with_leaf_filter_passes_through(dim_model: DimModel):
    cube_filters, mappings = expand_filters(
        {"account": DimFilter(members=["4000_Revenue"])}, dim_model
    )
    assert cube_filters["account"].members == ["4000_Revenue"]
    assert mappings["account"] == {"4000_Revenue": "4000_Revenue"}


def test_expand_with_parent_filter_yields_leaves(dim_model: DimModel):
    cube_filters, mappings = expand_filters(
        {"account": DimFilter(members=["Total_PnL"])}, dim_model
    )
    assert sorted(cube_filters["account"].members) == sorted(["4000_Revenue", "5000_OpEx"])
    assert mappings["account"] == {"4000_Revenue": "Total_PnL", "5000_OpEx": "Total_PnL"}


def test_expand_with_two_level_parent(dim_model: DimModel):
    cube_filters, mappings = expand_filters(
        {"period": DimFilter(members=["2026-FY"])}, dim_model
    )
    assert len(cube_filters["period"].members) == 12
    # Every leaf maps back to the year.
    assert all(v == "2026-FY" for v in mappings["period"].values())


def test_expand_with_mixed_parent_and_leaf(dim_model: DimModel):
    cube_filters, mappings = expand_filters(
        {"period": DimFilter(members=["2026-Q1", "2026-07"])}, dim_model
    )
    assert sorted(cube_filters["period"].members) == sorted(
        ["2026-01", "2026-02", "2026-03", "2026-07"]
    )
    assert mappings["period"]["2026-01"] == "2026-Q1"
    assert mappings["period"]["2026-07"] == "2026-07"


def test_expand_with_empty_members_list_preserves_match_nothing(dim_model: DimModel):
    cube_filters, mappings = expand_filters(
        {"account": DimFilter(members=[])}, dim_model
    )
    assert cube_filters["account"].members == []


# --- aggregate_to_requested -----------------------------------------


def test_aggregate_no_mapping_passes_through_as_is():
    rows = [_row("100"), _row("200", period="2026-02")]
    mappings = {dim: None for dim in (
        "account", "entity", "costcenter", "period", "scenario", "version",
    )}
    out = aggregate_to_requested(rows, mappings)  # type: ignore[arg-type]
    assert len(out) == 2  # no group collapse
    assert sum(r.value for r in out) == Decimal("300")


def test_aggregate_sums_when_period_collapsed_to_quarter():
    rows = [
        _row("10", period="2026-01"),
        _row("20", period="2026-02"),
        _row("30", period="2026-03"),
    ]
    mappings = {
        "account": None, "entity": None, "costcenter": None,
        "scenario": None, "version": None,
        "period": {"2026-01": "2026-Q1", "2026-02": "2026-Q1", "2026-03": "2026-Q1"},
    }
    out = aggregate_to_requested(rows, mappings)  # type: ignore[arg-type]
    assert len(out) == 1
    assert out[0].period == "2026-Q1"
    assert out[0].value == Decimal("60")


def test_aggregate_keeps_groups_separate_when_dim_value_differs():
    rows = [
        _row("10", entity="E001_US", period="2026-01"),
        _row("100", entity="E002_UK", period="2026-01"),
    ]
    mappings = {
        "account": None, "costcenter": None, "scenario": None, "version": None,
        "entity": None,  # don't collapse entities
        "period": {"2026-01": "2026-Q1"},
    }
    out = aggregate_to_requested(rows, mappings)  # type: ignore[arg-type]
    assert len(out) == 2
    by_entity = {r.entity: r.value for r in out}
    assert by_entity["E001_US"] == Decimal("10")
    assert by_entity["E002_UK"] == Decimal("100")


def test_aggregate_two_dims_collapsed_simultaneously():
    rows = [
        _row("1", account="4000_Revenue", entity="E001_US"),
        _row("2", account="4000_Revenue", entity="E002_UK"),
        _row("3", account="5000_OpEx", entity="E001_US"),
        _row("4", account="5000_OpEx", entity="E002_UK"),
    ]
    mappings = {
        "costcenter": None, "period": None, "scenario": None, "version": None,
        "account": {"4000_Revenue": "Total_PnL", "5000_OpEx": "Total_PnL"},
        "entity": {"E001_US": "Worldwide", "E002_UK": "Worldwide"},
    }
    out = aggregate_to_requested(rows, mappings)  # type: ignore[arg-type]
    assert len(out) == 1
    assert out[0].account == "Total_PnL"
    assert out[0].entity == "Worldwide"
    assert out[0].value == Decimal("10")


def test_aggregate_empty_input_yields_empty():
    mappings = {dim: None for dim in (
        "account", "entity", "costcenter", "period", "scenario", "version",
    )}
    assert aggregate_to_requested([], mappings) == []  # type: ignore[arg-type]
