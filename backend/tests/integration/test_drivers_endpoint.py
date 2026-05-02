"""POST /drivers/define + driver recalc triggered by /submit."""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from vena_lite.api.deps import (
    get_calc_engine,
    get_cube,
    get_dim_model,
    get_metadata,
)
from vena_lite.calc.engine import CalcEngine
from vena_lite.cube.store import DuckDBCubeStore
from vena_lite.main import app
from vena_lite.metadata.dim_model import DimModel
from vena_lite.metadata.store import SQLiteMetadataStore
from vena_lite.schemas.dimensions import DimFilter


@pytest.fixture
def client(
    seeded_store: DuckDBCubeStore,
    hierarchy_seeded_metadata: SQLiteMetadataStore,
) -> Iterator[TestClient]:
    """Real metadata so /drivers/define persists and the next request's
    get_calc_engine + get_dim_model see the new state."""
    md = hierarchy_seeded_metadata
    app.dependency_overrides[get_cube] = lambda: seeded_store
    app.dependency_overrides[get_metadata] = lambda: md
    app.dependency_overrides[get_dim_model] = lambda: DimModel.from_store(md)
    app.dependency_overrides[get_calc_engine] = lambda: CalcEngine.from_store(md)
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


# --- define: happy path + initial compute ---------------------------


