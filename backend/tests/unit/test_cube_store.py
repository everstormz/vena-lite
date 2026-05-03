"""Cube store correctness against the 96-fact seed."""

from __future__ import annotations

from decimal import Decimal

from vena_lite.cube.store import DuckDBCubeStore
from vena_lite.schemas.dimensions import DimFilter
from vena_lite.seed import (
    ACCOUNTS,
    COSTCENTERS,
    ENTITIES,
    EXPECTED_FACT_COUNT,
    deterministic_value,
)


def test_slice_no_filters_returns_all_96(seeded_store: DuckDBCubeStore):
    rows = seeded_store.slice({})
    assert len(rows) == EXPECTED_FACT_COUNT == 96


def test_slice_filter_one_dim_account_returns_48(seeded_store: DuckDBCubeStore):
    """One of two accounts → exactly half: 48 rows."""
    rows = seeded_store.slice({"account": DimFilter(members=[ACCOUNTS[0]])})
    assert len(rows) == 48
    assert all(r.account == ACCOUNTS[0] for r in rows)


def test_slice_filter_two_dims_account_and_entity_returns_24(seeded_store: DuckDBCubeStore):
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[ACCOUNTS[0]]),
            "entity": DimFilter(members=[ENTITIES[0]]),
        }
    )
    assert len(rows) == 24
    assert all(r.account == ACCOUNTS[0] and r.entity == ENTITIES[0] for r in rows)


def test_slice_filter_three_dims_returns_12(seeded_store: DuckDBCubeStore):
    """Account + Entity + CostCenter pinned → 12 periods remain."""
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[ACCOUNTS[0]]),
            "entity": DimFilter(members=[ENTITIES[0]]),
            "costcenter": DimFilter(members=[COSTCENTERS[0]]),
        }
    )
    assert len(rows) == 12


def test_slice_filter_no_match_returns_empty(seeded_store: DuckDBCubeStore):
    rows = seeded_store.slice({"account": DimFilter(members=["nonexistent_account"])})
    assert rows == []


def test_slice_members_none_means_no_filter_on_that_dim(seeded_store: DuckDBCubeStore):
    rows = seeded_store.slice({"account": DimFilter(members=None)})
    assert len(rows) == EXPECTED_FACT_COUNT


def test_slice_value_is_decimal_not_float(seeded_store: DuckDBCubeStore):
    rows = seeded_store.slice({})
    assert all(isinstance(r.value, Decimal) for r in rows)
    assert all(not isinstance(r.value, float) for r in rows)


def test_slice_value_preserves_six_decimal_places(seeded_store: DuckDBCubeStore):
    """Seed values all end in .123456 — verify the digit pattern is intact."""
    rows = seeded_store.slice({})
    for r in rows:
        # str(Decimal('1.123456')) == '1.123456'; '.' must be there with 6 digits after.
        s = format(r.value, "f")
        fractional = s.split(".")[1] if "." in s else ""
        assert fractional == "123456", f"value {r.value!r} lost precision"


def test_slice_returns_exact_seeded_value_for_known_intersection(
    seeded_store: DuckDBCubeStore,
):
    """Spot-check a single intersection's value matches deterministic_value()."""
    expected = deterministic_value(ACCOUNTS[1], ENTITIES[1], COSTCENTERS[1], "2026-07")
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[ACCOUNTS[1]]),
            "entity": DimFilter(members=[ENTITIES[1]]),
            "costcenter": DimFilter(members=[COSTCENTERS[1]]),
            "period": DimFilter(members=["2026-07"]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == expected


def test_facts_current_view_returns_latest_when_two_rows_same_keys(
    seeded_store: DuckDBCubeStore,
):
    """Append a new row for an existing intersection; slice must return ONLY the latest."""
    key = (ACCOUNTS[0], ENTITIES[0], COSTCENTERS[0], "2026-01", "Actual", "v1")
    new_value = Decimal("99999.999999")

    # Force a strictly-later loaded_at than the seeded row so the latest-wins ordering
    # is unambiguous on systems where the seed and this insert share a millisecond.
    seeded_store._conn.execute(  # noqa: SLF001  (test-only access)
        """
        INSERT INTO facts (account_id, entity_id, costcenter_id, period_id,
                           scenario_id, version_id, value, loaded_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL 1 SECOND, 'test_override')
        """,
        [*key, new_value],
    )

    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[key[0]]),
            "entity": DimFilter(members=[key[1]]),
            "costcenter": DimFilter(members=[key[2]]),
            "period": DimFilter(members=[key[3]]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == new_value


def test_facts_current_view_does_not_return_superseded_rows(
    seeded_store: DuckDBCubeStore,
):
    """After overwriting one cell, total count is still 96 — not 97."""
    key = (ACCOUNTS[0], ENTITIES[0], COSTCENTERS[0], "2026-01", "Actual", "v1")
    seeded_store._conn.execute(  # noqa: SLF001
        """
        INSERT INTO facts (account_id, entity_id, costcenter_id, period_id,
                           scenario_id, version_id, value, loaded_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL 1 SECOND, 'test_override')
        """,
        [*key, Decimal("42.000000")],
    )
    rows = seeded_store.slice({})
    assert len(rows) == EXPECTED_FACT_COUNT  # still 96


def test_empty_store_slice_returns_empty(empty_store: DuckDBCubeStore):
    assert empty_store.slice({}) == []


def test_bulk_insert_round_trips_a_single_row(empty_store: DuckDBCubeStore):
    empty_store.bulk_insert(
        [("A", "E", "C", "2026-01", "Actual", "v1", Decimal("7.000000"))],
        source="test",
    )
    rows = empty_store.slice({})
    assert len(rows) == 1
    assert rows[0].value == Decimal("7.000000")


def test_lookup_overrides_returns_only_currently_overridden(
    empty_store: DuckDBCubeStore,
):
    """Submit row at k1; override at k2; override-then-release at k3.
    lookup_overrides returns only k2 — k1 is a regular submit, k3's latest
    is a release row, so it is no longer overridden.
    """
    k1 = ("A1", "E", "C", "2026-01", "Actual", "v1")
    k2 = ("A2", "E", "C", "2026-01", "Actual", "v1")
    k3 = ("A3", "E", "C", "2026-01", "Actual", "v1")

    empty_store.bulk_insert([(*k1, Decimal("10.000000"))], source="submit:r1")
    empty_store.bulk_insert([(*k2, Decimal("20.000000"))], source="override:r2")
    empty_store.bulk_insert([(*k3, Decimal("30.000000"))], source="override:r3")
    empty_store._conn.execute(  # noqa: SLF001
        """INSERT INTO facts (account_id, entity_id, costcenter_id, period_id,
           scenario_id, version_id, value, loaded_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL 1 SECOND, 'driver:released:r4')""",
        [*k3, Decimal("3.000000")],
    )

    overrides = empty_store.lookup_overrides([k1, k2, k3])
    assert overrides == {k2}


def test_lookup_overrides_empty_input_returns_empty_set(
    empty_store: DuckDBCubeStore,
):
    assert empty_store.lookup_overrides([]) == set()


def test_lookup_overrides_no_match_returns_empty_set(
    seeded_store: DuckDBCubeStore,
):
    """Seeded data uses source='seed_v1' — no overrides exist."""
    k = (ACCOUNTS[0], ENTITIES[0], COSTCENTERS[0], "2026-01", "Actual", "v1")
    assert seeded_store.lookup_overrides([k]) == set()
