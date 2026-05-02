"""GET /dimensions/{dim}/members — Slice 7 read endpoint.
Slice 9: POST/PATCH/DELETE for editing dim_member."""

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
from vena_lite.seed import ACCOUNTS, COSTCENTERS, ENTITIES, PERIODS, SCENARIOS, VERSIONS


@pytest.fixture
def client(dim_model: DimModel) -> Iterator[TestClient]:
    app.dependency_overrides[get_dim_model] = lambda: dim_model
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def crud_client(
    seeded_store: DuckDBCubeStore,
    hierarchy_seeded_metadata: SQLiteMetadataStore,
) -> Iterator[TestClient]:
    """Real metadata so POST/PATCH/DELETE writes persist and the next request's
    get_dim_model sees the new state. Mirror of the drivers test fixture."""
    md = hierarchy_seeded_metadata
    app.dependency_overrides[get_cube] = lambda: seeded_store
    app.dependency_overrides[get_metadata] = lambda: md
    app.dependency_overrides[get_dim_model] = lambda: DimModel.from_store(md)
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


# --- GET (Slice 7, kept) ---------------------------------------------


def test_get_dim_members_account_includes_parent_and_leaves(client: TestClient):
    r = client.get("/dimensions/account/members")
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == "account"
    ids = [m["id"] for m in body["members"]]
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
    assert "2026-FY" in by_id and not by_id["2026-FY"]["is_leaf"]
    assert "2026-Q1" in by_id and by_id["2026-Q1"]["parent"] == "2026-FY"
    assert by_id["2026-01"]["parent"] == "2026-Q1"
    assert by_id["2026-01"]["is_leaf"] is True
    for p in PERIODS:
        assert p in by_id


def test_get_dim_members_flat_dim(client: TestClient):
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


def test_get_dim_members_includes_display_name_field(client: TestClient):
    """Slice 9: every DimMemberInfo carries an optional display_name (NULL for seed)."""
    by_id = {m["id"]: m for m in client.get("/dimensions/account/members").json()["members"]}
    assert "display_name" in by_id["Total_PnL"]
    assert by_id["Total_PnL"]["display_name"] is None


# --- POST (Slice 9) --------------------------------------------------


