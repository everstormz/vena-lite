"""GET /dimensions/{dim}/members — Slice 7 read endpoint."""
from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from vena_lite.api.deps import get_dim_model
from vena_lite.main import app
from vena_lite.metadata.dim_model import DimModel
from vena_lite.seed import ACCOUNTS, COSTCENTERS, ENTITIES, PERIODS, SCENARIOS, VERSIONS


@pytest.fixture
def client(dim_model: DimModel) -> Iterator[TestClient]:
    app.dependency_overrides[get_dim_model] = lambda: dim_model
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def test_get_dim_members_account_includes_parent_and_leaves(client: TestClient):
    r = client.get("/dimensions/account/members")
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == "account"
    ids = [m["id"] for m in body["members"]]
    # Total_PnL plus the leaf accounts.
    assert "Total_PnL" in ids
    for a in ACCOUNTS:
        assert a in ids


def test_get_dim_members_marks_leaves_correctly(client: TestClient):
    r = client.get("/dimensions/account/members")
    by_id = {m["id"]: m for m in r.json()["members"]}
    assert by_id["Total_PnL"]["is_leaf"] is False
    assert by_id["Total_PnL"]["parent"] is None
    assert by_id[ACCOUNTS[0]]["is_leaf"] is True
    assert by_id[ACCOUNTS[0]]["parent"] == "Total_PnL"


def test_get_dim_members_period_full_hierarchy(client: TestClient):
    r = client.get("/dimensions/period/members")
    by_id = {m["id"]: m for m in r.json()["members"]}
    # Year, quarters, months all present.
    assert "2026-FY" in by_id and not by_id["2026-FY"]["is_leaf"]
    assert "2026-Q1" in by_id and by_id["2026-Q1"]["parent"] == "2026-FY"
    assert by_id["2026-01"]["parent"] == "2026-Q1"
    assert by_id["2026-01"]["is_leaf"] is True
    for p in PERIODS:
        assert p in by_id


def test_get_dim_members_flat_dim(client: TestClient):
    """CostCenter is flat — every member is its own root + a leaf."""
    r = client.get("/dimensions/costcenter/members")
    by_id = {m["id"]: m for m in r.json()["members"]}
    for c in COSTCENTERS:
        assert by_id[c]["is_leaf"] is True
        assert by_id[c]["parent"] is None


def test_get_dim_members_scenario_and_version(client: TestClient):
    sc = client.get("/dimensions/scenario/members").json()
    assert {m["id"] for m in sc["members"]} >= set(SCENARIOS)
    ve = client.get("/dimensions/version/members").json()
    assert {m["id"] for m in ve["members"]} >= set(VERSIONS)


def test_get_dim_members_entity(client: TestClient):
    by_id = {m["id"]: m for m in client.get("/dimensions/entity/members").json()["members"]}
    for e in ENTITIES:
        assert e in by_id and by_id[e]["is_leaf"]
    assert by_id["Worldwide"]["is_leaf"] is False


def test_get_dim_members_unknown_dim_returns_422(client: TestClient):
    r = client.get("/dimensions/not_a_dim/members")
    assert r.status_code == 422
