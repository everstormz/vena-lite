"""Dimension types — single source of truth for dim names and filter shape.

`DimName` is a `Literal` so Pydantic and the TypeScript generator both surface
unknown dim names as compile/parse errors instead of runtime mysteries.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

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
    """One row in `GET /dimensions/{dim}/members`.

    Slice 9: `display_name` is the user-facing alias. NULL → render falls back
    to `id`. Cube facts and driver formulas always reference `id` (immutable).
    """

    id: str
    is_leaf: bool
    parent: str | None = None
    rollup_op: str = "sum"
    display_name: str | None = None


class DimMembersResponse(BaseModel):
    dim: str
    members: list[DimMemberInfo]


# --- Slice 9 dim CRUD --------------------------------------------------------


class DimMemberCreateRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    id: str = Field(min_length=1, max_length=128)
    display_name: str | None = None
    parent: str | None = None
    ordinal: int = 0
    rollup_op: str = "sum"


class DimMemberUpdateRequest(BaseModel):
    """PATCH body. Omitted fields stay unchanged. `display_name=null` clears
    the alias (renders as id again). No `id` (immutable). No `parent` (no
    reparent in v1)."""

    request_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = None
    ordinal: int | None = None


class DimMemberMutationResponse(BaseModel):
    request_id: str
    dim: DimName
    member: DimMemberInfo
    audit_id: int


class DimMemberDeleteResponse(BaseModel):
    request_id: str
    dim: DimName
    member: str
    descendants_deleted: list[str]
    audit_id: int
