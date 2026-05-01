"""GET /dimensions/{dim}/members — read-only helper for the add-in to populate
scenario / version / account dropdowns.

Validates `dim` against the v1 Literal type via FastAPI path parsing → 422 on
unknown dim. Walks `dim_model.all_members(dim)` and projects each member to
`(id, is_leaf, parent)`. No I/O beyond the dim_model snapshot reload.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..metadata.dim_model import DimModel
from ..schemas.dimensions import DimMemberInfo, DimMembersResponse, DimName
from .deps import get_dim_model

router = APIRouter()


@router.get("/dimensions/{dim}/members", response_model=DimMembersResponse)
def list_dim_members(
    dim: DimName,
    dim_model: DimModel = Depends(get_dim_model),
) -> DimMembersResponse:
    members: list[DimMemberInfo] = []
    for member_id in dim_model.all_members(dim):
        rec = dim_model._members.get((dim, member_id), {})  # noqa: SLF001
        members.append(
            DimMemberInfo(
                id=member_id,
                is_leaf=dim_model.is_leaf(dim, member_id),
                parent=rec.get("parent"),
                rollup_op=rec.get("rollup_op", "sum"),
            )
        )
    members.sort(key=lambda m: m.id)
    return DimMembersResponse(dim=dim, members=members)
