"""Submit request/response schemas. Decimal-as-string on the wire (same as slice).

`SubmittedCell` is the "submit" counterpart of `FactRow` — same dim members,
same Decimal precision, but the cell is a write intent, not a stored fact.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field, field_serializer


class SubmittedCell(BaseModel):
    account: str
    entity: str
    costcenter: str
    period: str
    scenario: str
    version: str
    value: Decimal

    @field_serializer("value")
    def _serialize_value(self, v: Decimal) -> str:
        return format(v, "f")


class SubmitRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    cells: list[SubmittedCell] = Field(min_length=1)


class InvalidMember(BaseModel):
    dim: str
    member: str
    # Slice 4: distinguish unknown-to-model vs known-but-not-leaf.
    reason: str | None = None


class CellValidationError(BaseModel):
    cell_index: int
    invalid_members: list[InvalidMember]


class SubmitResponse(BaseModel):
    request_id: str
    accepted_count: int
