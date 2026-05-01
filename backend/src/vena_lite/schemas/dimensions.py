"""Dimension types — single source of truth for dim names and filter shape.

`DimName` is a `Literal` so Pydantic and the TypeScript generator both surface
unknown dim names as compile/parse errors instead of runtime mysteries.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

DimName = Literal["account", "entity", "costcenter", "period", "scenario", "version"]

DIM_NAMES: tuple[DimName, ...] = (
    "account",
    "entity",
    "costcenter",
    "period",
    "scenario",
    "version",
)


class DimFilter(BaseModel):
    """Filter on one dimension. `members=None` means 'all members of this dim'."""

    members: list[str] | None = None


# --- Slice 7 read endpoints --------------------------------------------------


class DimMemberInfo(BaseModel):
    """One row in `GET /dimensions/{dim}/members`."""

    id: str
    is_leaf: bool
    parent: str | None = None
    rollup_op: str = "sum"


class DimMembersResponse(BaseModel):
    dim: str
    members: list[DimMemberInfo]
