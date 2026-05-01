"""POST /submit contract: validation (incl. leaf-only), atomic cube+audit write."""
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
from vena_lite.seed import ACCOUNTS, ENTITIES


@pytest.fixture
def client(
    seeded_store: DuckDBCubeStore,
    metadata_store: SQLiteMetadataStore,
    dim_model: DimModel,
) -> Iterator[TestClient]:
    app.dependency_overrides[get_cube] = lambda: seeded_store
    app.dependency_overrides[get_metadata] = lambda: metadata_store
    app.dependency_overrides[get_dim_model] = lambda: dim_model
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _existing_cell(value: str = "999.999999") -> dict:
    return {
        "account": "4000_Revenue",
        "entity": "E001_US",
        "costcenter": "CC100_Sales",
        "period": "2026-01",
        "scenario": "Actual",
        "version": "v1",
        "value": value,
    }


# --- happy path ----------------------------------------------------------


def test_submit_one_cell_returns_200_and_accepted_count(client: TestClient):
    r = client.post(
        "/submit",
        json={"request_id": "req-1", "cells": [_existing_cell()]},
    )
    assert r.status_code == 200
    assert r.json() == {"request_id": "req-1", "accepted_count": 1}


def test_submit_writes_new_value_to_cube(
    client: TestClient, seeded_store: DuckDBCubeStore
):
    client.post(
        "/submit",
        json={"request_id": "req-2", "cells": [_existing_cell(value="42.000000")]},
    )
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["4000_Revenue"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == Decimal("42.000000")


def test_submit_writes_audit_rows_with_before_and_after(
    client: TestClient, metadata_store: SQLiteMetadataStore
):
    client.post(
        "/submit",
        json={"request_id": "req-3", "cells": [_existing_cell(value="55.000000")]},
    )
    rows = metadata_store.fetch_rows_for_request("req-3")
    assert len(rows) == 1
    assert rows[0]["before_value"] == "1.123456"
    assert rows[0]["after_value"] == "55.000000"
    assert rows[0]["who"] == "local"
    assert rows[0]["source"] == "submit"


def test_submit_subsequent_slice_returns_new_value(
    client: TestClient, seeded_store: DuckDBCubeStore
):
    client.post(
        "/submit",
        json={"request_id": "req-4", "cells": [_existing_cell(value="7.000000")]},
    )
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["4000_Revenue"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
        }
    )
    assert rows[0].value == Decimal("7.000000")


def test_submit_total_row_count_grows_by_zero_in_facts_current(
    client: TestClient, seeded_store: DuckDBCubeStore
):
    """facts_current dedupes — 96 facts in, 96 facts out, even after a submit."""
    client.post(
        "/submit",
        json={"request_id": "req-5", "cells": [_existing_cell(value="11.000000")]},
    )
    assert len(seeded_store.slice({})) == 96


# --- validation paths ----------------------------------------------------


def test_submit_unknown_account_returns_400(client: TestClient):
    bad = _existing_cell()
    bad["account"] = "9999_NotReal"
    r = client.post("/submit", json={"request_id": "req-bad", "cells": [bad]})
    assert r.status_code == 400
    body = r.json()
    assert body["detail"]["code"] == "INTERSECTION_INVALID"
    invalid = body["detail"]["errors"][0]["invalid_members"][0]
    assert invalid["dim"] == "account"
    assert invalid["member"] == "9999_NotReal"
    assert invalid["reason"] == "unknown"


def test_submit_non_leaf_account_returns_400(client: TestClient):
    """Slice 4: parents are read-only. Submitting at Total_PnL must fail."""
    bad = _existing_cell()
    bad["account"] = "Total_PnL"
    r = client.post("/submit", json={"request_id": "req-parent", "cells": [bad]})
    assert r.status_code == 400
    body = r.json()
    invalid = body["detail"]["errors"][0]["invalid_members"][0]
    assert invalid["dim"] == "account"
    assert invalid["member"] == "Total_PnL"
    assert invalid["reason"] == "non_leaf"


def test_submit_non_leaf_period_returns_400(client: TestClient):
    bad = _existing_cell()
    bad["period"] = "2026-Q1"
    r = client.post("/submit", json={"request_id": "req-q1", "cells": [bad]})
    assert r.status_code == 400
    invalid = r.json()["detail"]["errors"][0]["invalid_members"][0]
    assert invalid["dim"] == "period"
    assert invalid["reason"] == "non_leaf"


def test_submit_partial_invalid_rolls_back_all(
    client: TestClient,
    seeded_store: DuckDBCubeStore,
    metadata_store: SQLiteMetadataStore,
):
    good = _existing_cell(value="100.000000")
    bad = _existing_cell()
    bad["entity"] = "E999_NoSuchEntity"

    r = client.post(
        "/submit",
        json={"request_id": "req-partial", "cells": [good, bad]},
    )
    assert r.status_code == 400
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[ACCOUNTS[0]]),
            "entity": DimFilter(members=[ENTITIES[0]]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
        }
    )
    assert rows[0].value == Decimal("1.123456")
    assert metadata_store.count_rows_for_request("req-partial") == 0


def test_submit_empty_cells_list_returns_422(client: TestClient):
    r = client.post("/submit", json={"request_id": "req-empty", "cells": []})
    assert r.status_code == 422


def test_submit_missing_request_id_returns_422(client: TestClient):
    r = client.post("/submit", json={"cells": [_existing_cell()]})
    assert r.status_code == 422


# --- atomicity -----------------------------------------------------------


def test_submit_audit_failure_rolls_back_cube(
    monkeypatch,
    client: TestClient,
    seeded_store: DuckDBCubeStore,
    metadata_store: SQLiteMetadataStore,
):
    def _failing_append(_rows):
        raise RuntimeError("simulated audit disk failure")

    monkeypatch.setattr(metadata_store, "append_audit_rows", _failing_append)

    with pytest.raises(RuntimeError, match="simulated audit disk failure"):
        client.post(
            "/submit",
            json={
                "request_id": "req-atomic",
                "cells": [_existing_cell(value="999.000000")],
            },
        )

    monkeypatch.undo()

    rows = seeded_store.slice(
        {
            "account": DimFilter(members=["4000_Revenue"]),
            "entity": DimFilter(members=["E001_US"]),
            "costcenter": DimFilter(members=["CC100_Sales"]),
            "period": DimFilter(members=["2026-01"]),
        }
    )
    assert rows[0].value == Decimal("1.123456"), "cube should be rolled back"
    assert metadata_store.count_rows_for_request("req-atomic") == 0
