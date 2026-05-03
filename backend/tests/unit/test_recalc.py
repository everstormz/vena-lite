"""Unit tests for `compute_driver_cells`. Integration coverage of recalc lives
in `test_drivers_endpoint.py` and `test_overrides_endpoint.py`.
"""

from __future__ import annotations

from decimal import Decimal

from vena_lite.calc.engine import CalcEngine, Driver
from vena_lite.calc.parser import parse_formula
from vena_lite.calc.recalc import compute_driver_cells
from vena_lite.cube.store import DuckDBCubeStore


def _engine_with(formulas: dict[str, str]) -> CalcEngine:
    drivers = [Driver(acc, src, parse_formula(src)) for acc, src in formulas.items()]
    return CalcEngine(drivers)


def test_compute_driver_cells_emits_one_row_per_target(empty_store: DuckDBCubeStore):
    """Sanity: single driver, two target intersections → two cells."""
    empty_store.bulk_insert(
        [
            ("4000_Revenue", "E", "C", "2026-01", "Actual", "v1", Decimal("100")),
            ("4000_Revenue", "E", "C", "2026-02", "Actual", "v1", Decimal("200")),
        ],
        source="seed",
    )
    engine = _engine_with({"X": "4000_Revenue * 2"})
    cells = compute_driver_cells(
        engine,
        empty_store,
        ["X"],
        [("E", "C", "2026-01", "Actual", "v1"), ("E", "C", "2026-02", "Actual", "v1")],
    )
    assert len(cells) == 2
    assert {c.value for c in cells} == {Decimal("200"), Decimal("400")}


def test_compute_driver_cells_skips_overridden_intersections(
    empty_store: DuckDBCubeStore,
):
    """If (X, t) is in `overrides`, no driver row is emitted for that
    intersection — the override fact in the cube remains the current value.
    """
    empty_store.bulk_insert(
        [
            ("4000_Revenue", "E", "C", "2026-01", "Actual", "v1", Decimal("100")),
            ("4000_Revenue", "E", "C", "2026-02", "Actual", "v1", Decimal("200")),
        ],
        source="seed",
    )
    engine = _engine_with({"X": "4000_Revenue * 2"})

    overridden = {("X", "E", "C", "2026-01", "Actual", "v1")}
    cells = compute_driver_cells(
        engine,
        empty_store,
        ["X"],
        [("E", "C", "2026-01", "Actual", "v1"), ("E", "C", "2026-02", "Actual", "v1")],
        overrides=overridden,
    )
    assert len(cells) == 1
    assert cells[0].period == "2026-02"
    assert cells[0].value == Decimal("400")


def test_compute_driver_cells_empty_overrides_set_is_no_op(
    empty_store: DuckDBCubeStore,
):
    """Behaviour matches the no-overrides default."""
    empty_store.bulk_insert(
        [("4000_Revenue", "E", "C", "2026-01", "Actual", "v1", Decimal("100"))],
        source="seed",
    )
    engine = _engine_with({"X": "4000_Revenue * 2"})
    target = [("E", "C", "2026-01", "Actual", "v1")]
    no_set = compute_driver_cells(engine, empty_store, ["X"], target)
    empty_set = compute_driver_cells(engine, empty_store, ["X"], target, overrides=set())
    assert [c.value for c in no_set] == [c.value for c in empty_set] == [Decimal("200")]


def test_compute_driver_cells_downstream_sees_overridden_upstream_via_cube(
    empty_store: DuckDBCubeStore,
):
    """If A is overridden and Y = A + 1, recompute of Y reads the override
    from the cube via lookup_current_values — Y's value reflects the override.
    """
    # Override on A at the target intersection
    empty_store.bulk_insert(
        [("A", "E", "C", "2026-01", "Actual", "v1", Decimal("999"))],
        source="override:test",
    )
    engine = _engine_with({"Y": "A + 1"})

    # No override on Y itself, so Y gets recomputed using the override value.
    cells = compute_driver_cells(
        engine,
        empty_store,
        ["Y"],
        [("E", "C", "2026-01", "Actual", "v1")],
    )
    assert len(cells) == 1
    assert cells[0].account == "Y"
    assert cells[0].value == Decimal("1000")
