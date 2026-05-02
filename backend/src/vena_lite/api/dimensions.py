"""Dimension members API.

GET (Slice 7) lists members for a dim — feeds add-in pickers.

Slice 9 adds CRUD:
  POST   /dimensions/{dim}/members        — add a member
  PATCH  /dimensions/{dim}/members/{id}   — change display_name and/or ordinal
  DELETE /dimensions/{dim}/members/{id}   — remove member (and descendants) if no facts reference it

`id` is immutable. `parent` cannot be changed (no reparent in v1). The
mutable alias is `display_name` (NULL → render falls back to id).
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from ..audit import build_dim_change_audit_row
from ..cube.store import DuckDBCubeStore
from ..metadata.dim_model import DimModel
from ..metadata.store import SQLiteMetadataStore
from ..schemas.dimensions import (
    DimFilter,
    DimMemberCreateRequest,
    DimMemberDeleteResponse,
    DimMemberInfo,
    DimMemberMutationResponse,
    DimMembersResponse,
    DimMemberUpdateRequest,
    DimName,
)
from .deps import get_cube, get_dim_model, get_metadata

router = APIRouter()


def _to_member_info(dim_model: DimModel, dim: str, member_id: str) -> DimMemberInfo:
    rec = dim_model.lookup(dim, member_id) or {}
    return DimMemberInfo(
        id=member_id,
        is_leaf=dim_model.is_leaf(dim, member_id),
        parent=rec.get("parent"),
        rollup_op=rec.get("rollup_op", "sum"),
        display_name=rec.get("display_name"),
    )


@router.get("/dimensions/{dim}/members", response_model=DimMembersResponse)
def list_dim_members(
    dim: DimName,
    dim_model: DimModel = Depends(get_dim_model),
) -> DimMembersResponse:
    members = [_to_member_info(dim_model, dim, mid) for mid in dim_model.all_members(dim)]
    members.sort(key=lambda m: m.id)
    return DimMembersResponse(dim=dim, members=members)


@router.post("/dimensions/{dim}/members", response_model=DimMemberMutationResponse)
def create_dim_member(
    dim: DimName,
    req: DimMemberCreateRequest,
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
) -> DimMemberMutationResponse:
    if req.parent is not None and not dim_model.is_known(dim, req.parent):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "PARENT_UNKNOWN",
                "message": f"Parent {req.parent!r} not in dim {dim!r}",
            },
        )
    display_name = req.display_name if req.display_name else None
    row = (dim, req.id, req.parent, req.rollup_op, req.ordinal, display_name)
    audit_row = build_dim_change_audit_row(
        request_id=req.request_id,
        dim=dim,
        member=req.id,
        field="create",
        before=None,
        after={
            "parent": req.parent,
            "ordinal": req.ordinal,
            "rollup_op": req.rollup_op,
            "display_name": display_name,
        },
    )
    try:
        with audit.transaction():
            audit.insert_dim_member(row)
            audit.append_audit_rows([audit_row])
            audit_id = audit.last_audit_id()
    except sqlite3.IntegrityError as e:
        raise HTTPException(
            status_code=409,
            detail={"code": "MEMBER_EXISTS", "message": f"({dim!r}, {req.id!r}) already exists"},
        ) from e

    fresh_model = DimModel.from_store(audit)
    return DimMemberMutationResponse(
        request_id=req.request_id,
        dim=dim,
        member=_to_member_info(fresh_model, dim, req.id),
        audit_id=audit_id,
    )


@router.patch("/dimensions/{dim}/members/{member_id}", response_model=DimMemberMutationResponse)
def update_dim_member_endpoint(
    dim: DimName,
    member_id: str,
    req: DimMemberUpdateRequest,
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
) -> DimMemberMutationResponse:
    if not dim_model.is_known(dim, member_id):
        raise HTTPException(
            status_code=404,
            detail={
                "code": "MEMBER_UNKNOWN",
                "message": f"({dim!r}, {member_id!r}) not in dim model",
            },
        )

    fields = req.model_dump(exclude_unset=True, exclude={"request_id"})
    with audit.transaction():
        changes = audit.update_dim_member(dim, member_id, fields)
        last_id = audit.last_audit_id()
        for field, (before, after) in changes.items():
            audit.append_audit_rows(
                [
                    build_dim_change_audit_row(
                        request_id=req.request_id,
                        dim=dim,
                        member=member_id,
                        field=field,
                        before=before,
                        after=after,
                    )
                ]
            )
            last_id = audit.last_audit_id()

    fresh_model = DimModel.from_store(audit)
    return DimMemberMutationResponse(
        request_id=req.request_id,
        dim=dim,
        member=_to_member_info(fresh_model, dim, member_id),
        audit_id=last_id,
    )


@router.delete("/dimensions/{dim}/members/{member_id}", response_model=DimMemberDeleteResponse)
def delete_dim_member_endpoint(
    dim: DimName,
    member_id: str,
    request_id: str,
    cube: DuckDBCubeStore = Depends(get_cube),
    audit: SQLiteMetadataStore = Depends(get_metadata),
    dim_model: DimModel = Depends(get_dim_model),
) -> DimMemberDeleteResponse:
    if not dim_model.is_known(dim, member_id):
        raise HTTPException(
            status_code=404,
            detail={
                "code": "MEMBER_UNKNOWN",
                "message": f"({dim!r}, {member_id!r}) not in dim model",
            },
        )

    # Compute the leaf footprint we'd need to delete.
    if dim_model.is_leaf(dim, member_id):
        leaves = [member_id]
        descendants_to_delete: list[str] = []
    else:
        leaves = dim_model.get_leaves(dim, member_id)
        descendants_to_delete = list(leaves)

    # Cube fact-count check. Read-only.
    if leaves:
        existing = cube.slice({dim: DimFilter(members=leaves)})
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "MEMBER_HAS_FACTS",
                    "fact_count": len(existing),
                    "leaves": sorted({getattr(r, dim) for r in existing}),
                },
            )

    members_to_delete = [*descendants_to_delete, member_id]
    with audit.transaction():
        audit.delete_dim_members(dim, members_to_delete)
        audit_rows = [
            build_dim_change_audit_row(
                request_id=request_id,
                dim=dim,
                member=m,
                field="delete",
                before=m,
                after=None,
            )
            for m in members_to_delete
        ]
        audit.append_audit_rows(audit_rows)
        last_id = audit.last_audit_id()

    return DimMemberDeleteResponse(
        request_id=request_id,
        dim=dim,
        member=member_id,
        descendants_deleted=descendants_to_delete,
        audit_id=last_id,
    )
