"""POST /overrides + DELETE /overrides — Slice 11 override lifecycle.

Coverage:
- happy path: define driver, override one cell, confirm value sticks across
  upstream submit (downstream recalc should NOT replace the override).
- release: re-fires recompute and the cell reverts to formula value.
- audit-log shape for both set + release (`source='override'`, details JSON).
- 400 on non-driver account; 400 on non-overridden release.
"""

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


# Helper — define `5000_OpEx = 4000_Revenue * 0.5` via the API so the test
# starts from a known state with one driver in play.
def _define_demo_driver(client: TestClient) -> None:
    r = client.post(
        "/drivers/define",
        json={
            "request_id": "drv-init",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    assert r.status_code == 200, r.text


# --- POST /overrides --------------------------------------------------


def test_post_overrides_writes_override_and_blocks_recompute(
    client: TestClient,
    seeded_store: DuckDBCubeStore,
):
    _define_demo_driver(client)

    # Override 5000_OpEx at one specific intersection.
    target = ("5000_OpEx", "E001_US", "CC100_Sales", "2026-01", "Actual", "v1")
    r = client.post(
        "/overrides",
        json={
            "request_id": "ov-1",
            "cells": [
                {
                    "account": target[0],
                    "entity": target[1],
                    "costcenter": target[2],
                    "period": target[3],
                    "scenario": target[4],
                    "version": target[5],
                    "value": "9999.000000",
                }
            ],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted_count"] == 1

    # Override is now the latest value at this intersection.
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[target[0]]),
            "entity": DimFilter(members=[target[1]]),
            "costcenter": DimFilter(members=[target[2]]),
            "period": DimFilter(members=[target[3]]),
            "scenario": DimFilter(members=[target[4]]),
            "version": DimFilter(members=[target[5]]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == Decimal("9999.000000")

    # Now /submit a new value to the upstream driver (4000_Revenue) at the
    # same intersection — the override on 5000_OpEx must NOT be replaced
    # by recompute (formula would say 0.5 * new_revenue).
    r = client.post(
        "/submit",
        json={
            "request_id": "sub-1",
            "cells": [
                {
                    "account": "4000_Revenue",
                    "entity": target[1],
                    "costcenter": target[2],
                    "period": target[3],
                    "scenario": target[4],
                    "version": target[5],
                    "value": "200.000000",
                }
            ],
        },
    )
    assert r.status_code == 200, r.text

    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[target[0]]),
            "entity": DimFilter(members=[target[1]]),
            "costcenter": DimFilter(members=[target[2]]),
            "period": DimFilter(members=[target[3]]),
            "scenario": DimFilter(members=[target[4]]),
            "version": DimFilter(members=[target[5]]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == Decimal("9999.000000"), (
        "override must survive a downstream recompute"
    )


def test_post_overrides_writes_audit_row_with_source_override(
    client: TestClient,
    hierarchy_seeded_metadata: SQLiteMetadataStore,
):
    _define_demo_driver(client)

    r = client.post(
        "/overrides",
        json={
            "request_id": "ov-audit",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "5555.000000",
                }
            ],
        },
    )
    assert r.status_code == 200, r.text

    rows = hierarchy_seeded_metadata.fetch_rows_for_request("ov-audit")
    override_rows = [row for row in rows if row["source"] == "override"]
    assert len(override_rows) == 1
    assert override_rows[0]["after_value"] == "5555.000000"
    assert override_rows[0]["details"] is None


def test_post_overrides_rejects_non_driver_account(client: TestClient):
    """4000_Revenue is NOT driver-controlled in this test — overriding it
    is a category error, the user should be using /submit instead.
    """
    r = client.post(
        "/overrides",
        json={
            "request_id": "ov-bad",
            "cells": [
                {
                    "account": "4000_Revenue",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "1.0",
                }
            ],
        },
    )
    assert r.status_code == 400
    body = r.json()["detail"]
    assert body["code"] == "INTERSECTION_INVALID"
    reasons = {im["reason"] for e in body["errors"] for im in e["invalid_members"]}
    assert "not_driver" in reasons


def test_post_overrides_rejects_unknown_member(client: TestClient):
    _define_demo_driver(client)
    r = client.post(
        "/overrides",
        json={
            "request_id": "ov-bad-2",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "GHOST_ENTITY",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "1.0",
                }
            ],
        },
    )
    assert r.status_code == 400
    body = r.json()["detail"]
    assert body["code"] == "INTERSECTION_INVALID"


