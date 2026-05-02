"""POST /slice contract: validation, hierarchy expansion, aggregation, decimal-as-string."""

from __future__ import annotations

import json
from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from vena_lite.api.deps import get_cube, get_dim_model
from vena_lite.cube.store import DuckDBCubeStore
from vena_lite.main import app
from vena_lite.metadata.dim_model import DimModel
from vena_lite.seed import ACCOUNTS, EXPECTED_FACT_COUNT, deterministic_value


@pytest.fixture
def client(seeded_store: DuckDBCubeStore, dim_model: DimModel) -> Iterator[TestClient]:
    app.dependency_overrides[get_cube] = lambda: seeded_store
    app.dependency_overrides[get_dim_model] = lambda: dim_model
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


# --- baseline / health ----------------------------------------------


def test_health_endpoint(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_post_slice_empty_filters_200_with_96_rows(client: TestClient):
    r = client.post("/slice", json={"filters": {}})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == EXPECTED_FACT_COUNT == 96
    assert len(body["rows"]) == 96


def test_post_slice_with_account_leaf_filter_returns_48(client: TestClient):
    r = client.post(
        "/slice",
        json={"filters": {"account": {"members": [ACCOUNTS[0]]}}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 48
    assert all(row["account"] == ACCOUNTS[0] for row in body["rows"])


def test_post_slice_total_matches_len_rows(client: TestClient):
    r = client.post(
        "/slice",
        json={"filters": {"account": {"members": [ACCOUNTS[0]]}}},
    )
    body = r.json()
    assert body["total"] == len(body["rows"])


# --- decimal wire format --------------------------------------------


def test_post_slice_value_is_json_string_not_number(client: TestClient):
    r = client.post("/slice", json={"filters": {}})
    assert r.status_code == 200
    raw = r.text
    parsed = json.loads(raw)
    sample = parsed["rows"][0]
    assert isinstance(sample["value"], str)
    assert f'"value": "{sample["value"]}"' in raw or f'"value":"{sample["value"]}"' in raw


def test_post_slice_value_preserves_six_decimal_places_over_wire(client: TestClient):
    r = client.post("/slice", json={"filters": {}})
    body = r.json()
    for row in body["rows"]:
        # Seed values all end in ".123456".
        assert row["value"].endswith(".123456")


# --- validation (Slice 4 behavior change) ---------------------------


def test_post_slice_invalid_dim_name_returns_422(client: TestClient):
    """Unknown dim name in filters dict must fail Pydantic validation, not reach store."""
    r = client.post(
        "/slice",
        json={"filters": {"not_a_dim": {"members": ["x"]}}},
    )
    assert r.status_code == 422


def test_post_slice_unknown_member_returns_400(client: TestClient):
    """Slice 4: typos fail loudly. Previous behavior was silent empty result."""
    r = client.post(
        "/slice",
        json={"filters": {"account": {"members": ["nonsense"]}}},
    )
    assert r.status_code == 400
    body = r.json()
    assert body["detail"]["code"] == "MEMBER_UNKNOWN"
    assert body["detail"]["unknown"] == [{"dim": "account", "member": "nonsense"}]


def test_post_slice_empty_members_list_yields_empty_result(client: TestClient):
    """An explicit empty list still means 'match nothing' — not a validation error."""
    r = client.post(
        "/slice",
        json={"filters": {"account": {"members": []}}},
    )
    assert r.status_code == 200
    assert r.json() == {"rows": [], "total": 0}


# --- hierarchy: parent expansion + aggregation ----------------------


def test_post_slice_account_parent_aggregates_two_leaves(client: TestClient):
    """Total_PnL filter → one row per (entity, costcenter, period, scenario, version)
    with value = sum across both child accounts."""
    r = client.post(
        "/slice",
        json={
            "filters": {
                "account": {"members": ["Total_PnL"]},
                "entity": {"members": ["E001_US"]},
                "costcenter": {"members": ["CC100_Sales"]},
                "period": {"members": ["2026-01"]},
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    row = body["rows"][0]
    assert row["account"] == "Total_PnL"
    rev = deterministic_value("4000_Revenue", "E001_US", "CC100_Sales", "2026-01")
    opex = deterministic_value("5000_OpEx", "E001_US", "CC100_Sales", "2026-01")
    assert Decimal(row["value"]) == rev + opex


def test_post_slice_period_quarter_sums_three_months(client: TestClient):
    r = client.post(
        "/slice",
        json={
            "filters": {
                "account": {"members": ["4000_Revenue"]},
                "entity": {"members": ["E001_US"]},
                "costcenter": {"members": ["CC100_Sales"]},
                "period": {"members": ["2026-Q1"]},
            },
        },
    )
    body = r.json()
    assert body["total"] == 1
    row = body["rows"][0]
    assert row["period"] == "2026-Q1"
    expected = (
        deterministic_value("4000_Revenue", "E001_US", "CC100_Sales", "2026-01")
        + deterministic_value("4000_Revenue", "E001_US", "CC100_Sales", "2026-02")
        + deterministic_value("4000_Revenue", "E001_US", "CC100_Sales", "2026-03")
    )
    assert Decimal(row["value"]) == expected


def test_post_slice_period_year_sums_twelve_months(client: TestClient):
    r = client.post(
        "/slice",
        json={
            "filters": {
                "account": {"members": ["4000_Revenue"]},
                "entity": {"members": ["E001_US"]},
                "costcenter": {"members": ["CC100_Sales"]},
                "period": {"members": ["2026-FY"]},
            },
        },
    )
    body = r.json()
    assert body["total"] == 1
    expected = sum(
        (
            deterministic_value("4000_Revenue", "E001_US", "CC100_Sales", p)
            for p in [f"2026-{m:02d}" for m in range(1, 13)]
        ),
        Decimal(0),
    )
    assert Decimal(body["rows"][0]["value"]) == expected


def test_post_slice_two_dims_collapsed_simultaneously(client: TestClient):
    """Total_PnL + Worldwide → single row per (cc, period, scenario, version)
    with value = sum across both accounts × both entities (4 leaves)."""
    r = client.post(
        "/slice",
        json={
            "filters": {
                "account": {"members": ["Total_PnL"]},
                "entity": {"members": ["Worldwide"]},
                "costcenter": {"members": ["CC100_Sales"]},
                "period": {"members": ["2026-01"]},
            },
        },
    )
    body = r.json()
    assert body["total"] == 1
    row = body["rows"][0]
    assert row["account"] == "Total_PnL"
    assert row["entity"] == "Worldwide"
    expected = sum(
        (
            deterministic_value(a, e, "CC100_Sales", "2026-01")
            for a in ["4000_Revenue", "5000_OpEx"]
            for e in ["E001_US", "E002_UK"]
        ),
        Decimal(0),
    )
    assert Decimal(row["value"]) == expected


def test_post_slice_mixed_parent_and_leaf_in_same_dim(client: TestClient):
    """Quarter + standalone month → two rows."""
    r = client.post(
        "/slice",
        json={
            "filters": {
                "account": {"members": ["4000_Revenue"]},
                "entity": {"members": ["E001_US"]},
                "costcenter": {"members": ["CC100_Sales"]},
                "period": {"members": ["2026-Q1", "2026-07"]},
            },
        },
    )
    body = r.json()
    assert body["total"] == 2
    by_period = {r["period"]: r["value"] for r in body["rows"]}
    assert "2026-Q1" in by_period
    assert "2026-07" in by_period
    assert Decimal(by_period["2026-07"]) == deterministic_value(
        "4000_Revenue", "E001_US", "CC100_Sales", "2026-07"
    )
