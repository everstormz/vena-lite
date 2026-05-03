"""GET /value — single-cell lookup for Excel's =VENA custom function."""

from __future__ import annotations

from collections.abc import Iterator

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


def test_get_value_returns_seeded_intersection(client: TestClient):
    r = client.get(
        "/value",
        params={
            "account": "4000_Revenue",
            "entity": "E001_US",
            "costcenter": "CC100_Sales",
            "period": "2026-01",
            "scenario": "Actual",
            "version": "v1",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["account"] == "4000_Revenue"
    assert body["period"] == "2026-01"
    assert isinstance(body["value"], str)
    assert body["source"].startswith("seed")


def test_get_value_returns_404_for_missing_intersection(client: TestClient):
    r = client.get(
        "/value",
        params={
            "account": "4000_Revenue",
            "entity": "E001_US",
            "costcenter": "CC100_Sales",
            "period": "2099-01",  # not in seed
            "scenario": "Actual",
            "version": "v1",
        },
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "VALUE_NOT_FOUND"


def test_get_value_reports_override_source_when_overridden(client: TestClient):
    """After a successful /overrides POST, /value reports source='override:...'."""
    client.post(
        "/drivers/define",
        json={
            "request_id": "drv-v",
            "account": "5000_OpEx",
            "formula": "4000_Revenue * 0.5",
        },
    )
    client.post(
        "/overrides",
        json={
            "request_id": "ov-v",
            "cells": [
                {
                    "account": "5000_OpEx",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Actual",
                    "version": "v1",
                    "value": "777.000000",
                }
            ],
        },
    )
    r = client.get(
        "/value",
        params={
            "account": "5000_OpEx",
            "entity": "E001_US",
            "costcenter": "CC100_Sales",
            "period": "2026-01",
            "scenario": "Actual",
            "version": "v1",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["value"] == "777.000000"
    assert body["source"].startswith("override:")
