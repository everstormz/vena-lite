"""POST /scenarios/copy — copy + audit + dim_member registration."""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from vena_lite.api.deps import get_cube, get_dim_model, get_metadata
from vena_lite.cube.store import DuckDBCubeStore
from vena_lite.main import app
from vena_lite.metadata.dim_model import DimModel
from vena_lite.metadata.store import SQLiteMetadataStore
from vena_lite.schemas.dimensions import DimFilter
from vena_lite.seed import EXPECTED_FACT_COUNT


@pytest.fixture
def client(
    seeded_store: DuckDBCubeStore,
    hierarchy_seeded_metadata: SQLiteMetadataStore,
) -> Iterator[TestClient]:
    """Real metadata store (so scenarios/copy can persist new dim_members and
    the next get_dim_model() call sees them)."""
    app.dependency_overrides[get_cube] = lambda: seeded_store
    app.dependency_overrides[get_metadata] = lambda: hierarchy_seeded_metadata
    app.dependency_overrides[get_dim_model] = lambda: DimModel.from_store(hierarchy_seeded_metadata)
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


_BASE_COPY = {
    "request_id": "cp-1",
    "source": {"scenario": "Actual", "version": "v1"},
    "target": {"scenario": "Forecast", "version": "v1"},
}


# --- happy path -----------------------------------------------------


def test_copy_returns_count_matching_source_facts(client: TestClient):
    r = client.post("/scenarios/copy", json=_BASE_COPY)
    assert r.status_code == 200
    body = r.json()
    assert body["copied_count"] == EXPECTED_FACT_COUNT == 96