# --- DELETE /overrides ------------------------------------------------


def test_delete_overrides_releases_to_formula_value(
    client: TestClient,
    seeded_store: DuckDBCubeStore,
):
    _define_demo_driver(client)

    target = ("5000_OpEx", "E001_US", "CC100_Sales", "2026-01", "Actual", "v1")
    inter_payload = {
        "account": target[0],
        "entity": target[1],
        "costcenter": target[2],
        "period": target[3],
        "scenario": target[4],
        "version": target[5],
    }

    # Set an override.
    client.post(
        "/overrides",
        json={
            "request_id": "ov-set",
            "cells": [{**inter_payload, "value": "9999.000000"}],
        },
    )

    # Capture the upstream Revenue value so we know what 0.5 * Revenue should be.
    rev_rows = seeded_store.slice(
        {
            "account": DimFilter(members=["4000_Revenue"]),
            "entity": DimFilter(members=[target[1]]),
            "costcenter": DimFilter(members=[target[2]]),
            "period": DimFilter(members=[target[3]]),
            "scenario": DimFilter(members=[target[4]]),
            "version": DimFilter(members=[target[5]]),
        }
    )
    assert len(rev_rows) == 1
    expected_release_value = rev_rows[0].value * Decimal("0.5")

    # Release the override.
    r = client.request(
        "DELETE",
        "/overrides",
        json={
            "request_id": "ov-rel",
            "cells": [inter_payload],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted_count"] == 1

    # Cube now shows the formula's value, not the override.
    rows = seeded_store.slice(
        {
            "account": DimFilter(members=[target[0]]),
            "entity": DimFilter(members=[target[1]]),
            "costcenter": DimFilter(members=[target[2]]),
            "period": DimFilter(members=[target[3]]),
            "scenario": DimFilter(members=[target[4]]),
            "version": DimFilter(members=[target[5]]),
        }
    )
    assert len(rows) == 1
    assert rows[0].value == expected_release_value


def test_delete_overrides_writes_release_audit_row(
    client: TestClient,
    hierarchy_seeded_metadata: SQLiteMetadataStore,
):
    _define_demo_driver(client)
    inter_payload = {
        "account": "5000_OpEx",
        "entity": "E001_US",
        "costcenter": "CC100_Sales",
        "period": "2026-01",
        "scenario": "Actual",
        "version": "v1",
    }
    client.post(
        "/overrides",
        json={"request_id": "ov-set-2", "cells": [{**inter_payload, "value": "1.0"}]},
    )
    r = client.request(
        "DELETE", "/overrides", json={"request_id": "ov-rel-2", "cells": [inter_payload]}
    )
    assert r.status_code == 200, r.text

    rows = hierarchy_seeded_metadata.fetch_rows_for_request("ov-rel-2")
    override_rows = [row for row in rows if row["source"] == "override"]
    assert len(override_rows) == 1
    import json as _json

    details = _json.loads(override_rows[0]["details"])
    assert details == {"action": "release"}


def test_delete_overrides_rejects_non_overridden_intersection(
    client: TestClient,
):
    _define_demo_driver(client)
    r = client.request(
        "DELETE",
        "/overrides",
        json={
            "request_id": "ov-rel-bad",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                }
            ],
        },
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "NOT_OVERRIDDEN"