def test_define_returns_200_and_metadata(client: TestClient):
    r = client.post(
        "/drivers/define",
        json={
            "request_id": "drv-1",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["account"] == "5000_OpEx"
    assert body["references"] == ["4000_Revenue"]
    # 48 unique (entity, costcenter, period, scenario, version) tuples in the
    # seed (96 facts / 2 accounts) — one driver cell per non-account tuple.
    assert body["initial_computed_count"] == 48


def test_define_overwrites_existing_facts_with_computed(
    client: TestClient, seeded_store: DuckDBCubeStore
):
    client.post(
        "/drivers/define",
        json={
            "request_id": "drv-2",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    # Pick one intersection: 2026-01 / E001_US / CC100_Sales.
    # Seed Revenue = 1.123456 → expected OpEx after driver = 0.561728.
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["5000_OpEx"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == Decimal("1.123456") * Decimal("0.5")


def test_define_writes_audit_rows_with_who_driver(
    client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    client.post(
        "/drivers/define",
        json={
            "request_id": "drv-3",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    rows = hierarchy_seeded_metadata.fetch_rows_for_request("drv-3")
    assert len(rows) == 48
    assert all(r["who"] == "driver" for r in rows)
    assert all(r["source"].startswith("driver:initial") for r in rows)


# --- define: validation paths ---------------------------------------


def test_define_unknown_output_account_returns_400(client: TestClient):
    r = client.post(
        "/drivers/define",
        json={"request_id": "x", "account": "9999_NoSuch", "formula": "4000_Revenue"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "DRIVER_DEFINE_INVALID"


def test_define_non_leaf_output_account_returns_400(client: TestClient):
    r = client.post(
        "/drivers/define",
        json={"request_id": "x", "account": "Total_PnL", "formula": "4000_Revenue"},
    )
    assert r.status_code == 400


def test_define_bad_formula_returns_400(client: TestClient):
    """`1 +` is unambiguously broken (trailing operator); `1 + + 2` would
    actually parse as `1 + (+2)` because of unary-plus support."""
    r = client.post(
        "/drivers/define",
        json={"request_id": "x", "account": "5000_OpEx", "formula": "1 +"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "DRIVER_FORMULA_INVALID"


def test_define_unknown_reference_returns_400(client: TestClient):
    r = client.post(
        "/drivers/define",
        json={"request_id": "x", "account": "5000_OpEx", "formula": "Phantom * 2"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "DRIVER_REFERENCE_UNKNOWN"


def test_define_cycle_returns_400(client: TestClient):
    """A = B; defining B = A creates a cycle."""
    client.post(
        "/drivers/define",
        json={"request_id": "x", "account": "5000_OpEx", "formula": "4000_Revenue"},
    )
    r = client.post(
        "/drivers/define",
        json={"request_id": "y", "account": "4000_Revenue", "formula": "5000_OpEx"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "DRIVER_CYCLE"


def test_define_self_reference_returns_400(client: TestClient):
    r = client.post(
        "/drivers/define",
        json={"request_id": "x", "account": "5000_OpEx", "formula": "5000_OpEx + 1"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "DRIVER_CYCLE"


# --- recalc on submit -----------------------------------------------


def test_submit_to_input_triggers_driver_recalc(client: TestClient, seeded_store: DuckDBCubeStore):
    client.post(
        "/drivers/define",
        json={
            "request_id": "drv-r",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    # User submits a Revenue change at 2026-01/E001_US/CC100_Sales.
    client.post(
        "/submit",
        json={
            "request_id": "sub-after-drv",
            "cells": [
                {
                    "account": "4000_Revenue",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "1000.000000",
                }
            ],
        },
    )
    opex = seeded_store.slice(
        {
            "account": DimFilter(members=["5000_OpEx"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
        }
    )
    assert len(opex) == 1
    assert opex[0].value == Decimal("500.000000")  # 1000 * 0.5


def test_submit_to_driver_account_returns_400_with_driver_reason(client: TestClient):
    client.post(
        "/drivers/define",
        json={
            "request_id": "drv-r",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    r = client.post(
        "/submit",
        json={
            "request_id": "sub-bad",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "42.000000",
                }
            ],
        },
    )
    assert r.status_code == 400
    invalid = r.json()["detail"]["errors"][0]["invalid_members"]
    assert any(
        m["dim"] == "account" and m["member"] == "5000_OpEx" and m["reason"] == "driver"
        for m in invalid
    )


def test_get_drivers_empty_when_none_defined(client: TestClient):
    r = client.get("/drivers")
    assert r.status_code == 200
    assert r.json() == {"drivers": []}


def test_get_drivers_lists_defined_driver(client: TestClient):
    client.post(
        "/drivers/define",
        json={
            "request_id": "list-drv",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    r = client.get("/drivers")
    assert r.status_code == 200
    body = r.json()
    assert body["drivers"] == [{"account": "5000_OpEx", "formula": "4000_Revenue * 0.5"}]


# --- DELETE (Slice 9 — undefine) -------------------------------------


def test_delete_driver_succeeds_and_audits(
    client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    client.post(
        "/drivers/define",
        json={"request_id": "drv-d1", "account": "5000_OpEx", "formula": "4000_Revenue * 0.5"},
    )
    r = client.delete("/drivers/5000_OpEx", params={"request_id": "undef-1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["account"] == "5000_OpEx"
    assert body["formula"] == "4000_Revenue * 0.5"
    audit = hierarchy_seeded_metadata.fetch_rows_for_request("undef-1")
    assert len(audit) == 1
    assert audit[0]["source"] == "driver_change"
    assert "undefine" in audit[0]["details"]


def test_delete_driver_404_when_not_defined(client: TestClient):
    r = client.delete("/drivers/5000_OpEx", params={"request_id": "x"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "DRIVER_NOT_DEFINED"


def test_submit_to_undefined_account_legal_after_delete(client: TestClient):
    """Define -> submit-rejected -> undefine -> submit-accepted. Locks in the
    user-confirmed semantic that previously-driver accounts become editable
    once the driver row is gone."""
    client.post(
        "/drivers/define",
        json={"request_id": "drv-flow", "account": "5000_OpEx", "formula": "4000_Revenue * 0.5"},
    )
    bad = client.post(
        "/submit",
        json={
            "request_id": "sub-rej",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "42.000000",
                }
            ],
        },
    )
    assert bad.status_code == 400  # rejected: driver

    client.delete("/drivers/5000_OpEx", params={"request_id": "u"})

    ok = client.post(
        "/submit",
        json={
            "request_id": "sub-ok",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "42.000000",
                }
            ],
        },
    )
    assert ok.status_code == 200, ok.text


def test_submit_only_recalcs_affected_intersections(
    client: TestClient, seeded_store: DuckDBCubeStore
):
    """Submitting Revenue at 2026-01 must NOT change OpEx at 2026-02."""
    client.post(
        "/drivers/define",
        json={
            "request_id": "drv-i",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    # Original OpEx at 2026-02/E001_US/CC100_Sales after initial compute:
    # Revenue at that intersection = 2.123456 → OpEx = 1.061728
    expected_2026_02 = Decimal("2.123456") * Decimal("0.5")

    client.post(
        "/submit",
        json={
            "request_id": "sub-isolated",
            "cells": [
                {
                    "account": "4000_Revenue",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "9999.000000",
                }
            ],
        },
    )
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["5000_OpEx"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-02"]),
        }
    )
    assert rows[0].value == expected_2026_02