def test_copy_creates_target_scenario_member(
    client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    client.post("/scenarios/copy", json=_BASE_COPY)
    rows = hierarchy_seeded_metadata.fetch_dim_members()
    members = [(r[0], r[1]) for r in rows]
    assert ("scenario", "Forecast") in members


def test_copy_does_not_recreate_existing_version(
    client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    """Target version 'v1' already exists → not in created_members."""
    r = client.post("/scenarios/copy", json=_BASE_COPY)
    body = r.json()
    created = {(m["dim"], m["member"]) for m in body["created_members"]}
    assert ("scenario", "Forecast") in created
    assert ("version", "v1") not in created


def test_copy_creates_both_when_target_version_is_new(
    client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    payload = {
        **_BASE_COPY,
        "target": {"scenario": "Budget", "version": "v2"},
    }
    r = client.post("/scenarios/copy", json=payload)
    body = r.json()
    created = {(m["dim"], m["member"]) for m in body["created_members"]}
    assert ("scenario", "Budget") in created
    assert ("version", "v2") in created


def test_copy_target_facts_equal_source_facts(client: TestClient, seeded_store: DuckDBCubeStore):
    client.post("/scenarios/copy", json=_BASE_COPY)
    src = seeded_store.slice(
        {"scenario": DimFilter(members=["Actual"]), "version": DimFilter(members=["v1"])}
    )
    tgt = seeded_store.slice(
        {"scenario": DimFilter(members=["Forecast"]), "version": DimFilter(members=["v1"])}
    )
    assert len(src) == len(tgt)
    src_by_int = {(r.account, r.entity, r.costcenter, r.period): r.value for r in src}
    tgt_by_int = {(r.account, r.entity, r.costcenter, r.period): r.value for r in tgt}
    assert src_by_int == tgt_by_int


def test_copy_source_unchanged_after(client: TestClient, seeded_store: DuckDBCubeStore):
    before = seeded_store.slice(
        {"scenario": DimFilter(members=["Actual"]), "version": DimFilter(members=["v1"])}
    )
    client.post("/scenarios/copy", json=_BASE_COPY)
    after = seeded_store.slice(
        {"scenario": DimFilter(members=["Actual"]), "version": DimFilter(members=["v1"])}
    )
    assert {(r.account, r.entity, r.costcenter, r.period, r.value) for r in before} == {
        (r.account, r.entity, r.costcenter, r.period, r.value) for r in after
    }


def test_copy_writes_audit_rows_with_null_before(
    client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    client.post("/scenarios/copy", json=_BASE_COPY)
    rows = hierarchy_seeded_metadata.fetch_rows_for_request("cp-1")
    assert len(rows) == 96
    # Target was empty before → before_value IS NULL on every row.
    assert all(r["before_value"] is None for r in rows)
    # source field on the audit row is the literal "copy" we passed in.
    assert all(r["source"] == "copy" for r in rows)


# --- after-copy interactions ---------------------------------------


def test_subsequent_slice_at_target_returns_copied_facts(client: TestClient):
    client.post("/scenarios/copy", json=_BASE_COPY)
    r = client.post(
        "/slice",
        json={"filters": {"scenario": {"members": ["Forecast"]}}},
    )
    assert r.status_code == 200
    assert r.json()["total"] == 96


def test_submit_to_new_target_works(client: TestClient, seeded_store: DuckDBCubeStore):
    """After copy, Forecast is a known leaf scenario → submit accepted."""
    client.post("/scenarios/copy", json=_BASE_COPY)
    submit = {
        "request_id": "sub-after-copy",
        "cells": [
            {
                "account": "4000_Revenue",
                "entity": "E001_US",
                "costcenter": "CC100_Sales",
                "period": "2026-01",
                "scenario": "Forecast",
                "version": "v1",
                "value": "9999.000000",
            }
        ],
    }
    r = client.post("/submit", json=submit)
    assert r.status_code == 200
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["4000_Revenue"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
            "scenario": DimFilter(members=["Forecast"]),
            "version": DimFilter(members=["v1"]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == Decimal("9999.000000")


def test_recopy_appends_new_rows_latest_wins(client: TestClient, seeded_store: DuckDBCubeStore):
    """First copy populates Forecast. User then submits an edit. Re-copy from
    Actual overwrites — facts_current shows the re-copied (=Actual) value."""
    client.post("/scenarios/copy", json=_BASE_COPY)
    edit = {
        "request_id": "sub-edit",
        "cells": [
            {
                "account": "4000_Revenue",
                "entity": "E001_US",
                "costcenter": "CC100_Sales",
                "period": "2026-01",
                "scenario": "Forecast",
                "version": "v1",
                "value": "5555.000000",
            }
        ],
    }
    client.post("/submit", json=edit)

    # Re-copy with a new request_id.
    client.post("/scenarios/copy", json={**_BASE_COPY, "request_id": "cp-2"})

    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["4000_Revenue"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
            "scenario": DimFilter(members=["Forecast"]),
        }
    )
    assert len(rows) == 1
    # Re-copy brought back the source value (1.123456 from the seed).
    assert rows[0].value == Decimal("1.123456")


# --- validation paths -----------------------------------------------


def test_copy_unknown_source_returns_400(client: TestClient):
    payload = {
        **_BASE_COPY,
        "source": {"scenario": "NeverWasASc", "version": "v1"},
    }
    r = client.post("/scenarios/copy", json=payload)
    assert r.status_code == 400
    body = r.json()
    assert body["detail"]["code"] == "SCENARIO_COPY_INVALID"
    assert body["detail"]["source_errors"] == [
        {"dim": "scenario", "member": "NeverWasASc", "reason": "unknown"}
    ]


def test_copy_missing_request_id_returns_422(client: TestClient):
    payload = {k: v for k, v in _BASE_COPY.items() if k != "request_id"}
    r = client.post("/scenarios/copy", json=payload)
    assert r.status_code == 422


def test_copy_empty_source_version_returns_422(client: TestClient):
    payload = {
        **_BASE_COPY,
        "source": {"scenario": "Actual", "version": ""},
    }
    r = client.post("/scenarios/copy", json=payload)
    assert r.status_code == 422
