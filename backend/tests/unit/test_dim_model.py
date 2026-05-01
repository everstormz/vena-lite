"""DimModel: known/leaf/get_leaves over the seeded hierarchy."""
from __future__ import annotations

from vena_lite.hierarchy_seed import hierarchy_seed
from vena_lite.metadata.dim_model import DimModel
from vena_lite.seed import ACCOUNTS, COSTCENTERS, ENTITIES, PERIODS, SCENARIOS, VERSIONS


def test_seeded_hierarchy_loads(dim_model: DimModel):
    assert dim_model.is_known("account", "Total_PnL")
    assert dim_model.is_known("account", "4000_Revenue")
    assert dim_model.is_known("entity", "Worldwide")
    assert dim_model.is_known("period", "2026-FY")
    assert dim_model.is_known("period", "2026-Q1")
    assert dim_model.is_known("period", "2026-01")


def test_unknown_member_is_not_known(dim_model: DimModel):
    assert not dim_model.is_known("account", "9999_NotReal")
    assert not dim_model.is_known("period", "1999-01")


def test_leaf_detection(dim_model: DimModel):
    # Leaves
    assert dim_model.is_leaf("account", "4000_Revenue")
    assert dim_model.is_leaf("period", "2026-01")
    assert dim_model.is_leaf("scenario", "Actual")  # flat dim → leaf
    # Parents
    assert not dim_model.is_leaf("account", "Total_PnL")
    assert not dim_model.is_leaf("entity", "Worldwide")
    assert not dim_model.is_leaf("period", "2026-FY")
    assert not dim_model.is_leaf("period", "2026-Q1")


def test_get_leaves_for_leaf_returns_self(dim_model: DimModel):
    assert dim_model.get_leaves("account", "4000_Revenue") == ["4000_Revenue"]
    assert dim_model.get_leaves("period", "2026-01") == ["2026-01"]


def test_get_leaves_for_one_level_parent(dim_model: DimModel):
    leaves = dim_model.get_leaves("account", "Total_PnL")
    assert sorted(leaves) == sorted(ACCOUNTS)


def test_get_leaves_for_two_level_parent_recurses(dim_model: DimModel):
    """Year → quarters → months. Year should yield all 12 month leaves."""
    leaves = dim_model.get_leaves("period", "2026-FY")
    assert sorted(leaves) == sorted(PERIODS)
    assert len(leaves) == 12


def test_get_leaves_for_quarter(dim_model: DimModel):
    leaves = dim_model.get_leaves("period", "2026-Q1")
    assert sorted(leaves) == ["2026-01", "2026-02", "2026-03"]


def test_get_leaves_for_unknown_member_is_empty(dim_model: DimModel):
    assert dim_model.get_leaves("account", "Nope") == []


def test_all_leaves_matches_seed_lists(dim_model: DimModel):
    assert sorted(dim_model.all_leaves("account")) == sorted(ACCOUNTS)
    assert sorted(dim_model.all_leaves("entity")) == sorted(ENTITIES)
    assert sorted(dim_model.all_leaves("costcenter")) == sorted(COSTCENTERS)
    assert sorted(dim_model.all_leaves("period")) == sorted(PERIODS)
    assert sorted(dim_model.all_leaves("scenario")) == sorted(SCENARIOS)
    assert sorted(dim_model.all_leaves("version")) == sorted(VERSIONS)


def test_hierarchy_seed_leaves_match_cube_seed():
    """The leaf members in the hierarchy MUST line up with the cube's leaf seed."""
    model = DimModel(list(hierarchy_seed()))
    assert sorted(model.all_leaves("account")) == sorted(ACCOUNTS)
    assert sorted(model.all_leaves("entity")) == sorted(ENTITIES)
    assert sorted(model.all_leaves("costcenter")) == sorted(COSTCENTERS)
    assert sorted(model.all_leaves("period")) == sorted(PERIODS)
    assert sorted(model.all_leaves("scenario")) == sorted(SCENARIOS)
    assert sorted(model.all_leaves("version")) == sorted(VERSIONS)