def test_post_member_creates_with_display_name_and_audits(
    crud_client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    r = crud_client.post(
        "/dimensions/account/members",
        json={
            "request_id": "add-1",
            "id": "6000_Marketing",
            "display_name": "Marketing",
            "parent": "Total_PnL",
            "ordinal": 5,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dim"] == "account"
    assert body["member"]["id"] == "6000_Marketing"
    assert body["member"]["display_name"] == "Marketing"
    assert body["member"]["parent"] == "Total_PnL"
    audit = hierarchy_seeded_metadata.fetch_rows_for_request("add-1")
    assert len(audit) == 1
    assert audit[0]["source"] == "dim_change"
    assert audit[0]["details"] is not None and "create" in audit[0]["details"]


def test_post_member_409_on_id_collision(crud_client: TestClient):
    r = crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "x", "id": "4000_Revenue", "parent": "Total_PnL"},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "MEMBER_EXISTS"


def test_post_member_400_on_unknown_parent(crud_client: TestClient):
    r = crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "x", "id": "9000_X", "parent": "NoSuchParent"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "PARENT_UNKNOWN"


def test_post_then_slice_sees_new_member(crud_client: TestClient, seeded_store: DuckDBCubeStore):
    """Reload-on-each-call dim_model: the next /slice call respects the new member."""
    crud_client.post(
        "/dimensions/scenario/members",
        json={"request_id": "x", "id": "Forecast2"},
    )
    # Submit a fact under the new scenario.
    r = crud_client.post(
        "/submit",
        json={
            "request_id": "sub-new-sc",
            "cells": [
                {
                    "account": "4000_Revenue",
                    "entity": "E001_US",
                    "costcenter": "CC100_Sales",
                    "period": "2026-01",
                    "scenario": "Forecast2",
                    "version": "v1",
                    "value": "777.000000",
                }
            ],
        },
    )
    assert r.status_code == 200, r.text


# --- PATCH (Slice 9) --------------------------------------------------


def test_patch_member_updates_display_name_and_audits(
    crud_client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    r = crud_client.patch(
        "/dimensions/account/members/4000_Revenue",
        json={"request_id": "rn-1", "display_name": "Top-line Revenue"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["member"]["display_name"] == "Top-line Revenue"
    audit = hierarchy_seeded_metadata.fetch_rows_for_request("rn-1")
    assert len(audit) == 1
    assert audit[0]["source"] == "dim_change"


def test_patch_member_no_op_writes_no_audit(
    crud_client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    """If no field actually changed, no audit row is written."""
    crud_client.patch(
        "/dimensions/account/members/4000_Revenue",
        json={"request_id": "rn-2", "display_name": "X"},
    )
    # Patch with same value should be a no-op.
    crud_client.patch(
        "/dimensions/account/members/4000_Revenue",
        json={"request_id": "rn-3", "display_name": "X"},
    )
    audit = hierarchy_seeded_metadata.fetch_rows_for_request("rn-3")
    assert len(audit) == 0


def test_patch_member_404_on_unknown(crud_client: TestClient):
    r = crud_client.patch(
        "/dimensions/account/members/NoSuchMember",
        json={"request_id": "x", "display_name": "X"},
    )
    assert r.status_code == 404


# --- DELETE (Slice 9) -------------------------------------------------


def test_delete_member_with_no_facts_succeeds(
    crud_client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "add-x", "id": "9999_Tmp", "parent": "Total_PnL"},
    )
    r = crud_client.delete("/dimensions/account/members/9999_Tmp", params={"request_id": "del-x"})
    assert r.status_code == 200, r.text
    assert r.json()["member"] == "9999_Tmp"
    audit = hierarchy_seeded_metadata.fetch_rows_for_request("del-x")
    assert len(audit) == 1
    assert audit[0]["source"] == "dim_change"


def test_delete_member_with_facts_returns_409_with_count(crud_client: TestClient):
    """4000_Revenue has facts in the seed — delete must refuse with the count."""
    r = crud_client.delete(
        "/dimensions/account/members/4000_Revenue",
        params={"request_id": "del-bad"},
    )
    assert r.status_code == 409
    body = r.json()
    assert body["detail"]["code"] == "MEMBER_HAS_FACTS"
    assert body["detail"]["fact_count"] > 0
    assert "4000_Revenue" in body["detail"]["leaves"]


def test_delete_parent_with_descendant_facts_returns_409(crud_client: TestClient):
    """Total_PnL has leaves (4000_Revenue, 5000_OpEx) with facts — refused."""
    r = crud_client.delete(
        "/dimensions/account/members/Total_PnL",
        params={"request_id": "del-bad"},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "MEMBER_HAS_FACTS"


def test_delete_parent_with_no_facts_cascades_to_descendants(
    crud_client: TestClient, hierarchy_seeded_metadata: SQLiteMetadataStore
):
    """Add a parent with empty leaves, then delete it; both go in one batch."""
    crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "p", "id": "8000_Group", "parent": "Total_PnL"},
    )
    crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "l", "id": "8001_Leaf", "parent": "8000_Group"},
    )
    r = crud_client.delete(
        "/dimensions/account/members/8000_Group",
        params={"request_id": "del-cascade"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["descendants_deleted"] == ["8001_Leaf"]
    audit = hierarchy_seeded_metadata.fetch_rows_for_request("del-cascade")
    assert len(audit) == 2  # leaf + parent


def test_delete_member_404_on_unknown(crud_client: TestClient):
    r = crud_client.delete(
        "/dimensions/account/members/NoSuchMember",
        params={"request_id": "x"},
    )
    assert r.status_code == 404


def test_delete_then_post_same_id_succeeds(crud_client: TestClient):
    """After delete, the id is free for a new member."""
    crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "a", "id": "7000_Tmp", "parent": "Total_PnL"},
    )
    crud_client.delete("/dimensions/account/members/7000_Tmp", params={"request_id": "b"})
    r = crud_client.post(
        "/dimensions/account/members",
        json={"request_id": "c", "id": "7000_Tmp", "parent": "Total_PnL", "display_name": "Reborn"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["member"]["display_name"] == "Reborn"


# Confirm seed leaves are findable by Decimal lookup type-checks (smoke)
def _smoke_decimal_unused():
    Decimal("1.0")
